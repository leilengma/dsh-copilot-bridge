import { GITHUB_DOTCOM } from '../shared/contract.ts'

/** Raised for a value that is neither a URL nor a hostname. */
export class InvalidEnterpriseUrlError extends Error {
  override readonly name = 'InvalidEnterpriseUrlError'
  readonly input: string
  constructor(input: string) {
    super(`invalid GitHub Enterprise URL/domain "${input}"`)
    this.input = input
  }
}

/**
 * Normalize a GitHub Enterprise URL or bare domain to its hostname, the form
 * pi-ai stores in a Copilot grant's `enterpriseUrl`.
 *
 * `https://octocorp.ghe.com/` and `octocorp.ghe.com` both become `octocorp.ghe.com`.
 * Blank and `github.com` mean "no enterprise host".
 *
 * @throws {InvalidEnterpriseUrlError} when the value is not a URL or hostname.
 */
export function normalizeEnterpriseDomain(input: string | undefined): string | undefined {
  const trimmed = input?.trim() ?? ''
  if (trimmed.length === 0) return undefined
  let url: URL
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
  } catch {
    throw new InvalidEnterpriseUrlError(trimmed)
  }
  const hostname = url.hostname.toLowerCase()
  if (hostname.length === 0 || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new InvalidEnterpriseUrlError(trimmed)
  }
  return hostname === GITHUB_DOTCOM || hostname === `www.${GITHUB_DOTCOM}` ? undefined : hostname
}

/** GitHub OAuth device-flow endpoints for a host; github.com and `*.ghe.com` share the layout. */
export interface DeviceFlowUrls {
  readonly deviceCodeUrl: string
  readonly accessTokenUrl: string
  readonly verificationUri: string
}

export function deviceFlowUrls(domain: string): DeviceFlowUrls {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
    verificationUri: `https://${domain}/login/device`,
  }
}
