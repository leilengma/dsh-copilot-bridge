import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { PI_AI_PROVIDER, PI_AI_RECORD_SCOPE, type CopilotUsage } from '../shared/contract.ts'
import { grantEnterpriseDomain, grantToken } from './grant.ts'
import { githubFetch } from './transport.ts'

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const number = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function parseUsage(raw: unknown): CopilotUsage {
  const data = object(raw)
  const snapshots = object(data?.quota_snapshots)
  const premium = object(snapshots?.premium_interactions)
  const snapshot = premium && (premium.unlimited === true || (number(premium.entitlement) ?? 0) > 0) ? premium : object(snapshots?.chat)
  if (!snapshot) return { state: 'unavailable' }
  const unlimited = snapshot.unlimited === true
  const total = unlimited ? undefined : number(snapshot.entitlement) || undefined
  const remaining = number(snapshot.quota_remaining)
  const percentRemaining = number(snapshot.percent_remaining)
  const percentUsed = unlimited ? undefined : percentRemaining !== undefined && percentRemaining <= 100
    ? 100 - percentRemaining : total !== undefined && remaining !== undefined ? Math.max(0, 100 * (1 - remaining / total)) : undefined
  // quota_remaining and entitlement share a basis; credits_used may be rounded or pooled.
  const used = unlimited ? number(snapshot.credits_used) : total === undefined ? undefined
    : remaining !== undefined ? Math.max(0, total - remaining) : undefined
  if (!unlimited && total === undefined && percentUsed === undefined) return { state: 'unavailable' }
  const resetSeconds = number(snapshot.quota_reset_at)
  const resetSource = resetSeconds ? resetSeconds * 1000 : data?.quota_reset_date_utc ?? data?.quota_reset_date
  const date = typeof resetSource === 'number' || typeof resetSource === 'string' ? new Date(resetSource) : undefined
  const reset = date && Number.isFinite(date.getTime()) ? { at: date.toISOString(), hasTime: !!resetSeconds || typeof data?.quota_reset_date_utc === 'string' } : undefined
  return {
    state: 'available', unit: data?.token_based_billing === true ? 'credits' : 'requests', unlimited,
    ...(total === undefined ? {} : { total }), ...(used === undefined ? {} : { used }),
    ...(percentUsed === undefined ? {} : { percentUsed }), ...(reset === undefined ? {} : { reset }),
  }
}

/** Fresh on each invocation; coalesce only concurrent reads for the same credential and issuer. */
export function createCopilotUsage(deps: {
  readonly credentials: () => Pick<CredentialProvider, 'readRecord'> | undefined
  readonly fetch?: typeof githubFetch
}): () => Promise<CopilotUsage> {
  const fetch = deps.fetch ?? githubFetch
  const key = credentialKey(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER)
  let pending: { token: string; domain: string; value: Promise<CopilotUsage> } | undefined
  return async () => {
    try {
      const credentials = deps.credentials()
      const record = await credentials?.readRecord(key)
      const token = grantToken(record)
      if (!token) { pending = undefined; return { state: 'signed-out' } }
      const domain = grantEnterpriseDomain(record) ?? 'github.com'
      // Only a stored, validated issuer receives the OAuth credential; never the current draft/config.
      if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) return { state: 'unavailable' }
      if (pending?.token === token && pending.domain === domain) return pending.value
      const entry = { token, domain, value: Promise.resolve<CopilotUsage>({ state: 'unavailable' }) }
      pending = entry
      entry.value = (async (): Promise<CopilotUsage> => {
        try {
          const response = await fetch(`https://api.${domain}/copilot_internal/user`, {
            headers: { Accept: 'application/json', Authorization: `token ${token}`,
              'X-GitHub-Api-Version': '2025-04-01', 'User-Agent': 'GitHubCopilotChat/0.35.0',
              'Editor-Version': 'vscode/1.107.0', 'Editor-Plugin-Version': 'copilot-chat/0.35.0' },
            redirect: 'error', signal: AbortSignal.timeout(5000),
          })
          if (!response.ok) return { state: 'unavailable' }
          const result = parseUsage(await response.json())
          const current = await deps.credentials()?.readRecord(key)
          if (!grantToken(current)) return { state: 'signed-out' }
          if (grantToken(current) !== token || (grantEnterpriseDomain(current) ?? 'github.com') !== domain) return { state: 'unavailable' }
          return result
        } catch { return { state: 'unavailable' } } // Transport errors may contain credentials.
        finally { if (pending === entry) pending = undefined }
      })()
      return entry.value
    } catch { return { state: 'unavailable' } }
  }
}
