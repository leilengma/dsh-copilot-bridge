import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectCatalog, type CatalogModel } from '../src/host/live-catalog.ts'
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
