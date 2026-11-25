import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { apply } from '../src/host/index.ts'
import type { CredentialStore } from '../src/host/auth-controller.ts'
import { grantModelIds } from '../src/host/grant.ts'
import { PI_AI_PROVIDER, PI_AI_RECORD_SCOPE } from '../src/shared/contract.ts'

const PI_AI_RECORD_KEY = credentialKey(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER)

const settle = () => new Promise(resolve => setImmediate(resolve))

// The installed pi-ai adapter lists a static catalog, ignoring the grant's allowed ids.
class StaticCatalog extends LlmAdapter {
  override async listModels(provider: string) {
    return ['a', 'b', 'A'].map(id => ({ provider, id, name: `Model ${id}`, inputModalities: ['text' as const] }))
  }
  override async *stream() { throw new Error('test must not make model requests') }
}

test('the actual LLM catalog boundary hides models even when the adapter ignores credentials', async () => {
  const ctx = new Context()
  const hiddenModels = createVolatile(['a'])
  const updates: string[] = []
  ctx.on('llm/models-updated', provider => { updates.push(provider) })
  // Exercise late service mounting and plugin disposal, not just a local wrapper call.
  let entryContext!: Context
  const bridge = ctx.plugin({ apply(child: Context) {
    entryContext = child
    apply(child, { enterpriseUrl: createVolatile(''), hiddenModels })
  } })
  // Match Loader Entry.updateVolatileConfig: only the entry fiber receives edits.
  const emitEdit = () => {
    const self: Context = Object.create(entryContext)
    Object.defineProperty(self, Context.filter, { value: (owner: Context) => owner.fiber === entryContext.fiber })
    entryContext.emit(self, 'loader/volatile-update', [['hiddenModels']])
  }
  const runtime = new LlmRuntime(ctx)
  runtime.registerAdapter(['github-copilot', 'other'], new StaticCatalog())
  await settle()
  const consumer = ctx.extend().llm
  assert.deepEqual((await consumer.listModels('github-copilot')).map(model => model.id), ['b', 'A'])
  assert.deepEqual((await consumer.listModels('other')).map(model => model.id), ['a', 'b', 'A'])
  assert.deepEqual((await consumer.resolveModelInfo('github-copilot', 'a')).id, 'a', 'hiding is advisory, not a routing block')
  assert.deepEqual((await consumer.listModels('github-copilot'))[0]?.inputModalities, ['text'])

  const before = updates.length
  updateVolatile(hiddenModels, createVolatile(['a', 'b', 'A']))
  emitEdit()
  assert.deepEqual(await consumer.listModels('github-copilot'), [])
  assert.ok(updates.length > before, 'cached selectors must receive a models-updated notification')
  updateVolatile(hiddenModels, createVolatile([]))
  emitEdit()
  assert.equal((await consumer.listModels('github-copilot')).length, 3)

  updateVolatile(hiddenModels, createVolatile(['a']))
  const beforeDispose = updates.length
  await bridge.dispose()
  assert.equal(Object.hasOwn(runtime, 'listModels'), false, 'restore the inherited method on unload')
  assert.equal((await consumer.listModels('github-copilot')).length, 3)
  assert.ok(updates.length > beforeDispose, 'unload must also refresh cached selectors')
  await ctx.fiber.dispose()
})

test('Host mount, pi-ai record events, and volatile YAML edits re-filter without a status request', async () => {
  const ctx = new Context()
  const routes = new Map<string, ConnectionFetchRoute>()
  ctx.provide('connection', { fetch: { register(route: ConnectionFetchRoute) {
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } })
  const hiddenModels = createVolatile(['a', 'removed'])
  let record: CredentialRecord | undefined = { kind: 'grant', payload: { refresh: 'ghu_test', availableModelIds: ['a', 'b'] } }
  let writes = 0
  const credentials: CredentialStore = {
    async readRecord() { return record },
    async modifyRecord(_key, update) {
      const next = await update(record)
      if (next !== undefined) {
        record = next
        writes++
        ctx.emit('credentials/record-updated', PI_AI_RECORD_KEY)
      }
      return record
    },
    async deleteRecord() { record = undefined },
  }
  apply(ctx, { enterpriseUrl: createVolatile(''), hiddenModels })
  // Credential service can mount after the bridge.
  ctx.provide('credentials', credentials)
  await settle()
  assert.deepEqual(grantModelIds(record), ['b'])
  assert.equal(writes, 1)
  assert.ok(routes.has('/api/copilot-bridge/hidden-models'))
  // No settings/profile entry: stale ids must not prevent the read-only UI loading.
  const statusRoute = routes.get('/api/copilot-bridge/status')
  assert.ok(statusRoute)
  const response = await statusRoute.fetch(new Request('https://localhost/api/copilot-bridge/status'))
  assert.equal(response.status, 200)
  const status = (await response.json()).value
  assert.equal(status.configWritable, false)
  assert.deepEqual(status.hiddenModels, ['a'])
  assert.deepEqual(hiddenModels.get(), ['a', 'removed'])

  record = { kind: 'grant', payload: { refresh: 'ghu_test', availableModelIds: ['a', 'b', 'c'] } }
  ctx.emit('credentials/record-updated', PI_AI_RECORD_KEY)
  await settle()
  assert.deepEqual(grantModelIds(record), ['b', 'c'])
  assert.equal(writes, 2)

  updateVolatile(hiddenModels, createVolatile(['b']))
  ctx.emit('loader/volatile-update', [['hiddenModels']])
  await settle()
  assert.deepEqual(grantModelIds(record), ['a', 'c'])
  assert.equal(writes, 3)

  ctx.emit('credentials/record-updated', credentialKey('other', 'provider'))
  await settle()
  assert.equal(writes, 3)

  await ctx.fiber.dispose()
  assert.equal(routes.size, 0)
  record = { kind: 'grant', payload: { refresh: 'ghu_test', availableModelIds: ['a', 'b'] } }
  ctx.emit('credentials/record-updated', PI_AI_RECORD_KEY)
  await settle()
  assert.deepEqual(grantModelIds(record), ['a', 'b'])
})
