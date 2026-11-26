import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAccessTokens, type AccessTokenDeps } from '../src/host/access-token.ts'

const NOW = 1_800_000_000_000

interface Call { readonly url: string; readonly init: RequestInit | undefined }

/** Deterministic timers: `run()` fires the earliest pending timer. */
function fakeTimers() {
  const pending = new Map<number, { fn: () => void; at: number }>()
  let next = 0
  return {
    setTimeout: (fn: () => void, ms: number) => { pending.set(++next, { fn, at: ms }); return next },
    clearTimeout: (handle: unknown) => { pending.delete(handle as number) },
    get size() { return pending.size },
    get delays() { return [...pending.values()].map(entry => entry.at) },
    run() {
      const [id, entry] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? []
      assert.ok(id !== undefined && entry, 'no timer pending')
      pending.delete(id)
      entry.fn()
    },
  }
}

const exchange = (token: string, api?: string, extra: Record<string, unknown> = {}) => Response.json({
  token, expires_at: NOW / 1000 + 1800, refresh_in: 1500, ...(api ? { endpoints: { api } } : {}), ...extra,
})

function setup(options: {
  account?: { token: string; enterpriseHost?: string } | undefined
  respond?: (call: Call, index: number) => Response | Promise<Response>
} = {}) {
  const calls: Call[] = []
  const logs: string[] = []
  const timers = fakeTimers()
  const state = { account: 'account' in options ? options.account : { token: 'gho_secret' } }
  const deps: AccessTokenDeps = {
    readAccount: async () => state.account,
    fetch: async (url, init) => {
      const call = { url, init }
      calls.push(call)
      return options.respond ? options.respond(call, calls.length - 1) : exchange(`tid=${calls.length}`, 'https://api.individual.githubcopilot.com')
    },
    now: () => NOW,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    logger: { warn: message => logs.push(message) },
  }
  return { tokens: createAccessTokens(deps), calls, logs, timers, state }
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('exchanges the github.com OAuth token for an in-memory Copilot access token', async () => {
  const { tokens, calls } = setup()
  const token = await tokens.current()
  assert.equal(token.token, 'tid=1')
  assert.equal(token.baseUrl, 'https://api.individual.githubcopilot.com')
  assert.equal(token.expiresAt, NOW + 1_800_000)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, 'https://api.github.com/copilot_internal/v2/token')
  const headers = new Headers(calls[0]?.init?.headers)
  assert.equal(headers.get('authorization'), 'Bearer gho_secret')
  assert.equal(headers.get('editor-version'), 'vscode/1.107.0')
  assert.equal(calls[0]?.init?.redirect, 'error')
  assert.ok(calls[0]?.init?.signal)
})

test('Enterprise accounts exchange at their host and use the enterprise-derived base URL', async () => {
  const { tokens, calls } = setup({
    account: { token: 'ghu_ent', enterpriseHost: 'acme.ghe.com' },
    respond: () => exchange('tid=ent', 'https://copilot-api.acme.ghe.com'),
  })
  const token = await tokens.current()
  assert.equal(calls[0]?.url, 'https://api.acme.ghe.com/copilot_internal/v2/token')
  assert.equal(token.baseUrl, 'https://copilot-api.acme.ghe.com')
})

test('accepts only allowlisted HTTPS Copilot API origins', async () => {
  for (const api of ['https://api.githubcopilot.com', 'https://api.business.githubcopilot.com/']) {
    const { tokens } = setup({ respond: () => exchange('tid', api) })
    assert.equal((await tokens.current()).baseUrl, api.replace(/\/$/, ''))
  }
  for (const api of [
    'http://api.githubcopilot.com', 'https://evil.example.com', 'https://api.githubcopilot.com.evil.com',
    'https://copilot-api.acme.ghe.com', 'https://user@api.githubcopilot.com', 'https://api.githubcopilot.com:8443',
    'https://api.githubcopilot.com/v1', 'not a url',
  ]) {
    const { tokens, logs } = setup({ respond: () => exchange('tid=secret-access', api) })
    await assert.rejects(tokens.current(), (error: Error & { reason?: string }) => {
      assert.equal(error.reason, 'disallowed-endpoint')
      assert.doesNotMatch(error.message, /secret/)
      return true
    })
    assert.deepEqual(logs, [])
  }
})

test('signed-out, failed and malformed exchanges reject without exposing tokens', async () => {
  await assert.rejects(setup({ account: undefined }).tokens.current(), { reason: 'signed-out' })
  await assert.rejects(setup({ account: { token: 'x', enterpriseHost: 'evil/host' } }).tokens.current(), { reason: 'invalid-host' })
  for (const [respond, reason] of [
    [() => new Response('gho_secret', { status: 401 }), 'exchange-failed'],
    [() => { throw new Error('gho_secret') }, 'exchange-failed'],
    [() => new Response('not json'), 'invalid-response'],
    [() => Response.json({ token: 'tid', expires_at: 'soon' }), 'invalid-response'],
  ] as const) {
    await assert.rejects(setup({ respond }).tokens.current(), (error: Error & { reason?: string }) => {
      assert.equal(error.reason, reason)
      assert.doesNotMatch(error.message, /secret/)
      return true
    })
  }
})

test('concurrent current() calls share one exchange and later calls reuse the cached token', async () => {
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  const { tokens, calls } = setup({ respond: async () => { await gate; return exchange('tid=shared', 'https://api.githubcopilot.com') } })
  const first = tokens.current(), second = tokens.current()
  await tick()
  assert.equal(calls.length, 1)
  resume()
  assert.deepEqual(await first, await second)
  assert.equal(await tokens.current(), await first)
  assert.equal(calls.length, 1)
})

test('a changed account or host re-exchanges with a new generation', async () => {
  const { tokens, calls, state } = setup()
  const first = await tokens.current()
  state.account = { token: 'gho_secret', enterpriseHost: 'acme.ghe.com' }
  const second = await tokens.current()
  assert.equal(calls.length, 2)
  assert.equal(calls[1]?.url, 'https://api.acme.ghe.com/copilot_internal/v2/token')
  assert.notEqual(second.generation, first.generation)
})

test('the refresh timer re-exchanges before expiry, bumps the generation and emits a refresh event', async () => {
  const { tokens, calls, timers } = setup()
  const first = await tokens.current()
  assert.deepEqual(timers.delays, [1_500_000])
  const events: number[] = []
  tokens.onRefresh(token => events.push(token.generation))
  timers.run()
  await tick(); await tick()
  assert.equal(calls.length, 2)
  const second = await tokens.current()
  assert.equal(second.token, 'tid=2')
  assert.ok(second.generation > first.generation)
  assert.deepEqual(events, [second.generation])
  assert.equal(timers.size, 1)
})

test('a failed refresh keeps the current token, logs no secrets and retries later', async () => {
  const { tokens, timers, logs } = setup({
    respond: (_call, index) => index === 0 ? exchange('tid=1', 'https://api.githubcopilot.com') : new Response('gho_secret', { status: 500 }),
  })
  const first = await tokens.current()
  timers.run()
  await tick(); await tick()
  assert.equal(await tokens.current(), first)
  assert.equal(logs.length, 1)
  assert.doesNotMatch(logs.join(), /secret|tid=/)
  assert.deepEqual(timers.delays, [60_000])
})

test('invalidate after a 401 triggers one re-exchange and refresh notification without changing account lifetime', async () => {
  const { tokens, calls } = setup()
  const refreshed: number[] = []
  tokens.onRefresh(value => refreshed.push(value.generation))
  const stale = await tokens.current()
  assert.deepEqual(refreshed, [], 'initial exchange must not recursively trigger discovery')
  tokens.invalidate(stale)
  tokens.invalidate(stale)
  const [a, b] = await Promise.all([tokens.current(), tokens.current()])
  tokens.invalidate(stale)
  assert.equal(await tokens.current(), a)
  assert.equal(a, b)
  assert.equal(calls.length, 2)
  assert.notEqual(a.generation, stale.generation)
  assert.equal(a.accountGeneration, stale.accountGeneration)
  assert.equal(a.signal, stale.signal)
  assert.equal(stale.signal.aborted, false)
  assert.deepEqual(refreshed, [a.generation])
  tokens.reset()
  assert.equal(a.signal.aborted, true)
  const next = await tokens.current()
  assert.notEqual(next.accountGeneration, a.accountGeneration)
  assert.deepEqual(refreshed, [a.generation], 'first exchange after reset is not a refresh')
})

test('reset during an in-flight exchange discards its result', async () => {
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  const { tokens, calls, timers } = setup({
    respond: async (_call, index) => { if (index === 0) await gate; return exchange(`tid=${index}`, 'https://api.githubcopilot.com') },
  })
  const pending = tokens.current()
  await tick()
  tokens.reset()
  resume()
  await assert.rejects(pending, { reason: 'reset' })
  assert.equal(timers.size, 0)
  assert.equal((await tokens.current()).token, 'tid=1')
  assert.equal(calls.length, 2)
})

test('a caller abort signal rejects its own wait only', async () => {
  let resume!: () => void
  const gate = new Promise<void>(resolve => { resume = resolve })
  const { tokens } = setup({ respond: async () => { await gate; return exchange('tid', 'https://api.githubcopilot.com') } })
  const controller = new AbortController()
  const aborted = tokens.current(controller.signal)
  const other = tokens.current()
  await tick()
  controller.abort(new Error('cancelled'))
  await assert.rejects(aborted, /cancelled/)
  resume()
  assert.equal((await other).token, 'tid')
})

test('dispose clears timers and listeners and rejects later calls', async () => {
  const { tokens, timers, calls } = setup()
  let events = 0
  tokens.onRefresh(() => { events++ })
  await tokens.current()
  assert.equal(timers.size, 1)
  tokens.dispose()
  assert.equal(timers.size, 0)
  await assert.rejects(tokens.current(), { reason: 'disposed' })
  assert.equal(events, 0)
  assert.equal(calls.length, 1)
})
