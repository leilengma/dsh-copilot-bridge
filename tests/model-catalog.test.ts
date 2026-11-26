import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AuthStatus } from '../src/shared/contract.ts'
import { modelCatalog } from '../src/host/model-catalog.ts'

const status: AuthStatus = {
  authenticated: true, state: 'authenticated', provider: 'github-copilot',
  githubHost: 'github.com', enterpriseUrl: '', configWritable: true,
  availableModels: ['hidden', 'unknown', 'visible'], hiddenModels: ['hidden'],
}

test('management catalog includes hidden models and resolves safe metadata without listing the filtered picker', async () => {
  const calls: string[] = []
  const result = await modelCatalog(status, {
    async resolveModelInfo(provider, id) {
      calls.push(`${provider}/${id}`)
      if (id === 'unknown') throw new Error('model missing from adapter')
      return { provider, id, name: `Name ${id}`, context: { contextWindow: 200_000 }, inputModalities: ['text', 'image'] }
    },
  })
  assert.equal(result.status, status)
  assert.deepEqual(result.models, [
    { id: 'hidden', name: 'Name hidden', contextWindow: 200_000, inputModalities: ['text', 'image'] },
    { id: 'unknown', name: 'unknown' },
    { id: 'visible', name: 'Name visible', contextWindow: 200_000, inputModalities: ['text', 'image'] },
  ])
  assert.deepEqual(calls, ['github-copilot/hidden', 'github-copilot/unknown', 'github-copilot/visible'])
})

test('missing LLM service degrades to raw account ids and unknown catalogs stay empty', async () => {
  assert.deepEqual((await modelCatalog(status)).models, status.availableModels?.map(id => ({ id, name: id })))
  const { availableModels: _models, ...unknown } = status
  assert.deepEqual((await modelCatalog(unknown)).models, [])
  assert.deepEqual((await modelCatalog({ ...status, availableModels: [] })).models, [])
})

test('live billing enriches only eligible account ids, including hidden rows, without changing visibility', async () => {
  const retiring = { retiring: 'Retiring December 1', pricing: { input: 5, output: 25 }, promotion: { discountPercent: 50 } }
  const result = await modelCatalog(status, undefined, async () => new Map([
    ['hidden', retiring], ['not-eligible', retiring],
  ]))
  assert.equal(result.status, status)
  assert.deepEqual(result.models, [
    { id: 'hidden', name: 'hidden', ...retiring }, { id: 'unknown', name: 'unknown' }, { id: 'visible', name: 'visible' },
  ])
  assert.deepEqual((await modelCatalog({ ...status, authenticated: false }, undefined, async () => {
    assert.fail('signed out must not request metadata')
  })).models, [])
})

test('signed-out callers never resolve or expose model metadata', async () => {
  const result = await modelCatalog({ ...status, authenticated: false }, {
    async resolveModelInfo() { throw new Error('must not be called') },
  })
  assert.deepEqual(result.models, [])
})
