// Isolated browser seam: production Models page + fake HTTP boundary, no Harness account.
import { createRoot } from 'react-dom/client'
import { CopilotModelsPage } from '../../src/client/models-page.tsx'
import { bindLocale } from '../../src/client/i18n.ts'
import { bumpAuthRevision, createStore } from '../../src/client/store.ts'
import type { AuthStatus, ModelCatalog } from '../../src/shared/contract.ts'

const locale = createStore({ active: 'en', revision: 0 })
bindLocale({ getSnapshot: locale.getSnapshot, subscribe: locale.subscribe, register: () => () => {} })
let status: AuthStatus = {
  authenticated: true, state: 'authenticated', provider: 'copilot-bridge', githubHost: 'github.com',
  enterpriseUrl: '', configWritable: true, hiddenModels: ['beta'], pinnedModels: [],
}
const models: ModelCatalog['models'] = [
  { id: 'alpha', name: 'Alpha', contextWindow: 200_000, inputModalities: ['text', 'image'] },
  { id: 'beta', name: 'Beta', contextWindow: 1_000_000, pricing: { input: 5, output: 25 } },
  { id: 'gamma', name: 'Gamma' },
  { id: 'disabled', name: 'Disabled', disabledReason: 'not-offered' },
]
const calls: { path: string; body: unknown }[] = []
let failNext = false
let holdNext = false
let release: (() => void) | undefined
let notifyNext = false

globalThis.fetch = async (input, init) => {
  const path = String(input)
  const body = init?.body === undefined ? undefined : JSON.parse(String(init.body)) as Record<string, string[]>
  calls.push({ path, body })
  if (path === '/api/copilot-bridge/models') {
    const pinned = status.pinnedModels ?? []
    const ordered = [...models].sort((a, b) => Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)))
    return Response.json({ ok: true, value: { status, models: ordered, state: 'ready' } })
  }
  if ((path === '/api/copilot-bridge/pinned-models' || path === '/api/copilot-bridge/hidden-models') && body) {
    if (holdNext) {
      holdNext = false
      await new Promise<void>(resolve => { release = resolve })
      release = undefined
    }
    if (failNext) {
      failNext = false
      return Response.json({ ok: false, error: 'Fixture settings unavailable' }, { status: 503 })
    }
    status = { ...status, ...body }
    if (notifyNext) { notifyNext = false; bumpAuthRevision() }
    return Response.json({ ok: true, value: status })
  }
  throw new Error(`Unexpected fixture request: ${path}`)
}

const onStatusChange = () => {}
createRoot(document.getElementById('root')!).render(<CopilotModelsPage onStatusChange={onStatusChange} />)

// Only external HTTP/locale/store boundaries are controllable. Assertions use the DOM.
const fixture = {
  calls,
  holdNextSave() { holdNext = true },
  releaseSave() { release?.() },
  failNextSave() { failNext = true },
  notifyDuringSave() { notifyNext = true },
  setLocale(active: 'en' | 'zh') { locale.set({ active, revision: locale.getSnapshot().revision + 1 }) },
  setWritable(configWritable: boolean) { status = { ...status, configWritable }; bumpAuthRevision() },
}
Object.assign(window, { modelUiFixture: fixture })
