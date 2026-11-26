// Run with the installed Harness Electron in Node mode so its app.asar is readable.
// Usage: ELECTRON_RUN_AS_NODE=1 <Harness executable> scripts/test-installed-harness.cjs <app.asar/dsh/node_modules>
// No network, profile changes, or real credentials: exercise the installed catalog with an in-memory grant.
const assert = require('node:assert/strict')
const path = require('node:path')
const modules = process.argv[2]
assert.ok(modules, 'pass the installed Harness node_modules directory (inside app.asar on macOS)')
const load = name => require(path.join(modules, '@deepseek-ai', name, 'lib/index.js'))
const { Context } = load('cordis')
const { LlmRuntime } = load('dsh-llm')
const piAi = load('dsh-llm-pi-ai')
const bridge = require('../lib/index.js')
const recordKey = 'llm-pi-ai/github-copilot'
const settle = () => new Promise(resolve => setImmediate(resolve))

async function main() {
  const originalFetch = globalThis.fetch
  let metadataRequests = 0
  let usageRequests = 0
  globalThis.fetch = async (url, init) => {
    if (url === 'https://api.github.com/copilot_internal/user') {
      usageRequests++
      assert.equal(init.headers.Authorization, 'token fixture-only')
      assert.equal(init.redirect, 'error')
      return Response.json({ token_based_billing: true, quota_snapshots: { premium_interactions: { entitlement: 100000, quota_remaining: 53916.3, percent_remaining: 53.9 } } })
    }
    assert.equal(url, 'https://api.individual.githubcopilot.com/models', 'unexpected network request')
    assert.equal(init.redirect, 'error')
    metadataRequests++
    return Response.json({ data: [{ id: 'claude-haiku-4.5',
      billing: { token_prices: { batch_size: 1_000_000, default: { input_price: 5, output_price: 25, cache_read_price: 0 } }, promo: { discount_percent: 50 } },
      warning_text: { model_pending_deprecation: 'Provider retirement warning' },
    }] })
  }
  const ctx = new Context()
  new LlmRuntime(ctx)
  piAi.apply(ctx, piAi.Config({ providers: { 'github-copilot': {} } }))
  const consumer = ctx.extend().llm
  const baseline = await consumer.listModels('github-copilot')
  const hidden = 'claude-haiku-4.5'
  assert.ok(baseline.some(model => model.id === hidden), 'fixture must be in the installed catalog')
  const key = 'llm-pi-ai/github-copilot'
  let record = { kind: 'grant', payload: {
    type: 'oauth', access: 'fixture-only', refresh: 'fixture-only', expires: Number.MAX_SAFE_INTEGER,
    availableModelIds: baseline.map(model => model.id),
  } }
  ctx.provide('credentials', {
    async readRecord() { return record },
    async modifyRecord(_key, update) {
      const next = await update(record)
      if (next !== undefined) { record = next; ctx.emit('credentials/record-updated', key) }
      return record
    },
    async deleteRecord() { record = undefined },
  })
  const routes = new Map()
  ctx.provide('connection', { fetch: { register(route) {
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } })
  const fiber = ctx.plugin(bridge, { hiddenModels: [hidden] })
  try {
    await settle()
    const models = await consumer.listModels('github-copilot')
    assert.ok(!models.some(model => model.id === hidden), 'hidden model is still visible in the installed picker catalog')
    assert.equal(models.length, baseline.length - 1)
    assert.ok(!record.payload.availableModelIds.includes(hidden), 'grant filtering must still work')
    const response = await routes.get('/api/copilot-bridge/models').fetch(new Request('https://localhost/api/copilot-bridge/models'))
    assert.equal(response.status, 200)
    const catalog = (await response.json()).value
    assert.equal(catalog.models.length, baseline.length, 'management must include hidden rows')
    const row = catalog.models.find(model => model.id === hidden)
    assert.ok(row, 'a hidden model must remain restorable in Plugins')
    assert.notEqual(row.name, row.id, 'resolve actual display metadata from the installed pi-ai adapter')
    assert.ok(row.contextWindow > 0)
    assert.ok(row.inputModalities.includes('image'))
    assert.deepEqual(row.pricing, { input: 5, output: 25, cacheRead: 0 })
    assert.equal(row.promotion.discountPercent, 50)
    assert.equal(row.retiring, 'Provider retirement warning')
    assert.equal(metadataRequests, 1, 'metadata enriches management, not picker visibility')
    assert.ok(!JSON.stringify(catalog).includes('fixture-only'), 'never expose grant secrets')
    const usageResponse = await routes.get('/api/copilot-bridge/usage').fetch(new Request('https://localhost/api/copilot-bridge/usage'))
    assert.equal(usageResponse.status, 200)
    const usage = (await usageResponse.json()).value
    assert.equal(usage.used, 46083.7)
    assert.equal(usage.total, 100000)
    assert.equal(usageRequests, 1)
    assert.ok(!JSON.stringify(usage).includes('fixture-only'), 'quota must never expose credentials')
    console.log(JSON.stringify({ baseline: baseline.length, filtered: models.length, hiddenOmitted: true, management: catalog.models.length, hiddenMetadata: { name: row.name, contextWindow: row.contextWindow } }))
    await fiber.dispose()
    assert.equal((await consumer.listModels('github-copilot')).length, baseline.length, 'unload must restore the catalog')
    console.log('PASS: installed pi-ai adapter + LLM service + bridge; catalog restored on unload')
  } finally {
    globalThis.fetch = originalFetch
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
}
async function testProviderSetup(initiallyWritable) {
  const { createVolatile, updateVolatile } = load('cosmokit')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('provider setup must use the fixture grant, not the network') }
  const ctx = new Context()
  const runtime = new LlmRuntime(ctx)
  const config = piAi.Config({ providers: {} })
  piAi.apply(ctx, config)
  let providers = {}
  let revision = 0
  let writes = 0
  const settings = {
    writable: initiallyWritable,
    configure: () => () => {},
    describe: () => [{ ns: 'llm-pi-ai', value: { providers }, revision }],
    async mutate(ns, ops, expectedRevision) {
      assert.equal(settings.writable, true)
      assert.equal(ns, 'llm-pi-ai')
      assert.equal(expectedRevision, revision)
      assert.deepEqual(ops, [{ op: 'set', path: ['providers', 'github-copilot'], value: {} }])
      providers = { ...providers, 'github-copilot': {} }
      revision++
      writes++
      updateVolatile(config.providers, createVolatile(providers))
      ctx.emit('loader/volatile-update', [['providers', 'github-copilot']])
    },
  }
  ctx.provide('settings', settings)
  let catalogUpdates = 0
  ctx.on('llm/models-updated', provider => { if (provider === 'github-copilot') catalogUpdates++ })
  let record = { kind: 'grant', payload: { type: 'oauth', access: 'fixture-only', refresh: 'fixture-only', expires: Number.MAX_SAFE_INTEGER } }
  ctx.provide('credentials', {
    async readRecord() { return record },
    async modifyRecord(_key, update) {
      const next = await update(record)
      if (next !== undefined) { record = next; ctx.emit('credentials/record-updated', recordKey) }
      return record
    },
    async deleteRecord() { record = undefined; ctx.emit('credentials/record-updated', recordKey) },
  })
  const routes = new Map()
  ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); return async () => {} } } })
  const fiber = ctx.plugin(bridge)
  const request = async (action, method = 'POST') => {
    const response = await routes.get(`/api/copilot-bridge/${action}`).fetch(new Request(`https://localhost/api/copilot-bridge/${action}`, { method }))
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    return body.value
  }
  try {
    await settle()
    assert.ok(!runtime.listProviders().some(provider => provider.id === 'github-copilot'))
    if (!initiallyWritable) {
      const warning = await request('login')
      assert.equal(warning.authenticated, true)
      assert.equal(warning.providerSetup, 'warning')
      assert.equal(writes, 0)
      assert.equal(record.payload.refresh, 'fixture-only')
      settings.writable = true
    }
    const signedIn = await request('login')
    assert.equal(signedIn.authenticated, true)
    assert.equal(signedIn.providerSetup, 'ready')
    assert.ok(runtime.listProviders().some(provider => provider.id === 'github-copilot'))
    assert.ok((await runtime.listModels('github-copilot')).length > 0)
    assert.equal(record.payload.availableModelIds, undefined, 'fixture must model a fresh grant without account discovery')
    const catalog = await request('models', 'GET')
    assert.equal(catalog.status.modelCatalogSource, 'provider')
    assert.equal(catalog.models.length, (await runtime.listModels('github-copilot')).length, 'management must populate before any chat request')
    assert.ok(catalog.models.some(model => model.id === 'claude-haiku-4.5'))
    assert.equal((await request('login')).providerSetup, 'ready')
    assert.equal(writes, 1, 'repeated sign-in must not recreate a configured provider')
    const beforeLogout = catalogUpdates
    assert.equal((await request('logout')).authenticated, false)
    await settle()
    assert.deepEqual(providers, { 'github-copilot': {} }, 'sign-out retains provider configuration')
    assert.equal(writes, 1)
    assert.ok(runtime.listProviders().some(provider => provider.id === 'github-copilot'))
    assert.deepEqual(await runtime.listModels('github-copilot'), [], 'a retained provider must not advertise models after logout')
    assert.ok(catalogUpdates > beforeLogout, 'logout must invalidate remote model pickers')
    record = { kind: 'grant', payload: { type: 'oauth', access: 'fixture-again', refresh: 'fixture-again', expires: Number.MAX_SAFE_INTEGER } }
    ctx.emit('credentials/record-updated', recordKey)
    await settle()
    assert.ok((await runtime.listModels('github-copilot')).length > 0, 'models return on sign-in without recreating the provider')
    console.log(`PASS: installed pi-ai provider auto-configuration${initiallyWritable ? '' : ' after read-only warning/retry'}; logout hides models and invalidates selectors, sign-in restores them`)
  } finally {
    globalThis.fetch = originalFetch
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
}
main().then(() => testProviderSetup(true)).then(() => testProviderSetup(false)).catch(error => { console.error(error); process.exitCode = 1 })
