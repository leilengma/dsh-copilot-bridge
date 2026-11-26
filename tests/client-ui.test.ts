import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
import type { CopilotPluginTabs } from '../src/client/plugin-page.tsx'
import type { UsageDisplay } from '../src/client/account-usage.tsx'
import type { ModelsTable } from '../src/client/hidden-models-card.tsx'

type TableProps = Parameters<typeof ModelsTable>[0]

// Bundle TSX in memory: Node's native type stripping deliberately doesn't transform JSX.
const compiled = buildSync({
  stdin: { contents: `
    import { createElement } from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { CopilotPluginTabs } from './src/client/plugin-page.tsx'
    import { ModelsTable } from './src/client/hidden-models-card.tsx'
    import { UsageDisplay } from './src/client/account-usage.tsx'
    import { apply, inject } from './src/client/index.tsx'
    export const injections = inject
    export const commandHooks = []
    import { authRevision } from './src/client/store.ts'
    const slots = []
    const selectedPanels = []
    const remoteListeners = new Map()
    apply({
      layout: { selectPanel: id => selectedPanels.push(id) },
      locale: { register: () => () => {}, getSnapshot: () => ({ active: 'en', revision: 0 }), subscribe: () => () => {} },
      effect: f => f(), on: event => { commandHooks.push(event); return () => {} }, remote: { $on: (event, listener) => { remoteListeners.set(event, listener); return () => remoteListeners.delete(event) } },
      commandUi: { decorate: decoration => { commandHooks.push(decoration.name); return () => {} } }, sessions: {},
      slots: { inject: (_name, f) => f(), register: (slot, component) => { slots.push({slot, component}); return () => {} } },
    })
    export const registrations = slots.map(({slot}) => ({ name: slot.name, id: slot.id, key: slot.key }))
    const configSlot = slots.find(({slot}) => slot.name === 'plugins.bundle.config')
    export const config = renderToStaticMarkup(createElement(configSlot.component, configSlot.slot.inject?.()))
    export const main = slots.some(({slot}) => slot.name === 'main') ? renderToStaticMarkup(createElement(slots.find(({slot}) => slot.name === 'main').component)) : ''
    export const openConfig = () => { configSlot.slot.inject?.().onOpen(); return selectedPanels.at(-1) }
    export const sidebarLabel = () => slots.find(({slot}) => slot.name === 'sidebar.panellist')?.slot.label()
    export const sidebarIcon = slots.some(({slot}) => slot.name === 'sidebar.panellist') ? renderToStaticMarkup(createElement(slots.find(({slot}) => slot.name === 'sidebar.panellist').component, { size: 18, active: true })) : ''
    export const renderTabs = props => renderToStaticMarkup(createElement(CopilotPluginTabs, props))
    export const renderUsage = props => renderToStaticMarkup(createElement(UsageDisplay, props))
    export const renderTable = props => renderToStaticMarkup(createElement(ModelsTable, props))
    export const getRevision = authRevision.getSnapshot
    export const subscribeToRevision = authRevision.subscribe
    export const emitRemote = (event, key) => remoteListeners.get(event)?.(key)
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./fixtures/ui-primitives.tsx', import.meta.url)) },
  loader: { '.svg': 'dataurl' },
  define: { __PLUGIN_VERSION__: '"test"' },
}).outputFiles[0]
assert.ok(compiled)
const bundled = { exports: {} }
new Function('require', 'module', 'exports', compiled.text)(createRequire(import.meta.url), bundled, bundled.exports)
const ui = bundled.exports as {
  registrations: { name: string; id?: string; key?: string }[]
  injections: string[]
  commandHooks: string[]
  config: string
  main: string
  sidebarIcon: string
  sidebarLabel: () => string
  openConfig: () => string
  getRevision: () => number
  subscribeToRevision: (listener: () => void) => () => void
  emitRemote: (event: string, key: string) => void
  renderTabs: (props: Parameters<typeof CopilotPluginTabs>[0]) => string
  renderTable: (props: TableProps) => string
  renderUsage: (props: Parameters<typeof UsageDisplay>[0]) => string
}

const status: TableProps['status'] = {
  authenticated: true, state: 'authenticated', provider: 'copilot-bridge', githubHost: 'github.com',
  enterpriseUrl: '', configWritable: true, availableModels: ['haiku', 'gpt'], hiddenModels: ['gpt'],
}
const props: TableProps = {
  status, busy: false, onSave: async () => {}, models: [
    { id: 'haiku', name: 'Claude Haiku 4.5', contextWindow: 200_000, inputModalities: ['text', 'image'] },
    { id: 'gpt', name: 'GPT', contextWindow: 1_000_000 },
  ],
}

test('usage exposes exact credits on focus/hover, accessible progress and manual refresh without inventing missing data', () => {
  const html = ui.renderUsage({ loading: false, onRefresh: () => {}, usage: { state: 'available', unit: 'credits', unlimited: false, used: 46083.7, total: 100000, percentUsed: 46.1 } })
  assert.match(html, /46% used/)
  assert.ok(html.includes(`${(46083.7).toLocaleString(undefined, { maximumFractionDigits: 3 })} / ${(100000).toLocaleString()} used`))
  assert.match(html, /tabindex="0"/)
  assert.match(html, /:hover|:focus/)
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="46"/)
  assert.match(html, /aria-label="Refresh usage"/)
  const missing = ui.renderUsage({ loading: false, onRefresh: () => {}, usage: { state: 'unavailable' } })
  assert.match(missing, /Usage unavailable/)
  assert.doesNotMatch(missing, /0%|role="progressbar"/)
  const unlimited = ui.renderUsage({ loading: false, onRefresh: () => {}, usage: { state: 'available', unit: 'requests', unlimited: true } })
  assert.match(unlimited, /Unlimited/)
  assert.doesNotMatch(unlimited, /0%|role="progressbar"/)
})

test('client has no chat command hooks, session dependencies, or composer login overlay', () => {
  assert.deepEqual(ui.commandHooks, [])
  assert.equal(ui.injections.includes('commandUi'), false)
  assert.equal(ui.injections.includes('sessions'), false)
  assert.equal(ui.registrations.some(slot => slot.name === 'conversation.input.overlay'), false)
})

test('client config belongs to its installed bundle so the host uses package artwork, not an official-item fallback', () => {
  assert.deepEqual(ui.registrations.find(slot => slot.name === 'plugins.bundle.config'), { name: 'plugins.bundle.config', key: 'dsh-copilot-bridge', id: undefined })
  assert.equal(ui.registrations.some(slot => slot.name === 'plugins.item'), false)
  assert.equal(ui.registrations.some(slot => slot.name === 'settings.section' && slot.id === 'copilot-bridge'), false)
  assert.equal(ui.registrations.some(slot => slot.name === 'settings.section.icon' && slot.id === 'copilot-bridge'), false)
  assert.match(ui.config, /Open GitHub Copilot/)
  assert.doesNotMatch(ui.config, /role="tab"|<table|<input/)
})

test('sidebar entry opens a matching full-page main panel with Account and Models', () => {
  assert.ok(ui.injections.includes('layout'))
  const entry = ui.registrations.find(slot => slot.name === 'sidebar.panellist')
  assert.equal(entry?.id, 'copilot-bridge')
  assert.equal(ui.registrations.find(slot => slot.name === 'main')?.key, entry?.id)
  assert.equal(ui.sidebarLabel(), 'GitHub Copilot')
  assert.match(ui.sidebarIcon, /<img[^>]*src="data:image\/svg\+xml/)
  assert.match(ui.sidebarIcon, /width="18"[^>]*height="18"/)
  assert.equal(ui.openConfig(), entry?.id)
  assert.match(ui.main, /<h1[^>]*>GitHub Copilot</)
  assert.match(ui.main, /overflow-y:auto/)
  assert.match(ui.main, /role="tab"[^>]*>Account</)
  assert.match(ui.main, /GitHub Enterprise URL/)
  assert.doesNotMatch(ui.main, />Models<|<table/)
})

test('Account owns sign-in and host controls; Models is absent until authentication succeeds', () => {
  for (const auth of [undefined, { ...status, authenticated: false, state: 'signed-out' as const }, { ...status, authenticated: false, state: 'pending' as const }]) {
    const html = ui.renderTabs({ status: auth, tab: 'models', onTabChange: () => {}, onStatusChange: () => {} })
    assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>Account</)
    assert.doesNotMatch(html, />Models<|Loading models|<table/)
    assert.match(html, /GitHub Enterprise URL/)
    assert.doesNotMatch(html, /\/copilot-(login|status|logout)/)
    assert.doesNotMatch(html, /aria-label="Account usage"/)
  }
  const html = ui.renderTabs({ status, tab: 'account', onTabChange: () => {}, onStatusChange: () => {} })
  assert.match(html, />Models</)
  assert.match(html, /Sign out/)
  assert.doesNotMatch(html, /Your credential is available|Select a Copilot model in the model picker/)
  assert.doesNotMatch(html, /<h2[^>]*>GitHub Copilot<\/h2>/)
  assert.ok(html.indexOf('Signed in at github.com.') < html.indexOf('aria-label="Account usage"'))
  assert.doesNotMatch(html, /GitHub Enterprise URL|>GitHub host</)
  const models = ui.renderTabs({ status, tab: 'models', onTabChange: () => {}, onStatusChange: () => {} })
  assert.match(models, /role="tab"[^>]*aria-selected="true"[^>]*>Models</)
  assert.match(models, /Loading models/)
  assert.doesNotMatch(models, /aria-label="Account usage"/)
})

test('model table exposes accessible eye toggles, search and real metadata without invented costs', () => {
  const html = ui.renderTable(props)
  assert.match(html, /type="search"/)
  assert.match(html, /aria-label="Hide Claude Haiku 4.5"[^>]*aria-pressed="true"/)
  assert.match(html, /aria-label="Show GPT"[^>]*aria-pressed="false"/)
  assert.match(html, /200K/)
  assert.match(html, /1M/)
  assert.match(html, />Vision</)
  assert.doesNotMatch(html, />Tools<|\$|Add models|Install model providers/)
})

test('disabled catalog models show their reason without offering a visibility toggle', () => {
  const html = ui.renderTable({ ...props, models: [
    props.models[0]!,
    { id: 'unsupported', name: 'Unsupported model', disabledReason: 'unsupported-protocol' },
    { id: 'not-offered', name: 'Unavailable model', protocol: 'openai-responses', disabledReason: 'not-offered' },
  ] })
  assert.match(html, /Unsupported model/)
  assert.match(html, /Unsupported protocol/)
  assert.match(html, /Unavailable model/)
  assert.match(html, /Not offered for selection/)
  assert.doesNotMatch(html, /aria-label="(?:Hide|Show) (?:Unsupported|Unavailable) model"/)
  assert.equal((html.match(/aria-pressed=/g) ?? []).length, 1)
})

test('model table shows provider credit prices, discount and Retiring text without disabling visibility', () => {
  const html = ui.renderTable({ ...props, models: [{
    id: 'm', name: 'Model', pricing: { input: 5, output: 25, cacheRead: 0, cacheWrite: 6.25 },
    longContextPricing: { input: 10, output: 50 }, defaultContextMax: 200_000,
    promotion: { discountPercent: 50, message: 'Special <offer>', endsAt: '2099-12-01T00:00:00Z' },
    retiring: 'Use <replacement> soon',
  }] })
  assert.match(html, /Credits per 1M tokens/)
  assert.match(html, /In: 5/)
  assert.match(html, /Out: 25/)
  assert.match(html, /Cache Read: 0/)
  assert.match(html, /Cache Write: 6.25/)
  assert.match(html, /50% off/)
  assert.match(html, /2099-12-01/)
  assert.match(html, /<summary[^>]*>Retiring<\/summary>/)
  assert.match(html, /<summary[^>]*>50% off<\/summary>/)
  assert.match(html, /Use &lt;replacement&gt; soon/)
  assert.match(html, /Special &lt;offer&gt;/)
  assert.match(html, /200K/)
  assert.match(html, /In: 10/)
  assert.doesNotMatch(html, /disabled=|Retired|<replacement>|<offer>/)
})

test('a stale response cannot display an already-expired discount', () => {
  const html = ui.renderTable({ ...props, models: [{ id: 'm', name: 'Model',
    promotion: { discountPercent: 50, endsAt: '2000-01-01T00:00:00Z' }, retiring: 'Still retiring',
  }] })
  assert.doesNotMatch(html, /50% off/)
  assert.match(html, /Retiring/)
})

test('bridge record updates notify model-page subscribers but other records do not', () => {
  const before = ui.getRevision()
  let notifications = 0
  const unsubscribe = ui.subscribeToRevision(() => { notifications++ })
  try {
    ui.emitRemote('credentials/record-updated', 'another-provider')
    ui.emitRemote('credentials/record-updated', 'llm-pi-ai/github-copilot')
    assert.equal(ui.getRevision(), before)
    assert.equal(notifications, 0)
    ui.emitRemote('credentials/record-updated', 'copilot-bridge/github')
    assert.equal(ui.getRevision(), before + 1)
    assert.equal(notifications, 1)
  } finally { unsubscribe() }
})

test('credential reference changes still refresh Account subscribers without chat integration', () => {
  const before = ui.getRevision()
  ui.emitRemote('credentials/reference-updated', 'copilot-bridge/github')
  assert.equal(ui.getRevision(), before + 1)
})

test('busy and read-only model tables disable every visibility mutation', () => {
  for (const html of [ui.renderTable({ ...props, busy: true }), ui.renderTable({ ...props, status: { ...status, configWritable: false } })]) {
    assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, 2)
    assert.match(html, /type="search"/)
  }
})
