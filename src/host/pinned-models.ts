/** Invalid pin input, returned as HTTP 400 by the authenticated route. */
export class InvalidPinnedModelsError extends Error {}

/** Exact, case-sensitive, deduplicated ids; supported catalog membership is checked by the caller. */
export function validatePinnedModels(input: unknown): string[] {
  if (!Array.isArray(input) || !input.every(id => typeof id === 'string') || input.some(id => id.trim().length === 0)) {
    throw new InvalidPinnedModelsError('pinnedModels must be an array of non-empty strings')
  }
  return [...new Set(input)]
}

/** Stable partition: pin preference never replaces the live catalog's relative order. */
export function pinnedFirst<T extends { readonly id: string }>(models: readonly T[], pinnedIds: readonly string[]): T[] {
  const pinned = new Set(pinnedIds)
  return [...models.filter(model => pinned.has(model.id)), ...models.filter(model => !pinned.has(model.id))]
}
