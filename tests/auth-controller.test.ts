import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { PI_AI_RECORD_KEY } from '../src/shared/contract.ts'
import { createAuthController, type CredentialStore, type EnterpriseUrlConfig } from '../src/host/auth-controller.ts'
import type { DeviceAuthorization, PollResult } from '../src/host/device-flow.ts'

class FakeCredentials implements CredentialStore {
  readonly records = new Map<string, CredentialRecord>()
  async readRecord(key: CredentialKey) { return this.records.get(key) }
  async modifyRecord(key: CredentialKey, update: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const next = await update(this.records.get(key))
    if (next === undefined) this.records.delete(key)
    else this.records.set(key, next)
    return next
  }
  async deleteRecord(key: CredentialKey) { this.records.delete(key) }
}

/** Mirrors the Host wiring: the saved value is the `https://<host>/` form, or absent. */
class FakeConfig implements EnterpriseUrlConfig {
  value = ''
  canWrite = true
  read() { return this.value }
  writable() { return this.canWrite }
  async write(host: string | undefined) { this.value = host === undefined ? '' : `https://${host}/` }
}

interface Harness {
  readonly credentials: FakeCredentials
  readonly config: FakeConfig
  readonly started: (string | undefined)[]
  readonly polls: PollResult[]
  /** Run the pending poll timer and let its async work settle. */
  tick(): Promise<void>
  readonly controller: ReturnType<typeof createAuthController>
}

function harness(): Harness {
  const credentials = new FakeCredentials()
  const config = new FakeConfig()
  const started: (string | undefined)[] = []
  const polls: PollResult[] = []
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
    logger: { info() {}, warn() {}, error() {} },
    now: () => 0,
    setTimer: callback => { timer = callback; return 1 },
    clearTimer: () => { timer = undefined },
  })
  return {
    credentials, config, started, polls, controller,
    async tick() {
      const run = timer
      timer = undefined
      run?.()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    },
  }
}

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
