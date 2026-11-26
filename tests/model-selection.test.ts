import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterModelSelection } from '../src/host/model-selection.ts'

const models = [{ provider: 'github-copilot', id: 'hidden', name: 'Hidden model' }]

test('a configured Copilot provider advertises no models while signed out', async () => {
  let signedIn = false
  let calls = 0
  const runtime = { async listModels(_provider: string) { calls++; return models } }
  const dispose = filterModelSelection(runtime, () => [], async () => signedIn)
  assert.deepEqual(await runtime.listModels('github-copilot'), [])
  assert.equal(calls, 0, 'do not ask the adapter to discover models or resolve fallback credentials while signed out')
  signedIn = true
  assert.deepEqual(await runtime.listModels('github-copilot'), models)
  signedIn = false
  assert.deepEqual(await runtime.listModels('github-copilot'), [])
  dispose()
})

test('a catalog request started before logout cannot return stale Copilot models afterward', async () => {
  let signedIn = true
  let resume!: () => void
  const wait = new Promise<void>(resolve => { resume = resolve })
  const runtime = { async listModels(_provider: string) { await wait; return models } }
  const dispose = filterModelSelection(runtime, () => [], async () => signedIn)
  const inflight = runtime.listModels('github-copilot')
  await new Promise(resolve => setImmediate(resolve))
  signedIn = false
  resume()
  assert.deepEqual(await inflight, [])
  dispose()
})

test('other providers never read the Copilot sign-in state', async () => {
  const runtime = { async listModels(_provider: string) { return models } }
  const dispose = filterModelSelection(runtime, () => [], async () => { throw new Error('must not inspect Copilot credentials') })
  assert.equal(await runtime.listModels('other'), models)
  dispose()
})

test('catalog wrapper preserves an existing own method descriptor and its receiver', async () => {
  const runtime = {
    calls: 0,
    async listModels(_provider: string) { this.calls++; return models },
  }
  Object.defineProperty(runtime, 'listModels', { enumerable: false })
  const before = Object.getOwnPropertyDescriptor(runtime, 'listModels')
  const dispose = filterModelSelection(runtime, () => ['hidden'], async () => true)
  assert.deepEqual(await runtime.listModels('github-copilot'), [])
  assert.equal(runtime.calls, 1)
  dispose()
  dispose()
  assert.deepEqual(Object.getOwnPropertyDescriptor(runtime, 'listModels'), before)
  assert.equal(await runtime.listModels('github-copilot'), models)
})

test('unload leaves a later wrapper intact and deactivates any retained filter', async () => {
  const runtime = { async listModels(_provider: string) { return models } }
  const dispose = filterModelSelection(runtime, () => ['hidden'], async () => true)
  const filtered = runtime.listModels
  const later = async (provider: string) => filtered.call(runtime, provider)
  runtime.listModels = later
  assert.deepEqual(await runtime.listModels('github-copilot'), [])
  dispose()
  assert.equal(runtime.listModels, later)
  assert.equal(await runtime.listModels('github-copilot'), models)
})

test('a catalog request completing after unload does not read disposed configuration', async () => {
  let resume!: () => void
  const wait = new Promise<void>(resolve => { resume = resolve })
  const runtime = { async listModels(_provider: string) { await wait; return models } }
  const dispose = filterModelSelection(runtime, () => { throw new Error('disposed config must not be read') }, async () => true)
  const inflight = runtime.listModels('github-copilot')
  dispose()
  resume()
  assert.equal(await inflight, models)
})
