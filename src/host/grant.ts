import type { CredentialRecord, GrantRecord } from '@deepseek-ai/dsh-credentials'

/**
 * The pi-ai GitHub Copilot grant payload, as far as this plugin reads or writes it.
 *
 * The record belongs to `llm-pi-ai`: after the first token exchange it writes
 * `access`, `expires`, `availableModelIds`, and more into the same record, so
 * every reader here tolerates extra fields.
 */
export interface CopilotGrantPayload {
  readonly type: 'oauth'
  /** Long-lived GitHub OAuth token (`ghu_…`). */
  readonly refresh: string
  /** Short-lived Copilot token; empty until the route's first exchange. */
  readonly access: string
  /** Expiry of `access` (epoch ms); 0 until the first exchange. */
  readonly expires: number
  /** GitHub Enterprise host the token was issued by; absent for github.com. */
  readonly enterpriseUrl?: string
  readonly availableModelIds?: readonly string[]
}

/**
 * The grant a fresh sign-in produces. Only `refresh` carries information; the
 * empty `access`/`expires` tell the route the grant is unexchanged. pi-ai reads
 * `enterpriseUrl` to exchange at `api.<host>` and serve from `copilot-api.<host>`.
 */
export function piAiGrantRecord(token: string, enterpriseDomain?: string): GrantRecord {
  const payload: CopilotGrantPayload = {
    type: 'oauth',
    refresh: token,
    access: '',
    expires: 0,
    ...(enterpriseDomain === undefined ? {} : { enterpriseUrl: enterpriseDomain }),
  }
  return { kind: 'grant', payload }
}

function payloadOf(record: CredentialRecord | undefined): Record<string, unknown> | undefined {
  if (record?.kind !== 'grant') return undefined
  const { payload } = record
  return typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : undefined
}

/** The long-lived token inside a stored grant, when the record holds one. */
export function grantToken(record: CredentialRecord | undefined): string | undefined {
  const refresh = payloadOf(record)?.refresh
  return typeof refresh === 'string' && refresh.length > 0 ? refresh : undefined
}

/** The enterprise host a stored grant was issued by; undefined for github.com. */
export function grantEnterpriseDomain(record: CredentialRecord | undefined): string | undefined {
  const value = payloadOf(record)?.enterpriseUrl
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The models the route recorded as available to this account, when recorded. */
export function grantModelIds(record: CredentialRecord | undefined): readonly string[] | undefined {
  const ids = payloadOf(record)?.availableModelIds
  return Array.isArray(ids) && ids.every((id): id is string => typeof id === 'string') ? ids : undefined
}
