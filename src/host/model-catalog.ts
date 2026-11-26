import type { CopilotMetadata } from './copilot-metadata.ts'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { PI_AI_PROVIDER, type AuthStatus, type CopilotModel, type ModelCatalog } from '../shared/contract.ts'

/** Resolve display metadata by exact id, never from the visibility-filtered picker list. */
export async function modelCatalog(
  status: AuthStatus, runtime?: Pick<LlmRuntime, 'resolveModelInfo'>,
  metadata?: () => Promise<ReadonlyMap<string, CopilotMetadata>>,
): Promise<ModelCatalog> {
  const live = status.authenticated && status.availableModels?.length ? await metadata?.() : undefined
  const models = await Promise.all((status.authenticated ? status.availableModels ?? [] : []).map(async (id): Promise<CopilotModel> => {
    if (runtime !== undefined) {
      try {
        const info = await runtime.resolveModelInfo(PI_AI_PROVIDER, id)
        return {
          ...live?.get(id), id, name: info.name,
          ...info.context === undefined ? {} : { contextWindow: info.context.contextWindow },
          ...info.inputModalities === undefined ? {} : { inputModalities: info.inputModalities },
        }
      } catch {
        // Account discovery can precede the adapter's catalog, or LLM may be unavailable.
        // Keep the row restorable even when its optional display metadata is unknown.
      }
    }
    return { ...live?.get(id), id, name: id }
  }))
  return { status, models, state: 'ready' }
}
