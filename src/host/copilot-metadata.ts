import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { allowedBaseUrl, type AccessToken } from './access-token.ts'
import type { CopilotModel, ModelPrices } from '../shared/contract.ts'
import { readBridgeAccount } from './bridge-credentials.ts'
import { githubFetch } from './transport.ts'

export type CopilotMetadata = Pick<CopilotModel, 'pricing' | 'longContextPricing' | 'defaultContextMax' | 'promotion' | 'retiring'>
type Metadata = ReadonlyMap<string, CopilotMetadata>

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.slice(0, 2000) : undefined

function prices(value: unknown, batch: number): ModelPrices | undefined {
  const tier = object(value)
  const result: Record<string, number> = {}
  for (const [field, raw] of [
    ['input', tier?.input_price], ['output', tier?.output_price],
    ['cacheRead', tier?.cache_read_price ?? tier?.cache_price], ['cacheWrite', tier?.cache_write_price],
  ] as const) {
    const amount = number(raw)
    const perMillion = amount === undefined ? undefined : amount * (1_000_000 / batch)
    if (perMillion !== undefined && Number.isFinite(perMillion)) result[field] = perMillion
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function retirement(row: Record<string, unknown>): string | undefined {
  const warnings = object(row.warning_text)
  const messages = [row.warning_messages, row.info_messages].flatMap(value => Array.isArray(value) ? value : [])
  for (const code of ['model_pending_deprecation', 'model_deprecated']) {
    if (warnings && Object.hasOwn(warnings, code)) return text(warnings[code]) ?? 'This model is retiring.'
    const message = messages.map(object).find(item => item?.code === code)
    if (message) return text(message.message) ?? 'This model is retiring.'
  }
  return undefined
}

/** Project an allowlist only: never send the raw provider response to the client. */
function parseCatalog(raw: unknown, now: number): Metadata {
  const data = object(raw)?.data
  if (!Array.isArray(data)) return new Map()
  const result = new Map<string, CopilotMetadata>()
  for (const value of data) {
    const row = object(value)
    if (typeof row?.id !== 'string') continue
    const billing = object(row.billing)
    const tiers = object(billing?.token_prices)
    const batch = number(tiers?.batch_size)
    const pricing = batch ? prices(tiers?.default, batch) : undefined
    const longContextPricing = batch ? prices(tiers?.long_context, batch) : undefined
    const defaultTier = object(tiers?.default)
    const defaultContextMax = number(defaultTier?.max_prompt_tokens ?? defaultTier?.context_max)
    const promo = object(billing?.promo)
    const discount = number(promo?.discount_percent)
    const endsAt = text(promo?.ends_at)
    const validExpiry = promo?.ends_at === undefined || (endsAt !== undefined && Date.parse(endsAt) > now)
    const message = text(promo?.message)
    const retiring = retirement(row)
    result.set(row.id, {
      ...(retiring === undefined ? {} : { retiring }),
      ...(pricing === undefined ? {} : { pricing }),
      ...(longContextPricing === undefined ? {} : { longContextPricing }),
      ...(defaultContextMax === undefined ? {} : { defaultContextMax }),
      ...(discount === undefined || discount <= 0 || discount > 100 || !validExpiry ? {} : {
        promotion: { discountPercent: discount, ...(message === undefined ? {} : { message }), ...(endsAt === undefined ? {} : { endsAt }) },
      }),
    })
  }
  return result
}

/** Only approved Copilot hosts or the stored Enterprise host receive the token. */
function modelsUrl(token: string, enterprise: string | undefined): string {
  const proxy = token.match(/(?:^|;)proxy-ep=([^;]+)/)?.[1]?.replace(/^proxy\./, 'api.')
  if (proxy && /^api(?:\.[a-z0-9-]+)?\.githubcopilot\.com$/.test(proxy)) return `https://${proxy}/models`
  if (enterprise !== undefined && /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(enterprise)) {
    return `https://copilot-api.${enterprise}/models`
  }
  return 'https://api.individual.githubcopilot.com/models'
}

/** Short-lived Copilot access token, held in host memory by the bridge. */
export type CopilotAccessToken = Pick<AccessToken, 'token' | 'expiresAt'> & Partial<Pick<AccessToken, 'baseUrl'>>

/**
 * Reuse the bridge's access token; never exchange, persist or expose credentials here.
 * Signed-in state and Enterprise host come from `copilot-bridge/github`.
 */
export function createCopilotMetadata(deps: {
  readonly credentials: () => Pick<CredentialProvider, 'readRecord'> | undefined
  /** Current access token, or undefined while none is available. Without it, metadata is empty. */
  readonly accessToken?: () => Promise<CopilotAccessToken | undefined>
  readonly fetch?: typeof githubFetch
  readonly now?: () => number
}): () => Promise<Metadata> {
  const now = deps.now ?? Date.now
  const fetch = deps.fetch ?? githubFetch
  let cache: { token: string; url: string; expiresAt: number; value: Promise<Metadata> } | undefined
  return async () => {
    try {
      const account = await readBridgeAccount(deps.credentials())
      const access = account === undefined ? undefined : await deps.accessToken?.()
      const expires = number(access?.expiresAt)
      if (account === undefined || typeof access?.token !== 'string' || !access.token || expires === undefined || expires <= now()) {
        cache = undefined
        return new Map()
      }
      const { token } = access
      const baseUrl = access.baseUrl === undefined ? undefined : allowedBaseUrl(access.baseUrl, account.enterpriseHost)
      if (access.baseUrl !== undefined && baseUrl === undefined) return new Map()
      const url = baseUrl === undefined ? modelsUrl(token, account.enterpriseHost) : `${baseUrl}/models`
      if (cache?.token === token && cache.url === url && cache.expiresAt > now()) return cache.value
      const entry = { token, url, expiresAt: Math.min(now() + 300_000, expires), value: Promise.resolve<Metadata>(new Map()) }
      cache = entry
      entry.value = (async () => {
        try {
          const response = await fetch(url, {
            headers: {
              Accept: 'application/json', Authorization: `Bearer ${token}`,
              'Editor-Version': 'vscode/1.107.0',
              'Editor-Plugin-Version': 'copilot-chat/0.35.0', 'Copilot-Integration-Id': 'vscode-chat',
              'X-GitHub-Api-Version': '2026-06-01', ...attributionHeaders(),
            },
            redirect: 'error', signal: AbortSignal.timeout(5000),
          })
          if (!response.ok) throw new Error('Copilot metadata unavailable')
          const result = parseCatalog(await response.json(), now())
          for (const model of result.values()) {
            if (model.promotion?.endsAt) entry.expiresAt = Math.min(entry.expiresAt, Date.parse(model.promotion.endsAt))
          }
          return result
        } catch {
          entry.expiresAt = Math.min(entry.expiresAt, now() + 30_000)
          return new Map()
        }
      })()
      return entry.value
    } catch {
      cache = undefined
      // Metadata is optional: errors (which may contain secrets) never cross the boundary.
      return new Map()
    }
  }
}
