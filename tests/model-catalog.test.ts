import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AuthStatus } from '../src/shared/contract.ts'
import { modelCatalog } from '../src/host/model-catalog.ts'
import { projectCatalog, type CatalogSnapshot } from '../src/host/live-catalog.ts'
import { modelsPayload } from './fixtures/copilot-models.ts'

const status: AuthStatus = {
  authenticated: true, state: 'authenticated', provider: 'copilot-bridge',
  githubHost: 'github.com', enterpriseUrl: '', configWritable: true, hiddenModels: ['mai-code-2'],
}
const snapshot: CatalogSnapshot = { generation: 1, models: projectCatalog(modelsPayload) }
const catalog = { snapshot: () => snapshot, state: () => ({ status: 'ready' as const }) }

test('management rows preserve hidden and disabled descriptors and merge only exact-id display metadata', async () => {
  const retiring = { retiring: 'Retiring December 1', pricing: { input: 5, output: 25 }, promotion: { discountPercent: 50 } }
  const result = await modelCatalog(status, catalog, async () => new Map([['mai-code-2', retiring], ['not-eligible', retiring]]))
  assert.equal(result.status, status)
  assert.equal(result.models.length, 10)
  assert.deepEqual(result.models.find(model => model.id === 'mai-code-2'), {
    id: 'mai-code-2', name: 'Name mai-code-2', protocol: 'openai-responses', contextWindow: 200_000, inputModalities: ['text'], ...retiring,
  })
  assert.equal(result.models.find(model => model.id === 'claude-opus-5')?.disabledReason, 'not-offered')
  assert.equal(result.models.find(model => model.id === 'future-realtime')?.disabledReason, 'unsupported-protocol')
})

test('unknown differs from known-empty, and failure keeps the last good rows with a safe error', async () => {
  assert.deepEqual(await modelCatalog(status), { status, models: [], state: 'loading' })
  assert.deepEqual(await modelCatalog(status, { ...catalog, snapshot: () => ({ generation: 1, models: [] }) }), { status, models: [], state: 'ready' })
  const failed = await modelCatalog(status, { ...catalog, state: () => ({ status: 'error', error: 'Copilot model discovery failed' }) })
  assert.equal(failed.models.length, 10)
  assert.equal(failed.state, 'error')
  assert.equal(failed.error, 'Copilot model discovery failed')
})

test('signed-out callers never load metadata and reset during enrichment discards stale rows', async () => {
  assert.deepEqual((await modelCatalog({ ...status, authenticated: false }, catalog, async () => {
    assert.fail('signed out must not request metadata')
  })).models, [])
  let current: CatalogSnapshot | undefined = snapshot
  const result = await modelCatalog(status, { ...catalog, snapshot: () => current }, async () => {
    current = undefined
    return new Map()
  })
  assert.deepEqual(result.models, [])
})
