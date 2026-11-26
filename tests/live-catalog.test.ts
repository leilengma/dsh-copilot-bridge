import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLiveCatalog, projectCatalog, type CatalogModel, type CatalogToken } from '../src/host/live-catalog.ts'
import { modelsPayload } from './fixtures/copilot-models.ts'

const byId = (models: readonly CatalogModel[]) => new Map(models.map(model => [model.id, model]))
const projected = byId(projectCatalog(modelsPayload))

test('mai-code-2 and mai-code-2-flash prefer the Responses endpoint over Chat Completions', () => {
  assert.equal(projected.get('mai-code-2')?.protocol, 'openai-responses')
  assert.equal(projected.get('mai-code-2-flash')?.protocol, 'openai-responses')
  assert.equal(projected.get('gpt-6')?.protocol, 'openai-responses')
  assert.equal(projected.get('grok-4.7')?.protocol, 'openai-responses')
})

test('Claude prefers Anthropic Messages and Gemini/kimi use Chat Completions', () => {
  assert.equal(projected.get('claude-sonnet-5')?.protocol, 'anthropic-messages')
  assert.equal(projected.get('gemini-3-pro')?.protocol, 'openai-completions')
  assert.equal(projected.get('kimi-k3')?.protocol, 'openai-completions')
})

test('supported models carry the full safe projection and nothing from the raw descriptor', () => {
  assert.deepEqual(projected.get('claude-sonnet-5'), {
    id: 'claude-sonnet-5', name: 'Name claude-sonnet-5', supported: true, protocol: 'anthropic-messages',
    input: ['text', 'image'], contextWindow: 200_000, maxOutputTokens: 32_000, reasoningEfforts: ['low', 'medium', 'high'],
  })
})

test('model_picker_enabled=false disables the model as not-offered', () => {
  assert.deepEqual(projected.get('claude-opus-5'), {
    id: 'claude-opus-5', name: 'Name claude-opus-5', supported: false, disabledReason: 'not-offered',
    protocol: 'anthropic-messages', input: ['text', 'image'], contextWindow: 200_000, maxOutputTokens: 32_000, reasoningEfforts: [],
  })
  assert.equal(projected.get('gpt-5.4-nano')?.supported, false)
  assert.equal(projected.get('gpt-5.4-nano')?.disabledReason, 'not-offered')
})

test('a chat model with only unsupported endpoints is disabled as unsupported-protocol', () => {
  const model = projected.get('future-realtime')
  assert.equal(model?.supported, false)
  assert.equal(model?.disabledReason, 'unsupported-protocol')
  assert.equal(model?.protocol, undefined)
})

test('non-chat models and chat models without endpoints are omitted', () => {
  for (const id of ['legacy-gpt-4o', 'legacy-empty', 'text-embedding-3-small', 'image-gen-2']) {
    assert.equal(projected.has(id), false, id)
  }
  assert.deepEqual([...projected.keys()], [
    'claude-sonnet-5', 'claude-opus-5', 'gpt-6', 'gpt-5.4-nano', 'grok-4.7', 'mai-code-2', 'mai-code-2-flash',
    'gemini-3-pro', 'kimi-k3', 'future-realtime',
  ])
})

test('reasoning efforts are exactly the advertised list; none advertised means none', () => {
  assert.deepEqual(projected.get('gpt-6')?.reasoningEfforts, ['minimal', 'low', 'medium', 'high', 'xhigh'])
  assert.deepEqual(projected.get('mai-code-2')?.reasoningEfforts, ['low', 'medium', 'high'])
  assert.deepEqual(projected.get('mai-code-2-flash')?.reasoningEfforts, [])
  assert.deepEqual(projected.get('kimi-k3')?.reasoningEfforts, [])
})

test('image input only with supports.vision and never PDF', () => {
  assert.deepEqual(projected.get('gemini-3-pro')?.input, ['text', 'image'])
  assert.deepEqual(projected.get('kimi-k3')?.input, ['text'])
  for (const model of projected.values()) assert.equal((model.input as readonly string[]).includes('pdf'), false)
})

test('limits are taken from capabilities.limits when present and stay unknown otherwise', () => {
  const [model] = projectCatalog({ data: [{
    id: 'm', supported_endpoints: ['/responses'], capabilities: { type: 'chat', limits: { max_output_tokens: -1 } },
  }] })
  assert.deepEqual(model, { id: 'm', name: 'm', supported: true, protocol: 'openai-responses', input: ['text'], reasoningEfforts: [] })
})

test('malformed descriptors are skipped and a malformed payload is rejected', () => {
  assert.deepEqual(projectCatalog({ data: [null, 'x', { id: 7 }, { id: '' }, { id: 'ok', supported_endpoints: ['/responses', 3], capabilities: { type: 'chat', supports: { reasoning_effort: ['high', 2, 'high'] } } }] }), [
    { id: 'ok', name: 'ok', supported: true, protocol: 'openai-responses', input: ['text'], reasoningEfforts: ['high'] },
  ])
  assert.throws(() => projectCatalog({ models: [] }), /invalid/)
  assert.throws(() => projectCatalog(null), /invalid/)
})

const SECRET = 'tid=secret-access-token'

function harness(options: { token?: Partial<CatalogToken>; respond?: (url: string, init?: RequestInit) => Promise<Response> } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  const logs: string[] = []
  let generation = 1
  const catalog = createLiveCatalog({
    token: async () => ({ token: SECRET, baseUrl: 'https://api.enterprise.githubcopilot.com', generation, ...options.token }),
    fetch: async (url, init) => {
      calls.push({ url, ...init === undefined ? {} : { init } })
      return options.respond ? options.respond(url, init) : Response.json(modelsPayload)
    },
    logger: { warn: message => logs.push(message) },
  })
  return { catalog, calls, logs, setGeneration: (value: number) => { generation = value } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('discovery requests <baseUrl>/models with Copilot auth and publishes a ready snapshot of that generation', async () => {
  const { catalog, calls, setGeneration } = harness()
  setGeneration(7)
  let changes = 0
  catalog.onChange(() => changes++)
  assert.equal(catalog.snapshot(), undefined)
  const snapshot = await catalog.refresh()
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://api.enterprise.githubcopilot.com/models')
  const headers = new Headers(calls[0]?.init?.headers)
  assert.equal(headers.get('authorization'), `Bearer ${SECRET}`)
  assert.equal(headers.get('copilot-integration-id'), 'vscode-chat')
  assert.ok(headers.get('editor-version'))
  assert.equal(calls[0]?.init?.redirect, 'error')
  assert.ok(calls[0]?.init?.signal)
  assert.equal(snapshot.generation, 7)
  assert.deepEqual(snapshot.models, projectCatalog(modelsPayload))
  assert.equal(catalog.snapshot(), snapshot)
  assert.deepEqual(catalog.state(), { status: 'ready' })
  assert.ok(changes > 0)
})

test('concurrent refresh and ready calls share one in-flight discovery', async () => {
  const gate = deferred<Response>()
  const { catalog, calls } = harness({ respond: () => gate.promise })
  const first = catalog.refresh()
  const second = catalog.refresh()
  const waiting = catalog.ready()
  assert.deepEqual(catalog.state(), { status: 'loading' })
  gate.resolve(Response.json(modelsPayload))
  const [a, b, c] = await Promise.all([first, second, waiting])
  assert.equal(a, b)
  assert.equal(b, c)
  assert.equal(calls.length, 1)
})

test('ready triggers discovery only while the catalog is unknown', async () => {
  const { catalog, calls } = harness()
  const snapshot = await catalog.ready()
  assert.equal(await catalog.ready(), snapshot)
  assert.equal(calls.length, 1)
})

test('a known-empty catalog is ready with no models, unlike an unknown catalog', async () => {
  const { catalog } = harness({ respond: async () => Response.json({ data: [] }) })
  assert.equal(catalog.snapshot(), undefined)
  const snapshot = await catalog.ready()
  assert.deepEqual(snapshot.models, [])
  assert.deepEqual(catalog.state(), { status: 'ready' })
})

test('a failure after success keeps the last good snapshot and reports a secret-free error state', async () => {
  let fail = false
  const { catalog, logs } = harness({ respond: async () => fail ? new Response(`denied ${SECRET}`, { status: 500 }) : Response.json(modelsPayload) })
  const good = await catalog.refresh()
  fail = true
  let changes = 0
  catalog.onChange(() => changes++)
  await assert.rejects(catalog.refresh(), /HTTP 500/)
  assert.equal(catalog.snapshot(), good)
  const state = catalog.state()
  assert.equal(state.status, 'error')
  assert.match(state.status === 'error' ? state.error : '', /HTTP 500/)
  assert.equal(await catalog.ready(), good)
  assert.ok(changes > 0)
  for (const line of [...logs, JSON.stringify(state)]) assert.equal(line.includes(SECRET), false)
})

test('a failure with no snapshot leaves the catalog unknown and ready rejects without any fallback', async () => {
  const { catalog } = harness({ respond: async () => { throw new Error(`socket closed ${SECRET}`) } })
  await assert.rejects(catalog.ready(), error => error instanceof Error && !error.message.includes(SECRET))
  assert.equal(catalog.snapshot(), undefined)
  assert.equal(catalog.state().status, 'error')
})

test('an invalid payload is an error, not an empty catalog', async () => {
  const { catalog } = harness({ respond: async () => Response.json({ models: [] }) })
  await assert.rejects(catalog.refresh(), /invalid/)
  assert.equal(catalog.snapshot(), undefined)
})

test('reset during an in-flight discovery aborts it and discards its late response', async () => {
  const gate = deferred<Response>()
  let signal: AbortSignal | undefined
  const { catalog } = harness({ respond: async (_url, init) => { signal = init?.signal ?? undefined; return gate.promise } })
  const pending = catalog.refresh()
  const waiting = catalog.ready()
  await new Promise(resolve => setImmediate(resolve))
  let changes = 0
  catalog.onChange(() => changes++)
  catalog.reset()
  assert.equal(signal?.aborted, true)
  const afterReset = changes
  gate.resolve(Response.json(modelsPayload))
  await assert.rejects(pending, /cancelled/)
  await assert.rejects(waiting, /cancelled/)
  assert.equal(catalog.snapshot(), undefined)
  assert.equal(changes, afterReset)
  assert.deepEqual(catalog.state(), { status: 'loading' })
})

test('reset drops the previous snapshot so a new account never sees it', async () => {
  const { catalog, calls, setGeneration } = harness()
  await catalog.refresh()
  catalog.reset()
  assert.equal(catalog.snapshot(), undefined)
  setGeneration(2)
  assert.equal((await catalog.ready()).generation, 2)
  assert.equal(calls.length, 2)
})

test('a non-HTTPS base URL never receives the access token', async () => {
  const { catalog, calls } = harness({ token: { baseUrl: 'http://api.githubcopilot.com' } })
  await assert.rejects(catalog.refresh(), /HTTPS/)
  assert.equal(calls.length, 0)
})

test('dispose aborts pending work and stops notifying listeners', async () => {
  const gate = deferred<Response>()
  const { catalog } = harness({ respond: () => gate.promise })
  let changes = 0
  catalog.onChange(() => changes++)
  const pending = catalog.refresh()
  const before = changes
  catalog.dispose()
  gate.resolve(Response.json(modelsPayload))
  await assert.rejects(pending, /cancelled/)
  assert.equal(changes, before)
  await assert.rejects(catalog.refresh(), /disposed/)
})

test('onChange returns an unsubscribe function', async () => {
  const { catalog } = harness()
  let changes = 0
  const off = catalog.onChange(() => changes++)
  off()
  await catalog.refresh()
  assert.equal(changes, 0)
})
