import assert from 'node:assert/strict'
import { test } from 'node:test'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { createCopilotUsage } from '../src/host/copilot-usage.ts'

const record = (token = 'secret-token', enterpriseHost?: string) => ({ kind: 'grant' as const, payload: { type: 'github-oauth', token, ...(enterpriseHost ? { enterpriseHost } : {}) } })
const quota = { token_based_billing: true, quota_reset_date_utc: '2026-12-01T00:00:00Z', quota_snapshots: {
  premium_interactions: { entitlement: 100000, quota_remaining: 53916.3, percent_remaining: 53.9, unlimited: false, credits_used: 46084 },
} }

test('account usage projects exact credits from remaining quota without exposing credentials or raw account data', async () => {
  const read = createCopilotUsage({ credentials: () => ({ readRecord: async key => {
    assert.deepEqual(key, credentialKey('copilot-bridge', 'github'), 'reads only the bridge record')
    return record()
  } }), fetch: async (url, init) => {
    assert.equal(url, 'https://api.github.com/copilot_internal/user')
    assert.equal(new Headers(init?.headers).get('authorization'), 'token secret-token')
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.signal)
    return Response.json({ ...quota, email: 'private@example.com', secret: 'never expose' })
  } })
  const result = await read()
  assert.deepEqual(result, { state: 'available', unit: 'credits', unlimited: false, percentUsed: 46.1, used: 46083.7, total: 100000, reset: { at: '2026-12-01T00:00:00.000Z', hasTime: true } })
  assert.doesNotMatch(JSON.stringify(result), /secret|email|private|access|refresh/)
})

test('usage uses the stored issuer, not a configured host, and handles request-based/unlimited plans', async () => {
  const read = createCopilotUsage({ credentials: () => ({ readRecord: async () => record('enterprise-secret', 'acme.ghe.com') }), fetch: async url => {
    assert.equal(url, 'https://api.acme.ghe.com/copilot_internal/user')
    return Response.json({ quota_snapshots: { premium_interactions: { unlimited: true, credits_used: 123, quota_reset_at: 1893456000 } } })
  } })
  assert.deepEqual(await read(), { state: 'available', unit: 'requests', unlimited: true, used: 123, reset: { at: '2030-01-01T00:00:00.000Z', hasTime: true } })
})

test('missing exact remaining quota never invents used credits from a rounded percentage', async () => {
  const read = createCopilotUsage({ credentials: () => ({ readRecord: async () => record() }), fetch: async () => Response.json({
    token_based_billing: true, quota_reset_date: '2026-12-01', quota_snapshots: { premium_interactions: { entitlement: '100000', percent_remaining: 53.9 } },
  }) })
  assert.deepEqual(await read(), { state: 'available', unit: 'credits', unlimited: false, total: 100000, percentUsed: 46.1, reset: { at: '2026-12-01T00:00:00.000Z', hasTime: false } })
})

test('signed-out callers never perform a network request; failures and malformed data are unavailable', async () => {
  let calls = 0
  const absent = createCopilotUsage({ credentials: () => undefined, fetch: async () => { calls++; throw Error('secret') } })
  assert.deepEqual(await absent(), { state: 'signed-out' })
  assert.equal(calls, 0)
  for (const fetch of [
    async () => { throw Error('secret-token') },
    async () => new Response('secret-token', { status: 401 }),
    async () => new Response('not json'),
    async () => Response.json({}),
    async () => Response.json({ quota_snapshots: { premium_interactions: { entitlement: -10, percent_remaining: 'NaN' } } }),
  ]) {
    const read = createCopilotUsage({ credentials: () => ({ readRecord: async () => record() }), fetch })
    assert.deepEqual(await read(), { state: 'unavailable' })
  }
})

test('concurrent reads deduplicate, but opening again fetches fresh quota', async () => {
  let calls = 0
  let resume!: () => void
  const wait = new Promise<void>(resolve => { resume = resolve })
  const read = createCopilotUsage({ credentials: () => ({ readRecord: async () => record() }), fetch: async () => {
    calls++; await wait; return Response.json(quota)
  } })
  const first = read(), second = read()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  resume()
  assert.deepEqual(await first, await second)
  await read()
  assert.equal(calls, 2)
})

test('delayed quota for a removed or replaced account cannot be returned as current usage', async () => {
  for (const next of [undefined, record('new-account')]) {
    let current: ReturnType<typeof record> | undefined = record()
    let resume!: () => void
    const wait = new Promise<void>(resolve => { resume = resolve })
    const read = createCopilotUsage({ credentials: () => ({ readRecord: async () => current }), fetch: async () => {
      await wait; return Response.json(quota)
    } })
    const pending = read()
    await new Promise(resolve => setImmediate(resolve))
    current = next
    resume()
    assert.deepEqual(await pending, { state: next ? 'unavailable' : 'signed-out' })
  }
})
