import assert from 'node:assert/strict'
import { test } from 'node:test'
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { createAuthController, type BridgeConfig } from '../src/host/auth-controller.ts'
import type { BridgeAccount, CredentialStore } from '../src/host/bridge-credentials.ts'
import type { DeviceAuthorization, PollResult } from '../src/host/device-flow.ts'
import { authRoutes } from '../src/host/routes.ts'

const BRIDGE = credentialKey('copilot-bridge', 'github')
const NATIVE = credentialKey('llm-pi-ai', 'github-copilot')
const nativeRecord: CredentialRecord = { kind: 'grant', payload: { type: 'oauth', refresh: 'ghu_native', access: 'a', expires: 1 } }

class FakeCredentials implements CredentialStore {
  readonly records = new Map<string, CredentialRecord>()
  /** Every key read, written, or deleted, in order. */
  readonly touched: string[] = []
  async readRecord(key: CredentialKey) { this.touched.push(key); return this.records.get(key) }
  async modifyRecord(key: CredentialKey, update: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    this.touched.push(key)
    const next = await update(this.records.get(key))
    if (next !== undefined) this.records.set(key, next)
    return this.records.get(key)
  }
  async deleteRecord(key: CredentialKey) { this.touched.push(key); this.records.delete(key) }
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
  readonly signedIn: BridgeAccount[]
  signedOut: number
  /** Catalog ids the controller sees; undefined while unknown. */
  catalog: readonly string[] | undefined
  /** Run the pending poll timer and let its async work settle. */
  tick(): Promise<void>
  readonly controller: ReturnType<typeof createAuthController>
}

function harness(): Harness {
  const credentials = new FakeCredentials()
  const config = new FakeConfig()
  let timer: (() => void) | undefined
  const h: Harness = {
    credentials, config, started: [], polls: [], warnings: [], signedIn: [], signedOut: 0, catalog: undefined,
    controller: createAuthController({
      credentials: () => credentials,
      config,
      catalogIds: async () => h.catalog,
      onSignedIn: account => { h.signedIn.push(account) },
      onSignedOut: () => { h.signedOut++ },
      async startDeviceFlow(domain): Promise<DeviceAuthorization> {
        h.started.push(domain)
        const host = domain ?? 'github.com'
        return { domain: host, deviceCode: 'dev', userCode: 'ABCD-1234', verificationUri: `https://${host}/login/device`, interval: 5, expiresIn: 900 }
      },
      async pollDeviceFlow() { return h.polls.shift() ?? { state: 'retry' } },
      logger: { info() {}, warn(message) { h.warnings.push(message) }, error() {} },
      now: () => 0,
      setTimer: callback => { timer = callback; return 1 },
      clearTimer: () => { timer = undefined },
    }),
    async tick() {
      const run = timer
      timer = undefined
      run?.()
      await new Promise(resolve => setImmediate(resolve))
    },
  }
  return h
}

async function signIn(h: Harness, token = 'ghu_new'): Promise<void> {
  await h.controller.login()
  h.polls.push({ state: 'done', token })
  await h.tick()
}

const signedInAs = (h: Harness, payload: object) => h.credentials.records.set(BRIDGE, { kind: 'grant', payload })

test('sign-in writes only copilot-bridge/github and never touches the native pi-ai record', async () => {
  const h = harness()
  h.credentials.records.set(NATIVE, nativeRecord)
  await signIn(h, 'ghu_bridge')
  assert.deepEqual(h.credentials.records.get(BRIDGE), { kind: 'grant', payload: { type: 'github-oauth', token: 'ghu_bridge' } })
  assert.equal(h.credentials.records.get(NATIVE), nativeRecord)
  const status = await h.controller.status()
  assert.equal(status.authenticated, true)
  assert.equal(status.provider, 'copilot-bridge')
  await h.controller.logout()
  assert.equal(h.credentials.records.get(NATIVE), nativeRecord)
  assert.ok(!h.credentials.touched.includes(NATIVE), 'native record is never read, written, or deleted')
})

test('a native credential alone does not sign the bridge in', async () => {
  const h = harness()
  h.credentials.records.set(NATIVE, nativeRecord)
  const status = await h.controller.status()
  assert.equal(status.authenticated, false)
  assert.equal(status.provider, 'copilot-bridge')
})

test('completed sign-in unsets hidden models and notifies the host with the account', async () => {
  const h = harness()
  h.config.hidden = ['a']
  await signIn(h, 'ghu_x')
  assert.equal(h.config.hidden, undefined)
  assert.deepEqual(h.signedIn, [{ token: 'ghu_x' }])
  assert.equal((await h.controller.status()).state, 'authenticated')
})

test('sign-out deletes the bridge record, unsets hidden models, keeps enterpriseUrl, and notifies the host', async () => {
  const h = harness()
  await h.controller.setEnterpriseUrl('octocorp.ghe.com')
  await signIn(h)
  h.config.hidden = ['a']
  const status = await h.controller.logout()
  assert.equal(status.authenticated, false)
  assert.equal(h.credentials.records.has(BRIDGE), false)
  assert.equal(h.config.hidden, undefined)
  assert.equal(h.config.value, 'https://octocorp.ghe.com/')
  assert.equal(status.enterpriseUrl, 'https://octocorp.ghe.com/')
  assert.equal(h.signedOut, 1)
})

test('sign-out unsets hidden models even without a credential', async () => {
  const h = harness()
  h.config.hidden = ['a']
  const status = await h.controller.logout()
  assert.equal(h.config.hidden, undefined)
  assert.equal(status.hiddenModels, undefined)
})

test('hidden-model reset and host hook failures do not fail sign-in or logout', async () => {
  const h = harness()
  const failing = createAuthController({
    credentials: () => h.credentials,
    config: h.config,
    onSignedIn: () => { throw new Error('hook failed') },
    onSignedOut: async () => { throw new Error('hook failed') },
    async startDeviceFlow() { return { domain: 'github.com', deviceCode: 'd', userCode: 'u', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900 } },
    async pollDeviceFlow() { return { state: 'done', token: 'ghu_x' } },
    logger: { info() {}, warn(message) { h.warnings.push(message) }, error() {} },
    now: () => 0,
    setTimer: callback => { void Promise.resolve().then(callback); return 1 },
    clearTimer: () => {},
  })
  h.config.hidden = ['a']
  h.config.failHiddenWrite = true
  await failing.login()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await failing.status()).authenticated, true)
  assert.equal((await failing.logout()).authenticated, false)
  assert.match(h.warnings.join('\n'), /hook failed/)
})

test('a credential write failure ends the flow in error without notifying sign-in', async () => {
  const h = harness()
  await h.controller.login()
  h.credentials.modifyRecord = async () => { throw new Error('credential storage failed') }
  h.polls.push({ state: 'done', token: 'ghu_new' })
  await h.tick()
  const status = await h.controller.status()
  assert.equal(status.authenticated, false)
  assert.equal(status.state, 'error')
  assert.deepEqual(h.signedIn, [])
})

test('an already-authenticated login answers status without restarting OAuth', async () => {
  const h = harness()
  signedInAs(h, { token: 'ghu_test' })
  assert.equal((await h.controller.login()).authenticated, true)
  assert.deepEqual(h.started, [])
})

test('a malformed bridge record reads as signed out', async () => {
  const h = harness()
  signedInAs(h, { refresh: 'ghu_old_format' })
  assert.equal((await h.controller.status()).authenticated, false)
})

test('status lists the catalog and saved hidden ids, sorted, only when signed in', async () => {
  const h = harness()
  h.catalog = ['z-model', 'a-model']
  h.config.hidden = ['z-model', 'z-model', 'gone']
  assert.equal((await h.controller.status()).availableModels, undefined)
  signedInAs(h, { token: 'ghu_test' })
  const status = await h.controller.status()
  assert.deepEqual(status.availableModels, ['a-model', 'z-model'])
  assert.equal(status.modelCount, 2)
  assert.deepEqual(status.hiddenModels, ['z-model'])
  assert.deepEqual(h.config.hidden, ['z-model', 'z-model', 'gone'], 'status never prunes the saved list')
  h.catalog = undefined
  const unknown = await h.controller.status()
  assert.equal(unknown.availableModels, undefined)
  assert.deepEqual(unknown.hiddenModels, ['z-model', 'gone'])
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

test('hidden-models route rejects malformed bodies and ids outside a known catalog without saving', async () => {
  const h = harness()
  signedInAs(h, { token: 'ghu_test' })
  h.catalog = ['a', 'b']
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
  signedInAs(h, { token: 'ghu_test' })
  h.config.hidden = ['a']
  h.config.canWrite = false
  const response = await postHidden(h, { hiddenModels: ['b'] })
  assert.equal(response.status, 500)
  assert.match((await response.json()).error, /settings service/)
  assert.deepEqual(h.config.hidden, ['a'])
})

test('hidden-models route deduplicates, hides all, and unsets the key on an empty list', async () => {
  const h = harness()
  signedInAs(h, { token: 'ghu_test' })
  h.catalog = ['a', 'b']
  const response = await postHidden(h, { hiddenModels: ['a', 'a', 'b'] })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.value.hiddenModels, ['a', 'b'])
  assert.deepEqual(h.config.hidden, ['a', 'b'])
  assert.equal((await postHidden(h, { hiddenModels: [] })).status, 200)
  assert.equal(h.config.hidden, undefined)
})

test('accepts any ids while the catalog is unknown; surfaces persistence errors', async () => {
  const h = harness()
  signedInAs(h, { token: 'ghu_test' })
  assert.equal((await postHidden(h, { hiddenModels: ['a'] })).status, 200)
  assert.deepEqual(h.config.hidden, ['a'])
  h.config.failHiddenWrite = true
  assert.equal((await postHidden(h, { hiddenModels: [] })).status, 500)
  assert.deepEqual(h.config.hidden, ['a'])
})

test('signs in against the configured enterprise host and stores it in the bridge record', async () => {
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
  assert.deepEqual(h.credentials.records.get(BRIDGE), {
    kind: 'grant', payload: { type: 'github-oauth', token: 'ghu_test', enterpriseHost: 'octocorp.ghe.com' },
  })
  assert.deepEqual(h.signedIn, [{ token: 'ghu_test', enterpriseHost: 'octocorp.ghe.com' }])
  const status = await h.controller.status()
  assert.equal(status.authenticated, true)
  assert.equal(status.signedInHost, undefined)
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
  await signIn(h, 'ghu_dotcom')
  const status = await h.controller.setEnterpriseUrl('octocorp.ghe.com')
  assert.equal(status.authenticated, true)
  assert.equal(status.signedInHost, 'github.com')
  assert.equal(status.githubHost, 'octocorp.ghe.com')
})

test('a denied authorization ends the flow with a message and stores nothing', async () => {
  const h = harness()
  await h.controller.login()
  h.polls.push({ state: 'denied' })
  await h.tick()
  const status = await h.controller.status()
  assert.equal(status.state, 'denied')
  assert.match(status.message ?? '', /denied/)
  assert.equal(h.credentials.records.size, 0)
  assert.deepEqual(h.signedIn, [])
})
