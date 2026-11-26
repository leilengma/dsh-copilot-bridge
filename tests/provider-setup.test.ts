import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ensureCopilotProvider, type ProviderSetupDeps } from '../src/host/provider-setup.ts'

function harness(value: unknown = { providers: { other: { apiKeyEnv: 'MY_KEY' } } }) {
  const writes: unknown[] = []
  const reads: unknown[] = []
  let refreshes = 0
  let failure: Error | undefined
  const settings = {
    writable: true,
    describe(options: unknown) { reads.push(options); return [{ ns: 'custom-pi-ai', value, revision: 7 }] },
    async mutate(...args: unknown[]) {
      writes.push(args)
      if (failure) throw failure
    },
  }
  const llm = {
    listProviders: () => [] as { id: string; name: string }[],
    listConfigurableProviders: () => [{ provider: 'github-copilot', displayName: 'GitHub Copilot', settingsNs: 'custom-pi-ai', settingsPath: ['providers', 'github-copilot'] }],
  }
  const deps: ProviderSetupDeps = {
    settings: () => settings,
    llm: () => llm,
    async refresh() { refreshes++ },
  }
  return { deps, settings, llm, writes, reads, fail: (error: Error) => { failure = error }, refreshes: () => refreshes }
}

test('creates only the absent provider via its directory address, without an API key', async () => {
  const h = harness()
  await ensureCopilotProvider(h.deps)
  assert.deepEqual(h.reads, [{ redactSecrets: true }])
  assert.deepEqual(h.writes, [['custom-pi-ai', [{ op: 'set', path: ['providers', 'github-copilot'], value: {} }], 7]])
  assert.equal(h.refreshes(), 1)
})

for (const existing of [{}, { apiKeyEnv: 'CUSTOM_KEY', baseURL: 'https://proxy.example', models: [] }, null, false]) {
  test(`preserves an existing profile (${JSON.stringify(existing)}) even if settings are read-only`, async () => {
    const h = harness({ providers: { 'github-copilot': existing } })
    h.settings.writable = false
    await ensureCopilotProvider(h.deps)
    assert.deepEqual(h.writes, [])
    assert.equal(h.refreshes(), 1)
  })
}

test('an active route needs no settings service and is never recreated', async () => {
  const h = harness()
  h.llm.listProviders = () => [{ id: 'github-copilot', name: 'Custom Copilot' }]
  h.deps.settings = () => undefined
  await ensureCopilotProvider(h.deps)
  assert.deepEqual(h.writes, [])
  assert.equal(h.refreshes(), 1)
})

for (const missing of ['settings', 'llm', 'directory', 'namespace', 'read-only'] as const) {
  test(`refuses creation when ${missing} is unavailable`, async () => {
    const h = harness()
    if (missing === 'settings') h.deps.settings = () => undefined
    if (missing === 'llm') h.deps.llm = () => undefined
    if (missing === 'directory') h.llm.listConfigurableProviders = () => []
    if (missing === 'namespace') h.settings.describe = () => []
    if (missing === 'read-only') h.settings.writable = false
    await assert.rejects(ensureCopilotProvider(h.deps))
    assert.deepEqual(h.writes, [])
    assert.equal(h.refreshes(), 0)
  })
}

test('a revision conflict refuses the write without retrying over concurrent settings', async () => {
  const h = harness()
  h.fail(Object.assign(new Error('changed since read'), { code: 'SETTINGS_CONFLICT' }))
  await assert.rejects(ensureCopilotProvider(h.deps), /changed since read/)
  assert.equal(h.writes.length, 1)
  assert.equal(h.refreshes(), 0)
})

test('repeated setup reads the persisted provider and does not create duplicates', async () => {
  const h = harness()
  h.settings.mutate = async (...args) => {
    h.writes.push(args)
    h.settings.describe = () => [{ ns: 'custom-pi-ai', value: { providers: { 'github-copilot': {} } }, revision: 8 }]
  }
  await ensureCopilotProvider(h.deps)
  await ensureCopilotProvider(h.deps)
  assert.equal(h.writes.length, 1)
  assert.equal(h.refreshes(), 2)
})
