/**
 * dsh-copilot-bridge Host plugin.
 *
 * Runs the GitHub OAuth device flow against github.com or a GitHub Enterprise
 * host and writes the result as the grant record `llm-pi-ai` reads for its
 * built-in `github-copilot` provider. That route performs the Copilot token
 * exchange, discovers models, and serves every request.
 *
 * The enterprise host is a volatile config field: the Settings page writes it
 * into the profile's `cordis.patch.yml` through the settings service, and the
 * Loader updates it live without remounting the plugin.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// Type-only: augment `Context` with `credentials`, `settings`, `connection`, and `fiber.entry`.
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { PI_AI_PROVIDER, PI_AI_RECORD_KEY, PI_AI_RECORD_SCOPE } from '../shared/contract.ts'
import { createAuthController, type AuthController, type BridgeConfig } from './auth-controller.ts'
import { pollDeviceFlow, startDeviceFlow } from './device-flow.ts'
import { createCopilotUsage } from './copilot-usage.ts'
import { createCopilotMetadata } from './copilot-metadata.ts'
import { authRoutes } from './routes.ts'
import { filterModelSelection } from './model-selection.ts'
import { ensureCopilotProvider } from './provider-setup.ts'
import { grantToken } from './grant.ts'

export const name = 'copilot-bridge'

/** No hard inject: `credentials`, `settings`, and `connection` are optional and resolved when present. */
export const inject: string[] = []

export interface Config {
  /** GitHub Enterprise URL or host (e.g. `https://octocorp.ghe.com/`); blank means github.com. */
  enterpriseUrl: Volatile<string>
  hiddenModels: Volatile<string[]>
}

export const Config: z<Config> = z.object({
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

function registerRoutes(ctx: Context, auth: AuthController): void {
  const metadata = createCopilotMetadata({ credentials: () => ctx.get('credentials') })
  const usage = createCopilotUsage({ credentials: () => ctx.get('credentials') })
  // `connection.fetch` routes run only after the shared `/api` channel applied its
  // trust and authentication policy; `webServer.register` would be unauthenticated.
  ctx.inject(['connection'], connectionCtx => {
    connectionCtx.effect(() => {
      const { fetch } = connectionCtx.connection
      const disposers = authRoutes(auth, () => ctx.get('llm'), metadata, usage).map(route => fetch.register(route))
      return async () => {
        for (const dispose of disposers.reverse()) await dispose()
      }
    }, `${name}: Web sign-in routes`)
  })
}

export function apply(ctx: Context, config: Config): void {
  let providerModelIds: (() => Promise<readonly string[]>) | undefined
  const auth = createAuthController({
    credentials: () => ctx.get('credentials'),
    config: bridgeConfig(ctx, config),
    providerModelIds: async () => providerModelIds?.(),
    ensureProvider: () => ensureCopilotProvider({
      settings: () => ctx.get('settings'),
      llm: () => ctx.get('llm'),
      async refresh() {
        const llm = ctx.get('llm')
        if (llm === undefined) throw new Error('the LLM service is unavailable')
        await llm.listModels(PI_AI_PROVIDER)
        await ctx.parallel('llm/models-updated', PI_AI_PROVIDER)
      },
    }),
    startDeviceFlow,
    pollDeviceFlow,
    logger: {
      info: message => ctx.logger.info(`${name}: ${message}`),
      warn: message => ctx.logger.warn(`${name}: ${message}`),
      error: error => ctx.logger.error(error),
    },
  })
  ctx.effect(() => () => auth.dispose(), `${name}: stop device-flow polling`)
  const syncModels = () => { void auth.syncModels().catch(error => ctx.logger.warn(`${name}: model filtering failed: ${errorMessage(error)}`)) }
  ctx.on('credentials/record-updated', key => { if (key === PI_AI_RECORD_KEY) syncModels() })
  ctx.on('loader/volatile-update', paths => { if (paths.some(path => path[0] === 'hiddenModels')) syncModels() })
  ctx.inject(['credentials'], () => { syncModels() })
  ctx.inject(['llm'], llmCtx => {
    const notify = () => {
      void llmCtx.parallel('llm/models-updated', PI_AI_PROVIDER)
        .catch(error => ctx.logger.warn(`${name}: model selection refresh failed: ${errorMessage(error)}`))
    }
    llmCtx.effect(() => {
      // A fresh grant has no account model ids. Keep a full provider catalog
      // reader for management; going through our picker filter loses hidden rows.
      const runtime = llmCtx.llm
      const original = runtime.listModels
      const fullCatalog = async () => (await original.call(runtime, PI_AI_PROVIDER)).map(model => model.id)
      providerModelIds = fullCatalog
      const dispose = filterModelSelection(runtime, () => config.hiddenModels.get() ?? [], async () => {
        const record = await llmCtx.get('credentials')?.readRecord(credentialKey(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER))
        return grantToken(record) !== undefined
      })
      return () => {
        if (providerModelIds === fullCatalog) providerModelIds = undefined
        dispose()
        notify()
      }
    }, `${name}: model selection filter`)
    notify()
    // Loader targets only the entry fiber, not this injected child's fiber.
    // Register on the entry context but clean up when the LLM service unloads.
    llmCtx.effect(() => ctx.on('loader/volatile-update', paths => {
      if (paths.some(path => path[0] === 'hiddenModels')) notify()
    }), `${name}: model selection config updates`)
    // The adapter's static catalog does not change on logout. Explicitly
    // invalidate cached pickers when the grant changes, even with no hidden ids.
    llmCtx.effect(() => ctx.on('credentials/record-updated', key => {
      if (key === PI_AI_RECORD_KEY) notify()
    }), `${name}: model selection credential updates`)
    llmCtx.inject(['credentials'], credentialsCtx => {
      notify()
      credentialsCtx.effect(() => () => notify(), `${name}: model selection credentials lifetime`)
    })
  })

  // This plugin ships its own Settings page; hide the generated form.
  ctx.inject(['settings'], settingsCtx => {
    settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), `${name}: custom settings page`)
  })

  registerRoutes(ctx, auth)
}
