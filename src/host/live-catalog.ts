/**
 * Live Copilot model catalog: discovery (`GET <baseUrl>/models`), boundary
 * validation and projection into protocol-bound catalog entries (spec D8,
 * D9, D11, D12, D13). The raw payload is never kept, logged or exposed.
 */
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { ModelProtocol, ModelDisabledReason, CatalogState as ModelCatalogState } from '../shared/contract.ts'
import { githubFetch } from './transport.ts'
import { COPILOT_EDITOR_HEADERS, COPILOT_USER_AGENT } from './copilot-headers.ts'

export type CatalogProtocol = ModelProtocol
export type DisabledReason = ModelDisabledReason
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

/** Only locally constructed catalog diagnostics are safe to publish. */
class CatalogError extends Error {}

/** Validate a `/models` response and project it; malformed descriptors are skipped. */
export function projectCatalog(payload: unknown): readonly CatalogModel[] {
  const data = object(payload)?.data
  if (!Array.isArray(data)) throw new CatalogError('Copilot model catalog response is invalid')
  return data.flatMap(value => projectModel(value) ?? [])
}

/** Subset of the host-memory Copilot access token needed for discovery. */
export interface CatalogToken {
  readonly token: string
  readonly baseUrl: string
  readonly generation: number
}

export interface CatalogSnapshot {
  readonly generation: number
  readonly models: readonly CatalogModel[]
}

export type CatalogState =
  | { readonly status: Exclude<ModelCatalogState, 'error'> }
  | { readonly status: 'error'; readonly error: string }

export interface LiveCatalogDeps {
  readonly token: () => Promise<CatalogToken>
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>
  readonly logger: { warn(message: string): void }
  readonly timeoutMs?: number
}

export interface LiveCatalog {
  /** Start (or join) a discovery and resolve with its snapshot. */
  refresh(): Promise<CatalogSnapshot>
  /** Await in-flight discovery; trigger one while unknown; else the current snapshot. */
  ready(): Promise<CatalogSnapshot>
  /** Last good snapshot, or `undefined` while unknown. */
  snapshot(): CatalogSnapshot | undefined
  state(): CatalogState
  /** Sign-out / host switch: drop the snapshot and abort + discard in-flight discovery. */
  reset(): void
  onChange(listener: () => void): () => void
  dispose(): void
}

const COPILOT_HEADERS = {
  Accept: 'application/json',
  'user-agent': COPILOT_USER_AGENT,
  ...COPILOT_EDITOR_HEADERS,
  'X-GitHub-Api-Version': '2026-06-01',
} as const

const cancelled = () => new CatalogError('Copilot model discovery was cancelled')

function modelsUrl(baseUrl: string): string {
  let url: URL
  try {
    url = new URL(`${baseUrl.replace(/\/+$/, '')}/models`)
  } catch {
    throw new CatalogError('Copilot API base URL is invalid')
  }
  if (url.protocol !== 'https:') throw new CatalogError('Copilot API base URL must use HTTPS')
  return url.href
}

/** Single-flight, generation-tagged live catalog; no static fallback ever. */
export function createLiveCatalog(deps: LiveCatalogDeps): LiveCatalog {
  const fetch = deps.fetch ?? githubFetch
  const timeoutMs = deps.timeoutMs ?? 15_000
  const listeners = new Set<() => void>()
  let current: CatalogSnapshot | undefined
  let status: CatalogState = { status: 'loading' }
  let inFlight: { readonly promise: Promise<CatalogSnapshot>; readonly abort: AbortController } | undefined
  let epoch = 0
  let disposed = false

  const emit = () => {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch {
        deps.logger.warn('Copilot catalog listener failed')
      }
    }
  }

  async function discover(abort: AbortController, started: number): Promise<CatalogSnapshot> {
    const live = () => { if (started !== epoch) throw cancelled() }
    try {
      let access = await deps.token()
      for (;;) {
        live()
        const url = modelsUrl(access.baseUrl)
        const response = await fetch(url, {
          headers: { ...COPILOT_HEADERS, Authorization: `Bearer ${access.token}`, ...attributionHeaders() },
          redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]),
        })
        live()
        if (!response.ok) throw new CatalogError(`Copilot model discovery failed (HTTP ${response.status})`)
        const payload: unknown = await response.json().catch(() => undefined)
        live()
        const models = projectCatalog(payload)
        const latest = await deps.token()
        live()
        // A refresh may have joined this discovery while its old response was pending.
        if (latest.generation !== access.generation) { access = latest; continue }
        const snapshot: CatalogSnapshot = { generation: access.generation, models }
        current = snapshot
        status = { status: 'ready' }
        emit()
        return snapshot
      }
    } catch (error) {
      if (started !== epoch) throw cancelled()
      // A matching prefix does not make a foreign error safe: transports may echo credentials.
      const message = error instanceof CatalogError ? error.message : 'Copilot model discovery failed'
      deps.logger.warn(message)
      status = { status: 'error', error: message }
      emit()
      throw new Error(message)
    } finally {
      if (inFlight?.abort === abort) inFlight = undefined
    }
  }

  function refresh(): Promise<CatalogSnapshot> {
    if (disposed) return Promise.reject(new Error('Copilot model catalog is disposed'))
    if (inFlight) return inFlight.promise
    const abort = new AbortController()
    const previous = status
    status = { status: 'loading' }
    const promise = discover(abort, epoch)
    inFlight = { promise, abort }
    if (previous.status !== 'loading') emit()
    return promise
  }

  function reset(): void {
    epoch++
    inFlight?.abort.abort(cancelled())
    inFlight = undefined
    const changed = current !== undefined || status.status !== 'loading'
    current = undefined
    status = { status: 'loading' }
    if (changed) emit()
  }

  return {
    refresh,
    async ready() {
      const started = epoch
      if (!inFlight && current) return current
      try {
        const snapshot = await refresh()
        if (started !== epoch) throw cancelled()
        return snapshot
      } catch (error) {
        // A failed refresh is non-destructive only within the same account/host epoch.
        if (started !== epoch) throw cancelled()
        if (current) return current
        throw error
      }
    },
    snapshot: () => current,
    state: () => status,
    reset,
    onChange(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      listeners.clear()
      reset()
      disposed = true
    },
  }
}
