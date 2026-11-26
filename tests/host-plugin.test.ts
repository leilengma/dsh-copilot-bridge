import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { attributionHeaders, LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { apply } from '../src/host/index.ts'
import { BRIDGE_PROVIDER, BRIDGE_RECORD_KEY } from '../src/shared/contract.ts'
import { modelsPayload } from './fixtures/copilot-models.ts'

const settle = () => new Promise(resolve => setImmediate(resolve))
const ids = (models: readonly { id: string }[]) => models.map(model => model.id)
const supported = ['claude-sonnet-5', 'gpt-6', 'grok-4.7', 'mai-code-2', 'mai-code-2-flash', 'gemini-3-pro', 'kimi-k3']
const account = (token = 'fixture-oauth', enterpriseHost?: string): CredentialRecord => ({
  kind: 'grant', payload: { type: 'github-oauth', token, ...enterpriseHost === undefined ? {} : { enterpriseHost } },
})

class NativeCatalog extends LlmAdapter {
  override async listModels(provider: string) { return [{ provider, id: 'mai-code-2', name: 'Native MAI' }] }
  override async *stream() { throw new Error('native route must not be used by the bridge') }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function host(t: TestContext, options: { signedOut?: boolean; lateLlm?: boolean; hidden?: string[] } = {}) {
  const ctx = new Context()
  const enterpriseUrl = createVolatile('')
  const hiddenModels = createVolatile(options.hidden ?? [])
  const routes = new Map<string, ConnectionFetchRoute>()
  const records = new Map<string, CredentialRecord>([
    ['llm-pi-ai/github-copilot', { kind: 'api-key', key: 'native-user-owned' }],
  ])
  if (!options.signedOut) records.set(BRIDGE_RECORD_KEY, account())
  const credentialWrites: string[] = []
  const settingWrites: unknown[] = []
  const updates: string[] = []
  const requests: { url: string; init: RequestInit | undefined }[] = []
  let discovery: (init?: RequestInit) => Promise<Response> = async () => Response.json(modelsPayload)
  let inference: (init?: RequestInit) => Promise<Response> = async () => { throw new Error('unexpected inference') }
  let exchanges = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push({ url, init })
    if (url.endsWith('/copilot_internal/v2/token')) {
      exchanges++
      const host = new URL(url).hostname.slice(4)
      return Response.json({ token: `fixture-access-${exchanges}`, expires_at: Date.now() / 1000 + 3600,
        refresh_in: 1800, endpoints: { api: host === 'github.com' ? 'https://api.individual.githubcopilot.com' : `https://copilot-api.${host}` } })
    }
    if (url.endsWith('/models')) return discovery(init)
    return inference(init)
  })
  ctx.provide('connection', { fetch: { register(route: ConnectionFetchRoute) {
    assert.ok(!routes.has(route.path), `duplicate route ${route.path}`)
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } })
  ctx.provide('credentials', {
    async readRecord(key: string) { assert.equal(key, BRIDGE_RECORD_KEY, 'bridge must never read native credentials'); return records.get(key) },
    async modifyRecord(key: CredentialKey, update: (record: CredentialRecord | undefined) => CredentialRecord | undefined) {
      credentialWrites.push(key)
      const value = update(records.get(key))
      if (value) records.set(key, value)
      ctx.emit('credentials/record-updated', key)
      return value
    },
    async deleteRecord(key: CredentialKey) { credentialWrites.push(key); records.delete(key); ctx.emit('credentials/record-updated', key) },
  })
  let entry!: Context
  const emitEdit = (field: string) => {
    const self: Context = Object.create(entry)
    Object.defineProperty(self, Context.filter, { value: (owner: Context) => owner.fiber === entry.fiber })
    entry.emit(self, 'loader/volatile-update', [[field]])
  }
  ctx.provide('settings', {
    configure() { return () => {} },
    async update(_id: string, patch: { hiddenModels?: string[]; enterpriseUrl?: string }) {
      settingWrites.push(patch)
      if (patch.hiddenModels) { updateVolatile(hiddenModels, createVolatile(patch.hiddenModels)); emitEdit('hiddenModels') }
      if (patch.enterpriseUrl !== undefined) { updateVolatile(enterpriseUrl, createVolatile(patch.enterpriseUrl)); emitEdit('enterpriseUrl') }
    },
    async mutate(_id: string, operations: { path: string[] }[]) {
      settingWrites.push(operations)
      for (const { path } of operations) {
        if (path[0] === 'hiddenModels') updateVolatile(hiddenModels, createVolatile([]))
        if (path[0] === 'enterpriseUrl') updateVolatile(enterpriseUrl, createVolatile(''))
        emitEdit(path[0]!)
      }
    },
  })
  ctx.on('llm/models-updated', provider => { updates.push(provider) })
  let runtime: LlmRuntime
  const mountLlm = () => {
    runtime = new LlmRuntime(ctx)
    runtime.registerAdapter(['github-copilot', 'other'], new NativeCatalog())
    return runtime
  }
  if (!options.lateLlm) mountLlm()
  const nativeList = ctx.get('llm')?.listModels
  const mount = () => ctx.plugin({ apply(child: Context) {
    entry = child
    Object.defineProperty(child.fiber, 'entry', { value: { options: { id: 'bridge-fixture' } } })
    apply(child, { enterpriseUrl, hiddenModels })
  } })
  const plugin = mount()
  t.after(async () => { await ctx.fiber.dispose() })
  return {
    ctx, plugin, mount, mountLlm, nativeList, records, updates, requests, credentialWrites, settingWrites, hiddenModels,
    get runtime() { return runtime }, get exchanges() { return exchanges },
    discover(next: typeof discovery) { discovery = next }, infer(next: typeof inference) { inference = next },
    editHidden(next: string[]) { updateVolatile(hiddenModels, createVolatile(next)); emitEdit('hiddenModels') },
    editHost(next: string) { updateVolatile(enterpriseUrl, createVolatile(next)); emitEdit('enterpriseUrl') },
    setAccount(next: CredentialRecord | undefined) {
      if (next) records.set(BRIDGE_RECORD_KEY, next)
      else records.delete(BRIDGE_RECORD_KEY)
      ctx.emit('credentials/record-updated', credentialKey('copilot-bridge', 'github'))
    },
    async request(path: string, body?: unknown) {
      const route = routes.get(`/api/copilot-bridge/${path}`)
      assert.ok(route, `missing route ${path}`)
      const response = await route.fetch(new Request(`https://localhost/api/copilot-bridge/${path}`, {
        method: body === undefined ? 'GET' : 'POST', ...body === undefined ? {} : { body: JSON.stringify(body) },
      }))
      return { status: response.status, envelope: await response.json() }
    },
    async picker() { await settle(); return ids(await runtime.listModels(BRIDGE_PROVIDER)) },
  }
}

test('host registers the bridge on late LLM injection; saved session resolution awaits live discovery without touching native routes', async t => {
  const h = host(t, { lateLlm: true, hidden: ['mai-code-2'] })
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  h.mountLlm()
  await settle()
  assert.deepEqual(h.runtime.listProviders().map(provider => provider.id).sort(), ['copilot-bridge', 'github-copilot', 'other'])
  let resolved = false
  const saved = h.runtime.resolveModelInfo(BRIDGE_PROVIDER, 'mai-code-2').then(model => { resolved = true; return model })
  await settle()
  assert.equal(resolved, false)
  gate.resolve(Response.json(modelsPayload))
  assert.equal((await saved).id, 'mai-code-2')
  assert.deepEqual(await h.picker(), supported.filter(id => id !== 'mai-code-2'))
  assert.equal(Object.hasOwn(h.runtime, 'listModels'), false)
  assert.deepEqual(ids(await h.runtime.listModels('github-copilot')), ['mai-code-2'])
  assert.deepEqual(h.records.get('llm-pi-ai/github-copilot'), { kind: 'api-key', key: 'native-user-owned' })
  assert.deepEqual(h.credentialWrites, [])
  assert.ok(h.updates.length > 0)
  assert.ok(h.updates.every(provider => provider === BRIDGE_PROVIDER))
})

test('hide/reveal and all-hidden changes refresh only the bridge picker; routes expose supported and disabled rows', async t => {
  const h = host(t)
  assert.deepEqual(await h.picker(), supported)
  const view = (await h.request('models')).envelope.value
  assert.equal(view.state, 'ready')
  assert.equal(view.status.provider, BRIDGE_PROVIDER)
  assert.deepEqual(view.models.find((row: { id: string }) => row.id === 'mai-code-2'), {
    id: 'mai-code-2', name: 'Name mai-code-2', protocol: 'openai-responses', contextWindow: 200_000, inputModalities: ['text'],
  })
  assert.equal(view.models.find((row: { id: string }) => row.id === 'claude-opus-5').disabledReason, 'not-offered')
  assert.equal(view.models.find((row: { id: string }) => row.id === 'future-realtime').disabledReason, 'unsupported-protocol')
  assert.ok(!JSON.stringify(view).includes('fixture-access'))
  const before = h.updates.length
  assert.equal((await h.request('hidden-models', { hiddenModels: ['mai-code-2'] })).status, 200)
  assert.deepEqual(await h.picker(), supported.filter(id => id !== 'mai-code-2'))
  assert.equal((await h.runtime.resolveModelInfo(BRIDGE_PROVIDER, 'mai-code-2')).id, 'mai-code-2')
  assert.equal((await h.request('hidden-models', { hiddenModels: ['claude-opus-5'] })).status, 400)
  assert.equal((await h.request('hidden-models', { hiddenModels: ['future-realtime'] })).status, 400)
  await h.request('hidden-models', { hiddenModels: supported })
  assert.deepEqual(await h.picker(), [])
  assert.equal((await h.request('models')).envelope.value.models.length, 10)
  await h.request('hidden-models', { hiddenModels: supported.filter(id => id !== 'mai-code-2') })
  assert.deepEqual(await h.picker(), ['mai-code-2'])
  await h.request('hidden-models', { hiddenModels: [] })
  assert.deepEqual(await h.picker(), supported)
  assert.deepEqual(h.settingWrites.at(-1), [{ op: 'unset', path: ['hiddenModels'] }])
  assert.ok(h.updates.length > before)
  assert.ok(h.updates.every(provider => provider === BRIDGE_PROVIDER))
  assert.deepEqual(ids(await h.runtime.listModels('github-copilot')), ['mai-code-2'])
  assert.equal(Object.hasOwn(h.runtime, 'listModels'), false)
  assert.deepEqual(h.credentialWrites, [])
})

test('manual refresh keeps the last good catalog and hidden ids after failure, then accepts known empty', async t => {
  const h = host(t, { hidden: ['mai-code-2'] })
  await h.picker()
  h.discover(async () => new Response('fixture-access-secret', { status: 503 }))
  const failed = (await h.request('models/refresh', {})).envelope.value
  assert.equal(failed.state, 'error')
  assert.equal(failed.error, 'Copilot model discovery failed (HTTP 503)')
  assert.deepEqual(failed.status.hiddenModels, ['mai-code-2'])
  assert.equal(failed.models.length, 10)
  assert.deepEqual(await h.picker(), supported.filter(id => id !== 'mai-code-2'))
  assert.deepEqual(h.hiddenModels.get(), ['mai-code-2'])
  h.discover(async () => Response.json({ data: [] }))
  const empty = (await h.request('models/refresh', {})).envelope.value
  assert.equal(empty.state, 'ready')
  assert.deepEqual(empty.models, [])
  assert.deepEqual(await h.picker(), [])
})

test('sign-out discards discovery, clears hidden config, and empties the picker without changing native state', async t => {
  const h = host(t, { hidden: ['mai-code-2'] })
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  await settle()
  const pending = h.picker()
  await settle()
  const before = h.updates.length
  const logout = await h.request('logout', {})
  assert.equal(logout.envelope.value.authenticated, false)
  assert.deepEqual(await h.picker(), [])
  assert.deepEqual(h.hiddenModels.get(), [])
  assert.ok(h.updates.length > before)
  gate.resolve(Response.json(modelsPayload))
  assert.deepEqual(await pending, [])
  assert.deepEqual((await h.request('models')).envelope.value.models, [])
  assert.deepEqual(ids(await h.runtime.listModels('github-copilot')), ['mai-code-2'])
  assert.deepEqual(h.credentialWrites, [BRIDGE_RECORD_KEY])
  h.discover(async () => Response.json(modelsPayload))
  h.setAccount(account('second-account'))
  assert.deepEqual(await h.picker(), supported)
  h.setAccount(undefined)
  assert.deepEqual(await h.picker(), [])
})

test('host switch gates a preserved account, discards old discovery and resumes only for a matching signed-in host', async t => {
  const h = host(t, { hidden: ['mai-code-2'] })
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  await settle()
  const old = h.picker()
  await settle()
  h.editHost('https://acme.ghe.com/')
  assert.deepEqual(await h.picker(), [])
  assert.deepEqual(h.hiddenModels.get(), [])
  const status = (await h.request('status')).envelope.value
  assert.equal(status.signedInHost, 'github.com')
  const before = h.requests.length
  gate.resolve(Response.json(modelsPayload))
  assert.deepEqual(await old, [])
  await h.request('models/refresh', {})
  assert.equal(h.requests.length, before, 'a mismatched account cannot make even discovery requests')
  h.discover(async () => Response.json(modelsPayload))
  h.setAccount(account('enterprise-account', 'acme.ghe.com'))
  assert.deepEqual(await h.picker(), supported)
  assert.ok(h.requests.some(request => request.url === 'https://copilot-api.acme.ghe.com/models'))
})

test('unload/reload disposes registration, routes, timers, pending discovery and listeners', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = host(t)
  await h.picker()
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  const refresh = h.request('models/refresh', {})
  await settle()
  const pendingRequest = h.requests.at(-1)!
  await h.plugin.dispose()
  assert.equal(pendingRequest.init?.signal?.aborted, true)
  assert.ok(!h.runtime.listProviders().some(provider => provider.id === BRIDGE_PROVIDER))
  const before = h.requests.length
  const updates = h.updates.length
  h.setAccount(account('changed-while-unloaded'))
  h.editHidden(['mai-code-2'])
  t.mock.timers.tick(1_800_000)
  await settle()
  assert.equal(h.requests.length, before)
  assert.equal(h.updates.length, updates)
  gate.resolve(Response.json(modelsPayload))
  await refresh
  h.discover(async () => Response.json(modelsPayload))
  const reloaded = h.mount()
  assert.deepEqual(await h.picker(), supported.filter(id => id !== 'mai-code-2'))
  const after = h.updates.length
  h.editHidden([])
  assert.equal(h.updates.length - after, 1, 'reload must have exactly one volatile listener')
  await reloaded.dispose()
})

test('management metadata uses the exchanged endpoint and every discovery/exchange/metadata request is attributed', async t => {
  const h = host(t)
  h.discover(async () => Response.json({ data: modelsPayload.data.map(row => ({ ...row,
    secret: 'raw-descriptor-must-not-leak', billing: { token_prices: { batch_size: 1000, default: { input_price: 0.005 } } },
  })) }))
  await h.picker()
  const view = (await h.request('models')).envelope.value
  assert.deepEqual(view.models.find((row: { id: string }) => row.id === 'mai-code-2').pricing, { input: 5 })
  assert.ok(!JSON.stringify(view).includes('raw-descriptor'))
  assert.equal(h.exchanges, 1, 'metadata must reuse the access token')
  assert.equal(h.requests.filter(request => request.url.endsWith('/models')).length, 2)
  for (const { init } of h.requests) {
    for (const [key, value] of Object.entries(attributionHeaders())) assert.equal(new Headers(init?.headers).get(key), value)
    assert.equal(init?.redirect, 'error')
  }
})

test('token refresh racing discovery publishes only the latest generation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = host(t)
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  await settle()
  assert.equal(h.exchanges, 1)
  t.mock.timers.tick(1_800_000)
  await settle()
  assert.equal(h.exchanges, 2)
  h.discover(async () => Response.json({ data: modelsPayload.data.filter(row => row.id === 'mai-code-2') }))
  gate.resolve(Response.json(modelsPayload))
  assert.deepEqual(await h.picker(), ['mai-code-2'])
  assert.ok(h.requests.filter(request => request.url.endsWith('/models')).some(request =>
    new Headers(request.init?.headers).get('authorization') === 'Bearer fixture-access-2'))
})
