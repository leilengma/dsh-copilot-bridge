// Shared, memory-only setup for the two installed-runtime checks. No desktop services
// are started: only the installed Loader, LLM registry, native adapter and catalog method.
const assert = require('node:assert/strict')
const path = require('node:path')
const net = require('node:net')

const BRIDGE = 'copilot-bridge'
const BRIDGE_KEY = 'copilot-bridge/github'
const NATIVE = 'github-copilot'
const NATIVE_KEY = 'llm-pi-ai/github-copilot'
const MODEL_IDS = ['mai-code-2', 'mai-code-2-flash']
const settle = () => new Promise(resolve => setImmediate(resolve))
const modelIds = models => models.map(model => model.id)

const modelsPayload = {
  data: MODEL_IDS.map(id => ({
    id, name: `Fixture ${id}`, model_picker_enabled: true,
    supported_endpoints: ['/chat/completions', '/responses'],
    capabilities: {
      type: 'chat',
      limits: { max_context_window_tokens: 200_000, max_output_tokens: 32_000 },
      supports: { tool_calls: true, streaming: true },
    },
  })),
}

async function createHarnessFixture() {
  const modules = process.argv[2]
  assert.ok(modules, 'pass the installed Harness node_modules directory (inside app.asar on macOS)')
  const load = name => require(path.join(modules, '@deepseek-ai', name, 'lib/index.js'))
  const originalFetch = globalThis.fetch
  const originalConnect = net.Socket.prototype.connect
  const unexpectedNetwork = []
  const requests = []
  const rejectNetwork = kind => {
    unexpectedNetwork.push(kind)
    throw new Error(`unexpected network: ${kind}`)
  }
  // The fetch allowlist is exhaustive, including inference. The socket guard also
  // blocks SDKs that bypass global fetch; swallowed network errors fail close().
  net.Socket.prototype.connect = function () { return rejectNetwork('socket connection') }
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const allowed = [
      'https://api.github.com/copilot_internal/v2/token',
      'https://api.individual.githubcopilot.com/models',
    ]
    if (!allowed.includes(url)) return rejectNetwork('non-fixture fetch')
    requests.push(url)
    assert.equal(init?.method ?? 'GET', 'GET')
    assert.equal(init.redirect, 'error')
    assert.equal(init.signal.aborted, false)
    const headers = new Headers(init.headers)
    assert.match(headers.get('user-agent'), /^deepseek-harness\//)
    if (url === allowed[0]) {
      assert.ok(headers.get('authorization') === 'Bearer fixture-bridge-oauth', 'exchange must use only the bridge fixture credential')
      return Response.json({ token: 'fixture-copilot-access', expires_at: Date.now() / 1000 + 3600,
        refresh_in: 1800, endpoints: { api: 'https://api.individual.githubcopilot.com' } })
    }
    assert.ok(headers.get('authorization') === 'Bearer fixture-copilot-access', 'discovery must use the exchanged fixture token')
    return Response.json(modelsPayload)
  }

  let ctx
  const close = async () => {
    try { await ctx?.fiber.dispose() } finally {
      globalThis.fetch = originalFetch
      net.Socket.prototype.connect = originalConnect
    }
    assert.deepEqual(unexpectedNetwork, [], 'no unexpected network, even if a runtime caught the rejection')
  }
  try {
    const { Context } = load('cordis')
    const { Loader } = load('cordis-plugin-loader')
    const { LlmRuntime } = load('dsh-llm')
    const { SessionController } = load('dsh-api-session-controller')
    const piAi = load('dsh-llm-pi-ai')
    const bridge = require('../lib/index.js')
    ctx = new Context()
    const loader = new Loader(ctx)
    const runtime = new LlmRuntime(ctx)
    const records = new Map([
      [BRIDGE_KEY, { kind: 'grant', payload: { type: 'github-oauth', token: 'fixture-bridge-oauth' } }],
      [NATIVE_KEY, { kind: 'grant', payload: {
        type: 'oauth', access: 'fixture-native-only', refresh: 'fixture-native-only', expires: Number.MAX_SAFE_INTEGER,
      } }],
    ])
    const originalNativeRecord = structuredClone(records.get(NATIVE_KEY))
    const credentialWrites = []
    ctx.provide('credentials', {
      async readRecord(key) {
        assert.ok(key === BRIDGE_KEY || key === NATIVE_KEY, 'unexpected credential read')
        return records.get(key)
      },
      async modifyRecord(key, update) {
        assert.equal(key, BRIDGE_KEY, 'only bridge credentials may be written')
        credentialWrites.push(key)
        const next = await update(records.get(key))
        if (next !== undefined) { records.set(key, next); ctx.emit('credentials/record-updated', key) }
        return records.get(key)
      },
      async deleteRecord(key) {
        assert.equal(key, BRIDGE_KEY, 'only bridge credentials may be deleted')
        credentialWrites.push(key)
        records.delete(key)
        ctx.emit('credentials/record-updated', key)
      },
    })
    const nativeConfig = piAi.Config({ providers: { [NATIVE]: {} } })
    const originalNativeConfig = structuredClone(nativeConfig.providers.get())
    piAi.apply(ctx, nativeConfig)
    await settle()
    const nativeModels = await runtime.listModels(NATIVE)
    assert.ok(nativeModels.length > 0, 'installed native catalog must be populated')
    const originalListModels = runtime.listModels
    const routes = new Map()
    ctx.provide('connection', { fetch: { register(route) {
      assert.ok(!routes.has(route.path), `duplicate route ${route.path}`)
      routes.set(route.path, route)
      return async () => { routes.delete(route.path) }
    } } })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: BRIDGE, model: 'mai-code-2' }) })
    let entryId
    const settingWrites = []
    const updateConfig = async (id, config) => {
      assert.equal(id, entryId, 'settings writes must target only the fixture bridge entry')
      settingWrites.push(structuredClone(config))
      await loader.update(id, { config })
    }
    ctx.provide('settings', {
      configure: () => () => {},
      async update(id, patch) {
        const keys = Object.keys(patch)
        assert.equal(keys.length, 1, 'one preference per settings update')
        assert.ok(keys[0] === 'hiddenModels' || keys[0] === 'pinnedModels', 'only bridge model preferences may be updated')
        await updateConfig(id, { ...loader.resolve(id).options.config, ...patch })
      },
      async mutate(id, ops) {
        assert.equal(ops.length, 1)
        const key = ops[0].path[0]
        assert.ok(key === 'hiddenModels' || key === 'pinnedModels', 'only bridge model preferences may be unset')
        assert.deepEqual(ops, [{ op: 'unset', path: [key] }])
        const config = { ...loader.resolve(id).options.config }
        delete config[key]
        await updateConfig(id, config)
      },
    })
    loader.builtins.bridge = bridge
    const updates = []
    ctx.on('llm/models-updated', provider => { updates.push(provider) })
    const mount = async (config = {}) => {
      entryId = await loader.create({ name: 'cordis:bridge', config })
      await loader.await()
      await settle()
      assert.ok(runtime.listProviders().some(provider => provider.id === BRIDGE), 'bridge Loader entry must register its adapter')
      return entryId
    }
    const request = async (action, body) => {
      const route = routes.get(`/api/copilot-bridge/${action}`)
      assert.ok(route, `missing route ${action}`)
      const response = await route.fetch(new Request(`https://localhost/api/copilot-bridge/${action}`, {
        method: body === undefined ? 'GET' : 'POST',
        ...body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      }))
      const envelope = await response.json()
      assert.equal(response.status, 200, `route ${action} must succeed`)
      assert.equal(envelope.ok, true, `route ${action} must return a success envelope`)
      assert.ok(!/fixture-(?:bridge-oauth|copilot-access|native-only)/.test(JSON.stringify(envelope)), 'routes must not expose fixture secrets')
      return envelope.value
    }
    // Invoke the installed public catalog method, not a reconstruction. Full
    // SessionController startup needs unrelated session/persistence services.
    const catalog = async () => {
      const result = await SessionController.prototype.modelCatalog.call({ ctx })
      assert.deepEqual(result.failures, [], 'no provider failure may be hidden by an empty picker')
      return result
    }
    const assertNativeUnchanged = async () => {
      assert.deepEqual(nativeConfig.providers.get(), originalNativeConfig, 'native profile was changed')
      assert.deepEqual(records.get(NATIVE_KEY), originalNativeRecord, 'native credential was changed')
      assert.equal(runtime.listModels, originalListModels, 'bridge must not wrap runtime.listModels')
      assert.deepEqual(await runtime.listModels(NATIVE), nativeModels, 'native catalog was changed')
      const group = (await catalog()).groups.find(group => group.id === NATIVE)
      assert.deepEqual(modelIds(group.models), modelIds(nativeModels), 'native picker group was changed')
      assert.ok(updates.every(provider => provider === BRIDGE), 'bridge must notify only its own route')
    }
    return { ctx, loader, runtime, load, records, routes, requests, credentialWrites, settingWrites, updates,
      mount, request, catalog, assertNativeUnchanged, close }
  } catch (error) {
    await close()
    throw error
  }
}

module.exports = { createHarnessFixture, BRIDGE, BRIDGE_KEY, NATIVE, MODEL_IDS, modelIds, settle }
