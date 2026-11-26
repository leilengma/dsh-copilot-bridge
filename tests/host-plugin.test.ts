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
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of stream) result.push(item)
  return result
}
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

function host(t: TestContext, options: { signedOut?: boolean; lateLlm?: boolean; hidden?: string[]; pinned?: string[]; readOnly?: boolean; failSettings?: boolean } = {}) {
  const ctx = new Context()
  const enterpriseUrl = createVolatile('')
  const hiddenModels = createVolatile(options.hidden ?? [])
  const pinnedModels = createVolatile(options.pinned ?? [])
  const routes = new Map<string, ConnectionFetchRoute>()
  const records = new Map<string, CredentialRecord>([
    ['llm-pi-ai/github-copilot', { kind: 'api-key', key: 'native-user-owned' }],
  ])
  if (!options.signedOut) records.set(BRIDGE_RECORD_KEY, account())
  const credentialWrites: string[] = []
  const settingWrites: unknown[] = []
  const updates: string[] = []
  const requests: { url: string; init: RequestInit | undefined }[] = []
  let authorize: (init?: RequestInit) => Promise<Response> = async () => Response.json({ device_code: 'fixture-device', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 })
  let pollAuthorization: (init?: RequestInit) => Promise<Response> = async () => Response.json({ access_token: 'fixture-completed-oauth' })
  let discovery: (init?: RequestInit) => Promise<Response> = async () => Response.json(modelsPayload)
  let inference: (init?: RequestInit) => Promise<Response> = async () => { throw new Error('unexpected inference') }
  let exchanges = 0
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push({ url, init })
    if (url.endsWith('/login/device/code')) return authorize(init)
    if (url.endsWith('/login/oauth/access_token')) return pollAuthorization(init)
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
    async modifyRecord(key: CredentialKey, update: (record: CredentialRecord | undefined) => CredentialRecord | undefined | Promise<CredentialRecord | undefined>) {
      credentialWrites.push(key)
      const value = await update(records.get(key))
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
  if (!options.readOnly) ctx.provide('settings', {
    configure() { return () => {} },
    async update(_id: string, patch: { hiddenModels?: string[]; pinnedModels?: string[]; enterpriseUrl?: string }) {
      if (options.failSettings) throw new Error('fixture settings unavailable')
      settingWrites.push(patch)
      if (patch.hiddenModels) { updateVolatile(hiddenModels, createVolatile(patch.hiddenModels)); emitEdit('hiddenModels') }
      if (patch.pinnedModels) { updateVolatile(pinnedModels, createVolatile(patch.pinnedModels)); emitEdit('pinnedModels') }
      if (patch.enterpriseUrl !== undefined) { updateVolatile(enterpriseUrl, createVolatile(patch.enterpriseUrl)); emitEdit('enterpriseUrl') }
    },
    async mutate(_id: string, operations: { path: string[] }[]) {
      if (options.failSettings) throw new Error('fixture settings unavailable')
      settingWrites.push(operations)
      for (const { path } of operations) {
        if (path[0] === 'hiddenModels') updateVolatile(hiddenModels, createVolatile([]))
        if (path[0] === 'pinnedModels') updateVolatile(pinnedModels, createVolatile([]))
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
    apply(child, { enterpriseUrl, hiddenModels, pinnedModels })
  } })
  const plugin = mount()
  t.after(async () => { await ctx.fiber.dispose() })
  return {
    ctx, plugin, mount, mountLlm, nativeList, records, updates, requests, credentialWrites, settingWrites, hiddenModels, pinnedModels,
    get runtime() { return runtime }, get exchanges() { return exchanges },
    authorize(next: typeof authorize) { authorize = next },
    pollAuthorization(next: typeof pollAuthorization) { pollAuthorization = next },
    discover(next: typeof discovery) { discovery = next }, infer(next: typeof inference) { inference = next },
    editHidden(next: string[]) { updateVolatile(hiddenModels, createVolatile(next)); emitEdit('hiddenModels') },
    editPinned(next: string[]) { updateVolatile(pinnedModels, createVolatile(next)); emitEdit('pinnedModels') },
    editHost(next: string) { updateVolatile(enterpriseUrl, createVolatile(next)); emitEdit('enterpriseUrl') },
    setAccount(next: CredentialRecord | undefined) {
      if (next) records.set(BRIDGE_RECORD_KEY, next)
      else records.delete(BRIDGE_RECORD_KEY)
      ctx.emit('credentials/record-updated', credentialKey('copilot-bridge', 'github'))
    },
    async request(path: string, body?: unknown, raw = false) {
      const route = routes.get(`/api/copilot-bridge/${path}`)
      assert.ok(route, `missing route ${path}`)
      assert.ok(route.methods?.includes(body === undefined ? 'GET' : 'POST'))
      const response = await route.fetch(new Request(`https://localhost/api/copilot-bridge/${path}`, {
        method: body === undefined ? 'GET' : 'POST', ...body === undefined ? {} : { body: raw ? String(body) : JSON.stringify(body) },
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

test('pin route persists exact supported ids, deduplicates, rejects invalid input and unsets empty pins', async t => {
  const h = host(t)
  await h.picker()
  const saved = await h.request('pinned-models', { pinnedModels: ['mai-code-2', 'gpt-6', 'mai-code-2'] })
  assert.equal(saved.status, 200)
  assert.equal(saved.envelope.ok, true)
  assert.deepEqual(saved.envelope.value.pinnedModels, ['mai-code-2', 'gpt-6'])
  assert.deepEqual((await h.request('status')).envelope.value.pinnedModels, ['mai-code-2', 'gpt-6'])
  assert.deepEqual(h.settingWrites.at(-1), { pinnedModels: ['mai-code-2', 'gpt-6'] })
  const writes = h.settingWrites.length
  for (const body of [null, {}, [], { pinnedModels: null }, { pinnedModels: 'mai-code-2' },
    { pinnedModels: [''] }, { pinnedModels: ['  '] }, { pinnedModels: [123] },
    { pinnedModels: ['MAI-code-2'] }, { pinnedModels: [' mai-code-2 '] },
    { pinnedModels: ['unknown'] }, { pinnedModels: ['claude-opus-5'] }, { pinnedModels: ['future-realtime'] }]) {
    const invalid = await h.request('pinned-models', body)
    assert.equal(invalid.status, 400)
    assert.equal(invalid.envelope.ok, false)
    assert.equal(typeof invalid.envelope.error, 'string')
  }
  assert.equal((await h.request('pinned-models', '{', true)).status, 400)
  assert.equal((await h.request('pinned-models', '', true)).status, 400)
  assert.equal(h.settingWrites.length, writes, 'invalid pin requests cannot mutate settings')
  assert.deepEqual((await h.request('status')).envelope.value.pinnedModels, ['mai-code-2', 'gpt-6'])
  const cleared = await h.request('pinned-models', { pinnedModels: [] })
  assert.equal(cleared.status, 200)
  assert.deepEqual(cleared.envelope.value.pinnedModels, [])
  assert.deepEqual(h.settingWrites.at(-1), [{ op: 'unset', path: ['pinnedModels'] }])
})

for (const mode of ['read-only', 'write-failure'] as const) {
  test(`pin route reports ${mode} settings without claiming a save or changing the picker`, async t => {
    const h = host(t, { pinned: ['mai-code-2'], hidden: ['gpt-6'], readOnly: mode === 'read-only', failSettings: mode === 'write-failure' })
    const before = await h.picker()
    const updates = h.updates.length
    for (const pinnedModels of [['gpt-6'], []]) {
      const failed = await h.request('pinned-models', { pinnedModels })
      assert.equal(failed.status, 500)
      assert.equal(failed.envelope.ok, false)
    }
    const status = (await h.request('status')).envelope.value
    assert.equal(status.configWritable, mode !== 'read-only')
    assert.deepEqual(status.pinnedModels, ['mai-code-2'])
    assert.deepEqual(status.hiddenModels, ['gpt-6'])
    assert.deepEqual(await h.picker(), before)
    assert.deepEqual(h.settingWrites, [])
    assert.equal(h.updates.length, updates)
  })
}

test('pins stably lead bridge picker and management rows without revealing hidden pins or changing resolution or native models', async t => {
  const h = host(t, { hidden: ['mai-code-2'] })
  await h.picker()
  const savedModel = await h.runtime.resolveModelInfo(BRIDGE_PROVIDER, 'mai-code-2')
  const before = h.updates.length
  await h.request('pinned-models', { pinnedModels: ['kimi-k3', 'mai-code-2', 'gpt-6'] })
  assert.deepEqual(await h.picker(), ['gpt-6', 'kimi-k3', 'claude-sonnet-5', 'grok-4.7', 'mai-code-2-flash', 'gemini-3-pro'])
  const view = (await h.request('models')).envelope.value
  assert.deepEqual(ids(view.models), ['gpt-6', 'mai-code-2', 'kimi-k3', 'claude-sonnet-5', 'claude-opus-5', 'gpt-5.4-nano', 'grok-4.7', 'mai-code-2-flash', 'gemini-3-pro', 'future-realtime'])
  assert.deepEqual(view.status.hiddenModels, ['mai-code-2'])
  assert.deepEqual(view.status.pinnedModels, ['kimi-k3', 'mai-code-2', 'gpt-6'])
  assert.deepEqual(await h.runtime.resolveModelInfo(BRIDGE_PROVIDER, 'mai-code-2'), savedModel)
  assert.ok(h.updates.length > before)
  assert.ok(h.updates.every(provider => provider === BRIDGE_PROVIDER))
  assert.deepEqual(ids(await h.runtime.listModels('github-copilot')), ['mai-code-2'])
  assert.deepEqual(h.records.get('llm-pi-ai/github-copilot'), { kind: 'api-key', key: 'native-user-owned' })
  assert.deepEqual(h.credentialWrites, [])
  assert.equal(Object.hasOwn(h.runtime, 'listModels'), false)
  await h.request('hidden-models', { hiddenModels: [] })
  assert.deepEqual(await h.picker(), ['gpt-6', 'mai-code-2', 'kimi-k3', 'claude-sonnet-5', 'grok-4.7', 'mai-code-2-flash', 'gemini-3-pro'])
  await h.request('pinned-models', { pinnedModels: [] })
  assert.deepEqual(await h.picker(), supported)
})

test('catalog refresh retains pin preference but uses the new catalog-relative order within both groups', async t => {
  const h = host(t, { pinned: ['gpt-6', 'mai-code-2', 'kimi-k3'] })
  assert.deepEqual(await h.picker(), ['gpt-6', 'mai-code-2', 'kimi-k3', 'claude-sonnet-5', 'grok-4.7', 'mai-code-2-flash', 'gemini-3-pro'])
  h.discover(async () => Response.json({ data: [...modelsPayload.data].reverse() }))
  const refreshed = (await h.request('models/refresh', {})).envelope.value
  assert.deepEqual(ids(refreshed.models), ['kimi-k3', 'mai-code-2', 'gpt-6', 'future-realtime', 'gemini-3-pro', 'mai-code-2-flash', 'grok-4.7', 'gpt-5.4-nano', 'claude-opus-5', 'claude-sonnet-5'])
  assert.deepEqual(await h.picker(), ['kimi-k3', 'mai-code-2', 'gpt-6', 'gemini-3-pro', 'mai-code-2-flash', 'grok-4.7', 'claude-sonnet-5'])
  await h.request('pinned-models', { pinnedModels: [] })
  assert.deepEqual(await h.picker(), ['kimi-k3', 'gemini-3-pro', 'mai-code-2-flash', 'mai-code-2', 'grok-4.7', 'gpt-6', 'claude-sonnet-5'])
})

test('discovery failures and catalog changes preserve saved pins while only supported live ids can be newly pinned', async t => {
  const h = host(t, { pinned: ['missing-from-catalog', 'mai-code-2'] })
  h.discover(async () => new Response('unavailable', { status: 503 }))
  await h.picker()
  const failed = (await h.request('models')).envelope.value
  assert.equal(failed.state, 'error')
  assert.deepEqual(failed.status.pinnedModels, ['missing-from-catalog', 'mai-code-2'])
  assert.deepEqual(h.settingWrites, [], 'discovery cannot prune saved pins')
  assert.equal((await h.request('pinned-models', { pinnedModels: ['mai-code-2', 'gpt-6'] })).status, 400)
  const kept = await h.request('pinned-models', { pinnedModels: ['missing-from-catalog', 'mai-code-2', 'mai-code-2'] })
  assert.equal(kept.status, 200)
  assert.deepEqual(kept.envelope.value.pinnedModels, ['missing-from-catalog', 'mai-code-2'])
  h.discover(async () => Response.json(modelsPayload))
  await h.request('models/refresh', {})
  const extended = await h.request('pinned-models', { pinnedModels: ['missing-from-catalog', 'mai-code-2', 'gpt-6'] })
  assert.equal(extended.status, 200)
  assert.deepEqual(extended.envelope.value.pinnedModels, ['missing-from-catalog', 'mai-code-2', 'gpt-6'])
  h.discover(async () => new Response('unavailable', { status: 503 }))
  const retryable = (await h.request('models/refresh', {})).envelope.value
  assert.equal(retryable.state, 'error')
  assert.deepEqual(retryable.status.pinnedModels, ['missing-from-catalog', 'mai-code-2', 'gpt-6'])
  assert.deepEqual(await h.picker(), ['gpt-6', 'mai-code-2', 'claude-sonnet-5', 'grok-4.7', 'mai-code-2-flash', 'gemini-3-pro', 'kimi-k3'])
  h.discover(async () => Response.json({ data: [] }))
  const empty = (await h.request('models/refresh', {})).envelope.value
  assert.deepEqual(empty.models, [])
  assert.deepEqual(empty.status.pinnedModels, ['missing-from-catalog', 'mai-code-2', 'gpt-6'])
  assert.equal((await h.request('pinned-models', { pinnedModels: ['mai-code-2', 'gpt-6'] })).status, 200)
  assert.deepEqual((await h.request('status')).envelope.value.pinnedModels, ['mai-code-2', 'gpt-6'])
  assert.equal((await h.request('pinned-models', { pinnedModels: ['kimi-k3'] })).status, 400)
})

test('a failed initial discovery does not turn picker notifications into a retry loop; manual refresh recovers', async t => {
  const h = host(t)
  const gate = deferred<Response>()
  let attempts = 0
  h.discover(async () => ++attempts > 3 ? gate.promise : new Response('unavailable', { status: 503 }))
  h.ctx.on('llm/models-updated', provider => { void h.runtime.listModels(provider).catch(() => {}) })
  try {
    await settle()
    assert.equal(attempts, 1, 'picker refetches must not automatically retry failed discovery')
    assert.deepEqual(await h.picker(), [])
    assert.equal(attempts, 1)
    assert.equal((await h.request('models')).envelope.value.state, 'error')
    h.discover(async () => Response.json(modelsPayload))
    assert.equal((await h.request('models/refresh', {})).envelope.value.state, 'ready')
    assert.deepEqual(await h.picker(), supported)
  } finally {
    await h.plugin.dispose()
    gate.resolve(Response.json(modelsPayload))
  }
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

test('sign-out discards discovery, clears hidden and pinned config, and empties the picker without changing native state', async t => {
  const h = host(t, { hidden: ['mai-code-2'], pinned: ['mai-code-2'] })
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  await settle()
  const pending = h.picker()
  await settle()
  const before = h.updates.length
  const logout = await h.request('logout', {})
  assert.equal(logout.envelope.value.authenticated, false)
  assert.equal(logout.envelope.value.pinnedModels, undefined)
  assert.deepEqual(await h.picker(), [])
  assert.deepEqual(h.hiddenModels.get(), [])
  assert.deepEqual(h.pinnedModels.get(), [])
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

test('host switch gates a preserved account, clears pins, discards old discovery and resumes only for a matching signed-in host', async t => {
  const h = host(t, { hidden: ['mai-code-2'], pinned: ['mai-code-2'] })
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  await settle()
  const old = h.picker()
  await settle()
  h.editHost('https://acme.ghe.com/')
  assert.deepEqual(await h.picker(), [])
  assert.deepEqual(h.hiddenModels.get(), [])
  assert.deepEqual(h.pinnedModels.get(), [])
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

test('external volatile pins update only the bridge and unload/reload leaves exactly one live listener', async t => {
  const h = host(t)
  await h.picker()
  const before = h.updates.length
  h.editPinned(['kimi-k3', 'mai-code-2'])
  assert.deepEqual(h.updates.slice(before), [BRIDGE_PROVIDER])
  assert.deepEqual(await h.picker(), ['mai-code-2', 'kimi-k3', 'claude-sonnet-5', 'gpt-6', 'grok-4.7', 'mai-code-2-flash', 'gemini-3-pro'])
  await h.plugin.dispose()
  const unloaded = h.updates.length
  h.editPinned(['mai-code-2-flash'])
  assert.equal(h.updates.length, unloaded)
  const reloaded = h.mount()
  assert.deepEqual(await h.picker(), ['mai-code-2-flash', 'claude-sonnet-5', 'gpt-6', 'grok-4.7', 'mai-code-2', 'gemini-3-pro', 'kimi-k3'])
  const after = h.updates.length
  h.editPinned([])
  assert.deepEqual(h.updates.slice(after), [BRIDGE_PROVIDER])
  assert.deepEqual(await h.picker(), supported)
  assert.deepEqual(ids(await h.runtime.listModels('github-copilot')), ['mai-code-2'])
  await reloaded.dispose()
})

test('enterprise URL route clears saved pins alongside hidden ids without deleting the native or bridge account', async t => {
  const h = host(t, { pinned: ['mai-code-2'], hidden: ['mai-code-2'] })
  await h.picker()
  const changed = await h.request('enterprise-url', { enterpriseUrl: 'acme.ghe.com' })
  assert.equal(changed.status, 200)
  assert.deepEqual(changed.envelope.value.pinnedModels, [])
  assert.deepEqual(h.pinnedModels.get(), [])
  assert.deepEqual(h.hiddenModels.get(), [])
  assert.deepEqual(await h.picker(), [])
  assert.deepEqual(h.credentialWrites, [])
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

test('composed vision uses verified Harness attachment bytes, and never advertises images without the service', async t => {
  const h = host(t)
  await h.picker()
  assert.deepEqual((await h.runtime.resolveModelInfo(BRIDGE_PROVIDER, 'gemini-3-pro')).inputModalities, ['text'])
  const image = { attachmentId: 'fixture-image', mediaType: 'image/png' as const, bytes: 5, width: 1, height: 1 }
  const read: unknown[] = []
  const attachments = h.ctx.plugin({ apply(child: Context) {
    child.provide('attachments', { async readImage(ref: unknown, signal?: AbortSignal) {
      read.push(ref)
      assert.equal(signal?.aborted, false)
      return { ref: image, data: Buffer.from('hello') }
    } })
  } })
  await settle()
  assert.deepEqual((await h.runtime.resolveModelInfo(BRIDGE_PROVIDER, 'gemini-3-pro')).inputModalities, ['text', 'image'])
  h.infer(async () => new Response([
    { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gemini-3-pro', choices: [{ index: 0, delta: { role: 'assistant', content: 'cat' }, finish_reason: null }] },
    { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gemini-3-pro', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }))
  const chunks = await collect(h.runtime.stream({ provider: BRIDGE_PROVIDER, model: 'gemini-3-pro', messages: [
    { role: 'user', content: [{ type: 'text', text: 'what?' }, { type: 'image', attachment: image }] },
  ] } as Parameters<LlmRuntime['stream']>[0]))
  assert.deepEqual(read, [image])
  assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'cat'))
  const sent = h.requests.at(-1)!
  assert.equal(new Headers(sent.init?.headers).get('copilot-vision-request'), 'true')
  assert.match(String(sent.init?.body), /data:image\/png;base64,aGVsbG8=/)
  await attachments.dispose()
  assert.deepEqual((await h.runtime.resolveModelInfo(BRIDGE_PROVIDER, 'gemini-3-pro')).inputModalities, ['text'])
})

test('preparation awaiting old discovery cannot bind the replacement account after its snapshot is ready', async t => {
  const h = host(t)
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  await settle()
  const pending = h.runtime.prepareCall({ provider: BRIDGE_PROVIDER, model: 'mai-code-2' })
  const rejected = assert.rejects(pending, { code: 'DISCOVERY_FAILED' })
  await settle()
  h.discover(async () => Response.json(modelsPayload))
  h.setAccount(account('replacement-account'))
  assert.deepEqual(await h.picker(), supported)
  const before = h.requests.length
  gate.resolve(Response.json(modelsPayload))
  await rejected
  assert.equal(h.requests.length, before, 'stale preparation must not exchange a token or send inference')
})

test('account change queued after discovery publication rejects the waiting host resolution', async t => {
  const h = host(t)
  const gate = deferred<Response>()
  h.discover(() => gate.promise)
  await settle()
  const pending = h.runtime.resolveModelInfo(BRIDGE_PROVIDER, 'mai-code-2')
  const rejected = assert.rejects(pending, { code: 'DISCOVERY_FAILED' })
  let changed = false
  h.ctx.on('llm/models-updated', () => {
    if (changed) return
    changed = true
    // Account events can arrive after the catalog has fulfilled readiness,
    // but before its host caller resumes from that await.
    queueMicrotask(() => { queueMicrotask(() => h.setAccount(account('replacement-account'))) })
  })
  gate.resolve(Response.json(modelsPayload))
  await rejected
})

test('account reset cancels an already prepared call and active inference without sending to a new account', async t => {
  const h = host(t)
  await h.picker()
  const prepared = await h.runtime.prepareCall({ provider: BRIDGE_PROVIDER, model: 'mai-code-2' })
  h.setAccount(account('replacement-account'))
  await h.picker()
  const before = h.requests.length
  const chunks = await collect(prepared.stream({ ...prepared.config, messages: [{ role: 'user', content: [{ type: 'text', text: 'private conversation' }] }] }))
  assert.equal(h.requests.length, before, 'prepared call from the old account must not make a request')
  assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'aborted'))

  const started = deferred<RequestInit | undefined>()
  h.infer(async init => {
    started.resolve(init)
    return new Response(new ReadableStream({ start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
    } }), { headers: { 'content-type': 'text/event-stream' } })
  })
  const active = collect(h.runtime.stream({ provider: BRIDGE_PROVIDER, model: 'mai-code-2', messages: [] }))
  const sent = await started.promise
  h.editHost('https://acme.ghe.com/')
  assert.equal(sent?.signal?.aborted, true)
  assert.ok((await active).some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'aborted'))
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

test('unload aborts device authorization and a late response cannot resurrect polling or persist an account', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = host(t, { signedOut: true })
  const gate = deferred<Response>()
  const started = deferred<RequestInit | undefined>()
  h.authorize(async init => { started.resolve(init); return gate.promise })
  await h.picker()
  const pending = h.request('login', {})
  const request = await started.promise
  await h.plugin.dispose()
  gate.resolve(Response.json({ device_code: 'late-device', user_code: 'LATE-CODE', interval: 1, expires_in: 900 }))
  assert.equal((await pending).envelope.ok, false)
  assert.equal(request?.signal?.aborted, true)
  const before = h.requests.length
  t.mock.timers.tick(10_000)
  await settle()
  assert.equal(h.requests.length, before, 'unload must not create device polling requests')
  assert.deepEqual(h.credentialWrites, [])
  assert.equal(h.records.has(BRIDGE_RECORD_KEY), false)
})

test('device authorization transport honors unload cancellation before a server response arrives', async t => {
  const h = host(t, { signedOut: true })
  const started = deferred<void>()
  h.authorize(init => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    started.resolve()
  }))
  await h.picker()
  let settled = false
  const pending = h.request('login', {}).then(response => { settled = true; return response })
  await started.promise
  await h.plugin.dispose()
  await settle()
  assert.equal(settled, true, 'the cancelled fetch must settle without waiting for a device-code response')
  assert.equal((await pending).envelope.ok, false)
  assert.deepEqual(h.credentialWrites, [])
})

for (const lifecycle of ['logout', 'host-route', 'volatile-host'] as const) {
  test(`${lifecycle} invalidates pending device authorization even if the configured host is restored`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const h = host(t, { signedOut: true })
    const gate = deferred<Response>()
    const started = deferred<RequestInit | undefined>()
    h.authorize(async init => { started.resolve(init); return gate.promise })
    await h.picker()
    const pending = h.request('login', {})
    const request = await started.promise
    if (lifecycle === 'logout') await h.request('logout', {})
    else if (lifecycle === 'host-route') {
      await h.request('enterprise-url', { enterpriseUrl: 'acme.ghe.com' })
      await h.request('enterprise-url', { enterpriseUrl: '' })
    } else {
      h.editHost('https://acme.ghe.com/')
      h.editHost('')
    }
    gate.resolve(Response.json({ device_code: 'late-device', user_code: 'LATE-CODE', interval: 1, expires_in: 900 }))
    assert.equal((await pending).envelope.ok, false)
    assert.equal(request?.signal?.aborted, true)
    const before = h.requests.length
    const writes = h.credentialWrites.length
    t.mock.timers.tick(10_000)
    await settle()
    assert.equal(h.requests.length, before, 'cancelled authorization must not create device polling requests')
    assert.equal(h.credentialWrites.length, writes)
    assert.equal((await h.request('status')).envelope.value.state, 'signed-out')
    assert.equal(h.records.has(BRIDGE_RECORD_KEY), false)
  })
}

test('logout aborts an in-flight device poll response body without persisting or rescheduling', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = host(t, { signedOut: true })
  const started = deferred<RequestInit | undefined>()
  h.pollAuthorization(async init => new Response(new ReadableStream({ start(controller) {
    started.resolve(init)
    init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason), { once: true })
  } })))
  await h.picker()
  await h.request('login', {})
  t.mock.timers.tick(1000)
  const request = await started.promise
  await h.request('logout', {})
  await settle()
  assert.equal(request?.signal?.aborted, true)
  const before = h.requests.length
  const writes = h.credentialWrites.length
  t.mock.timers.tick(10_000)
  await settle()
  assert.equal(h.requests.length, before)
  assert.equal(h.credentialWrites.length, writes)
  assert.equal((await h.request('status')).envelope.value.state, 'signed-out')
  assert.equal(h.records.has(BRIDGE_RECORD_KEY), false)
})

test('completed device sign-in clears hidden and pinned config, discovers the live catalog and notifies the bridge picker', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const h = host(t, { signedOut: true, hidden: ['mai-code-2'], pinned: ['mai-code-2'] })
  assert.deepEqual(await h.picker(), [])
  assert.equal((await h.request('login', {})).envelope.value.state, 'pending')
  const before = h.updates.length
  t.mock.timers.tick(1000)
  await settle()
  assert.equal((await h.request('status')).envelope.value.state, 'authenticated')
  assert.deepEqual(await h.picker(), supported)
  assert.deepEqual(h.hiddenModels.get(), [])
  assert.deepEqual(h.pinnedModels.get(), [])
  assert.deepEqual((await h.request('status')).envelope.value.pinnedModels, [])
  assert.deepEqual(h.credentialWrites, [BRIDGE_RECORD_KEY])
  assert.ok(h.updates.length > before)
  assert.ok(h.updates.every(provider => provider === BRIDGE_PROVIDER))
  assert.equal(h.exchanges, 1)
})

test('401 token replacement triggers live discovery as well as a single safe inference retry', async t => {
  const h = host(t)
  await h.picker()
  h.discover(async () => Response.json({ data: modelsPayload.data.filter(row => row.id === 'gemini-3-pro') }))
  let calls = 0
  h.infer(async () => {
    if (++calls === 1) return Response.json({ error: { message: 'expired', type: 'error' } }, { status: 401 })
    const events = [
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gemini-3-pro', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
      { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gemini-3-pro', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  })
  const chunks = await collect(h.runtime.stream({ provider: BRIDGE_PROVIDER, model: 'gemini-3-pro', messages: [] }))
  assert.equal(calls, 2)
  assert.equal(h.exchanges, 2)
  assert.ok(chunks.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'stop'))
  assert.deepEqual(await h.picker(), ['gemini-3-pro'])
  const modelRequests = h.requests.filter(request => request.url.endsWith('/models'))
  assert.equal(new Headers(modelRequests.at(-1)?.init?.headers).get('authorization'), 'Bearer fixture-access-2')
})

test('pending management metadata is cancelled and cannot cross sign-out or unload', async t => {
  const h = host(t)
  await h.picker()
  let gate = deferred<Response>()
  h.discover(() => gate.promise)
  const oldView = h.request('models')
  await settle()
  const metadata = h.requests.at(-1)!
  await h.request('logout', {})
  assert.equal(metadata.init?.signal?.aborted, true)
  gate.resolve(Response.json({ data: [{ id: 'mai-code-2', billing: { token_prices: { batch_size: 1000, default: { input_price: 999 } } } }] }))
  assert.deepEqual((await oldView).envelope.value.models, [])
  h.discover(async () => Response.json(modelsPayload))
  h.setAccount(account('second-account'))
  await h.picker()
  gate = deferred<Response>()
  h.discover(() => gate.promise)
  const pending = h.request('models')
  await settle()
  const unloading = h.requests.at(-1)!
  await h.plugin.dispose()
  assert.equal(unloading.init?.signal?.aborted, true)
  gate.resolve(Response.json(modelsPayload))
  await pending
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
