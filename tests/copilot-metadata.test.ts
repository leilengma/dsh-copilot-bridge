import assert from 'node:assert/strict'
import { test } from 'node:test'
import { credentialKey, type CredentialRecord, type GrantRecord } from '@deepseek-ai/dsh-credentials'
import { createCopilotMetadata } from '../src/host/copilot-metadata.ts'

const now = Date.parse('2026-11-26T09:00:00Z')
const account = (enterpriseHost?: string) => ({
  kind: 'grant', payload: { type: 'github-oauth', token: 'never-forward-github-token', ...(enterpriseHost ? { enterpriseHost } : {}) },
} satisfies GrantRecord)
const access = (token = 'tid=test;proxy-ep=proxy.individual.githubcopilot.com', expiresAt = now + 3_600_000) => ({ token, expiresAt })
const signedIn = () => ({ readRecord: async () => account() })

test('host reads credit prices per million without applying the promotion twice or leaking raw catalog fields', async () => {
  const read = createCopilotMetadata({
    credentials: () => ({ readRecord: async key => {
      assert.deepEqual(key, credentialKey('copilot-bridge', 'github'), 'reads only the bridge record')
      return account()
    } }),
    accessToken: async () => access(), now: () => now,
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.individual.githubcopilot.com/models')
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer tid=test;proxy-ep=proxy.individual.githubcopilot.com')
      assert.equal(init?.redirect, 'error')
      assert.ok(init?.signal)
      return Response.json({ data: [{ id: 'haiku', secret: 'do-not-project', billing: {
        token_prices: { batch_size: 1000, default: { input_price: 0.005, output_price: 0.025, cache_read_price: 0, cache_write_price: 0.00625 } },
        promo: { id: 'sale', discount_percent: 50, message: 'Limited offer', ends_at: '2026-12-01T00:00:00Z' },
      } }] })
    },
  })
  assert.deepEqual([...(await read()).entries()], [['haiku', {
    pricing: { input: 5, output: 25, cacheRead: 0, cacheWrite: 6.25 },
    promotion: { discountPercent: 50, message: 'Limited offer', endsAt: '2026-12-01T00:00:00Z' },
  }]])
})

test('metadata reads are single-flight, cached briefly, and never shared across accounts or expired promotions', async () => {
  let time = now
  let record: CredentialRecord | undefined = account()
  let token = access()
  let calls = 0
  const read = createCopilotMetadata({
    credentials: () => ({ readRecord: async () => record }), accessToken: async () => token, now: () => time,
    fetch: async () => { calls++; return Response.json({ data: [{ id: 'm', billing: { promo: { discount_percent: 10, ends_at: new Date(now + 1000).toISOString() } } }] }) },
  })
  await Promise.all([read(), read(), read()])
  assert.equal(calls, 1)
  assert.ok((await read()).get('m')?.promotion)
  assert.equal(calls, 1)
  time += 1001
  assert.equal((await read()).get('m')?.promotion, undefined)
  token = access('account-two')
  await read()
  assert.equal(calls, 3)
  record = undefined
  assert.equal((await read()).size, 0)
  record = account()
  await read()
  assert.equal(calls, 4)
  time += 300_001
  await read()
  assert.equal(calls, 5)
})

test('signed-out, missing or expired access tokens do not trigger requests', async () => {
  const cases: [CredentialRecord | undefined, ReturnType<typeof access> | undefined][] = [
    [undefined, access()],
    [{ kind: 'api-key', key: 'not-an-oauth-grant' } as unknown as CredentialRecord, access()],
    [{ kind: 'grant', payload: { type: 'oauth', refresh: 'native-pi-ai-shape', access: 'x', expires: now + 1 } }, access()],
    [account(), undefined],
    [account(), access('')],
    [account(), access(undefined, now - 1)],
  ]
  for (const [record, token] of cases) {
    const read = createCopilotMetadata({ credentials: () => ({ readRecord: async () => record }), accessToken: async () => token, now: () => now,
      fetch: async () => { assert.fail('must not fetch') },
    })
    assert.equal((await read()).size, 0)
  }
  const unwired = createCopilotMetadata({ credentials: signedIn, now: () => now, fetch: async () => { assert.fail('must not fetch') } })
  assert.equal((await unwired()).size, 0, 'no access-token source means no metadata')
})

test('timeouts, rejected responses, invalid JSON and token-source errors degrade without leaking', async () => {
  for (const fetch of [
    async () => { throw new Error('Authorization: Bearer do-not-leak') },
    async () => new Response('do-not-leak', { status: 401 }),
    async () => new Response('invalid json'),
    async () => Response.json({ unexpected: 'do-not-project' }),
  ]) {
    const read = createCopilotMetadata({ credentials: signedIn, accessToken: async () => access(), now: () => now, fetch })
    assert.equal((await read()).size, 0)
  }
  const failing = createCopilotMetadata({ credentials: signedIn, accessToken: async () => { throw new Error('do-not-leak') }, now: () => now })
  assert.equal((await failing()).size, 0)
})

test('enterprise requests follow the signed-in host, and untrusted token hosts never receive credentials', async () => {
  for (const [token, enterpriseHost, expected] of [
    ['opaque', 'octocorp.ghe.com', 'https://copilot-api.octocorp.ghe.com/models'],
    ['proxy-ep=proxy.business.githubcopilot.com', undefined, 'https://api.business.githubcopilot.com/models'],
    ['proxy-ep=attacker.example', undefined, 'https://api.individual.githubcopilot.com/models'],
    ['proxy-ep=api.individual.githubcopilot.com.attacker.example', undefined, 'https://api.individual.githubcopilot.com/models'],
  ] as const) {
    const read = createCopilotMetadata({ credentials: () => ({ readRecord: async () => account(enterpriseHost) }), accessToken: async () => access(token), now: () => now,
      fetch: async url => { assert.equal(url, expected); return Response.json({ data: [] }) },
    })
    await read()
  }
})

test('long-context prices and older cache spelling are normalized; malformed prices stay unknown', async () => {
  const read = createCopilotMetadata({ credentials: signedIn, accessToken: async () => access(), now: () => now,
    fetch: async () => Response.json({ data: [{ id: 'm', billing: { token_prices: { batch_size: 1_000_000,
      default: { input_price: -1, output_price: '25', cache_price: 10, context_max: 200_000 },
      long_context: { input_price: 200, output_price: 1000, cache_write_price: 0 },
    }, promo: { discount_percent: 10, ends_at: 'not-a-date' } } }] }),
  })
  assert.deepEqual((await read()).get('m'), {
    pricing: { cacheRead: 10 }, longContextPricing: { input: 200, output: 1000, cacheWrite: 0 }, defaultContextMax: 200_000,
  })
})

test('provider retirement warnings are informational and expired or invalid promotions are omitted', async () => {
  const read = createCopilotMetadata({
    credentials: signedIn, accessToken: async () => access(), now: () => now,
    fetch: async () => Response.json({ data: [
      { id: 'pending', warning_text: { model_pending_deprecation: 'Going away December 1' }, billing: { promo: { discount_percent: 50, ends_at: '2026-11-25T00:00:00Z' } } },
      { id: 'deprecated', warning_messages: [{ code: 'model_deprecated', message: 'Choose another model' }] },
      { id: 'info', info_messages: [{ code: 'model_pending_deprecation', message: 'Retiring soon' }] },
      { id: 'other', warning_text: { rate_limit: 'Not retirement' }, billing: { promo: { discount_percent: 101 }, token_prices: { batch_size: 0, default: { input_price: 50 } } } },
    ] }),
  })
  assert.deepEqual([...(await read()).entries()], [
    ['pending', { retiring: 'Going away December 1' }], ['deprecated', { retiring: 'Choose another model' }],
    ['info', { retiring: 'Retiring soon' }], ['other', {}],
  ])
})
