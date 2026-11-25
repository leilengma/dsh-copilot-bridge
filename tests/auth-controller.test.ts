import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { PI_AI_RECORD_KEY } from '../src/shared/contract.ts'
import { createAuthController, type CredentialStore, type BridgeConfig } from '../src/host/auth-controller.ts'
import type { DeviceAuthorization, PollResult } from '../src/host/device-flow.ts'
import { authRoutes } from '../src/host/routes.ts'
import { grantModelIds } from '../src/host/grant.ts'

const selectedIds = (h: Harness) => grantModelIds(h.credentials.records.get(PI_AI_RECORD_KEY))

class FakeCredentials implements CredentialStore {
  readonly records = new Map<string, CredentialRecord>()
  writes = 0
  onWrite: (() => void) | undefined
  async readRecord(key: CredentialKey) { return this.records.get(key) }
  async modifyRecord(key: CredentialKey, update: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const next = await update(this.records.get(key))
    if (next !== undefined) {
      this.records.set(key, next)
      this.writes++
      this.onWrite?.()
    }
    return this.records.get(key)
  }
  async deleteRecord(key: CredentialKey) { this.records.delete(key) }
}

/** Mirrors the Host wiring: the saved value is the `https://<host>/` form, or absent. */
class FakeConfig implements BridgeConfig {
  value = ''
  hidden: string[] | undefined
  canWrite = true
  failHiddenWrite = false
  readHidden() { return this.hidden ?? [] }
  async writeHidden(ids: readonly string[] | undefined) {
    if (this.failHiddenWrite) throw new Error('config write failed')
    this.hidden = ids === undefined ? undefined : [...ids]
  }
  read() { return this.value }
  writable() { return this.canWrite }
  async write(host: string | undefined) { this.value = host === undefined ? '' : `https://${host}/` }
}

interface Harness {
  readonly credentials: FakeCredentials
  readonly config: FakeConfig
  readonly started: (string | undefined)[]
  readonly polls: PollResult[]
  readonly warnings: string[]
  /** Run the pending poll timer and let its async work settle. */
  tick(): Promise<void>
  readonly controller: ReturnType<typeof createAuthController>
}

function harness(): Harness {
  const credentials = new FakeCredentials()
  const config = new FakeConfig()
  const started: (string | undefined)[] = []
  const polls: PollResult[] = []
  const warnings: string[] = []
  let timer: (() => void) | undefined
  const controller = createAuthController({
    credentials: () => credentials,
    config,
    async startDeviceFlow(domain): Promise<DeviceAuthorization> {
      started.push(domain)
      const host = domain ?? 'github.com'
      return { domain: host, deviceCode: 'dev', userCode: 'ABCD-1234', verificationUri: `https://${host}/login/device`, interval: 5, expiresIn: 900 }
    },
    async pollDeviceFlow() { return polls.shift() ?? { state: 'retry' } },
    logger: { info() {}, warn(message) { warnings.push(message) }, error() {} },
    now: () => 0,
    setTimer: callback => { timer = callback; return 1 },
    clearTimer: () => { timer = undefined },
  })
  return {
    credentials, config, started, polls, warnings, controller,
    async tick() {
      const run = timer
      timer = undefined
      run?.()
      await new Promise(resolve => setImmediate(resolve))
    },
  }
}

test('status keeps the full account catalog while hidden models are removed from selection', async () => {
  const h = harness()
  h.config.hidden = ['z-model']
  h.credentials.records.set(PI_AI_RECORD_KEY, {
    kind: 'grant',
    payload: { type: 'oauth', refresh: 'ghu_test', access: 'access', expires: 123, availableModelIds: ['z-model', 'a-model'] },
  })
  const status = await h.controller.status()
  assert.deepEqual(status.availableModels, ['a-model', 'z-model'])
  assert.deepEqual(status.hiddenModels, ['z-model'])
  assert.equal(status.modelCount, 2)
  assert.deepEqual(h.credentials.records.get(PI_AI_RECORD_KEY), {
    kind: 'grant',
    payload: {
      type: 'oauth', refresh: 'ghu_test', access: 'access', expires: 123,
      availableModelIds: ['a-model'],
      copilotBridge: { allModelIds: ['z-model', 'a-model'], filteredModelIds: ['a-model'] },
    },
  })
})

function catalog(h: Harness, ids?: string[], bridge?: object) {
  h.credentials.records.set(PI_AI_RECORD_KEY, {
    kind: 'grant', payload: {
      type: 'oauth', refresh: 'ghu_test', access: 'access', expires: 123,
      ...(ids === undefined ? {} : { availableModelIds: ids }),
      ...(bridge === undefined ? {} : { copilotBridge: bridge }),
    },
  })
}

test('own credential events settle without a write loop, including reordered lists', async () => {
  const h = harness()
  catalog(h, ['c', 'b', 'a'])
  h.config.hidden = ['c']
  h.credentials.onWrite = () => { void h.controller.syncModels() }
  await Promise.all([h.controller.syncModels(), h.controller.syncModels()])
  assert.equal(h.credentials.writes, 1)
  catalog(h, ['a', 'b'], { allModelIds: ['c', 'b', 'a'], filteredModelIds: ['b', 'a'] })
  assert.deepEqual((await h.controller.status()).availableModels, ['a', 'b', 'c'])
  assert.equal(h.credentials.writes, 1)
})

test('pi-ai refresh restores the full list and prunes models removed from the account', async () => {
  const h = harness()
  catalog(h, ['a', 'b', 'c'])
  h.config.hidden = ['a', 'c']
  await h.controller.syncModels()
  // pi-ai drops our metadata when refreshing its grant.
  catalog(h, ['b', 'c', 'd'])
  await h.controller.syncModels()
  assert.deepEqual((await h.controller.status()).hiddenModels, ['c'])
  assert.deepEqual(h.config.hidden, ['c'])
  assert.deepEqual(selectedIds(h), ['b', 'd'])
})

test('a pi-ai write with stale bridge metadata still supplies the new full catalog', async () => {
  const h = harness()
  h.config.hidden = ['a']
  catalog(h, ['a', 'b', 'c'], { allModelIds: ['a', 'b'], filteredModelIds: ['b'] })
  assert.deepEqual((await h.controller.status()).availableModels, ['a', 'b', 'c'])
})

test('live config edits prune unknown ids, use exact case, and can hide every model', async () => {
  const h = harness()
  catalog(h, ['a', 'B'])
  h.config.hidden = ['a', 'B', 'b', 'gone']
  await h.controller.syncModels()
  assert.deepEqual(h.config.hidden, ['a', 'B'])
  assert.equal((await h.controller.status()).modelCount, 2)
  assert.deepEqual(selectedIds(h), [])
  h.config.hidden = ['gone']
  await h.controller.syncModels()
  assert.equal(h.config.hidden, undefined)
  assert.deepEqual(selectedIds(h), ['a', 'B'])
})

for (const readOnly of [true, false]) {
  test(`stale hidden ids do not block filtering or status when pruning is ${readOnly ? 'read-only' : 'failing'}`, async () => {
    const h = harness()
    catalog(h, ['a', 'b'])
    h.config.hidden = ['a', 'removed']
    h.config.canWrite = !readOnly
    h.config.failHiddenWrite = true
    const status = await h.controller.status()
    assert.equal(status.authenticated, true)
    assert.equal(status.configWritable, !readOnly)
    assert.deepEqual(status.availableModels, ['a', 'b'])
    assert.deepEqual(status.hiddenModels, ['a'])
    assert.deepEqual(selectedIds(h), ['b'])
    assert.deepEqual(h.config.hidden, ['a', 'removed'])
    if (!readOnly) assert.match(h.warnings.join('\n'), /prun.*config write failed/i)
    assert.equal((await h.controller.logout()).authenticated, false)
    if (!readOnly) {
      h.config.failHiddenWrite = false
      catalog(h, ['a', 'b'])
      await h.controller.syncModels()
      assert.deepEqual(h.config.hidden, ['a'])
    }
  })
}

test('a known empty account catalog prunes all hidden ids, unlike an unknown catalog', async () => {
  const h = harness()
  catalog(h, [])
  h.config.hidden = ['gone']
  const status = await h.controller.status()
  assert.deepEqual(status.availableModels, [])
  assert.deepEqual(status.hiddenModels, [])
  assert.equal(status.modelCount, 0)
  assert.equal(h.config.hidden, undefined)
  assert.deepEqual(selectedIds(h), [])
})

test('an unknown full catalog neither filters nor prunes', async () => {
  const h = harness()
  catalog(h)
  h.config.hidden = ['a']
  const status = await h.controller.status()
  assert.equal(status.availableModels, undefined)
  assert.equal(status.modelCount, undefined)
  assert.deepEqual(h.config.hidden, ['a'])
  assert.equal(h.credentials.writes, 0)
})

test('a restarted bridge restores hidden ids from persisted bookkeeping', async () => {
  const h = harness()
  h.config.hidden = ['a']
  catalog(h, ['b'], { allModelIds: ['b', 'a'], filteredModelIds: ['b'] })
  assert.deepEqual((await h.controller.status()).availableModels, ['a', 'b'])
  h.config.hidden = undefined
  await h.controller.syncModels()
  assert.deepEqual(selectedIds(h), ['b', 'a'])
})

test('sign-out unsets hidden models even without a credential', async () => {
  const h = harness()
  h.config.hidden = ['a']
  const status = await h.controller.logout()
  assert.equal(h.config.hidden, undefined)
  assert.equal(status.hiddenModels, undefined)
})

test('completed sign-in unsets the hidden list and writes no bookkeeping', async () => {
  const h = harness()
  h.config.hidden = ['a']
  await h.controller.login()
  h.polls.push({ state: 'done', token: 'ghu_new' })
  await h.tick()
  assert.equal(h.config.hidden, undefined)
  assert.equal((await h.controller.status()).authenticated, true)
  const record = h.credentials.records.get(PI_AI_RECORD_KEY)
  assert.equal(record?.kind, 'grant')
  assert.equal(record.kind === 'grant' && 'copilotBridge' in (record.payload as object), false)
})

test('reset failures do not fail sign-in or logout', async () => {
  const h = harness()
  h.config.hidden = ['a']
  h.config.failHiddenWrite = true
  await h.controller.login()
  h.polls.push({ state: 'done', token: 'ghu_new' })
  await h.tick()
  assert.equal((await h.controller.status()).authenticated, true)
  assert.equal((await h.controller.logout()).authenticated, false)
})

async function postHidden(h: Harness, body: unknown, raw = false) {
  const route = authRoutes(h.controller).find(route => route.path.endsWith('/hidden-models'))
  assert.ok(route)
  assert.deepEqual(route.methods, ['POST'])
  assert.equal(route.requestBody, 'buffered')
  return route.fetch(new Request('https://localhost/api/copilot-bridge/hidden-models', {
    method: 'POST', body: raw ? String(body) : JSON.stringify(body),
  }))
}

test('hidden-models route rejects malformed bodies and unknown ids without saving', async () => {
  const h = harness()
  catalog(h, ['a', 'b'])
  for (const body of [null, {}, { hiddenModels: 'a' }, { hiddenModels: [1] }, { hiddenModels: [''] }, { hiddenModels: ['unknown'] }, { hiddenModels: ['A'] }]) {
    const response = await postHidden(h, body)
    assert.equal(response.status, 400)
    assert.equal((await response.json()).ok, false)
    assert.equal(h.config.hidden, undefined)
  }
  assert.equal((await postHidden(h, '{', true)).status, 400)
})

test('hidden-models route refuses a read-only profile without changing its saved selection', async () => {
  const h = harness()
  catalog(h, ['a', 'b'])
  h.config.hidden = ['a']
  h.config.canWrite = false
  const response = await postHidden(h, { hiddenModels: ['b'] })
  assert.equal(response.status, 500)
  assert.match((await response.json()).error, /settings service/)
  assert.deepEqual(h.config.hidden, ['a'])
})

test('hidden-models route deduplicates, hides all, restores, and unsets the last id', async () => {
  const h = harness()
  catalog(h, ['a', 'b'])
  const response = await postHidden(h, { hiddenModels: ['a', 'a', 'b'] })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.value.hiddenModels, ['a', 'b'])
  assert.deepEqual(body.value.availableModels, ['a', 'b'])
  assert.equal(body.value.modelCount, 2)
  assert.deepEqual(h.config.hidden, ['a', 'b'])
  assert.deepEqual(selectedIds(h), [])
  assert.equal((await postHidden(h, { hiddenModels: [] })).status, 200)
  assert.equal(h.config.hidden, undefined)
  assert.deepEqual(selectedIds(h), ['a', 'b'])
})

test('accepts ids without pruning when the catalog is unknown; surfaces persistence errors', async () => {
  const h = harness()
  catalog(h)
  assert.equal((await postHidden(h, { hiddenModels: ['a'] })).status, 200)
  assert.deepEqual(h.config.hidden, ['a'])
  h.config.failHiddenWrite = true
  assert.equal((await postHidden(h, { hiddenModels: [] })).status, 500)
  assert.deepEqual(h.config.hidden, ['a'])
})

test('signs in against the configured enterprise host and stores its grant', async () => {
  const h = harness()
  const saved = await h.controller.setEnterpriseUrl('https://octocorp.ghe.com/')
  assert.equal(saved.githubHost, 'octocorp.ghe.com')
  assert.equal(saved.enterpriseUrl, 'https://octocorp.ghe.com/')

  const pending = await h.controller.login()
  assert.deepEqual(h.started, ['octocorp.ghe.com'])
  assert.equal(pending.state, 'pending')
  assert.equal(pending.verificationUri, 'https://octocorp.ghe.com/login/device')

  h.polls.push({ state: 'done', token: 'ghu_test' })
  await h.tick()
  const record = h.credentials.records.get(PI_AI_RECORD_KEY)
  assert.deepEqual(record, {
    kind: 'grant',
    payload: { type: 'oauth', refresh: 'ghu_test', access: '', expires: 0, enterpriseUrl: 'octocorp.ghe.com' },
  })
  const status = await h.controller.status()
  assert.equal(status.authenticated, true)
  assert.equal(status.signedInHost, undefined)
})

test('github.com sign-in omits enterpriseUrl from the grant', async () => {
  const h = harness()
  await h.controller.login()
  assert.deepEqual(h.started, [undefined])
  h.polls.push({ state: 'done', token: 'ghu_dotcom' })
  await h.tick()
  const record = h.credentials.records.get(PI_AI_RECORD_KEY)
  assert.equal(record?.kind, 'grant')
  assert.equal(record?.kind === 'grant' && 'enterpriseUrl' in (record.payload as object), false)
})

test('an empty URL resets the saved value to github.com', async () => {
  const h = harness()
  await h.controller.setEnterpriseUrl('octocorp.ghe.com')
  const reset = await h.controller.setEnterpriseUrl('')
  assert.equal(reset.enterpriseUrl, '')
  assert.equal(reset.githubHost, 'github.com')
})

test('rejects an invalid URL without touching the saved value', async () => {
  const h = harness()
  await h.controller.setEnterpriseUrl('octocorp.ghe.com')
  await assert.rejects(h.controller.setEnterpriseUrl('ftp://nope'))
  assert.equal(h.config.value, 'https://octocorp.ghe.com/')
})

test('refuses to save when the configuration is not writable', async () => {
  const h = harness()
  h.config.canWrite = false
  await assert.rejects(h.controller.setEnterpriseUrl('octocorp.ghe.com'), /settings service/)
})

test('changing the host cancels a pending device flow', async () => {
  const h = harness()
  await h.controller.login()
  const status = await h.controller.setEnterpriseUrl('octocorp.ghe.com')
  assert.equal(status.state, 'signed-out')
  h.polls.push({ state: 'done', token: 'ghu_stale' })
  await h.tick()
  assert.equal(h.credentials.records.size, 0)
})

test('reports a credential issued by a different host than the configured one', async () => {
  const h = harness()
  await h.controller.login()
  h.polls.push({ state: 'done', token: 'ghu_dotcom' })
  await h.tick()
  const status = await h.controller.setEnterpriseUrl('octocorp.ghe.com')
  assert.equal(status.authenticated, true)
  assert.equal(status.signedInHost, 'github.com')
  assert.equal(status.githubHost, 'octocorp.ghe.com')
})

test('logout deletes the grant', async () => {
  const h = harness()
  await h.controller.login()
  h.polls.push({ state: 'done', token: 'ghu_x' })
  await h.tick()
  const status = await h.controller.logout()
  assert.equal(status.authenticated, false)
  assert.equal(h.credentials.records.size, 0)
})

test('a denied authorization ends the flow with a message', async () => {
  const h = harness()
  await h.controller.login()
  h.polls.push({ state: 'denied' })
  await h.tick()
  const status = await h.controller.status()
  assert.equal(status.state, 'denied')
  assert.match(status.message ?? '', /denied/)
})
