import assert from 'node:assert/strict'
import { test } from 'node:test'
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { deleteBridgeAccount, readBridgeAccount, writeBridgeAccount } from '../src/host/bridge-credentials.ts'

class FakeStore {
  readonly records = new Map<string, CredentialRecord>()
  async readRecord(key: CredentialKey) { return this.records.get(key) }
  async modifyRecord(key: CredentialKey, update: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) {
    const next = await update(this.records.get(key))
    if (next !== undefined) this.records.set(key, next)
    return this.records.get(key)
  }
  async deleteRecord(key: CredentialKey) { this.records.delete(key) }
}

const BRIDGE = credentialKey('copilot-bridge', 'github')
const NATIVE = credentialKey('llm-pi-ai', 'github-copilot')
const native: CredentialRecord = { kind: 'grant', payload: { type: 'oauth', refresh: 'ghu_native', access: 'a', expires: 1 } }

test('an account round-trips through copilot-bridge/github only, leaving the native record untouched', async () => {
  const store = new FakeStore()
  store.records.set(NATIVE, native)
  await writeBridgeAccount(store, { token: 'ghu_bridge', enterpriseHost: 'octocorp.ghe.com' })
  assert.deepEqual(await readBridgeAccount(store), { token: 'ghu_bridge', enterpriseHost: 'octocorp.ghe.com' })
  assert.deepEqual([...store.records.keys()].sort(), [BRIDGE, NATIVE].sort())
  assert.equal(store.records.get(NATIVE), native)
  await writeBridgeAccount(store, { token: 'ghu_dotcom' })
  assert.deepEqual(await readBridgeAccount(store), { token: 'ghu_dotcom' })
  await deleteBridgeAccount(store)
  assert.equal(await readBridgeAccount(store), undefined)
  assert.equal(store.records.get(NATIVE), native)
})

test('a missing store or malformed record reads as signed out', async () => {
  assert.equal(await readBridgeAccount(undefined), undefined)
  const store = new FakeStore()
  store.records.set(NATIVE, native)
  assert.equal(await readBridgeAccount(store), undefined, 'never falls back to the native record')
  for (const record of [
    { kind: 'api-key', value: 'x' },
    { kind: 'grant', payload: null },
    { kind: 'grant', payload: 'ghu_x' },
    { kind: 'grant', payload: { token: '' } },
    { kind: 'grant', payload: { token: 42 } },
    { kind: 'grant', payload: { token: 'ghu_x', enterpriseHost: 7 } },
    { kind: 'grant', payload: { token: 'ghu_x', enterpriseHost: 'https://evil.example/path' } },
  ] as CredentialRecord[]) {
    store.records.set(BRIDGE, record)
    assert.equal(await readBridgeAccount(store), undefined, JSON.stringify(record))
  }
})

test('a write the store does not persist is reported instead of leaving a silent sign-in', async () => {
  const store = new FakeStore()
  store.modifyRecord = async () => undefined
  await assert.rejects(writeBridgeAccount(store, { token: 'ghu_x' }), /copilot-bridge\/github/)
})
