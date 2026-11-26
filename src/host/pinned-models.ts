/** Invalid pin input, returned as HTTP 400 by the authenticated route. */
export class InvalidPinnedModelsError extends Error {}

/** Exact, case-sensitive, deduplicated ids; supported catalog membership is checked by the caller. */
export function validatePinnedModels(input: unknown): string[] {
  if (!Array.isArray(input) || !input.every(id => typeof id === 'string') || input.some(id => id.trim().length === 0)) {
    throw new InvalidPinnedModelsError('pinnedModels must be an array of non-empty strings')
  }
  return [...new Set(input)]
}
