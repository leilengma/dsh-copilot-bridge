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

/** Device-flow progress, as shown by the Settings page and the commands. */
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
  /** Models the Harness route recorded as available to this account. */
  readonly modelCount?: number
  /** Full, unfiltered account catalog, sorted; absent until recorded by pi-ai. */
  readonly availableModels?: readonly string[]
  /** Saved hidden ids, after pruning; only present when authenticated. */
  readonly hiddenModels?: readonly string[]
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
