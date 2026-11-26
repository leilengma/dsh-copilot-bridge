import { credentialKey, type CredentialProvider, type CredentialRecord, type GrantRecord } from '@deepseek-ai/dsh-credentials'
import { BRIDGE_RECORD_ID, BRIDGE_RECORD_KEY, BRIDGE_RECORD_SCOPE } from '../shared/contract.ts'

/**
 * The bridge's own sign-in, stored at `copilot-bridge/github`.
 *
 * Only the long-lived GitHub OAuth token lives here; the Copilot access token
 * is exchanged into host memory. The native `llm-pi-ai/github-copilot` record
 * belongs to the user and is never read or written.
 */
export interface BridgeAccount {
  /** GitHub OAuth token (`ghu_…`). */
  readonly token: string
  /** GitHub Enterprise host the token was issued by; absent for github.com. */
  readonly enterpriseHost?: string
}

/** The slice of the Harness credential service this plugin uses. */
export type CredentialStore = Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'>

interface BridgeGrantPayload {
  readonly type: 'github-oauth'
  readonly token: string
  readonly enterpriseHost?: string
}

const HOST = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/

export const bridgeRecordKey = () => credentialKey(BRIDGE_RECORD_SCOPE, BRIDGE_RECORD_ID)

/** Safe accessor: anything but a well-formed bridge grant reads as signed out. */
export function bridgeAccount(record: CredentialRecord | undefined): BridgeAccount | undefined {
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return undefined
  const { token, enterpriseHost } = record.payload as Record<string, unknown>
  if (typeof token !== 'string' || token.length === 0) return undefined
  if (enterpriseHost === undefined) return { token }
  return typeof enterpriseHost === 'string' && HOST.test(enterpriseHost) ? { token, enterpriseHost } : undefined
}

export async function readBridgeAccount(store: Pick<CredentialProvider, 'readRecord'> | undefined): Promise<BridgeAccount | undefined> {
  return bridgeAccount(await store?.readRecord(bridgeRecordKey()))
}

/** Replace the record, then read it back so a store that drops the write fails sign-in. */
export async function writeBridgeAccount(store: CredentialStore, account: BridgeAccount): Promise<void> {
  const payload: BridgeGrantPayload = {
    type: 'github-oauth',
    token: account.token,
    ...(account.enterpriseHost === undefined ? {} : { enterpriseHost: account.enterpriseHost }),
  }
  const record: GrantRecord = { kind: 'grant', payload }
  await store.modifyRecord(bridgeRecordKey(), async () => record)
  const written = await readBridgeAccount(store)
  if (written?.token !== account.token || written.enterpriseHost !== account.enterpriseHost) {
    throw new Error(`the credential record at ${BRIDGE_RECORD_KEY} did not survive the write`)
  }
}

export async function deleteBridgeAccount(store: CredentialStore): Promise<void> {
  await store.deleteRecord(bridgeRecordKey())
}
