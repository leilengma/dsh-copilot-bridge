/**
 * `copilot-bridge` LLM adapter (spec D1, D6, D7, D12, D13, §6.1–§6.3).
 *
 * Serves the live Copilot catalog to Harness and streams through the public
 * pi-ai transports. The pi-ai model object carries `provider: 'github-copilot'`
 * so pi-ai applies Copilot Bearer auth and dynamic Copilot headers; Harness
 * only ever sees the route `copilot-bridge`. A prepared call binds the model
 * definition, base URL, token and transport of one generation.
 */
import {
  attributionHeaders, fileHandleText, LlmAdapter, LlmError, offloadedImageText, ReasoningEffortId, textOnlyImageText, ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, FinishReason, GenerateOptions, ImageBlock, LlmFailure, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo,
  PreparedAdapterCall, RequestMessage, StreamChunk, TokenUsage, ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type {
  AssistantMessage as PiAssistantMessage, AssistantMessageEvent, ImageContent, Message as PiMessage, Model, SimpleStreamOptions,
  TextContent, ThinkingLevel, Tool, ToolCall, TranscriptContext, Usage,
} from '@earendil-works/pi-ai'
import { stream as anthropicMessages, streamSimple as anthropicMessagesSimple } from '@earendil-works/pi-ai/api/anthropic-messages'
import { streamSimple as openaiCompletions } from '@earendil-works/pi-ai/api/openai-completions'
import { streamSimple as openaiResponses } from '@earendil-works/pi-ai/api/openai-responses'
import { AccessTokenError, type AccessToken, type AccessTokens } from './access-token.ts'
import type { CatalogProtocol, LiveCatalog, SupportedCatalogModel } from './live-catalog.ts'
import { pinnedFirst } from './pinned-models.ts'

export const BRIDGE_PROVIDER = 'copilot-bridge'
export const BRIDGE_PROVIDER_NAME = 'GitHub Copilot Bridge'

/** One public pi-ai transport per protocol, accepting the shared simple options. */
export type BridgeTransport = (
  model: Model<CatalogProtocol>, context: TranscriptContext, options: SimpleStreamOptions,
) => AsyncIterable<AssistantMessageEvent>

export type ImageAttachment = ImageBlock['attachment']

export interface BridgeAdapterDeps {
  readonly catalog: Pick<LiveCatalog, 'ready'>
  readonly tokens: Pick<AccessTokens, 'current' | 'invalidate'>
  /** Exact, case-sensitive hidden model IDs (advisory: hidden models still resolve). */
  readonly hidden: () => readonly string[]
  /** Stable pinned-first list order only; pinning does not affect visibility or resolution. */
  readonly pinned?: () => readonly string[]
  readonly transports?: Partial<Record<CatalogProtocol, BridgeTransport>>
  /** Passed to pi-ai for every provider request. */
  readonly fetch?: typeof globalThis.fetch
  /** Load image bytes for a vision request; without it image blocks are rejected. */
  readonly loadImage?: ((ref: ImageAttachment, signal?: AbortSignal) => Promise<{ readonly data: string; readonly mimeType: string }>) | undefined
}

const DEFAULT_TRANSPORTS: Record<CatalogProtocol, BridgeTransport> = {
  'anthropic-messages': (model, context, options) => {
    const anthropicModel = model as Model<'anthropic-messages'>
    // streamSimple unconditionally sends disabled when reasoning is absent.
    // Always-on models need stream's explicit adaptive switch, without an invented effort.
    return options.reasoning === undefined && ANTHROPIC_THINKING_POLICY[model.id] === 'always-adaptive'
      ? anthropicMessages(anthropicModel, context, { ...options, thinkingEnabled: true })
      : anthropicMessagesSimple(anthropicModel, context, options)
  },
  'openai-responses': openaiResponses as BridgeTransport,
  'openai-completions': openaiCompletions as BridgeTransport,
}

/** Static editor headers Copilot expects; pi-ai adds the dynamic ones (D7). */
const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
}
/** pi-ai thinking levels in ascending order; advertised efforts outside this set are dropped (D12). */
const THINKING_LEVELS: readonly ThinkingLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']
/** Request ceiling when Copilot does not advertise `max_output_tokens`. */
const FALLBACK_MAX_TOKENS = 16_384
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/** Exact Copilot IDs, not protocol inference. Sources and default policy: README §Thinking compatibility. */
const ANTHROPIC_THINKING_POLICY: Readonly<Record<string, 'adaptive' | 'always-adaptive'>> = {
  'claude-fable-5': 'always-adaptive',
  'claude-fable-5.1': 'always-adaptive',
  'claude-haiku-5.5': 'adaptive',
  'claude-opus-4.7': 'adaptive',
  'claude-opus-4.8': 'adaptive',
  'claude-opus-5': 'adaptive',
  'claude-opus-5.5': 'always-adaptive',
  'claude-sonnet-4.6': 'adaptive',
  'claude-sonnet-5': 'adaptive',
  'claude-sonnet-5.5': 'always-adaptive',
}

interface BoundCall {
  readonly model: SupportedCatalogModel
  readonly token: AccessToken
  readonly transport: BridgeTransport
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const aborted = () => new LlmError('Copilot request aborted by caller', 'ABORTED')

/** Cancel only this caller's wait, never the catalog's shared discovery. */
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(aborted())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(aborted()) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value) }, error => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

/** Advertised efforts that pi-ai understands, in pi-ai order (never invented). */
export function supportedEfforts(model: Pick<SupportedCatalogModel, 'reasoningEfforts'>): readonly ThinkingLevel[] {
  return THINKING_LEVELS.filter(level => model.reasoningEfforts.includes(level))
}

function modelInfo(model: SupportedCatalogModel, vision: boolean): LlmModelInfo {
  return { provider: BRIDGE_PROVIDER, id: model.id, name: model.name, inputModalities: model.input.filter(input => input !== 'image' || vision) }
}

function resolvedInfo(model: SupportedCatalogModel, vision: boolean): LlmResolvedModelInfo {
  const efforts = supportedEfforts(model)
  return {
    ...modelInfo(model, vision),
    ...model.contextWindow === undefined ? {} : { context: { contextWindow: model.contextWindow } },
    ...efforts.length === 0 ? {} : {
      reasoning: { efforts: efforts.map(level => ({ id: ReasoningEffortId(level), name: capitalize(level) })) },
    },
  }
}

function piModel(model: SupportedCatalogModel, baseUrl: string): Model<CatalogProtocol> {
  const efforts = supportedEfforts(model)
  const thinking = model.protocol === 'anthropic-messages' && Object.hasOwn(ANTHROPIC_THINKING_POLICY, model.id)
    ? ANTHROPIC_THINKING_POLICY[model.id] : undefined
  return {
    id: model.id,
    name: model.name,
    api: model.protocol,
    provider: 'github-copilot',
    baseUrl,
    input: [...model.input],
    cost: ZERO_COST,
    headers: { ...COPILOT_HEADERS },
    reasoning: efforts.length > 0 || thinking === 'always-adaptive',
    ...thinking === undefined ? {} : { compat: { forceAdaptiveThinking: true } },
    // Unadvertised levels map to `null` so pi-ai never clamps onto an invented level.
    thinkingLevelMap: Object.fromEntries(THINKING_LEVELS.map(level => [level, efforts.includes(level) ? level : null])),
    contextWindow: model.contextWindow ?? 0,
    maxTokens: model.maxOutputTokens ?? FALLBACK_MAX_TOKENS,
  } as Model<CatalogProtocol>
}

function tokenError(error: unknown): LlmError {
  if (error instanceof AccessTokenError) {
    return error.reason === 'signed-out'
      ? new LlmError('Sign in to GitHub Copilot to use this model', 'MISSING_CREDENTIAL')
      : new LlmError(error.message, 'AUTH', { cause: error })
  }
  return new LlmError('Copilot access token is unavailable', 'AUTH')
}

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST, total: 0 } })

function mapUsage(usage: Usage): TokenUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
    ...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {},
  }
}

/** Classify a pi-ai terminal error; the HTTP status (when observed) wins over message text. */
function failureOf(message: string, status: number | undefined, aborted: boolean): LlmFailure {
  const code = aborted ? 'ABORTED' : classify(message, status)
  const leading = /^\D{0,40}?\b([45]\d\d)\b/.exec(message)
  const httpStatus = status !== undefined && status >= 400 ? status : leading ? Number(leading[1]) : undefined
  return { message: message || 'Copilot request failed', code, ...httpStatus === undefined ? {} : { status: httpStatus } }
}

function classify(message: string, status: number | undefined): string {
  const text = message.toLowerCase()
  const code = status !== undefined && status >= 400 ? status : Number(/^\D{0,40}?\b([45]\d\d)\b/.exec(message)?.[1] ?? 0)
  if (/context[\s_-](length|window)|too (long|large) for/.test(text)) return 'CONTEXT_WINDOW_EXCEEDED'
  if (code === 401 || code === 403) return 'AUTH'
  if (/insufficient[\s_-]+quota|quota[\s_-]+exceeded/.test(text)) return 'QUOTA'
  if (code === 429 || text.includes('rate limit')) return 'RATE_LIMIT'
  if (code === 400 || code === 413 || code === 422) return 'INVALID_REQUEST'
  if (code >= 500) return 'SERVER'
  if (text.includes('timeout') || text.includes('timed out')) return 'TIMEOUT'
  if (/stream ended|network|socket|terminated|econnreset|fetch failed/.test(text)) return 'TRANSPORT'
  return 'PI_AI_ERROR'
}

function isUnauthorized(status: number | undefined, message: string | undefined): boolean {
  return status === 401 || (status === undefined && /^\D{0,40}?\b401\b/.test(message ?? ''))
}

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** pi-ai assistant message captured in our own `finish.replayState`, if it fits this model. */
function replayed(source: unknown, model: SupportedCatalogModel): PiAssistantMessage | undefined {
  const replay = (source as { replayState?: { response?: unknown } } | undefined)?.replayState?.response
  if (typeof replay !== 'object' || replay === null) return undefined
  const message = replay as Partial<PiAssistantMessage>
  return message.role === 'assistant' && message.provider === 'github-copilot' && message.api === model.protocol
    && message.model === model.id && Array.isArray(message.content) ? message as PiAssistantMessage : undefined
}

const textOf = (content: readonly ContentBlock[]) =>
  content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')

function toTool(tool: ToolSchema): Tool {
  return { name: tool.name, description: tool.description, parameters: tool.parameters } as Tool
}

async function toContext(options: GenerateOptions, model: SupportedCatalogModel, deps: BridgeAdapterDeps): Promise<TranscriptContext> {
  const vision = model.input.includes('image')
  const toolNames = new Map<string, string>()
  const system: string[] = options.system ? [options.system] : []
  const messages: PiMessage[] = []
  let leading = true

  async function parts(content: readonly ContentBlock[]): Promise<(TextContent | ImageContent)[]> {
    const result: (TextContent | ImageContent)[] = []
    for (const block of content) {
      if (block.type === 'text') result.push({ type: 'text', text: block.text })
      else if (block.type === 'file') result.push({ type: 'text', text: fileHandleText(block.attachment, undefined) })
      else if (block.type === 'image') {
        if (block.offloaded) result.push({ type: 'text', text: offloadedImageText(block.attachment) })
        else if (!vision) result.push({ type: 'text', text: textOnlyImageText(block.attachment) })
        else {
          const loadImage = deps.loadImage
          if (!loadImage) throw new LlmError('Image input is not available for this route', 'UNSUPPORTED_CONTENT')
          const image = await loadImage(block.attachment, options.signal)
          result.push({ type: 'image', data: image.data, mimeType: image.mimeType })
        }
      }
    }
    return result
  }

  for (const message of options.messages as readonly RequestMessage[]) {
    const timestamp = Date.now()
    if (message.role === 'system' || message.role === 'developer') {
      const text = textOf(message.content)
      if (leading && message.role === 'system') {
        if (text) system.push(text)
      } else if (text) messages.push({ role: 'system', content: text, timestamp })
      continue
    }
    leading = false
    if (message.role === 'user') {
      messages.push({ role: 'user', content: await parts(message.content), timestamp })
    } else if (message.role === 'assistant') {
      for (const block of message.content) if (block.type === 'tool-call') toolNames.set(block.id, block.name)
      const replay = replayed(message.source, model)
      if (replay) {
        messages.push(replay)
        continue
      }
      const content = message.content.flatMap((block): (TextContent | ToolCall)[] =>
        block.type === 'text' ? [{ type: 'text', text: block.text }]
          : block.type === 'tool-call' ? [{ type: 'toolCall', id: block.id, name: block.name, arguments: parseArguments(block.arguments) } as ToolCall]
            : [])
      messages.push({
        role: 'assistant', content, api: model.protocol, provider: 'github-copilot', model: model.id, usage: emptyUsage(),
        stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop', timestamp,
      } as PiAssistantMessage)
    } else if (message.role === 'tool') {
      messages.push({
        role: 'toolResult', toolCallId: message.toolCallId, toolName: toolNames.get(message.toolCallId) ?? '',
        content: await parts(message.content), isError: message.isError === true, timestamp,
      })
    }
  }
  const tools = (options.tools ?? []).map(toTool)
  const prompt = system.join('\n\n')
  const head: PiMessage[] = prompt || tools.length > 0
    ? [{ role: 'system', content: prompt, ...tools.length > 0 ? { toolsAdded: tools } : {}, timestamp: 0 }]
    : []
  return { messages: [...head, ...messages] } as unknown as TranscriptContext
}

/** Maps one pi-ai event stream onto Harness chunks by `contentIndex`. */
class ChunkMapper {
  private readonly toolIds = new Map<number, ToolCallId>()
  private blocks = 0
  private malformedTool = false

  map(event: AssistantMessageEvent, aborted: () => boolean, status: () => number | undefined): StreamChunk[] {
    switch (event.type) {
      case 'text_start': return [{ type: 'block-start', index: event.contentIndex, blockType: 'text' }]
      case 'text_delta': return [{ type: 'text-delta', index: event.contentIndex, text: event.delta }]
      case 'text_end':
        this.blocks++
        return [{ type: 'block-end', index: event.contentIndex, block: { type: 'text', text: event.content } }]
      case 'thinking_start': return [{ type: 'block-start', index: event.contentIndex, blockType: 'reasoning' }]
      case 'thinking_delta': return [{ type: 'reasoning-delta', index: event.contentIndex, text: event.delta }]
      case 'thinking_end':
        this.blocks++
        return [{ type: 'block-end', index: event.contentIndex, block: { type: 'reasoning', text: event.content } }]
      case 'toolcall_start': {
        const call = event.partial.content[event.contentIndex]
        const id = ToolCallId(call?.type === 'toolCall' ? call.id : `call_${event.contentIndex}`)
        this.toolIds.set(event.contentIndex, id)
        return [{ type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }]
      }
      case 'toolcall_delta': {
        const call = event.partial.content[event.contentIndex]
        const id = this.toolIds.get(event.contentIndex) ?? ToolCallId(call?.type === 'toolCall' ? call.id : `call_${event.contentIndex}`)
        return [{
          type: 'tool-call-delta', index: event.contentIndex, id,
          ...call?.type === 'toolCall' && call.name ? { name: call.name } : {}, argumentsDelta: event.delta,
        }]
      }
      case 'toolcall_end':
        if (event.toolCall.argumentsError) { this.malformedTool = true; return [] }
        this.blocks++
        return [{
          type: 'block-end', index: event.contentIndex,
          block: { type: 'tool-call', id: ToolCallId(event.toolCall.id), name: event.toolCall.name, arguments: JSON.stringify(event.toolCall.arguments) },
        }]
      case 'done': return [{ type: 'usage', usage: mapUsage(event.message.usage) }, { type: 'finish', ...this.finish(event.message) }]
      case 'error': {
        const failure = failureOf(event.error.errorMessage ?? '', status(), event.reason === 'aborted' || aborted())
        const reason: FinishReason = failure.code === 'ABORTED' ? { kind: 'aborted', failure } : { kind: 'error', failure }
        return [{ type: 'usage', usage: mapUsage(event.error.usage ?? emptyUsage()) }, { type: 'finish', reason }]
      }
      default: return []
    }
  }

  private finish(message: PiAssistantMessage): { reason: FinishReason; replayState?: { response: unknown } } {
    if (message.stopReason === 'length') return { reason: { kind: 'max-tokens' }, replayState: { response: message } }
    if (this.malformedTool) {
      return { reason: { kind: 'error', failure: { message: 'Copilot returned malformed tool arguments', code: 'MALFORMED_RESPONSE' } } }
    }
    if (message.stopReason === 'toolUse') return { reason: { kind: 'tool-calls' }, replayState: { response: message } }
    if (this.blocks === 0) {
      return { reason: { kind: 'error', failure: { message: 'Copilot returned an empty response', code: 'EMPTY_RESPONSE' } } }
    }
    return { reason: { kind: 'stop' }, replayState: { response: message } }
  }
}

export class BridgeAdapter extends LlmAdapter {
  private readonly deps: BridgeAdapterDeps
  private readonly transports: Record<CatalogProtocol, BridgeTransport>

  constructor(deps: BridgeAdapterDeps) {
    super()
    this.deps = deps
    this.transports = { ...DEFAULT_TRANSPORTS, ...deps.transports }
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: BRIDGE_PROVIDER_NAME }
  }

  /** Visible models: supported − hidden; disabled models never appear. Empty while signed out or undiscovered. */
  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    let snapshot
    try {
      snapshot = await this.deps.catalog.ready()
    } catch {
      return []
    }
    const hidden = new Set(this.deps.hidden())
    return pinnedFirst(snapshot.models, this.deps.pinned?.() ?? [])
      .flatMap(model => model.supported && !hidden.has(model.id) ? [modelInfo(model, this.deps.loadImage !== undefined)] : [])
  }

  override async resolveModel(_provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return resolvedInfo((await this.supported(model, signal)).model, this.deps.loadImage !== undefined)
  }

  override async prepareCall(_provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const selected = await this.supported(model, signal)
    const definition = selected.model
    if (signal?.aborted) throw aborted()
    let token: AccessToken
    try {
      token = await this.deps.tokens.current(signal)
    } catch (error) {
      if (signal?.aborted) throw new LlmError('Copilot request aborted by caller', 'ABORTED')
      throw tokenError(error)
    }
    if (selected.generation !== token.generation) {
      throw new LlmError('Copilot model catalog changed during preparation; retry the request', 'DISCOVERY_FAILED')
    }
    const bound: BoundCall = { model: definition, token, transport: this.transports[definition.protocol] }
    return { model: resolvedInfo(definition, this.deps.loadImage !== undefined), stream: options => this.run(options, bound) }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const prepared = await this.prepareCall(options.provider, options.model, options.signal)
    yield* prepared.stream(options)
  }

  private async supported(id: string, signal?: AbortSignal): Promise<{ model: SupportedCatalogModel; generation: number }> {
    if (signal?.aborted) throw aborted()
    let snapshot
    try {
      snapshot = await waitFor(this.deps.catalog.ready(), signal)
    } catch (error) {
      if (signal?.aborted) throw aborted()
      throw new LlmError('Copilot model catalog is unavailable', 'DISCOVERY_FAILED', { cause: error })
    }
    const model = snapshot.models.find(entry => entry.id === id)
    if (!model?.supported) throw new LlmError(`GitHub Copilot Bridge has no model "${id}"`, 'UNKNOWN_MODEL')
    return { model, generation: snapshot.generation }
  }

  private reasoning(options: GenerateOptions, model: SupportedCatalogModel): ThinkingLevel | undefined {
    if (options.reasoningEffort === undefined) return undefined
    const level = supportedEfforts(model).find(entry => entry === String(options.reasoningEffort))
    if (level === undefined) {
      throw new LlmError(`Model "${model.id}" does not support reasoning effort "${options.reasoningEffort}"`, 'UNSUPPORTED_REASONING_EFFORT')
    }
    return level
  }

  private async *run(options: GenerateOptions, bound: BoundCall): AsyncGenerator<StreamChunk> {
    options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, bound.token.signal]) : bound.token.signal }
    if (options.signal?.aborted) throw aborted()
    if (options.stop?.length) throw new LlmError('GitHub Copilot Bridge does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    const reasoning = this.reasoning(options, bound.model)
    const context = await waitFor(toContext(options, bound.model, this.deps), options.signal)
    const baseFetch = this.deps.fetch ?? globalThis.fetch
    let token = bound.token
    for (let attempt = 0; ; attempt++) {
      let status: number | undefined
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const response = await baseFetch(input, { ...init, redirect: 'error' })
        status = response.status
        return response
      }
      const consumer = new AbortController()
      const signal = options.signal ? AbortSignal.any([options.signal, consumer.signal]) : consumer.signal
      const mapper = new ChunkMapper()
      let emitted = false
      let retry = false
      try {
        const events = bound.transport(piModel(bound.model, token.baseUrl), context, {
          apiKey: token.token,
          signal,
          fetch,
          maxRetries: 0,
          // Attribution goes last so no transport default can override it.
          headers: { ...attributionHeaders() },
          ...reasoning === undefined ? {} : { reasoning },
          ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
          ...options.temperature === undefined ? {} : { temperature: options.temperature },
          ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
        })
        for await (const event of events) {
          if (event.type === 'error' && !emitted && attempt === 0 && !options.signal?.aborted
            && isUnauthorized(status, event.error.errorMessage)) {
            retry = true
            break
          }
          for (const chunk of mapper.map(event, () => options.signal?.aborted === true, () => status)) {
            emitted = true
            yield chunk
          }
          if (event.type === 'done' || event.type === 'error') return
        }
      } catch (error) {
        if (options.signal?.aborted) throw new LlmError('Copilot request aborted by caller', 'ABORTED', { cause: error })
        throw error
      } finally {
        consumer.abort()
      }
      if (!retry) throw new LlmError('Copilot event stream ended without done/error', 'STREAM_CLOSED')
      // 401 before the first chunk: drop this token, re-exchange once and retry once.
      this.deps.tokens.invalidate(token)
      try {
        token = await this.deps.tokens.current(options.signal)
        if (token.accountGeneration !== bound.token.accountGeneration) {
          throw new LlmError('Copilot account changed; retry the request', 'AUTH')
        }
      } catch (error) {
        throw tokenError(error)
      }
    }
  }
}
