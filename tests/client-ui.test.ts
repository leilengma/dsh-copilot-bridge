import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { buildSync } from 'esbuild'
import type { ModelsTable } from '../src/client/hidden-models-card.tsx'

type TableProps = Parameters<typeof ModelsTable>[0]

// Bundle TSX in memory: Node's native type stripping deliberately doesn't transform JSX.
const compiled = buildSync({
  stdin: { contents: `
    import { createElement } from 'react'
    import { renderToStaticMarkup } from 'react-dom/server'
    import { ModelsTable } from './src/client/hidden-models-card.tsx'
    import { apply } from './src/client/index.tsx'
    import { authRevision } from './src/client/store.ts'
    const slots = []
    const remoteListeners = new Map()
    apply({
      locale: { register: () => () => {}, getSnapshot: () => ({ active: 'en', revision: 0 }), subscribe: () => () => {} },
      effect: f => f(), on: () => () => {}, remote: { $on: (event, listener) => { remoteListeners.set(event, listener); return () => remoteListeners.delete(event) } },
      commandUi: { decorate: () => () => {} }, sessions: {},
      slots: { inject: (_name, f) => f(), register: (slot, component) => { slots.push({slot, component}); return () => {} } },
    })
    export const registrations = slots.map(({slot}) => ({ name: slot.name, id: slot.id, label: slot.label?.() }))
    export const summary = renderToStaticMarkup(createElement(slots.find(({slot}) => slot.name === 'plugins.item').component, { view: 'summary' }))
    export const renderTable = props => renderToStaticMarkup(createElement(ModelsTable, props))
    export const getRevision = authRevision.getSnapshot
    export const subscribeToRevision = authRevision.subscribe
    export const emitRemote = (event, key) => remoteListeners.get(event)?.(key)
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'tsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./fixtures/ui-primitives.tsx', import.meta.url)) },
  define: { __PLUGIN_VERSION__: '"test"' },
}).outputFiles[0]
assert.ok(compiled)
const bundled = { exports: {} }
new Function('require', 'module', 'exports', compiled.text)(createRequire(import.meta.url), bundled, bundled.exports)
const ui = bundled.exports as {
  registrations: { name: string; id: string; label?: string }[]
  summary: string
  getRevision: () => number
  subscribeToRevision: (listener: () => void) => () => void
  emitRemote: (event: string, key: string) => void
  renderTable: (props: TableProps) => string
}

const status: TableProps['status'] = {
  authenticated: true, state: 'authenticated', provider: 'github-copilot', githubHost: 'github.com',
  enterpriseUrl: '', configWritable: true, availableModels: ['haiku', 'gpt'], hiddenModels: ['gpt'],
}
const props: TableProps = {
  status, busy: false, onSave: async () => {}, models: [
    { id: 'haiku', name: 'Claude Haiku 4.5', contextWindow: 200_000, inputModalities: ['text', 'image'] },
    { id: 'gpt', name: 'GPT', contextWindow: 1_000_000 },
  ],
}

test('client registers GitHub Copilot inside Plugins and retains the auth Settings entry', () => {
  assert.deepEqual(ui.registrations.find(slot => slot.name === 'plugins.item'), { name: 'plugins.item', id: 'copilot-bridge-models', label: 'GitHub Copilot' })
  assert.ok(ui.registrations.some(slot => slot.name === 'settings.section' && slot.id === 'copilot-bridge'))
  assert.match(ui.summary, /Search GitHub Copilot models/)
  assert.doesNotMatch(ui.summary, /<table|<input/)
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

test('account discovery notifies model-page subscribers but unrelated records do not', () => {
  const before = ui.getRevision()
  let notifications = 0
  const unsubscribe = ui.subscribeToRevision(() => { notifications++ })
  try {
    ui.emitRemote('credentials/record-updated', 'another-provider')
    assert.equal(ui.getRevision(), before)
    assert.equal(notifications, 0)
    ui.emitRemote('credentials/record-updated', 'llm-pi-ai/github-copilot')
    assert.equal(ui.getRevision(), before + 1)
    assert.equal(notifications, 1)
  } finally { unsubscribe() }
})

test('busy and read-only model tables disable every visibility mutation', () => {
  for (const html of [ui.renderTable({ ...props, busy: true }), ui.renderTable({ ...props, status: { ...status, configWritable: false } })]) {
    assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, 2)
    assert.match(html, /type="search"/)
  }
})
