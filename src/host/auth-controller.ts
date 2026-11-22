import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import {
  GITHUB_DOTCOM, PI_AI_PROVIDER, PI_AI_RECORD_KEY, PI_AI_RECORD_SCOPE,
  type AuthStatus, type FlowState,
} from '../shared/contract.ts'
import type { DeviceAuthorization, PollResult } from './device-flow.ts'
import { normalizeEnterpriseDomain } from './enterprise.ts'
import { grantEnterpriseDomain, grantModelIds, grantToken, piAiGrantRecord } from './grant.ts'

/** The slice of the Harness credential service this plugin uses. */
export type CredentialStore = Pick<CredentialProvider, 'readRecord' | 'modifyRecord' | 'deleteRecord'>

/** Where `enterpriseUrl` lives: the plugin's live Config, persisted in the profile's `cordis.patch.yml`. */
export interface EnterpriseUrlConfig {
  /** Saved value; empty when github.com is used. */
  read(): string
  /** Whether `write` can persist (needs the settings service and a profile entry). */
  writable(): boolean
  /** Persist a normalized host, or remove the field for github.com. */
  write(host: string | undefined): Promise<void>
}

export interface AuthControllerDeps {
  /** The credential service, or undefined while it is not mounted. */
  readonly credentials: () => CredentialStore | undefined
  readonly config: EnterpriseUrlConfig
  readonly startDeviceFlow: (enterpriseDomain?: string) => Promise<DeviceAuthorization>
  readonly pollDeviceFlow: (device: DeviceAuthorization) => Promise<PollResult>
  readonly logger: { info(message: string): void; warn(message: string): void; error(error: unknown): void }
  readonly now?: () => number
  readonly setTimer?: (callback: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

export interface AuthController {
  status(): Promise<AuthStatus>
  /** Start (or resume) a device flow; answers the already-authenticated status when signed in. */
  login(): Promise<AuthStatus>
  logout(): Promise<AuthStatus>
  /** Validate, normalize, and persist the enterprise URL; an empty value resets to github.com. */
  setEnterpriseUrl(input: string): Promise<AuthStatus>
  /** Stop polling; called when the plugin is disposed. */
  dispose(): void
}

type Flow =
  | { readonly state: 'pending'; readonly verificationUri: string; readonly userCode: string; readonly expiresAt: number }
  | { readonly state: Exclude<FlowState, 'pending'>; readonly message?: string }

const recordKey = () => credentialKey(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER)

export function createAuthController(deps: AuthControllerDeps): AuthController {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => { clearTimeout(handle as NodeJS.Timeout) })
  let flow: Flow = { state: 'signed-out' }
  let generation = 0
  let timer: unknown

  /** Configured enterprise host; an invalid saved value is reported, not silently replaced by github.com. */
  const configuredDomain = (): string | undefined => normalizeEnterpriseDomain(deps.config.read())
  const githubHost = (): string => configuredDomain() ?? GITHUB_DOTCOM

  const stopPolling = (): void => {
    generation += 1
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
  }

  const requireCredentials = (action: string): CredentialStore => {
    const credentials = deps.credentials()
    if (credentials === undefined) throw new Error(`${action} needs the credentials service; mount dsh-credentials-local`)
    return credentials
  }

  const readGrant = async () => deps.credentials()?.readRecord(recordKey())

  /**
   * Publish the token to the record the route reads, then read it back: the
   * record format belongs to another plugin, so a shape it stops accepting must
   * fail here rather than leave a credential that authenticates nothing.
   */
  const storeToken = async (token: string, enterpriseDomain: string | undefined): Promise<void> => {
    const credentials = requireCredentials('signing in')
    await credentials.modifyRecord(recordKey(), async () => piAiGrantRecord(token, enterpriseDomain))
    const written = await credentials.readRecord(recordKey())
    if (grantToken(written) !== token || grantEnterpriseDomain(written) !== enterpriseDomain) {
      throw new Error(`the credential record at ${PI_AI_RECORD_KEY} did not survive the write; the consuming plugin may have changed its grant format`)
    }
  }

  const status = async (): Promise<AuthStatus> => {
    const record = await readGrant()
    const base = {
      provider: PI_AI_PROVIDER,
      githubHost: githubHost(),
      enterpriseUrl: deps.config.read().trim(),
      configWritable: deps.config.writable(),
    } as const
    if (grantToken(record) === undefined) {
      return { ...base, authenticated: false, ...(flow.state === 'authenticated' ? { state: 'signed-out' } : flow) }
    }
    const signedInHost = grantEnterpriseDomain(record) ?? GITHUB_DOTCOM
    const modelIds = grantModelIds(record)
    return {
      ...base,
      authenticated: true,
      state: 'authenticated',
      ...(signedInHost === base.githubHost ? {} : { signedInHost }),
      ...(modelIds === undefined ? {} : { modelCount: modelIds.length }),
    }
  }

  const schedulePoll = (device: DeviceAuthorization): void => {
    stopPolling()
    const current = generation
    const deadline = now() + device.expiresIn * 1000
    let interval = device.interval
    flow = { state: 'pending', verificationUri: device.verificationUri, userCode: device.userCode, expiresAt: deadline }
    const finish = (state: Exclude<FlowState, 'pending'>, message?: string): void => {
      if (current !== generation) return
      timer = undefined
      flow = message === undefined ? { state } : { state, message }
    }
    const tick = async (): Promise<void> => {
      if (current !== generation) return
      if (now() > deadline) {
        finish('expired', 'The device code expired. Start sign-in again.')
        return
      }
      const result = await deps.pollDeviceFlow(device)
      if (current !== generation) return
      switch (result.state) {
        case 'done':
          try {
            await storeToken(result.token, device.domain === GITHUB_DOTCOM ? undefined : device.domain)
            finish('authenticated')
            deps.logger.info(`GitHub Copilot sign-in at ${device.domain} completed; the ${PI_AI_PROVIDER} route can now authenticate`)
          } catch (error) {
            finish('error', error instanceof Error ? error.message : String(error))
            deps.logger.error(error)
          }
          return
        case 'expired': finish('expired', 'The device code expired. Start sign-in again.'); return
        case 'denied': finish('denied', 'GitHub authorization was denied.'); return
        case 'error': finish('error', result.message); return
        case 'slow-down': interval += 5; break
        case 'retry': break
      }
      timer = setTimer(() => { void tick() }, interval * 1000)
    }
    timer = setTimer(() => { void tick() }, interval * 1000)
  }

  const login = async (): Promise<AuthStatus> => {
    if (grantToken(await readGrant()) !== undefined) return status()
    if (flow.state === 'pending' && now() < flow.expiresAt) return status()
    schedulePoll(await deps.startDeviceFlow(configuredDomain()))
    return status()
  }

  const logout = async (): Promise<AuthStatus> => {
    const credentials = requireCredentials('signing out')
    stopPolling()
    flow = { state: 'signed-out' }
    await credentials.deleteRecord(recordKey())
    return status()
  }

  const setEnterpriseUrl = async (input: string): Promise<AuthStatus> => {
    const host = normalizeEnterpriseDomain(input)
    if (!deps.config.writable()) throw new Error('saving the enterprise URL needs the settings service and a profile entry')
    await deps.config.write(host)
    // A device code issued by the previous host cannot complete on the new one.
    if (flow.state === 'pending') {
      stopPolling()
      flow = { state: 'signed-out' }
    }
    deps.logger.info(`GitHub host set to ${host ?? GITHUB_DOTCOM}`)
    return status()
  }

  return { status, login, logout, setEnterpriseUrl, dispose: stopPolling }
}
