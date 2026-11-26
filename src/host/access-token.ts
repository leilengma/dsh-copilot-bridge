/**
 * Copilot access-token exchange: trades the stored GitHub OAuth token for a
 * short-lived Copilot access token, kept in host memory only (spec D3).
 *
 * One exchange is shared by concurrent callers; a timer refreshes the token
 * before expiry and notifies `onRefresh` listeners (D11). Every exchanged token
 * carries a `generation`, so a prepared call can bind token and base URL from
 * one generation. `reset()` (sign-out, host switch) discards in-flight results.
 */
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { githubFetch } from './transport.ts'

/** The stored GitHub account: OAuth token plus optional Enterprise host. */
export interface CopilotAccount {
  readonly token: string
  readonly enterpriseHost?: string | undefined
}

export interface AccessToken {
  readonly token: string
  /** Validated HTTPS Copilot API origin, without trailing slash. */
  readonly baseUrl: string
  /** Epoch milliseconds. */
  readonly expiresAt: number
  /** Increments per exchanged token; differs across accounts, hosts and refreshes. */
  readonly generation: number
}

export type AccessTokenErrorReason =
  | 'signed-out' | 'invalid-host' | 'exchange-failed' | 'invalid-response' | 'disallowed-endpoint' | 'reset' | 'disposed'

/** Safe to log: never carries token values or response bodies. */
export class AccessTokenError extends Error {
  override readonly name = 'AccessTokenError'
  readonly reason: AccessTokenErrorReason
  readonly status: number | undefined
  constructor(reason: AccessTokenErrorReason, message: string, status?: number) {
    super(message)
    this.reason = reason
    this.status = status
  }
}

export interface AccessTokenDeps {
  readonly readAccount: () => Promise<CopilotAccount | undefined>
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>
  readonly now?: () => number
  readonly setTimeout?: (callback: () => void, ms: number) => unknown
  readonly clearTimeout?: (handle: unknown) => void
  readonly logger?: { warn(message: string): void }
  /** Per-exchange request timeout in milliseconds. */
  readonly timeoutMs?: number
}

export interface AccessTokens {
  /** Valid access token for the current account; concurrent calls share one exchange. */
  current(signal?: AbortSignal): Promise<AccessToken>
  /** Drop `token` after a 401 so the next `current()` re-exchanges once; stale tokens are ignored. */
  invalidate(token: AccessToken): void
  /** Called after every successful replacement exchange (not the first after reset). */
  onRefresh(listener: (token: AccessToken) => void): () => void
  /** Forget the token, cancel the refresh timer and discard in-flight exchanges. */
  reset(): void
  /** `reset()` plus listener removal; later `current()` calls reject. */
  dispose(): void
}

const COPILOT_HEADERS = {
  Accept: 'application/json',
  'user-agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
}
const DEFAULT_REFRESH_MS = 30 * 60_000
const EXPIRY_MARGIN_MS = 60_000
const RETRY_MS = 60_000
const MIN_DELAY_MS = 1_000
const HOST_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/

/**
 * Accept only HTTPS Copilot API origins: `api.githubcopilot.com`,
 * `api.<plan>.githubcopilot.com`, or `copilot-api.<enterprise-host>`.
 */
export function allowedBaseUrl(raw: string, enterpriseHost?: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return undefined
  if (url.pathname !== '/' && url.pathname !== '') return undefined
  const host = url.hostname
  const allowed = host === 'api.githubcopilot.com' || /^api\.[a-z0-9-]+\.githubcopilot\.com$/.test(host)
    || (enterpriseHost !== undefined && host === `copilot-api.${enterpriseHost}`)
  return allowed ? `https://${host}` : undefined
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const positive = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

export function createAccessTokens(deps: AccessTokenDeps): AccessTokens {
  const fetch = deps.fetch ?? githubFetch
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimeout ?? ((callback: () => void, ms: number) => {
    const handle = setTimeout(callback, ms)
    handle.unref()
    return handle
  })
  const clearTimer = deps.clearTimeout ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const timeoutMs = deps.timeoutMs ?? 10_000
  const listeners = new Set<(token: AccessToken) => void>()

  interface Exchange { readonly key: string; readonly controller: AbortController; promise: Promise<AccessToken> }
  let cached: { readonly key: string; readonly value: AccessToken } | undefined
  let inflight: Exchange | undefined
  let timer: unknown
  let epoch = 0
  let generation = 0
  let exchanged = false
  let disposed = false

  const keyOf = (account: CopilotAccount) => `${account.enterpriseHost ?? ''}\n${account.token}`

  function cancelTimer() {
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
  }

  function schedule(ms: number) {
    cancelTimer()
    timer = setTimer(() => {
      timer = undefined
      void refresh()
    }, Math.max(MIN_DELAY_MS, ms))
  }

  async function request(account: CopilotAccount, signal: AbortSignal) {
    const host = account.enterpriseHost?.toLowerCase()
    if (host !== undefined && !HOST_PATTERN.test(host)) throw new AccessTokenError('invalid-host', 'Invalid GitHub Enterprise host')
    let response: Response
    try {
      response = await fetch(`https://api.${host ?? 'github.com'}/copilot_internal/v2/token`, {
        headers: { ...COPILOT_HEADERS, Authorization: `Bearer ${account.token}`, ...attributionHeaders() },
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      })
    } catch {
      // Transport errors may echo request details; report only the category.
      if (signal.aborted) throw new AccessTokenError('reset', 'Copilot token exchange was discarded')
      throw new AccessTokenError('exchange-failed', 'Copilot token exchange failed')
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new AccessTokenError('exchange-failed', `Copilot token exchange failed with HTTP ${response.status}`, response.status)
    }
    let raw: Record<string, unknown> | undefined
    try {
      raw = object(await response.json())
    } catch {
      raw = undefined
    }
    const token = raw?.token
    const expiresAt = positive(raw?.expires_at)
    if (typeof token !== 'string' || token.length === 0 || expiresAt === undefined) {
      throw new AccessTokenError('invalid-response', 'Invalid Copilot token exchange response')
    }
    const api = object(raw?.endpoints)?.api
    // Without `endpoints.api`, fall back to the documented default origin for the host.
    const candidate = typeof api === 'string' ? api
      : host === undefined ? 'https://api.individual.githubcopilot.com' : `https://copilot-api.${host}`
    const baseUrl = allowedBaseUrl(candidate, host)
    if (baseUrl === undefined) throw new AccessTokenError('disallowed-endpoint', 'Copilot API endpoint is not allowed')
    const refreshIn = positive(raw?.refresh_in)
    return { token, baseUrl, expiresAt: expiresAt * 1000, refreshMs: refreshIn === undefined ? DEFAULT_REFRESH_MS : refreshIn * 1000 }
  }

  function exchange(account: CopilotAccount, key: string): Promise<AccessToken> {
    if (inflight?.key === key) return inflight.promise
    inflight?.controller.abort()
    const entry: Exchange = { key, controller: new AbortController(), promise: Promise.resolve() as never }
    inflight = entry
    entry.promise = (async () => {
      try {
        const result = await request(account, entry.controller.signal)
        if (inflight !== entry) throw new AccessTokenError('reset', 'Copilot token exchange was discarded')
        const value: AccessToken = { token: result.token, baseUrl: result.baseUrl, expiresAt: result.expiresAt, generation: ++generation }
        cached = { key, value }
        schedule(Math.min(result.refreshMs, result.expiresAt - now() - EXPIRY_MARGIN_MS))
        const replacement = exchanged
        exchanged = true
        if (replacement) {
          for (const listener of [...listeners]) {
            try {
              listener(value)
            } catch (error) {
              deps.logger?.warn(`Copilot access-token refresh listener failed: ${error instanceof Error ? error.name : 'error'}`)
            }
          }
        }
        return value
      } finally {
        if (inflight === entry) inflight = undefined
      }
    })()
    return entry.promise
  }

  async function refresh() {
    const started = epoch
    try {
      const account = await deps.readAccount()
      if (started !== epoch || !account?.token || cached?.key !== keyOf(account)) return
      // The current token stays usable until the replacement arrives.
      await exchange(account, keyOf(account))
    } catch (error) {
      if (started !== epoch || (error instanceof AccessTokenError && error.reason === 'reset')) return
      deps.logger?.warn(`Copilot access-token refresh failed: ${error instanceof AccessTokenError ? error.message : 'unexpected error'}`)
      if (timer === undefined) schedule(RETRY_MS)
    }
  }

  function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal === undefined) return promise
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  function reset() {
    epoch++
    inflight?.controller.abort()
    inflight = undefined
    cached = undefined
    exchanged = false
    cancelTimer()
  }

  return {
    async current(signal) {
      if (disposed) throw new AccessTokenError('disposed', 'Copilot access tokens are disposed')
      signal?.throwIfAborted()
      const started = epoch
      const account = await abortable(deps.readAccount(), signal)
      if (started !== epoch) throw new AccessTokenError('reset', 'Copilot account changed')
      if (!account?.token) {
        reset()
        throw new AccessTokenError('signed-out', 'Not signed in to GitHub Copilot')
      }
      const key = keyOf(account)
      if (cached?.key === key && cached.value.expiresAt - now() > EXPIRY_MARGIN_MS) return cached.value
      if (cached?.key !== key) {
        cached = undefined
        cancelTimer()
      }
      return abortable(exchange(account, key), signal)
    },
    invalidate(token) {
      if (cached?.value.generation !== token.generation) return
      cached = undefined
      cancelTimer()
    },
    onRefresh(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    reset,
    dispose() {
      disposed = true
      reset()
      listeners.clear()
    },
  }
}
