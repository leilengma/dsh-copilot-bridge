import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attributionHeaders, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantMessageEvent } from '@earendil-works/pi-ai'
import { BridgeAdapter, type BridgeAdapterDeps, type BridgeTransport } from '../src/host/bridge-adapter.ts'
import type { AccessToken } from '../src/host/access-token.ts'
import { projectCatalog, type CatalogSnapshot } from '../src/host/live-catalog.ts'
import { anthropicThinkingPayload, modelsPayload, opus55Payload } from './fixtures/copilot-models.ts'

const BASE = 'https://api.enterprise.githubcopilot.com'
const snapshot: CatalogSnapshot = { generation: 1, models: projectCatalog(modelsPayload) }
const token = (generation: number, baseUrl = BASE, accountGeneration = 1): AccessToken =>
  ({ token: `tok-${generation}`, baseUrl, expiresAt: Date.now() + 3_600_000, generation, accountGeneration, signal: new AbortController().signal })

interface Request { readonly url: string; readonly headers: Headers; readonly body: Record<string, unknown>; readonly redirect: RequestRedirect | undefined }

/** Fake HTTP endpoint: records requests and answers from a queue of response factories. */
function fakeFetch(...responses: ((init: RequestInit | undefined) => Response)[]) {
  const requests: Request[] = []
  const fetch = (async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, redirect: init?.redirect })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return next(init)
  }) as typeof globalThis.fetch
  return { fetch, requests }
}

const encoder = new TextEncoder()
const sseText = (events: readonly Record<string, unknown>[], done = false) =>
  events.map(event => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '')
const sse = (events: readonly Record<string, unknown>[], done = false) => () =>
  new Response(sseText(events, done), { status: 200, headers: { 'content-type': 'text/event-stream' } })
const httpError = (status: number, message: string) => () =>
  new Response(JSON.stringify({ error: { message, type: 'error' } }), { status, headers: { 'content-type': 'application/json' } })

// --- provider SSE fixtures -------------------------------------------------
const responsesText = (text: string) => [
  { type: 'response.created', response: { id: 'resp_1' } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', content: [] } },
  ...[...text].map(delta => ({ type: 'response.output_text.delta', output_index: 0, delta })),
  { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text }] } },
  { type: 'response.completed', response: { id: 'resp_1', status: 'completed', usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 2 } } } },
]
const responsesTools = [
  { type: 'response.created', response: { id: 'resp_2' } },
  { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'read', arguments: '' } },
  { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_b', call_id: 'call_b', name: 'list', arguments: '' } },
  { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"pa' },
  { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"dir"' },
  { type: 'response.function_call_arguments.delta', output_index: 0, delta: 'th":"a.ts"}' },
  { type: 'response.function_call_arguments.delta', output_index: 1, delta: ':"src"}' },
  { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_a', call_id: 'call_a', name: 'read', arguments: '{"path":"a.ts"}' } },
  { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_b', call_id: 'call_b', name: 'list', arguments: '{"dir":"src"}' } },
  { type: 'response.completed', response: { id: 'resp_2', status: 'completed', usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 } } },
]
const anthropicText = (text: string, thinking?: string) => [
  { type: 'message_start', message: { id: 'msg_a', type: 'message', role: 'assistant', model: 'claude-sonnet-5', content: [], stop_reason: null, usage: { input_tokens: 9, output_tokens: 1 } } },
  ...thinking === undefined ? [] : [
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
  ],
  { type: 'content_block_start', index: thinking === undefined ? 0 : 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: thinking === undefined ? 0 : 1, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: thinking === undefined ? 0 : 1 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
  { type: 'message_stop' },
]
const completionsText = (model: string, text: string) => [
  { id: 'c1', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  { id: 'c1', object: 'chat.completion.chunk', created: 0, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } },
]

// --- adapter harness ---------------------------------------------------------
function fakeTokens(initial: AccessToken) {
  let current = initial
  const invalidated: number[] = []
  return {
    invalidated,
    set(next: AccessToken) { current = next },
    tokens: {
      current: async () => current,
      invalidate(stale: AccessToken) {
        invalidated.push(stale.generation)
        if (stale.generation === current.generation) current = token(current.generation + 1, current.baseUrl, current.accountGeneration)
      },
    },
  }
}

function adapter(overrides: Partial<BridgeAdapterDeps> = {}, hidden: readonly string[] = []) {
  const tokens = fakeTokens(token(1))
  const http = fakeFetch()
  const instance = new BridgeAdapter({
    catalog: { ready: async () => snapshot }, tokens: tokens.tokens, hidden: () => hidden, fetch: http.fetch, ...overrides,
  })
  return { instance, tokens }
}

const user = (text: string): RequestMessage => ({ role: 'user', content: [{ type: 'text', text }] })
const request = (model: string, extra: Partial<GenerateOptions> = {}): GenerateOptions =>
  ({ provider: 'copilot-bridge', model, messages: [user('hello')], ...extra })

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}
const finishOf = (chunks: readonly StreamChunk[]) => {
  const last = chunks.at(-1)
  assert.equal(last?.type, 'finish')
  return last.reason
}
const blockEnds = (chunks: readonly StreamChunk[]) => chunks.flatMap(chunk => chunk.type === 'block-end' ? [chunk.block] : [])

// --- catalog surface -------------------------------------------------------------
test('describes itself as GitHub Copilot Bridge on route copilot-bridge', () => {
  assert.deepEqual(adapter().instance.providerInfo('copilot-bridge'), { id: 'copilot-bridge', name: 'GitHub Copilot Bridge' })
})

test('listModels lists visible models only: supported minus hidden, never disabled', async () => {
  const { instance } = adapter({}, ['grok-4.7'])
  const ids = (await instance.listModels('copilot-bridge')).map(model => model.id)
  assert.deepEqual(ids, ['claude-sonnet-5', 'gpt-6', 'mai-code-2', 'mai-code-2-flash', 'gemini-3-pro', 'kimi-k3'])
})

test('listModels awaits an in-flight discovery', async () => {
  let release: (value: CatalogSnapshot) => void = () => {}
  const pending = new Promise<CatalogSnapshot>(resolve => { release = resolve })
  const { instance } = adapter({ catalog: { ready: () => pending } })
  const listed = instance.listModels('copilot-bridge')
  release({ generation: 2, models: snapshot.models.filter(model => model.id === 'mai-code-2') })
  assert.deepEqual((await listed).map(model => model.id), ['mai-code-2'])
})

test('a hidden model still resolves but is not listed; disabled and unknown models do not resolve', async () => {
  const { instance } = adapter({}, ['mai-code-2'])
  assert.ok(!(await instance.listModels('copilot-bridge')).some(model => model.id === 'mai-code-2'))
  const resolved = await instance.resolveModel('copilot-bridge', 'mai-code-2')
  assert.equal(resolved.id, 'mai-code-2')
  assert.equal(resolved.provider, 'copilot-bridge')
  assert.deepEqual(resolved.context, { contextWindow: 200_000 })
  await assert.rejects(instance.resolveModel('copilot-bridge', 'claude-opus-5'), { code: 'UNKNOWN_MODEL' })
  await assert.rejects(instance.resolveModel('copilot-bridge', 'nope'), { code: 'UNKNOWN_MODEL' })
})

test('resolveModel awaits discovery and fails retryably when no catalog is known', async () => {
  const { instance } = adapter({ catalog: { ready: async () => { throw new Error('Copilot model discovery failed') } } })
  await assert.rejects(instance.resolveModel('copilot-bridge', 'mai-code-2'), { code: 'DISCOVERY_FAILED' })
  assert.deepEqual(await instance.listModels('copilot-bridge'), [])
})

test('reasoning efforts are the advertised pi-ai levels only and omitted when none', async () => {
  const { instance } = adapter()
  const efforts = async (id: string) => (await instance.resolveModel('copilot-bridge', id)).reasoning?.efforts.map(effort => effort.id)
  assert.deepEqual(await efforts('gpt-6'), ['minimal', 'low', 'medium', 'high', 'xhigh'])
  assert.deepEqual(await efforts('claude-sonnet-5'), ['low', 'medium', 'high'])
  assert.equal(await efforts('mai-code-2-flash'), undefined)
  assert.equal(await efforts('grok-4.7'), undefined)
})

test('adaptive model resolution excludes advertised minimal, including minimal-only descriptors', async () => {
  const sources = anthropicThinkingPayload.data.filter(model => model.id !== 'claude-haiku-4.5')
  for (const source of sources) {
    for (const advertised of [['minimal', 'low', 'medium', 'high', 'xhigh', 'max'], ['minimal']]) {
      const models = projectCatalog({ data: [{
        ...source, capabilities: { ...source.capabilities, supports: { reasoning_effort: advertised } },
      }] })
      const { instance } = adapter({ catalog: { ready: async () => ({ generation: 1, models }) } })
      const resolved = await instance.resolveModel('copilot-bridge', source.id)
      const prepared = await instance.prepareCall('copilot-bridge', source.id)
      const expected = advertised.length === 1 ? undefined : ['low', 'medium', 'high', 'xhigh', 'max']
      assert.deepEqual(resolved.reasoning?.efforts.map(effort => String(effort.id)), expected, source.id)
      assert.deepEqual(prepared.model.reasoning?.efforts.map(effort => String(effort.id)), expected, source.id)
    }
  }
})

test('input modalities: image only for vision models with an image loader, never pdf', async () => {
  assert.deepEqual((await adapter().instance.resolveModel('copilot-bridge', 'gemini-3-pro')).inputModalities, ['text'])
  const { instance } = adapter({ loadImage: async () => ({ data: 'aGVsbG8=', mimeType: 'image/png' }) })
  assert.deepEqual((await instance.resolveModel('copilot-bridge', 'gemini-3-pro')).inputModalities, ['text', 'image'])
  assert.deepEqual((await instance.resolveModel('copilot-bridge', 'kimi-k3')).inputModalities, ['text'])
})

// --- wire requests ---------------------------------------------------------------
test('mai-code-2 streams over the Responses endpoint with Copilot auth, attribution and exact model ID', async () => {
  const http = fakeFetch(sse(responsesText('Hi!')))
  const { instance } = adapter({ fetch: http.fetch })
  const chunks = await collect(instance.stream(request('mai-code-2')))
  const [sent] = http.requests
  assert.equal(sent?.url, `${BASE}/responses`)
  assert.equal(sent.redirect, 'error')
  assert.equal(sent.body.model, 'mai-code-2')
  assert.equal(sent.body.stream, true)
  assert.equal(sent.headers.get('authorization'), 'Bearer tok-1')
  assert.equal(sent.headers.get('x-initiator'), 'user')
  assert.equal(sent.headers.get('openai-intent'), 'conversation-edits')
  assert.equal(sent.headers.get('copilot-integration-id'), 'vscode-chat')
  assert.equal(sent.headers.get('editor-version'), 'vscode/1.107.0')
  assert.equal(sent.headers.get('user-agent'), attributionHeaders()['user-agent'])
  assert.equal(sent.body.reasoning, undefined)
  assert.deepEqual(chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text), ['H', 'i', '!'])
  assert.deepEqual(blockEnds(chunks), [{ type: 'text', text: 'Hi!' }])
  assert.deepEqual(chunks.at(-2), { type: 'usage', usage: { inputTokens: 10, outputTokens: 3, totalTokens: 15, cacheReadTokens: 2 } })
  assert.deepEqual(finishOf(chunks), { kind: 'stop' })
})

test('Opus 5.5 without an effort uses adaptive thinking and the server default effort', async () => {
  const http = fakeFetch(init => {
    const body = JSON.parse(String(init?.body))
    return body.thinking?.type === 'adaptive'
      ? sse(anthropicText('ok'))()
      : httpError(400, '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.')()
  })
  const { instance } = adapter({
    fetch: http.fetch,
    catalog: { ready: async () => ({ generation: 1, models: projectCatalog(opus55Payload) }) },
  })
  const chunks = await collect(instance.stream(request('claude-opus-5.5')))
  const [sent] = http.requests
  assert.equal(sent?.url.split('?')[0], `${BASE}/v1/messages`)
  assert.equal(sent.body.model, 'claude-opus-5.5')
  assert.deepEqual(sent.body.thinking, { type: 'adaptive', display: 'summarized' })
  assert.equal(sent.body.output_config, undefined, 'no invented effort: use the upstream model default')
  assert.deepEqual(finishOf(chunks), { kind: 'stop' })
})

test('Sonnet 5 streams over Anthropic Messages with Bearer auth and adaptive effort', async () => {
  const http = fakeFetch(sse(anthropicText('Done', 'pondering')))
  const { instance } = adapter({ fetch: http.fetch })
  const chunks = await collect(instance.stream(request('claude-sonnet-5', { reasoningEffort: ReasoningEffortId('medium') })))
  const [sent] = http.requests
  assert.equal(sent?.url.split('?')[0], `${BASE}/v1/messages`)
  assert.equal(sent.redirect, 'error')
  assert.equal(sent.body.model, 'claude-sonnet-5')
  assert.equal(sent.headers.get('authorization'), 'Bearer tok-1')
  assert.equal(sent.headers.get('x-api-key'), null)
  assert.equal(sent.headers.get('x-initiator'), 'user')
  assert.equal(sent.headers.get('user-agent'), attributionHeaders()['user-agent'])
  assert.deepEqual(sent.body.thinking, { type: 'adaptive', display: 'summarized' })
  assert.deepEqual(sent.body.output_config, { effort: 'medium' })
  assert.ok(chunks.some(chunk => chunk.type === 'reasoning-delta' && chunk.text === 'pondering'))
  assert.deepEqual(blockEnds(chunks), [{ type: 'reasoning', text: 'pondering' }, { type: 'text', text: 'Done' }])
  assert.deepEqual(finishOf(chunks), { kind: 'stop' })
})

test('known Copilot adaptive models serialize allowed advertised efforts but reject advertised minimal before HTTP', async () => {
  const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
  const models = projectCatalog({ data: anthropicThinkingPayload.data
    .filter(model => model.id !== 'claude-haiku-4.5')
    .map(model => ({ ...model, capabilities: { ...model.capabilities, supports: { reasoning_effort: ['minimal', ...efforts] } } })) })
  for (const model of models) {
    const http = fakeFetch(...efforts.map(() => sse(anthropicText('ok'))), sse(anthropicText('minimal must not reach HTTP')))
    const { instance } = adapter({ fetch: http.fetch, catalog: { ready: async () => ({ generation: 1, models: [model] }) } })
    const prepared = await instance.prepareCall('copilot-bridge', model.id)
    for (const effort of efforts) {
      const chunks = await collect(prepared.stream(request(model.id, { reasoningEffort: ReasoningEffortId(effort) })))
      const sent = http.requests.at(-1)!
      assert.deepEqual(sent.body.thinking, { type: 'adaptive', display: 'summarized' }, `${model.id}/${effort}`)
      assert.deepEqual(sent.body.output_config, { effort })
      assert.equal(sent.body.model, model.id)
      assert.ok(!(sent.headers.get('anthropic-beta') ?? '').includes('thinking-binding'))
      assert.ok(!(sent.headers.get('anthropic-beta') ?? '').includes('output-config'))
      assert.deepEqual(finishOf(chunks), { kind: 'stop' })
    }
    await assert.rejects(collect(prepared.stream(request(model.id, { reasoningEffort: ReasoningEffortId('minimal') }))), { code: 'UNSUPPORTED_REASONING_EFFORT' })
    assert.equal(http.requests.length, efforts.length, 'unsupported effort never reaches HTTP')
  }
})

test('always-adaptive models keep the upstream default with supported, minimal-only or no advertised efforts', async () => {
  for (const id of ['claude-opus-5.5', 'claude-sonnet-5.5', 'claude-fable-5', 'claude-fable-5.1']) {
    for (const efforts of [['low', 'medium', 'high'], ['minimal'], []]) {
      const source = anthropicThinkingPayload.data.find(model => model.id === id)!
      const models = projectCatalog({ data: [{ ...source, capabilities: { ...source.capabilities, supports: { reasoning_effort: efforts } } }] })
      const http = fakeFetch(sse(anthropicText('ok')))
      const { instance } = adapter({ fetch: http.fetch, catalog: { ready: async () => ({ generation: 1, models }) } })
      const prepared = await instance.prepareCall('copilot-bridge', id)
      if (efforts.length === 0) assert.equal(prepared.model.reasoning, undefined)
      await assert.rejects(collect(prepared.stream(request(id, { reasoningEffort: ReasoningEffortId('minimal') }))), { code: 'UNSUPPORTED_REASONING_EFFORT' })
      assert.equal(http.requests.length, 0, 'even advertised minimal must be rejected before HTTP')
      const chunks = await collect(prepared.stream(request(id, { maxTokens: 1234, temperature: 0.4 })))
      const sent = http.requests[0]!
      assert.deepEqual(sent.body.thinking, { type: 'adaptive', display: 'summarized' }, id)
      assert.equal(sent.body.output_config, undefined)
      assert.equal(sent.body.max_tokens, 1234)
      assert.equal(sent.body.temperature, undefined, 'adaptive thinking does not accept sampling temperature')
      assert.equal(sent.redirect, 'error')
      assert.equal(sent.headers.get('authorization'), 'Bearer tok-1')
      assert.equal(sent.headers.get('user-agent'), attributionHeaders()['user-agent'])
      assert.deepEqual(finishOf(chunks), { kind: 'stop' })
      await assert.rejects(collect(prepared.stream(request(id, { reasoningEffort: ReasoningEffortId('max') }))), { code: 'UNSUPPORTED_REASONING_EFFORT' })
      assert.equal(http.requests.length, 1)
    }
  }
})

test('genuine legacy Haiku retains minimal budget thinking and no-effort off behavior', async () => {
  const source = anthropicThinkingPayload.data.find(model => model.id === 'claude-haiku-4.5')!
  const models = projectCatalog({ data: [{
    ...source, capabilities: { ...source.capabilities, supports: { reasoning_effort: ['minimal', 'low', 'medium', 'high'] } },
  }] })
  const http = fakeFetch(sse(anthropicText('ok')), sse(anthropicText('ok')), sse(anthropicText('ok')))
  const { instance } = adapter({ fetch: http.fetch, catalog: { ready: async () => ({ generation: 1, models }) } })
  const resolved = await instance.resolveModel('copilot-bridge', 'claude-haiku-4.5')
  assert.deepEqual(resolved.reasoning?.efforts.map(effort => String(effort.id)), ['minimal', 'low', 'medium', 'high'])
  await collect(instance.stream(request('claude-haiku-4.5', { reasoningEffort: ReasoningEffortId('medium') })))
  assert.deepEqual(http.requests[0]?.body.thinking, { type: 'enabled', budget_tokens: 8192, display: 'summarized' })
  assert.equal(http.requests[0]?.body.output_config, undefined)
  await collect(instance.stream(request('claude-haiku-4.5')))
  assert.deepEqual(http.requests[1]?.body.thinking, { type: 'disabled' })
  await collect(instance.stream(request('claude-haiku-4.5', { reasoningEffort: ReasoningEffortId('minimal') })))
  assert.deepEqual(http.requests[2]?.body.thinking, { type: 'enabled', budget_tokens: 1024, display: 'summarized' })
  assert.equal(http.requests[2]?.body.output_config, undefined)
})

test('adaptive compatibility never selects a protocol by model name or applies to unknown Messages models', async () => {
  const source = opus55Payload.data[0]!
  const models = projectCatalog({ data: [
    { ...source, supported_endpoints: ['/responses'], capabilities: { ...source.capabilities, supports: { reasoning_effort: ['minimal'] } } },
    { ...source, id: 'claude-future', supported_endpoints: ['/v1/messages'] },
  ] })
  const http = fakeFetch(sse(responsesText('ok')), sse(anthropicText('ok')))
  const { instance } = adapter({ fetch: http.fetch, catalog: { ready: async () => ({ generation: 1, models }) } })
  const resolved = await instance.resolveModel('copilot-bridge', 'claude-opus-5.5')
  assert.deepEqual(resolved.reasoning?.efforts.map(effort => String(effort.id)), ['minimal'])
  await collect(instance.stream(request('claude-opus-5.5', { reasoningEffort: ReasoningEffortId('minimal') })))
  assert.equal(http.requests[0]?.url, `${BASE}/responses`)
  assert.deepEqual(http.requests[0]?.body.reasoning, { effort: 'minimal', summary: 'auto' })
  assert.equal(http.requests[0]?.body.thinking, undefined)
  await collect(instance.stream(request('claude-future', { reasoningEffort: ReasoningEffortId('medium') })))
  assert.equal((http.requests[1]?.body.thinking as { type: string }).type, 'enabled')
})

test('adaptive default requests retain abort, 401 refresh and injected transport seams', async () => {
  const catalog = { ready: async () => ({ generation: 1, models: projectCatalog(opus55Payload) }) }
  const http = fakeFetch(httpError(401, 'expired'), sse(anthropicText('ok')))
  const { instance, tokens } = adapter({ fetch: http.fetch, catalog })
  const prepared = await instance.prepareCall('copilot-bridge', 'claude-opus-5.5')
  const chunks = await collect(prepared.stream(request('claude-opus-5.5')))
  assert.deepEqual(finishOf(chunks), { kind: 'stop' })
  assert.deepEqual(tokens.invalidated, [1])
  assert.deepEqual(http.requests.map(sent => sent.headers.get('authorization')), ['Bearer tok-1', 'Bearer tok-2'])
  assert.ok(http.requests.every(sent => (sent.body.thinking as { type: string }).type === 'adaptive'))

  const controller = new AbortController()
  const pending = fakeFetch(init => {
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode(sseText(anthropicText('slow').slice(0, 3))))
        init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason))
      },
    })
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })
  const aborting = adapter({ catalog, fetch: pending.fetch }).instance
  const received: StreamChunk[] = []
  for await (const chunk of aborting.stream(request('claude-opus-5.5', { signal: controller.signal }))) {
    received.push(chunk)
    if (chunk.type === 'text-delta') controller.abort()
  }
  assert.equal(finishOf(received).kind, 'aborted')

  let injected = false
  const custom: BridgeTransport = async function* (model) {
    injected = model.id === 'claude-opus-5.5'
    throw new Error('injected transport')
  }
  const overriding = adapter({ catalog, transports: { 'anthropic-messages': custom } }).instance
  await assert.rejects(collect(overriding.stream(request('claude-opus-5.5'))), { code: 'PI_AI_ERROR' })
  assert.ok(injected)
})

test('Sonnet 5 without an effort retains supported disabled thinking', async () => {
  const http = fakeFetch(sse(anthropicText('ok')))
  const { instance } = adapter({ fetch: http.fetch })
  await collect(instance.stream(request('claude-sonnet-5')))
  assert.notEqual((http.requests[0]?.body.thinking as { type?: string } | undefined)?.type, 'enabled')
})

test('Gemini streams over Chat Completions', async () => {
  const http = fakeFetch(sse(completionsText('gemini-3-pro', 'hey'), true))
  const { instance } = adapter({ fetch: http.fetch })
  const chunks = await collect(instance.stream(request('gemini-3-pro')))
  const [sent] = http.requests
  assert.equal(sent?.url, `${BASE}/chat/completions`)
  assert.equal(sent.redirect, 'error')
  assert.equal(sent.body.model, 'gemini-3-pro')
  assert.equal(sent.headers.get('authorization'), 'Bearer tok-1')
  assert.equal(sent.headers.get('user-agent'), attributionHeaders()['user-agent'])
  assert.deepEqual(blockEnds(chunks), [{ type: 'text', text: 'hey' }])
  assert.deepEqual(finishOf(chunks), { kind: 'stop' })
})

test('an advertised effort is sent; an unadvertised effort is rejected', async () => {
  const http = fakeFetch(sse(responsesText('k')))
  const { instance } = adapter({ fetch: http.fetch })
  await collect(instance.stream(request('gpt-6', { reasoningEffort: ReasoningEffortId('xhigh') })))
  assert.equal((http.requests[0]?.body.reasoning as { effort?: string } | undefined)?.effort, 'xhigh')
  await assert.rejects(collect(instance.stream(request('gpt-6', { reasoningEffort: ReasoningEffortId('max') }))), { code: 'UNSUPPORTED_REASONING_EFFORT' })
  await assert.rejects(collect(instance.stream(request('grok-4.7', { reasoningEffort: ReasoningEffortId('low') }))), { code: 'UNSUPPORTED_REASONING_EFFORT' })
})

test('fragmented and parallel tool calls map to interleaved tool-call chunks', async () => {
  const http = fakeFetch(sse(responsesTools))
  const { instance } = adapter({ fetch: http.fetch })
  const chunks = await collect(instance.stream(request('gpt-6', {
    tools: [
      { name: 'read', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
      { name: 'list', description: 'List a dir', parameters: { type: 'object', properties: { dir: { type: 'string' } } } },
    ],
  })))
  const tools = http.requests[0]?.body.tools as { name: string }[]
  assert.deepEqual(tools.map(tool => tool.name), ['read', 'list'])
  const deltas = chunks.filter(chunk => chunk.type === 'tool-call-delta')
  const byIndex = (index: number) => deltas.filter(chunk => chunk.index === index).map(chunk => chunk.argumentsDelta).join('')
  assert.equal(byIndex(0), '{"path":"a.ts"}')
  assert.equal(byIndex(1), '{"dir":"src"}')
  const ends = blockEnds(chunks)
  assert.equal(ends.length, 2)
  assert.deepEqual(ends.map(block => block.type === 'tool-call' ? [block.name, JSON.parse(block.arguments)] : []), [['read', { path: 'a.ts' }], ['list', { dir: 'src' }]])
  assert.notEqual(ends[0]?.type === 'tool-call' && ends[0].id, ends[1]?.type === 'tool-call' && ends[1].id)
  assert.deepEqual(finishOf(chunks), { kind: 'tool-calls' })
})

test('malformed and array tool arguments never become executable empty calls; truncation remains max-tokens', async () => {
  for (const argumentsText of ['[]', '{"path":']) {
    for (const truncated of [false, true]) {
      const events = [
        { type: 'response.created', response: { id: 'bad' } },
        { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_bad', call_id: 'bad', name: 'read', arguments: '' } },
        { type: 'response.function_call_arguments.delta', output_index: 0, delta: argumentsText },
        { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_bad', call_id: 'bad', name: 'read', arguments: argumentsText } },
        { type: truncated ? 'response.incomplete' : 'response.completed', response: { id: 'bad', status: truncated ? 'incomplete' : 'completed',
          ...truncated ? { incomplete_details: { reason: 'max_output_tokens' } } : {}, usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 } } },
      ]
      const http = fakeFetch(sse(events))
      const { instance } = adapter({ fetch: http.fetch })
      const chunks = await collect(instance.stream(request('gpt-6')))
      const reason = finishOf(chunks)
      assert.deepEqual(blockEnds(chunks), [], 'malformed arguments must not be completed as a {} tool call')
      if (truncated) assert.deepEqual(reason, { kind: 'max-tokens' })
      else assert.equal(reason.kind === 'error' && reason.failure.code, 'MALFORMED_RESPONSE')
    }
  }
})

test('tool results and prior tool calls are sent back on the next request as agent-initiated', async () => {
  const http = fakeFetch(sse(responsesText('ok')))
  const { instance } = adapter({ fetch: http.fetch })
  const callId = ToolCallId('call_a|fc_a')
  const messages = [
    user('read a.ts'),
    { id: 'm2', role: 'assistant', source: { kind: 'model', provider: 'copilot-bridge', model: 'gpt-6' }, content: [{ type: 'tool-call', id: callId, name: 'read', arguments: '{"path":"a.ts"}' }] },
    { id: 'm3', role: 'tool', source: { kind: 'tool' }, toolCallId: callId, content: [{ type: 'text', text: 'contents' }] },
  ] as unknown as RequestMessage[]
  await collect(instance.stream(request('gpt-6', { messages })))
  const [sent] = http.requests
  assert.equal(sent?.headers.get('x-initiator'), 'agent')
  const input = JSON.stringify(sent.body.input)
  assert.match(input, /function_call_output/)
  assert.match(input, /contents/)
  assert.match(input, /call_a/)
})

test('vision requests send the image and the Copilot vision header', async () => {
  const http = fakeFetch(sse(completionsText('gemini-3-pro', 'a cat'), true))
  const { instance } = adapter({ fetch: http.fetch, loadImage: async () => ({ data: 'aGVsbG8=', mimeType: 'image/png' }) })
  const image = { attachmentId: 'sha256:0123456789abcdef', mediaType: 'image/png', bytes: 5, width: 1, height: 1 }
  await collect(instance.stream(request('gemini-3-pro', {
    messages: [{ role: 'user', content: [{ type: 'text', text: 'what?' }, { type: 'image', attachment: image }] }] as unknown as RequestMessage[],
  })))
  const [sent] = http.requests
  assert.equal(sent?.headers.get('copilot-vision-request'), 'true')
  assert.match(JSON.stringify(sent.body.messages), /data:image\/png;base64,aGVsbG8=/)
})

// --- errors, cancellation, auth refresh ---------------------------------------------------
test('provider errors never expose echoed access tokens but retain safe status and classification', async () => {
  const secret = 'tok-1'
  for (const model of ['mai-code-2', 'claude-sonnet-5', 'gemini-3-pro']) {
    const http = fakeFetch(httpError(400, `context length exceeded; Authorization: Bearer ${secret}`))
    const { instance } = adapter({ fetch: http.fetch })
    const chunks = await collect(instance.stream(request(model)))
    const reason = finishOf(chunks)
    assert.equal(reason.kind === 'error' && reason.failure.code, 'CONTEXT_WINDOW_EXCEEDED')
    assert.equal(reason.kind === 'error' && reason.failure.status, 400)
    assert.equal(JSON.stringify(chunks).includes(secret), false, model)
    assert.equal(JSON.stringify(chunks).includes('Authorization'), false, model)
  }
})

test('a throwing transport cannot expose request secrets in a propagated error or its cause', async () => {
  const transport: BridgeTransport = async function* () { throw new Error('network failure Bearer tok-1') }
  const { instance } = adapter({ transports: { 'anthropic-messages': transport } })
  await assert.rejects(collect(instance.stream(request('claude-sonnet-5'))), error => {
    assert.ok(error instanceof Error)
    assert.equal(error.message.includes('tok-1'), false)
    assert.equal(error.cause, undefined)
    assert.equal((error as Error & { code: string }).code, 'TRANSPORT')
    return true
  })
})

test('a provider error before the stream is a terminal error finish', async () => {
  const http = fakeFetch(httpError(400, 'bad request'))
  const { instance } = adapter({ fetch: http.fetch })
  const reason = finishOf(await collect(instance.stream(request('mai-code-2'))))
  assert.equal(reason.kind, 'error')
  assert.equal(reason.kind === 'error' && reason.failure.code, 'INVALID_REQUEST')
  assert.equal(reason.kind === 'error' && reason.failure.status, 400)
})

test('401 before the first chunk invalidates the token once, re-exchanges and retries once', async () => {
  const http = fakeFetch(httpError(401, 'token expired'), sse(responsesText('ok')))
  const { instance, tokens } = adapter({ fetch: http.fetch })
  const chunks = await collect(instance.stream(request('mai-code-2')))
  assert.deepEqual(tokens.invalidated, [1])
  assert.deepEqual(http.requests.map(sent => sent.headers.get('authorization')), ['Bearer tok-1', 'Bearer tok-2'])
  assert.deepEqual(finishOf(chunks), { kind: 'stop' })
})

test('a second 401 after the retry is a terminal auth error', async () => {
  const http = fakeFetch(httpError(401, 'no'), httpError(401, 'still no'))
  const { instance, tokens } = adapter({ fetch: http.fetch })
  const reason = finishOf(await collect(instance.stream(request('claude-sonnet-5'))))
  assert.equal(http.requests.length, 2)
  assert.deepEqual(tokens.invalidated, [1])
  assert.equal(reason.kind === 'error' && reason.failure.code, 'AUTH')
})

test('401 after the first chunk is a terminal error without retry', async () => {
  let calls = 0
  const transport: BridgeTransport = async function* (model) {
    calls++
    const partial = { role: 'assistant', content: [{ type: 'text', text: 'x' }], api: model.api, provider: model.provider, model: model.id, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'error', errorMessage: '401 unauthorized', timestamp: 0 }
    yield { type: 'start', partial } as unknown as AssistantMessageEvent
    yield { type: 'text_start', contentIndex: 0, partial } as unknown as AssistantMessageEvent
    yield { type: 'text_delta', contentIndex: 0, delta: 'x', partial } as unknown as AssistantMessageEvent
    yield { type: 'error', reason: 'error', error: partial } as unknown as AssistantMessageEvent
  }
  const { instance, tokens } = adapter({ transports: { 'openai-responses': transport } })
  const chunks = await collect(instance.stream(request('mai-code-2')))
  assert.equal(calls, 1)
  assert.deepEqual(tokens.invalidated, [])
  const reason = finishOf(chunks)
  assert.equal(reason.kind === 'error' && reason.failure.code, 'AUTH')
})

test('cancellation via AbortSignal ends the stream as aborted', async () => {
  const controller = new AbortController()
  const http = fakeFetch(init => {
    const events = responsesText('slow').slice(0, 3)
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode(sseText(events)))
        init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason))
      },
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  })
  const { instance } = adapter({ fetch: http.fetch })
  const chunks: StreamChunk[] = []
  for await (const chunk of instance.stream(request('mai-code-2', { signal: controller.signal }))) {
    chunks.push(chunk)
    if (chunk.type === 'text-delta') controller.abort()
  }
  const reason = finishOf(chunks)
  assert.equal(reason.kind, 'aborted')
})

test('a prepared call keeps its own token generation and model definition across a refresh', async () => {
  const http = fakeFetch(sse(responsesText('ok')))
  let catalog = snapshot
  const tokens = fakeTokens(token(1, 'https://api.one.githubcopilot.com'))
  const instance = new BridgeAdapter({ catalog: { ready: async () => catalog }, tokens: tokens.tokens, hidden: () => [], fetch: http.fetch })
  const prepared = await instance.prepareCall('copilot-bridge', 'gpt-6')
  tokens.set(token(2, 'https://api.two.githubcopilot.com'))
  catalog = { generation: 2, models: [] }
  const chunks = await collect(prepared.stream(request('gpt-6')))
  assert.equal(prepared.model.id, 'gpt-6')
  assert.equal(http.requests[0]?.url, 'https://api.one.githubcopilot.com/responses')
  assert.equal(http.requests[0]?.headers.get('authorization'), 'Bearer tok-1')
  assert.deepEqual(finishOf(chunks), { kind: 'stop' })
  await assert.rejects(instance.prepareCall('copilot-bridge', 'gpt-6'), { code: 'UNKNOWN_MODEL' })
})

test('preparation rejects a model definition and token from different generations', async () => {
  const tokens = fakeTokens(token(1))
  const http = fakeFetch(sse(responsesText('must not send')))
  const instance = new BridgeAdapter({
    catalog: { ready: async () => { tokens.set(token(2, BASE, 2)); return snapshot } },
    tokens: tokens.tokens, hidden: () => [], fetch: http.fetch,
  })
  await assert.rejects(instance.prepareCall('copilot-bridge', 'gpt-6'), { code: 'DISCOVERY_FAILED' })
  assert.deepEqual(http.requests, [])
})

test('401 retry never sends a prepared conversation using a different account', async () => {
  const tokens = fakeTokens(token(1))
  const http = fakeFetch(() => {
    tokens.set(token(2, 'https://api.two.githubcopilot.com', 2))
    return httpError(401, 'expired')()
  }, sse(responsesText('must not send')))
  const { instance } = adapter({ tokens: tokens.tokens, fetch: http.fetch })
  await assert.rejects(collect(instance.stream(request('mai-code-2'))), { code: 'AUTH' })
  assert.equal(http.requests.length, 1)
})

test('exact lookup and preparation honor pre-abort and stop waiting promptly without cancelling shared discovery', async () => {
  let release!: (value: CatalogSnapshot) => void
  const discovery = new Promise<CatalogSnapshot>(resolve => { release = resolve })
  let reads = 0
  const { instance } = adapter({ catalog: { ready: () => { reads++; return discovery } } })
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(instance.resolveModel('copilot-bridge', 'gpt-6', aborted.signal), { code: 'ABORTED' })
  await assert.rejects(instance.prepareCall('copilot-bridge', 'gpt-6', aborted.signal), { code: 'ABORTED' })
  assert.equal(reads, 0, 'pre-aborted requests do not start discovery')
  const caller = new AbortController()
  const resolving = instance.resolveModel('copilot-bridge', 'gpt-6', caller.signal)
  const preparing = instance.prepareCall('copilot-bridge', 'gpt-6', caller.signal)
  const survivor = instance.resolveModel('copilot-bridge', 'mai-code-2')
  const failures = Promise.all([
    assert.rejects(resolving, { code: 'ABORTED' }), assert.rejects(preparing, { code: 'ABORTED' }),
  ])
  caller.abort()
  try {
    await Promise.race([failures, new Promise<void>((_resolve, reject) => setImmediate(() => reject(new Error('abort did not settle promptly'))))])
  } finally { release(snapshot) }
  assert.equal((await survivor).id, 'mai-code-2')
})

test('signed out: prepareCall fails with a missing-credential error', async () => {
  const { AccessTokenError } = await import('../src/host/access-token.ts')
  const instance = new BridgeAdapter({
    catalog: { ready: async () => snapshot }, hidden: () => [],
    tokens: { current: async () => { throw new AccessTokenError('signed-out', 'Not signed in') }, invalidate() {} },
  })
  await assert.rejects(instance.prepareCall('copilot-bridge', 'gpt-6'), { code: 'MISSING_CREDENTIAL' })
})
