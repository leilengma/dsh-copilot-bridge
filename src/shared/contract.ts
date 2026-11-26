/**
 * Wire contract between the Host routes and the Web client.
 *
 * Both sides import these types, so a field renamed on one side fails the
 * other side's type check instead of silently reading `undefined`.
 */

/** Literal `/api` prefix of the Host routes; registered on the authenticated shared channel. */
export const API_BASE = '/api/copilot-bridge'

/** Harness route this plugin registers and owns. */
export const BRIDGE_PROVIDER = 'copilot-bridge'

/** Credential record holding the bridge's GitHub OAuth token (scope/id). */
export const BRIDGE_RECORD_SCOPE = 'copilot-bridge'
export const BRIDGE_RECORD_ID = 'github'
export const BRIDGE_RECORD_KEY = `${BRIDGE_RECORD_SCOPE}/${BRIDGE_RECORD_ID}`

/** The public GitHub host, used when no enterprise host is configured. */
export const GITHUB_DOTCOM = 'github.com'

/** Device-flow progress, as shown by the Account tab. */
export type FlowState = 'signed-out' | 'pending' | 'authenticated' | 'expired' | 'denied' | 'error'

/** Answer of `GET /status`, `POST /login`, `POST /logout`, and `POST /enterprise-url`. */
export interface AuthStatus {
  readonly authenticated: boolean
  readonly state: FlowState
  /** Harness route the bridge serves. */
  readonly provider: typeof BRIDGE_PROVIDER
  /** Host sign-in targets now: the configured enterprise host, or github.com. */
  readonly githubHost: string
  /** Enterprise URL saved in the profile's configuration; empty when github.com is used. */
  readonly enterpriseUrl: string
  /** Whether the Host can write `enterpriseUrl` into the profile's configuration file. */
  readonly configWritable: boolean
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
  /** Size of the full management catalog. */
  readonly modelCount?: number
  /** Full, unfiltered management catalog, sorted; absent when no catalog is available. */
  readonly availableModels?: readonly string[]
  /** Saved hidden ids, after pruning; only present when authenticated. */
  readonly hiddenModels?: readonly string[]
  /** Saved exact model ids pinned to the top of the bridge catalog; only present when authenticated. */
  readonly pinnedModels?: readonly string[]
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

/** Wire protocol a catalog model is served over. */
export type ModelProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-completions'

/** Why a listed model cannot be selected or revealed. */
export type ModelDisabledReason = 'unsupported-protocol' | 'not-offered'

/** Live catalog discovery progress. */
export type CatalogState = 'loading' | 'ready' | 'error'

/** Display-only metadata; missing values are unknown, never inferred capabilities or prices. */
export interface CopilotModel {
  readonly id: string
  readonly name: string
  /** Protocol chosen from the live `supported_endpoints`; absent when disabled. */
  readonly protocol?: ModelProtocol
  /** Present on rows shown disabled: never in the picker and never revealable. */
  readonly disabledReason?: ModelDisabledReason
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
  readonly state: CatalogState
  /** Last discovery error; `models` still holds the last good snapshot. */
  readonly error?: string
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

/** Body of `POST /pinned-models`. An empty array removes the config key. */
export interface PinnedModelsRequest {
  readonly pinnedModels: readonly string[]
}

/** Body of `POST /enterprise-url`. An empty string resets to github.com. */
export interface EnterpriseUrlRequest {
  readonly enterpriseUrl: string
}

/** Envelope every route answers with. */
export type ApiEnvelope<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }
