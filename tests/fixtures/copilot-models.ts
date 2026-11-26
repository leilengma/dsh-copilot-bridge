/** Synthetic `/models` payload modelled on the Enterprise snapshot (spec §4); no real account data. */
const chat = (id: string, endpoints: readonly string[] | undefined, extra: Record<string, unknown> = {}, supports: Record<string, unknown> = {}) => ({
  id, name: `Name ${id}`, vendor: 'fixture', model_picker_enabled: true,
  ...endpoints === undefined ? {} : { supported_endpoints: endpoints },
  capabilities: {
    type: 'chat', family: id,
    limits: { max_context_window_tokens: 200_000, max_output_tokens: 32_000, max_prompt_tokens: 168_000 },
    supports: { streaming: true, tool_calls: true, ...supports },
  },
  billing: { token_prices: { batch_size: 1000 } },
  ...extra,
})

/** Adaptive-only live descriptor shape; synthetic metadata, not an account response. */
export const opus55Payload = {
  data: [chat('claude-opus-5.5', ['/v1/messages', '/chat/completions'], {}, {
    vision: true, reasoning_effort: ['low', 'medium', 'high', 'xhigh', 'max'],
  })],
}

/** Exact adaptive IDs verified in pi-ai 1.3.0's Copilot metadata, plus a genuine budget model. */
export const anthropicThinkingPayload = {
  data: [
    ...['claude-fable-5', 'claude-fable-5.1', 'claude-haiku-5.5', 'claude-opus-4.7', 'claude-opus-4.8',
      'claude-opus-5', 'claude-sonnet-5', 'claude-sonnet-5.5'].map(id =>
      chat(id, ['/v1/messages', '/chat/completions'], {}, { reasoning_effort: ['low', 'medium', 'high', 'xhigh', 'max'] })),
    chat('claude-sonnet-4.6', ['/v1/messages'], {}, { reasoning_effort: ['low', 'medium', 'high', 'max'] }),
    chat('claude-haiku-4.5', ['/v1/messages'], {}, { reasoning_effort: ['low', 'medium', 'high'] }),
    ...opus55Payload.data,
  ],
}

export const modelsPayload = {
  object: 'list',
  data: [
    chat('claude-sonnet-5', ['/v1/messages', '/chat/completions'], {}, { vision: true, reasoning_effort: ['low', 'medium', 'high'] }),
    chat('claude-opus-5', ['/v1/messages', '/chat/completions'], { model_picker_enabled: false }, { vision: true }),
    chat('gpt-6', ['/responses', 'ws:/responses'], {}, { vision: true, reasoning_effort: ['minimal', 'low', 'medium', 'high', 'xhigh'] }),
    chat('gpt-5.4-nano', ['/responses'], { model_picker_enabled: false }),
    chat('grok-4.7', ['/responses', 'ws:/responses']),
    chat('mai-code-2', ['/chat/completions', '/responses'], {}, { reasoning_effort: ['low', 'medium', 'high'] }),
    chat('mai-code-2-flash', ['/chat/completions', '/responses'], {}, { reasoning_effort: [] }),
    chat('gemini-3-pro', ['/chat/completions'], {}, { vision: true }),
    chat('kimi-k3', ['/chat/completions']),
    chat('legacy-gpt-4o', undefined),
    chat('legacy-empty', []),
    chat('future-realtime', ['/v2/realtime', 'ws:/responses']),
    { id: 'text-embedding-3-small', name: 'Embedding', supported_endpoints: ['/embeddings'], capabilities: { type: 'embeddings' } },
    { id: 'image-gen-2', name: 'Image', supported_endpoints: ['/images/generations'], capabilities: { type: 'image' } },
  ],
}
