/**
 * Wire contract between the Host routes and the Web client.
 *
 * Both sides import these types, so a field renamed on one side fails the
 * other side's type check instead of silently reading `undefined`.
 */

/** Literal `/api` prefix of the Host routes; registered on the authenticated shared channel. */
export const API_BASE = '/api/copilot-bridge'

/** Credential record the Harness `github-copilot` route reads (scope/id). */
export const PI_AI_RECORD_SCOPE = 'llm-pi-ai'
export const PI_AI_PROVIDER = 'github-copilot'
export const PI_AI_RECORD_KEY = `${PI_AI_RECORD_SCOPE}/${PI_AI_PROVIDER}`

/** The public GitHub host, used when no enterprise host is configured. */
export const GITHUB_DOTCOM = 'github.com'

/** Device-flow progress, as shown by the Account tab. */
export type FlowState = 'signed-out' | 'pending' | 'authenticated' | 'expired' | 'denied' | 'error'

/** Answer of `GET /status`, `POST /login`, `POST /logout`, and `POST /enterprise-url`. */
export interface AuthStatus {
  readonly authenticated: boolean
  readonly state: FlowState
  /** Harness provider the credential is published to. */
  readonly provider: typeof PI_AI_PROVIDER
  /** Host sign-in targets now: the configured enterprise host, or github.com. */
  readonly githubHost: string
  /** Enterprise URL saved in the profile's configuration; empty when github.com is used. */
  readonly enterpriseUrl: string
  /** Whether the Host can write `enterpriseUrl` into the profile's configuration file. */
  readonly configWritable: boolean
  /** Post-sign-in provider configuration; absent until this session attempts setup. */
  readonly providerSetup?: 'pending' | 'ready' | 'warning'
  /** Host the stored credential was issued by, when it differs from `githubHost`. */
  readonly signedInHost?: string
  /** Pending device flow: page to open. */
  readonly verificationUri?: string
  /** Pending device flow: code to enter. */
  readonly userCode?: string
  /** Pending device flow: epoch milliseconds the code expires at. */
  readonly expiresAt?: number
  /** Terminal flow message (expired / denied / error). */
  readonly message?: string
  /** Size of the full management catalog (account-discovered, or provider fallback). */
  readonly modelCount?: number
  /** Full, unfiltered management catalog, sorted; absent when no catalog is available. */
  readonly availableModels?: readonly string[]
  /** Static provider fallback, not yet verified against this account's entitlements. */
  readonly modelCatalogSource?: 'provider'
  /** Saved hidden ids, after pruning; only present when authenticated. */
  readonly hiddenModels?: readonly string[]
}

/** Provider-reported AI credits per 1M tokens; absent fields are unknown (not zero). */
export interface ModelPrices {
  readonly input?: number
  readonly output?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

export interface ModelPromotion {
  readonly discountPercent: number
  readonly message?: string
  readonly endsAt?: string
}

/** Display-only metadata; missing values are unknown, never inferred capabilities or prices. */
export interface CopilotModel {
  readonly id: string
  readonly name: string
  readonly contextWindow?: number
  readonly inputModalities?: readonly ('text' | 'image' | 'audio' | 'video')[]
  readonly pricing?: ModelPrices
  readonly longContextPricing?: ModelPrices
  readonly defaultContextMax?: number
  readonly promotion?: ModelPromotion
  /** Provider warning text; the badge always says Retiring, never Retired. */
  readonly retiring?: string
}

/** Full account catalog for management, including models excluded from the picker. */
export interface ModelCatalog {
  readonly status: AuthStatus
  readonly models: readonly CopilotModel[]
}

/** Display-only account quota, never an OAuth token or raw user-info payload. */
export type CopilotUsage = { readonly state: 'signed-out' | 'unavailable' } | {
  readonly state: 'available'
  readonly unit: 'credits' | 'requests'
  readonly unlimited: boolean
  readonly percentUsed?: number
  readonly used?: number
  readonly total?: number
  readonly reset?: { readonly at: string; readonly hasTime: boolean }
}

/** Body of `POST /hidden-models`. An empty array removes the config key. */
export interface HiddenModelsRequest {
  readonly hiddenModels: readonly string[]
}

/** Body of `POST /enterprise-url`. An empty string resets to github.com. */
export interface EnterpriseUrlRequest {
  readonly enterpriseUrl: string
}

/** Envelope every route answers with. */
export type ApiEnvelope<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }
