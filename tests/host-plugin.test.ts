import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { apply } from '../src/host/index.ts'
import { BRIDGE_RECORD_KEY } from '../src/shared/contract.ts'
import { bridgeRecordKey } from '../src/host/bridge-credentials.ts'

const bridgeRecord = (token: string): CredentialRecord => ({ kind: 'grant', payload: { type: 'github-oauth', token } })

const settle = () => new Promise(resolve => setImmediate(resolve))

// The installed pi-ai adapter lists a static catalog, ignoring the grant's allowed ids.
class StaticCatalog extends LlmAdapter {
  override async listModels(provider: string) {
    return ['a', 'b', 'A'].map(id => ({ provider, id, name: `Model ${id}`, inputModalities: ['text' as const] }))
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: `Model ${model}`, inputModalities: ['text' as const] }
  }
  override async *stream() { throw new Error('test must not make model requests') }
}

test('Host exposes account routes without registering chat authentication commands', async () => {
  const ctx = new Context()
  const commands: string[] = []
  const routes = new Set<string>()
  ctx.provide('commands', { register(command: { name: string }) {
    commands.push(command.name)
    return () => {}
  } })
  ctx.provide('connection', { fetch: { register(route: ConnectionFetchRoute) {
    routes.add(route.path)
    return async () => { routes.delete(route.path) }
  } } })
  try {
    apply(ctx, { enterpriseUrl: createVolatile(''), hiddenModels: createVolatile([]) })
    await settle()
    assert.deepEqual(commands, [])
    for (const action of ['login', 'status', 'logout']) {
      assert.ok(routes.has(`/api/copilot-bridge/${action}`), `${action} must remain available on the Account tab`)
    }
  } finally { await ctx.fiber.dispose() }
})

test('the actual LLM catalog boundary hides models even when the adapter ignores credentials', async () => {
  const ctx = new Context()
  const hiddenModels = createVolatile(['a'])
  const routes = new Map<string, ConnectionFetchRoute>()
  ctx.provide('connection', { fetch: { register(route: ConnectionFetchRoute) {
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } })
  const management = async () => {
    const response = await routes.get('/api/copilot-bridge/models')!.fetch(new Request('https://localhost/api/copilot-bridge/models'))
    assert.equal(response.status, 200)
    return (await response.json()).value
  }
  ctx.provide('credentials', {
    async readRecord() { return bridgeRecord('ghu_test') },
    async modifyRecord() { return undefined },
    async deleteRecord() {},
  })
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
  const catalog = await management()
  assert.deepEqual(catalog.status.availableModels, ['A', 'a', 'b'])
  assert.deepEqual(catalog.models.map((model: { id: string }) => model.id), ['A', 'a', 'b'], 'a grant without account ids must still populate Models before any chat request')

  const before = updates.length
  updateVolatile(hiddenModels, createVolatile(['a', 'b', 'A']))
  emitEdit()
  assert.deepEqual(await consumer.listModels('github-copilot'), [])
  assert.equal((await management()).models.length, 3, 'hiding every model must not empty the management table')
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

test('sign-out empties cached Copilot selectors while preserving its configured route and other providers', async () => {
  const ctx = new Context()
  const routes = new Map<string, ConnectionFetchRoute>()
  ctx.provide('connection', { fetch: { register(route: ConnectionFetchRoute) {
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } })
  let record: CredentialRecord | undefined = bridgeRecord('ghu_test')
  ctx.provide('credentials', {
    async readRecord() { return record },
    async modifyRecord() { return record },
    async deleteRecord() { record = undefined; ctx.emit('credentials/record-updated', bridgeRecordKey()) },
  })
  const runtime = new LlmRuntime(ctx)
  runtime.registerAdapter(['github-copilot', 'other'], new StaticCatalog())
  let cached: string[] = []
  let refreshes = 0
  ctx.on('llm/models-updated', async provider => {
    if (provider === 'github-copilot') {
      cached = (await ctx.llm.listModels(provider)).map(model => model.id)
      refreshes++
    }
  })
  try {
    apply(ctx, { enterpriseUrl: createVolatile(''), hiddenModels: createVolatile([]) })
    await settle()
    assert.deepEqual(cached, ['a', 'b', 'A'])
    const before = refreshes
    const logout = routes.get('/api/copilot-bridge/logout')!
    const response = await logout.fetch(new Request('https://localhost/api/copilot-bridge/logout', { method: 'POST' }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).value.authenticated, false)
    await settle()
    assert.ok(refreshes > before, 'sign-out must invalidate a populated model picker, even without hidden models')
    assert.deepEqual(cached, [])
    assert.deepEqual(await ctx.llm.listModels('github-copilot'), [])
    assert.ok(ctx.llm.listProviders().some(provider => provider.id === 'github-copilot'))
    assert.equal((await ctx.llm.listModels('other')).length, 3)
    record = bridgeRecord('ghu_test_again')
    ctx.emit('credentials/record-updated', bridgeRecordKey())
    await settle()
    assert.deepEqual(cached, ['a', 'b', 'A'], 'a new sign-in must repopulate existing selectors without a restart')
    record = undefined
    ctx.emit('credentials/record-updated', bridgeRecordKey())
    await settle()
    assert.deepEqual(cached, [], 'external credential deletion also invalidates cached selectors')
  } finally { await ctx.fiber.dispose() }
})

test('Host mount, record events, and volatile YAML edits never write credentials', async () => {
  const ctx = new Context()
  const routes = new Map<string, ConnectionFetchRoute>()
  ctx.provide('connection', { fetch: { register(route: ConnectionFetchRoute) {
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } })
  const hiddenModels = createVolatile(['a', 'removed'])
  const record = bridgeRecord('ghu_test')
  let writes = 0
  apply(ctx, { enterpriseUrl: createVolatile(''), hiddenModels })
  // Credential service can mount after the bridge.
  ctx.provide('credentials', {
    async readRecord(key: string) { return key === BRIDGE_RECORD_KEY ? record : undefined },
    async modifyRecord() { writes++; return undefined },
    async deleteRecord() { writes++ },
  })
  await settle()
  assert.ok(routes.has('/api/copilot-bridge/hidden-models'))
  // No settings/profile entry: stale ids must not prevent the read-only UI loading.
  const statusRoute = routes.get('/api/copilot-bridge/status')
  assert.ok(statusRoute)
  const response = await statusRoute.fetch(new Request('https://localhost/api/copilot-bridge/status'))
  assert.equal(response.status, 200)
  const status = (await response.json()).value
  assert.equal(status.configWritable, false)
  assert.deepEqual(status.hiddenModels, ['a', 'removed'], 'saved ids are reported as-is while the catalog is unknown')
  assert.deepEqual(hiddenModels.get(), ['a', 'removed'])
  const runtime = new LlmRuntime(ctx)
  runtime.registerAdapter(['github-copilot'], new StaticCatalog())
  await settle()

  ctx.emit('credentials/record-updated', bridgeRecordKey())
  updateVolatile(hiddenModels, createVolatile(['b']))
  ctx.emit('loader/volatile-update', [['hiddenModels']])
  await settle()
  assert.equal(writes, 0, 'hidden models live in the profile, never in a credential record')

  await ctx.fiber.dispose()
  assert.equal(routes.size, 0)
})
