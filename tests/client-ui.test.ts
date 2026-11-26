import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
import type { CopilotPluginTabs } from '../src/client/plugin-page.tsx'
import type { UsageDisplay } from '../src/client/account-usage.tsx'
import type { ModelsTable } from '../src/client/hidden-models-card.tsx'
import type { ModelsDisplay } from '../src/client/models-page.tsx'
import type { api } from '../src/client/api.ts'

type TableProps = Parameters<typeof ModelsTable>[0]

// Bundle TSX in memory: Node's native type stripping deliberately doesn't transform JSX.
const compiled = buildSync({
  stdin: { contents: `
    import { createElement } from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { CopilotPluginTabs } from './src/client/plugin-page.tsx'
    import { ModelsTable } from './src/client/hidden-models-card.tsx'
    import { ModelsDisplay } from './src/client/models-page.tsx'
    export { api } from './src/client/api.ts'
    export { DICTIONARIES as dictionaries } from './src/client/i18n.ts'
    import { UsageDisplay } from './src/client/account-usage.tsx'
    import { apply, inject } from './src/client/index.tsx'
    export const injections = inject
    export const commandHooks = []
    import { authRevision } from './src/client/store.ts'
    const slots = []
    const selectedPanels = []
    const remoteListeners = new Map()
    const localeSnapshot = { active: 'en', revision: 0 }
    export const setLocale = active => { localeSnapshot.active = active; localeSnapshot.revision++ }
    apply({
      layout: { selectPanel: id => selectedPanels.push(id) },
      locale: { register: () => () => {}, getSnapshot: () => localeSnapshot, subscribe: () => () => {} },
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
    export const renderModels = props => renderToStaticMarkup(createElement(ModelsDisplay, props))
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
  renderModels: (props: Parameters<typeof ModelsDisplay>[0]) => string
  api: typeof api
  dictionaries: Readonly<Record<'en' | 'zh', Readonly<Record<string, string>>>>
  setLocale: (locale: 'en' | 'zh') => void
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

test('Account explains bridge ownership and upgrade sign-in in both locales without attaching to the native provider card', () => {
  assert.equal(ui.registrations.some(slot => slot.name === 'settings.models.provider-card'), false)
  for (const [locale, expected] of [
    ['en', [/GitHub Copilot Bridge \(copilot-bridge\)/, /native github-copilot provider, profiles and credentials are left untouched/, /sign in again using the device flow/, /tokens are not imported/, /github-copilot\/\* require your own native provider profile/]],
    ['zh', [/GitHub Copilot Bridge（copilot-bridge）/, /不会修改原生 github-copilot 提供方、配置档或凭据/, /通过设备码流程重新登录/, /不会导入现有 token/, /github-copilot\/\* 的会话需要你自己的原生提供方配置档/]],
  ] as const) {
    ui.setLocale(locale)
    try {
      const html = ui.renderTabs({ status, tab: 'account', onTabChange: () => {}, onStatusChange: () => {} })
      for (const pattern of expected) assert.match(html, pattern)
      assert.doesNotMatch(html, /Retry provider setup|首次请求 github-copilot|leave the API key|API 密钥留空/)
    } finally { ui.setLocale('en') }
  }
})

test('Models offers manual refresh and shows catalog loading and retryable errors without dropping the last good rows', () => {
  const catalog = { status, models: [...props.models, { id: 'disabled', name: 'Disabled model', disabledReason: 'not-offered' as const }], state: 'ready' as const }
  const display = { catalog, loading: false, busy: false, onSave: props.onSave, onRefresh: () => {} }
  const ready = ui.renderModels(display)
  assert.match(ready, /<button[^>]*>Refresh<\/button>/)
  assert.match(ready, /Claude Haiku 4.5/)
  assert.match(ready, /Disabled model/)
  assert.match(ready, /Not offered for selection/)
  const loading = ui.renderModels({ ...display, catalog: { ...catalog, state: 'loading' } })
  assert.match(loading, /aria-busy="true"/)
  assert.match(loading, /role="status"[^>]*>Loading models/)
  assert.match(loading, /<button[^>]*disabled=""[^>]*>Refresh<\/button>/)
  assert.match(loading, /Claude Haiku 4.5/)
  for (const html of [
    ui.renderModels({ ...display, catalog: { ...catalog, state: 'error', error: 'Discovery unavailable' } }),
    ui.renderModels({ ...display, loadError: 'Discovery unavailable' }),
  ]) {
    assert.match(html, /role="alert"/)
    assert.match(html, /Discovery unavailable/)
    assert.match(html, /<button[^>]*>Retry<\/button>/)
    assert.match(html, /Claude Haiku 4.5/)
    assert.match(html, /Disabled model/)
  }
  const empty = ui.renderModels({ ...display, catalog: { ...catalog, models: [] } })
  assert.match(empty, /No models are available to this account/)
  assert.doesNotMatch(empty, /Loading models|github-copilot provider|configured provider catalog/)
})

test('both locales translate every key and render model discovery states and disabled reasons', () => {
  const keys = Object.keys(ui.dictionaries.en).sort()
  assert.deepEqual(Object.keys(ui.dictionaries.zh).sort(), keys)
  for (const key of keys) {
    for (const locale of ['en', 'zh'] as const) assert.ok(ui.dictionaries[locale][key]?.trim(), `${locale}.${key}`)
    const placeholders = (value: string) => value.match(/\{[^}]+\}/g)?.sort() ?? []
    assert.deepEqual(placeholders(ui.dictionaries.en[key]!), placeholders(ui.dictionaries.zh[key]!), key)
  }
  for (const [locale, expected] of [
    ['en', { refresh: '>Refresh</button>', loading: 'Loading models…', retry: '>Retry</button>', error: 'Could not refresh models. Try again.', unsupported: 'Unsupported protocol', notOffered: 'Not offered for selection' }],
    ['zh', { refresh: '>刷新</button>', loading: '正在加载模型…', retry: '>重试</button>', error: '无法刷新模型，请重试。', unsupported: '不支持的协议', notOffered: '不可供选择' }],
  ] as const) {
    ui.setLocale(locale)
    try {
      const display = { catalog: { status, state: 'error' as const, models: [
        { id: 'unsupported', name: 'Unsupported', disabledReason: 'unsupported-protocol' as const },
        { id: 'not-offered', name: 'Not offered', disabledReason: 'not-offered' as const },
      ] }, loading: false, busy: false, onSave: props.onSave, onRefresh: () => {} }
      const html = ui.renderModels(display)
      for (const label of [expected.refresh, expected.retry, expected.error, expected.unsupported, expected.notOffered]) assert.ok(html.includes(label), label)
      assert.doesNotMatch(html, /aria-pressed=/)
      assert.ok(ui.renderModels({ ...display, loading: true }).includes(expected.loading))
    } finally { ui.setLocale('en') }
  }
})

test('manual catalog refresh posts to the authenticated route and a failed refresh can be retried', async t => {
  const catalog = { status, models: props.models, state: 'ready' }
  const calls: { url: string; method: string | undefined; cache: RequestCache | undefined }[] = []
  let fail = true
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method, cache: init.cache })
    return Response.json(fail ? { ok: false, error: 'Discovery unavailable' } : { ok: true, value: catalog }, { status: fail ? 503 : 200 })
  })
  await assert.rejects(ui.api.refreshModels(), /Discovery unavailable/)
  fail = false
  assert.deepEqual(await ui.api.refreshModels(), catalog)
  assert.deepEqual(calls, [
    { url: '/api/copilot-bridge/models/refresh', method: 'POST', cache: 'no-store' },
    { url: '/api/copilot-bridge/models/refresh', method: 'POST', cache: 'no-store' },
  ])
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

test('bridge catalog updates refresh Models subscribers when background discovery completes', () => {
  const before = ui.getRevision()
  ui.emitRemote('llm/models-updated', 'github-copilot')
  ui.emitRemote('llm/models-updated', 'another-provider')
  assert.equal(ui.getRevision(), before)
  ui.emitRemote('llm/models-updated', 'copilot-bridge')
  assert.equal(ui.getRevision(), before + 1)
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
