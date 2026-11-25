import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { PI_AI_PROVIDER, PI_AI_RECORD_SCOPE } from '../shared/contract.ts'
import type { BridgeConfig, CredentialStore } from './auth-controller.ts'
import { grantModelIds, grantToken } from './grant.ts'

/** Invalid user input, returned as HTTP 400 by the authenticated route. */
export class InvalidHiddenModelsError extends Error {}

export function validateHiddenModels(input: unknown): string[] {
  if (!isIds(input) || input.some(id => id.trim().length === 0)) {
    throw new InvalidHiddenModelsError('hiddenModels must be an array of non-empty strings')
  }
  return [...new Set(input)]
}

const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string')
const sameIds = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every(id => right.has(id))
}

/** Recover the account catalog from our own write; a different list belongs to pi-ai. */
export function fullModelIds(record: CredentialRecord | undefined): readonly string[] | undefined {
  const ids = grantModelIds(record)
  if (ids === undefined || record?.kind !== 'grant') return undefined
  const bridge = (record.payload as Record<string, unknown>).copilotBridge
  if (typeof bridge === 'object' && bridge !== null && 'allModelIds' in bridge && 'filteredModelIds' in bridge
    && isIds(bridge.allModelIds) && isIds(bridge.filteredModelIds) && sameIds(ids, bridge.filteredModelIds)) {
    return bridge.allModelIds
  }
  return ids
}

/** One serialized reconciliation, coalescing credential/config notifications (including our own). */
export function createModelFilter(credentials: () => CredentialStore | undefined, config: BridgeConfig, warn: (message: string) => void) {
  let inFlight: Promise<void> | undefined
  let rerun = false
  let disposed = false
  const reconcile = async (): Promise<void> => {
    const store = credentials()
    if (store === undefined) return
    await store.modifyRecord(credentialKey(PI_AI_RECORD_SCOPE, PI_AI_PROVIDER), async record => {
      if (disposed || grantToken(record) === undefined || record?.kind !== 'grant') return undefined
      const full = fullModelIds(record)
      if (full === undefined) return undefined
      const hidden = config.readHidden()
      const kept = [...new Set(hidden)].filter(id => full.includes(id))
      if (config.writable() && (!sameIds(kept, hidden) || kept.length !== hidden.length)) {
        try {
          await config.writeHidden(kept.length === 0 ? undefined : kept)
        } catch (error) {
          // Stale YAML must not disable filtering, status, or sign-out. Retry next run.
          warn(`Could not prune hidden models: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const filtered = full.filter(id => !kept.includes(id))
      const payload = record.payload as Record<string, unknown>
      const bridge = payload.copilotBridge as { allModelIds?: unknown; filteredModelIds?: unknown } | undefined
      if (sameIds(grantModelIds(record) ?? [], filtered) && bridge !== undefined && bridge !== null
        && isIds(bridge.allModelIds) && sameIds(bridge.allModelIds, full)
        && isIds(bridge.filteredModelIds) && sameIds(bridge.filteredModelIds, filtered)) return undefined
      return { ...record, payload: { ...payload, availableModelIds: filtered, copilotBridge: { allModelIds: full, filteredModelIds: filtered } } }
    })
  }
  return {
    synchronize(): Promise<void> {
      if (disposed) return Promise.resolve()
      rerun = true
      inFlight ??= Promise.resolve().then(async () => {
        while (rerun && !disposed) {
          rerun = false
          await reconcile()
        }
      }).finally(() => { inFlight = undefined })
      return inFlight
    },
    dispose() { disposed = true },
  }
}
