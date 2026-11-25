import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterModelSelection } from '../src/host/model-selection.ts'

const models = [{ provider: 'github-copilot', id: 'hidden', name: 'Hidden model' }]

test('catalog wrapper preserves an existing own method descriptor and its receiver', async () => {
  const runtime = {
    calls: 0,
    async listModels(_provider: string) { this.calls++; return models },
  }
  Object.defineProperty(runtime, 'listModels', { enumerable: false })
  const before = Object.getOwnPropertyDescriptor(runtime, 'listModels')
  const dispose = filterModelSelection(runtime, () => ['hidden'])
  assert.deepEqual(await runtime.listModels('github-copilot'), [])
  assert.equal(runtime.calls, 1)
  dispose()
  dispose()
  assert.deepEqual(Object.getOwnPropertyDescriptor(runtime, 'listModels'), before)
  assert.equal(await runtime.listModels('github-copilot'), models)
})

test('unload leaves a later wrapper intact and deactivates any retained filter', async () => {
  const runtime = { async listModels(_provider: string) { return models } }
  const dispose = filterModelSelection(runtime, () => ['hidden'])
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
  const dispose = filterModelSelection(runtime, () => { throw new Error('disposed config must not be read') })
  const inflight = runtime.listModels('github-copilot')
  dispose()
  resume()
  assert.equal(await inflight, models)
})
