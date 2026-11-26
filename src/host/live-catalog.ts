/**
 * Live Copilot model catalog: discovery (`GET <baseUrl>/models`), boundary
 * validation and projection into protocol-bound catalog entries (spec D8,
 * D9, D11, D12, D13). The raw payload is never kept, logged or exposed.
 */

export type CatalogProtocol = 'anthropic-messages' | 'openai-responses' | 'openai-completions'
export type DisabledReason = 'unsupported-protocol' | 'not-offered'
export type CatalogInput = 'text' | 'image'

interface CatalogModelBase {
  readonly id: string
  readonly name: string
  readonly input: readonly CatalogInput[]
  readonly contextWindow?: number
  readonly maxOutputTokens?: number
  /** Exactly the efforts the model advertises; empty when none. */
  readonly reasoningEfforts: readonly string[]
}

export interface SupportedCatalogModel extends CatalogModelBase {
  readonly supported: true
  readonly protocol: CatalogProtocol
  readonly disabledReason?: never
}

export interface DisabledCatalogModel extends CatalogModelBase {
  readonly supported: false
  readonly disabledReason: DisabledReason
  readonly protocol?: CatalogProtocol
}

export type CatalogModel = SupportedCatalogModel | DisabledCatalogModel

/** Endpoint preference order (D8): first match wins, never inferred from names. */
const PROTOCOLS: readonly (readonly [string, CatalogProtocol])[] = [
  ['/v1/messages', 'anthropic-messages'],
  ['/responses', 'openai-responses'],
  ['/chat/completions', 'openai-completions'],
]

const object = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined
const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is string => text(item) !== undefined))] : []

function projectModel(value: unknown): CatalogModel | undefined {
  const row = object(value)
  const id = text(row?.id)
  const capabilities = object(row?.capabilities)
  const endpoints = strings(row?.supported_endpoints)
  if (row === undefined || id === undefined || capabilities?.type !== 'chat' || endpoints.length === 0) return undefined
  const supports = object(capabilities.supports)
  const limits = object(capabilities.limits)
  const contextWindow = count(limits?.max_context_window_tokens) ?? count(limits?.max_prompt_tokens)
  const maxOutputTokens = count(limits?.max_output_tokens)
  const base: CatalogModelBase = {
    id, name: text(row.name) ?? id,
    input: supports?.vision === true ? ['text', 'image'] : ['text'],
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxOutputTokens === undefined ? {} : { maxOutputTokens },
    reasoningEfforts: strings(supports?.reasoning_effort),
  }
  const protocol = PROTOCOLS.find(([endpoint]) => endpoints.includes(endpoint))?.[1]
  if (protocol === undefined) return { ...base, supported: false, disabledReason: 'unsupported-protocol' }
  if (row.model_picker_enabled === false) return { ...base, supported: false, disabledReason: 'not-offered', protocol }
  return { ...base, supported: true, protocol }
}

/** Validate a `/models` response and project it; malformed descriptors are skipped. */
export function projectCatalog(payload: unknown): readonly CatalogModel[] {
  const data = object(payload)?.data
  if (!Array.isArray(data)) throw new Error('Copilot model catalog response is invalid')
  return data.flatMap(value => projectModel(value) ?? [])
}
