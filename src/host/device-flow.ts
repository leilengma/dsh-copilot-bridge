import { GITHUB_DOTCOM } from '../shared/contract.ts'
import { deviceFlowUrls } from './enterprise.ts'
import { githubFetch } from './transport.ts'

/** VS Code's public GitHub App client id; it issues `ghu_*` tokens Copilot accepts. */
export const OAUTH_CLIENT_ID = 'Iv1.b507a08c87ecfe98'
const OAUTH_SCOPE = 'read:user'
const USER_AGENT = 'GitHubCopilotChat/0.35.0'

export type CopilotAuthErrorCode = 'TRANSPORT' | 'SERVER'

/** A device-flow failure; `code` separates transport trouble from server refusal. */
export class CopilotAuthError extends Error {
  override readonly name = 'CopilotAuthError'
  readonly code: CopilotAuthErrorCode
  readonly status?: number
  constructor(message: string, code: CopilotAuthErrorCode, options?: { cause?: unknown; status?: number }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.code = code
    if (options?.status !== undefined) this.status = options.status
  }
}

/** A started device authorization. */
export interface DeviceAuthorization {
  /** Host the flow runs against (`github.com` or an enterprise host). */
  readonly domain: string
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  /** Seconds between polls. */
  readonly interval: number
  /** Seconds until the device code expires. */
  readonly expiresIn: number
}

/** One poll's outcome. */
export type PollResult =
  | { readonly state: 'done'; readonly token: string }
  | { readonly state: 'retry' | 'slow-down' | 'expired' | 'denied' }
  | { readonly state: 'error'; readonly message: string }

interface DeviceCodeResponse {
  device_code?: unknown
  user_code?: unknown
  verification_uri?: unknown
  interval?: unknown
  expires_in?: unknown
}

interface AccessTokenResponse {
  access_token?: unknown
  error?: unknown
}

const FORM_HEADERS = {
  accept: 'application/json',
  'content-type': 'application/x-www-form-urlencoded',
  'user-agent': USER_AGENT,
} as const

/** Request a device code from `domain` (github.com when absent). */
export async function startDeviceFlow(enterpriseDomain?: string): Promise<DeviceAuthorization> {
  const domain = enterpriseDomain ?? GITHUB_DOTCOM
  const urls = deviceFlowUrls(domain)
  let response: Response
  try {
    response = await githubFetch(urls.deviceCodeUrl, {
      method: 'POST',
      headers: FORM_HEADERS,
      body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, scope: OAUTH_SCOPE }).toString(),
    })
  } catch (cause) {
    throw new CopilotAuthError(`failed to start GitHub device authorization at ${domain}`, 'TRANSPORT', { cause })
  }
  if (!response.ok) {
    throw new CopilotAuthError(
      `GitHub device authorization at ${domain} failed (HTTP ${response.status})`,
      response.status >= 500 ? 'SERVER' : 'TRANSPORT',
      { status: response.status },
    )
  }
  const data = await response.json() as DeviceCodeResponse
  const { device_code: deviceCode, user_code: userCode } = data
  if (typeof deviceCode !== 'string' || deviceCode.length === 0 || typeof userCode !== 'string' || userCode.length === 0) {
    throw new CopilotAuthError(`GitHub at ${domain} did not return a device code`, 'TRANSPORT')
  }
  return {
    domain,
    deviceCode,
    userCode,
    verificationUri: typeof data.verification_uri === 'string' && data.verification_uri.length > 0
      ? data.verification_uri
      : urls.verificationUri,
    interval: Math.max(Number(data.interval) || 5, 1),
    expiresIn: Number(data.expires_in) || 900,
  }
}

/** Ask the device's host once whether the user has authorized yet. */
export async function pollDeviceFlow(device: DeviceAuthorization): Promise<PollResult> {
  let response: Response
  try {
    response = await githubFetch(deviceFlowUrls(device.domain).accessTokenUrl, {
      method: 'POST',
      headers: FORM_HEADERS,
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        device_code: device.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString(),
    })
  } catch {
    return { state: 'retry' }
  }
  if (!response.ok) return { state: 'retry' }
  const data = await response.json() as AccessTokenResponse
  if (typeof data.access_token === 'string' && data.access_token.length > 0) return { state: 'done', token: data.access_token }
  switch (data.error) {
    case 'authorization_pending': return { state: 'retry' }
    case 'slow_down': return { state: 'slow-down' }
    case 'expired_token': return { state: 'expired' }
    case 'access_denied': return { state: 'denied' }
    default: return { state: 'error', message: typeof data.error === 'string' ? data.error : 'unknown' }
  }
}
