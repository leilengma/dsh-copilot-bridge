/**
 * dsh-copilot-bridge Host plugin.
 *
 * Runs the GitHub OAuth device flow against github.com or a GitHub Enterprise
 * host and stores the result in the bridge's own credential record
 * `copilot-bridge/github`. The native `llm-pi-ai/github-copilot` record is
 * never read or written.
 *
 * The enterprise host is a volatile config field: the Settings page writes it
 * into the profile's `cordis.patch.yml` through the settings service, and the
 * Loader updates it live without remounting the plugin.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: augment `Context` with `credentials`, `settings`, `connection`, and `fiber.entry`.
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { BRIDGE_PROVIDER, BRIDGE_RECORD_KEY } from '../shared/contract.ts'
import { createAuthController, type AuthController, type BridgeConfig } from './auth-controller.ts'
import { pollDeviceFlow, startDeviceFlow } from './device-flow.ts'
import { createCopilotUsage } from './copilot-usage.ts'
import { createCopilotMetadata } from './copilot-metadata.ts'
import { authRoutes } from './routes.ts'
import { readBridgeAccount } from './bridge-credentials.ts'
import { createAccessTokens } from './access-token.ts'
import { createLiveCatalog, type LiveCatalog } from './live-catalog.ts'
import { BridgeAdapter, type ImageAttachment } from './bridge-adapter.ts'
import { normalizeEnterpriseDomain } from './enterprise.ts'

export const name = 'copilot-bridge'

/** No hard inject: `credentials`, `settings`, and `connection` are optional and resolved when present. */
export const inject: string[] = []

export interface Config {
  /** GitHub Enterprise URL or host (e.g. `https://octocorp.ghe.com/`); blank means github.com. */
  enterpriseUrl: Volatile<string>
  hiddenModels: Volatile<string[]>
  pinnedModels: Volatile<string[]>
}

export const Config: z<Config> = z.object({
  pinnedModels: z.array(z.string())
    .description('GitHub Copilot model ids pinned to the top of bridge model selection. Cleared on sign-out and sign-in.')
    .default([])
    .volatile(),
  hiddenModels: z.array(z.string())
    .description('GitHub Copilot model ids hidden from model selection. Cleared on sign-out and sign-in.')
    .default([])
    .volatile(),
  enterpriseUrl: z.string()
    .description('GitHub Enterprise URL or host, e.g. https://octocorp.ghe.com/. Leave blank for github.com.')
    .default('')
    .volatile(),
}) as unknown as z<Config>

const ENTERPRISE_URL_FIELD = 'enterpriseUrl'

function bridgeConfig(ctx: Context, config: Config): BridgeConfig {
  const entryId = ctx.fiber.entry?.options.id
  return {
    read: () => config.enterpriseUrl.get() ?? '',
    writable: () => entryId !== undefined && ctx.get('settings') !== undefined,
    readHidden: () => config.hiddenModels.get() ?? [],
    async writeHidden(ids) {
      const settings = ctx.get('settings')
      if (settings === undefined || entryId === undefined) {
        throw new Error('saving hidden models needs the settings service and a profile entry')
      }
      if (ids === undefined) await settings.mutate(entryId, [{ op: 'unset', path: ['hiddenModels'] }])
      else await settings.update(entryId, { hiddenModels: [...ids] })
    },
    readPinned: () => config.pinnedModels.get() ?? [],
    async writePinned(ids) {
      const settings = ctx.get('settings')
      if (settings === undefined || entryId === undefined) {
        throw new Error('saving pinned models needs the settings service and a profile entry')
      }
      if (ids === undefined) await settings.mutate(entryId, [{ op: 'unset', path: ['pinnedModels'] }])
      else await settings.update(entryId, { pinnedModels: [...ids] })
    },
    async write(host) {
      const settings = ctx.get('settings')
      if (settings === undefined || entryId === undefined) {
        throw new Error('saving the enterprise URL needs the settings service and a profile entry')
      }
      if (host === undefined) await settings.mutate(entryId, [{ op: 'unset', path: [ENTERPRISE_URL_FIELD] }])
      else await settings.update(entryId, { [ENTERPRISE_URL_FIELD]: `https://${host}/` })
    },
  }
}

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

function registerRoutes(ctx: Context, auth: AuthController, catalog: LiveCatalog, accessToken: ReturnType<typeof createAccessTokens>['current']): void {
  const metadata = createCopilotMetadata({ credentials: () => ctx.get('credentials'), accessToken })
  const usage = createCopilotUsage({ credentials: () => ctx.get('credentials') })
  // `connection.fetch` routes run only after the shared `/api` channel applied its
  // trust and authentication policy; `webServer.register` would be unauthenticated.
  ctx.inject(['connection'], connectionCtx => {
    connectionCtx.effect(() => {
      const { fetch } = connectionCtx.connection
      const disposers = authRoutes(auth, catalog, metadata, usage, () => ctx.get('attachments') !== undefined).map(route => fetch.register(route))
      return async () => {
        for (const dispose of disposers.reverse()) await dispose()
      }
    }, `${name}: Web sign-in routes`)
  })
}

export function apply(ctx: Context, config: Config): void {
  const configStore = bridgeConfig(ctx, config)
  const notify = () => ctx.emit('llm/models-updated', BRIDGE_PROVIDER)
  const readAccount = async () => {
    const account = await readBridgeAccount(ctx.get('credentials'))
    return account?.enterpriseHost === normalizeEnterpriseDomain(configStore.read()) ? account : undefined
  }
  const tokens = createAccessTokens({ readAccount, logger: ctx.logger })
  const catalog = createLiveCatalog({ token: () => tokens.current(), logger: ctx.logger })
  let disposed = false
  let epoch = 0
  const reset = () => {
    epoch++
    tokens.reset()
    catalog.reset()
    notify()
  }
  const discover = async () => {
    const started = epoch
    if (!disposed && await readAccount() && started === epoch) await catalog.refresh().catch(() => {})
  }
  const auth = createAuthController({
    credentials: () => ctx.get('credentials'),
    config: configStore,
    catalogIds: async () => catalog.snapshot()?.models.flatMap(model => model.supported ? [model.id] : []),
    onSignedIn: discover,
    onSignedOut: reset,
    startDeviceFlow,
    pollDeviceFlow,
    logger: {
      info: message => ctx.logger.info(`${name}: ${message}`),
      warn: message => ctx.logger.warn(`${name}: ${message}`),
      error: error => ctx.logger.error(error),
    },
  })
  ctx.effect(() => () => auth.dispose(), `${name}: stop device-flow polling`)
  ctx.effect(() => catalog.onChange(notify), `${name}: catalog updates`)
  ctx.effect(() => tokens.onRefresh(() => { void discover() }), `${name}: token refresh discovery`)
  ctx.effect(() => () => {
    disposed = true
    epoch++
    tokens.dispose()
    catalog.dispose()
  }, `${name}: dispose live catalog and access tokens`)
  ctx.on('credentials/record-updated', key => {
    if (key !== BRIDGE_RECORD_KEY) return
    reset()
    void discover()
  })
  ctx.on('loader/volatile-update', paths => {
    if (paths.some(path => path[0] === 'enterpriseUrl')) {
      auth.cancelLogin()
      reset()
      void configStore.writeHidden(undefined).catch(error => ctx.logger.warn(`${name}: could not reset hidden models: ${errorMessage(error)}`))
      void configStore.writePinned(undefined).catch(error => ctx.logger.warn(`${name}: could not reset pinned models: ${errorMessage(error)}`))
      void discover()
    } else if (paths.some(path => path[0] === 'hiddenModels' || path[0] === 'pinnedModels')) notify()
  })
  ctx.inject(['credentials'], credentialsCtx => {
    void discover()
    credentialsCtx.effect(() => () => reset(), `${name}: credentials lifetime`)
  })
  ctx.inject(['llm'], llmCtx => {
    const adapter = new BridgeAdapter({
      catalog: { async ready() {
        const started = epoch
        const account = await readAccount()
        if (started !== epoch || disposed) throw new Error('Copilot account changed')
        if (account === undefined) return { generation: -1, models: [] }
        const state = catalog.state()
        // Picker refetches triggered by the error notification are not retry actions.
        if (state.status === 'error' && catalog.snapshot() === undefined) throw new Error(state.error)
        const snapshot = await catalog.ready()
        if (started !== epoch || disposed) throw new Error('Copilot account changed')
        return snapshot
      } },
      tokens, hidden: () => configStore.readHidden(), pinned: () => configStore.readPinned(),
      get loadImage() {
        const attachments = llmCtx.get('attachments')
        if (attachments === undefined) return undefined
        return async (ref: ImageAttachment, signal?: AbortSignal) => {
          const image = await attachments.readImage(ref, signal)
          return { data: Buffer.from(image.data).toString('base64'), mimeType: image.ref.mediaType }
        }
      },
    })
    llmCtx.llm.registerAdapter([BRIDGE_PROVIDER], adapter)
    llmCtx.inject(['attachments'], attachmentsCtx => {
      notify()
      attachmentsCtx.effect(() => () => notify(), `${name}: attachment capabilities lifetime`)
    })
  })

  // This plugin ships its own Settings page; hide the generated form.
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), `${name}: custom settings page`)
  })

  registerRoutes(ctx, auth, catalog, signal => tokens.current(signal))
}
