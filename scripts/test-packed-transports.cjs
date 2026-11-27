// Same installed Electron/modules arguments as test-installed-harness.cjs, plus
// the absolute packed-plugin lib/index.js path. All HTTP is synthetic; sockets
// are blocked by the shared fixture. No desktop profile or account is touched.
const assert = require('node:assert/strict')
const { realpathSync } = require('node:fs')
const { createRequire, registerHooks } = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createHarnessFixture, BRIDGE } = require('./installed-harness-fixture.cjs')

const BASE = 'https://api.individual.githubcopilot.com'
const text = 'packed transport works'
const catalog = { data: [
  ['claude-opus-5.5', '/v1/messages'],
  ['fixture-responses', '/responses'],
  ['fixture-completions', '/chat/completions'],
].map(([id, endpoint]) => ({
  id, name: id, model_picker_enabled: true, supported_endpoints: [endpoint],
  capabilities: { type: 'chat', limits: { max_context_window_tokens: 200000, max_output_tokens: 32000 },
    supports: { tool_calls: true, streaming: true, reasoning: id.startsWith('claude') } },
})) }
const replies = new Map([
  ['/v1/messages', [
    { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-opus-5.5', content: [], stop_reason: null, usage: { input_tokens: 9, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ]],
  ['/responses', [
    { type: 'response.created', response: { id: 'r1' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm2', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, delta: text },
    { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'm2', role: 'assistant', content: [{ type: 'output_text', text }] } },
    { type: 'response.completed', response: { id: 'r1', status: 'completed', usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } },
  ]],
  ['/chat/completions', [
    { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'fixture-completions', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
    { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'fixture-completions', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } },
  ]],
])

async function main() {
  assert.ok(process.argv[3], 'pass the absolute packed-plugin lib/index.js path after the installed modules path')
  const inference = new Map([...replies].map(([endpoint, events]) => [`${BASE}${endpoint}`, init => {
    const body = JSON.parse(String(init.body))
    if (endpoint === '/v1/messages') {
      assert.equal(body.thinking.type, 'adaptive')
      assert.equal(body.output_config, undefined, 'default effort must not be invented')
    }
    const data = events.map(event => `event: ${event.type ?? 'chunk'}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    return new Response(data + (endpoint === '/chat/completions' ? 'data: [DONE]\n\n' : ''), {
      headers: { 'content-type': 'text/event-stream' },
    })
  }]))
  // A fresh production-only consumer has no Harness peers: the app supplies
  // them. Resolve ONLY the packed entry's @deepseek-ai imports to that installed
  // host; every SDK/runtime dependency still resolves from the packed package.
  const entryUrl = pathToFileURL(realpathSync(process.argv[3])).href
  const hostRequire = createRequire(path.join(process.argv[2], '__fixture__.cjs'))
  const peers = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === entryUrl && specifier.startsWith('@deepseek-ai/')) {
      return nextResolve(pathToFileURL(hostRequire.resolve(specifier)).href, context)
    }
    return nextResolve(specifier, context)
  } })
  let h
  try {
    h = await createHarnessFixture({ pluginEntry: process.argv[3], catalog, inference })
    await h.mount()
    for (const model of catalog.data) {
      const chunks = []
      for await (const chunk of h.runtime.stream({
        provider: BRIDGE, model: model.id, messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      })) chunks.push(chunk)
      assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === text), JSON.stringify(chunks))
      assert.equal(chunks.at(-1).type, 'finish')
      assert.deepEqual(chunks.at(-1).reason, { kind: 'stop' })
      assert.equal(chunks.at(-1).replayState.response.model, model.id)
      console.log(`PASS: packed ${model.id} streams through public transport with fixture HTTP`)
    }
    assert.equal(h.requests.length, 5, 'one exchange/discovery plus exactly three inference fixtures')
    await h.assertNativeUnchanged()
  } finally {
    try { await h?.close() } finally { peers.deregister() }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
