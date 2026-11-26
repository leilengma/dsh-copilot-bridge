import type { CopilotMetadata } from './copilot-metadata.ts'
import type { LiveCatalog } from './live-catalog.ts'
import type { AuthStatus, CopilotModel, ModelCatalog } from '../shared/contract.ts'

/** Management rows come from the same snapshot as the picker, including disabled and hidden models. */
export async function modelCatalog(
  status: AuthStatus, catalog?: Pick<LiveCatalog, 'snapshot' | 'state'>,
  metadata?: () => Promise<ReadonlyMap<string, CopilotMetadata>>,
): Promise<ModelCatalog> {
  const snapshot = catalog?.snapshot()
  const display = status.authenticated && snapshot?.models.length ? await metadata?.() : undefined
  const models: CopilotModel[] = status.authenticated && snapshot === catalog?.snapshot()
    ? (snapshot?.models ?? []).map(model => ({
      ...display?.get(model.id), id: model.id, name: model.name,
      ...model.protocol === undefined ? {} : { protocol: model.protocol },
      ...model.disabledReason === undefined ? {} : { disabledReason: model.disabledReason },
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      inputModalities: model.input,
    })) : []
  const state = status.authenticated ? catalog?.state() ?? { status: 'loading' as const } : { status: 'ready' as const }
  return { status, models, state: state.status, ...state.status === 'error' ? { error: state.error } : {} }
}
