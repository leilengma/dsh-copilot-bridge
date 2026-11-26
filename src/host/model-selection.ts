import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { PI_AI_PROVIDER } from '../shared/contract.ts'

/**
 * Harness 0.2.2-rc.5 materializes a static pi-ai catalog: its listModels never
 * reads the OAuth grant, so neither filtering availableModelIds nor deleting
 * the grant on sign-out removes UI entries. Gate its catalog on sign-in before
 * and after discovery, then apply hidden ids. There is no catalog middleware
 * hook in this version. Scope this
 * compatibility wrapper to the service lifetime; never change adapter routing.
 * Remove it when Harness offers an equivalent public catalog-filter seam.
 */
export function filterModelSelection(
  runtime: Pick<LlmRuntime, 'listModels'>,
  hidden: () => readonly string[],
  authenticated: () => Promise<boolean>,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(runtime, 'listModels')
  const original = runtime.listModels
  let active = true
  const filtered: typeof runtime.listModels = async function (this: Pick<LlmRuntime, 'listModels'>, provider) {
    if (active && provider === PI_AI_PROVIDER) {
      const signedIn = await authenticated()
      if (active && !signedIn) return []
    }
    const models = await original.call(this, provider)
    if (!active || provider !== PI_AI_PROVIDER) return models
    // Sign-out can complete while adapter discovery is in flight. Never publish
    // that stale result after the credential has been removed.
    const signedIn = await authenticated()
    if (!active) return models
    if (!signedIn) return []
    const excluded = new Set(hidden())
    return models.filter(model => !excluded.has(model.id))
  }
  // defineProperty reaches the service itself through Cordis' caller-context
  // proxy; assignment would create a shadow visible only to this plugin.
  Object.defineProperty(runtime, 'listModels', { configurable: true, writable: true, value: filtered })
  return () => {
    active = false
    // Do not remove a later contributor's wrapper. If it retained this one,
    // the inactive guard above makes ours a transparent pass-through.
    if (Object.getOwnPropertyDescriptor(runtime, 'listModels')?.value !== filtered) return
    if (descriptor === undefined) Reflect.deleteProperty(runtime, 'listModels')
    else Object.defineProperty(runtime, 'listModels', descriptor)
  }
}
