/** Invalid user input, returned as HTTP 400 by the authenticated route. */
export class InvalidHiddenModelsError extends Error {}

/** Exact, case-sensitive, deduplicated ids; catalog membership is checked by the caller. */
export function validateHiddenModels(input: unknown): string[] {
  if (!Array.isArray(input) || !input.every(id => typeof id === 'string') || input.some(id => id.trim().length === 0)) {
    throw new InvalidHiddenModelsError('hiddenModels must be an array of non-empty strings')
  }
  return [...new Set(input)]
}
