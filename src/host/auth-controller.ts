import { BRIDGE_PROVIDER, GITHUB_DOTCOM, type AuthStatus, type FlowState } from '../shared/contract.ts'
import {
  deleteBridgeAccount, readBridgeAccount, writeBridgeAccount, type BridgeAccount, type CredentialStore,
} from './bridge-credentials.ts'
import type { DeviceAuthorization, PollResult } from './device-flow.ts'
import { normalizeEnterpriseDomain } from './enterprise.ts'
import { InvalidHiddenModelsError, validateHiddenModels } from './hidden-models.ts'

/** Live bridge configuration, persisted in the profile's `cordis.patch.yml`. */
export interface BridgeConfig {
  /** Saved value; empty when github.com is used. */
  read(): string
  /** Whether `write` can persist (needs the settings service and a profile entry). */
  writable(): boolean
  /** Persist a normalized host, or remove the field for github.com. */
  write(host: string | undefined): Promise<void>
  readHidden(): readonly string[]
  /** Remove the key when undefined. */
  writeHidden(ids: readonly string[] | undefined): Promise<void>
}

export interface AuthControllerDeps {
  /** The credential service, or undefined while it is not mounted. */
  readonly credentials: () => CredentialStore | undefined
  readonly config: BridgeConfig
  /**
   * Ids of the signed-in account's model catalog, or undefined while unknown.
   * When known, status lists them and `setHiddenModels` rejects other ids.
   */
  readonly catalogIds?: () => Promise<readonly string[] | undefined>
  /** Called after a completed device flow stored the account; failures are logged, never fail sign-in. */
  readonly onSignedIn?: (account: BridgeAccount) => void | Promise<void>
  /** Called after sign-out deleted the account; failures are logged, never fail sign-out. */
  readonly onSignedOut?: () => void | Promise<void>
  readonly startDeviceFlow: (enterpriseDomain?: string, signal?: AbortSignal) => Promise<DeviceAuthorization>
  readonly pollDeviceFlow: (device: DeviceAuthorization, signal?: AbortSignal) => Promise<PollResult>
  readonly logger: { info(message: string): void; warn(message: string): void; error(error: unknown): void }
  readonly now?: () => number
  readonly setTimer?: (callback: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
}

export interface AuthController {
  status(): Promise<AuthStatus>
  setHiddenModels(input: unknown): Promise<AuthStatus>
  /** Start (or resume) a device flow; answers the already-authenticated status when signed in. */
  login(): Promise<AuthStatus>
  logout(): Promise<AuthStatus>
  /** Validate, normalize, and persist the enterprise URL; an empty value resets to github.com. */
  setEnterpriseUrl(input: string): Promise<AuthStatus>
  /** Cancel pending authorization and polling when the configured host changes. */
  cancelLogin(): void
  /** Permanently stop device-flow work when the plugin is disposed. */
  dispose(): void
}

type Flow =
  | { readonly state: 'pending'; readonly verificationUri: string; readonly userCode: string; readonly expiresAt: number }
  | { readonly state: Exclude<FlowState, 'pending'>; readonly message?: string }

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

export function createAuthController(deps: AuthControllerDeps): AuthController {
  const now = deps.now ?? Date.now
  const setTimer = deps.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => { clearTimeout(handle as NodeJS.Timeout) })
  let flow: Flow = { state: 'signed-out' }
  let generation = 0
  let disposed = false
  let deviceRequest: AbortController | undefined
  let timer: unknown

  /** Configured enterprise host; an invalid saved value is reported, not silently replaced by github.com. */
  const configuredDomain = (): string | undefined => normalizeEnterpriseDomain(deps.config.read())
  const githubHost = (): string => configuredDomain() ?? GITHUB_DOTCOM

  const stopPolling = (): void => {
    generation += 1
    deviceRequest?.abort()
    deviceRequest = undefined
    if (timer !== undefined) clearTimer(timer)
    timer = undefined
  }

  const cancelLogin = (): void => {
    stopPolling()
    flow = { state: 'signed-out' }
  }

  const requireCredentials = (action: string): CredentialStore => {
    const credentials = deps.credentials()
    if (credentials === undefined) throw new Error(`${action} needs the credentials service; mount dsh-credentials-local`)
    return credentials
  }

  const readAccount = () => readBridgeAccount(deps.credentials())

  const catalogIds = async (): Promise<readonly string[] | undefined> => {
    try {
      return await deps.catalogIds?.()
    } catch (error) {
      deps.logger.warn(`Could not read the model catalog: ${errorMessage(error)}`)
      return undefined
    }
  }

  /** Best-effort side effects of a sign-in/out; they never change its outcome. */
  const bestEffort = async (label: string, action: () => void | Promise<void>): Promise<void> => {
    try {
      await action()
    } catch (error) {
      deps.logger.warn(`${label}: ${errorMessage(error)}`)
    }
  }
  const resetHiddenModels = () => bestEffort('Could not reset hidden models', () => deps.config.writeHidden(undefined))

  const status = async (): Promise<AuthStatus> => {
    const account = await readAccount()
    const base = {
      provider: BRIDGE_PROVIDER,
      githubHost: githubHost(),
      enterpriseUrl: deps.config.read().trim(),
      configWritable: deps.config.writable(),
    } as const
    if (account === undefined) {
      return { ...base, authenticated: false, ...(flow.state === 'authenticated' ? { state: 'signed-out' } : flow) }
    }
    const signedInHost = account.enterpriseHost ?? GITHUB_DOTCOM
    const ids = await catalogIds()
    const modelIds = ids === undefined ? undefined : [...new Set(ids)].sort()
    return {
      ...base,
      authenticated: true,
      state: 'authenticated',
      ...(signedInHost === base.githubHost ? {} : { signedInHost }),
      hiddenModels: [...new Set(deps.config.readHidden())].filter(id => modelIds === undefined || modelIds.includes(id)),
      ...(modelIds === undefined ? {} : { modelCount: modelIds.length, availableModels: modelIds }),
    }
  }

  const schedulePoll = (device: DeviceAuthorization, abort: AbortController): void => {
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
      const result = await deps.pollDeviceFlow(device, abort.signal)
      if (current !== generation) return
      switch (result.state) {
        case 'done': {
          const account: BridgeAccount = device.domain === GITHUB_DOTCOM
            ? { token: result.token }
            : { token: result.token, enterpriseHost: device.domain }
          try {
            await writeBridgeAccount(requireCredentials('signing in'), account)
          } catch (error) {
            finish('error', errorMessage(error))
            deps.logger.error(error)
            return
          }
          await resetHiddenModels()
          if (current !== generation) return
          finish('authenticated')
          deps.logger.info(`GitHub Copilot sign-in at ${device.domain} completed`)
          await bestEffort('Sign-in follow-up failed', () => deps.onSignedIn?.(account))
          return
        }
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
    if (disposed) throw new Error('GitHub sign-in is disposed')
    const current = generation
    const host = configuredDomain()
    const account = await readAccount()
    if (current !== generation || disposed || host !== configuredDomain()) throw new Error('GitHub sign-in was cancelled')
    if (account !== undefined) return status()
    if (flow.state === 'pending' && now() < flow.expiresAt) return status()
    stopPolling()
    const started = generation
    const abort = deviceRequest = new AbortController()
    const device = await deps.startDeviceFlow(host, abort.signal)
    if (started !== generation || disposed || host !== configuredDomain()) throw new Error('GitHub sign-in was cancelled')
    schedulePoll(device, abort)
    return status()
  }

  const logout = async (): Promise<AuthStatus> => {
    const credentials = requireCredentials('signing out')
    cancelLogin()
    await deleteBridgeAccount(credentials)
    await resetHiddenModels()
    await bestEffort('Sign-out follow-up failed', () => deps.onSignedOut?.())
    return status()
  }

  const setEnterpriseUrl = async (input: string): Promise<AuthStatus> => {
    const host = normalizeEnterpriseDomain(input)
    if (!deps.config.writable()) throw new Error('saving the enterprise URL needs the settings service and a profile entry')
    // Invalidate even authorization requests that have not returned a device code yet.
    cancelLogin()
    await deps.config.write(host)
    deps.logger.info(`GitHub host set to ${host ?? GITHUB_DOTCOM}`)
    return status()
  }

  /** Accepts any ids while the catalog is unknown; catalog-aware rules are injected via `catalogIds`. */
  const setHiddenModels = async (input: unknown): Promise<AuthStatus> => {
    const hidden = validateHiddenModels(input)
    if (!deps.config.writable()) throw new Error('saving hidden models needs the settings service and a profile entry')
    const known = await catalogIds()
    if (known !== undefined && hidden.some(id => !known.includes(id))) {
      throw new InvalidHiddenModelsError('hiddenModels contains an id not in the account model list')
    }
    await deps.config.writeHidden(hidden.length === 0 ? undefined : hidden)
    return status()
  }

  return { status, login, logout, setEnterpriseUrl, setHiddenModels, cancelLogin, dispose() { disposed = true; cancelLogin() } }
}
