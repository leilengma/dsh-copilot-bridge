import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import { PI_AI_PROVIDER } from '../shared/contract.ts'

/** Only the redacted snapshot and path-addressed write are needed here. */
interface ProviderSettings extends Pick<SettingsForms, 'writable' | 'mutate'> {
  describe(options: { redactSecrets: true }): readonly { ns: string; value: unknown; revision: number }[]
}

export interface ProviderSetupDeps {
  settings(): ProviderSettings | undefined
  llm(): Pick<LlmRuntime, 'listProviders' | 'listConfigurableProviders'> | undefined
  refresh(): Promise<void>
}

function hasPath(value: unknown, path: readonly string[]): boolean {
  for (const key of path) {
    if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return false
    value = Reflect.get(value, key)
  }
  return true
}

/** Materialize a native profile exactly as Settings → Models does with a blank key. */
export async function ensureCopilotProvider(deps: ProviderSetupDeps): Promise<void> {
  const llm = deps.llm()
  if (llm === undefined) throw new Error('the LLM service is unavailable')
  if (llm.listProviders().some(provider => provider.id === PI_AI_PROVIDER)) {
    await deps.refresh()
    return
  }
  const entry = llm.listConfigurableProviders().find(provider => provider.provider === PI_AI_PROVIDER)
  if (entry === undefined) throw new Error('the built-in GitHub Copilot provider is unavailable')
  const settings = deps.settings()
  if (settings === undefined) throw new Error('the settings service is unavailable')
  const namespace = settings.describe({ redactSecrets: true }).find(view => view.ns === entry.settingsNs)
  if (namespace === undefined) throw new Error('the GitHub Copilot settings namespace is unavailable')
  if (!hasPath(namespace.value, entry.settingsPath)) {
    if (!settings.writable) throw new Error('provider settings are read-only')
    // Never replace a complete section or overwrite a profile created by a concurrent editor.
    await settings.mutate(entry.settingsNs, [{ op: 'set', path: entry.settingsPath, value: {} }], namespace.revision)
  }
  await deps.refresh()
}
