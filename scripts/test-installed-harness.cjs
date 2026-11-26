// Run with the installed Harness Electron in Node mode so its app.asar is readable.
// Usage: ELECTRON_RUN_AS_NODE=1 <Harness executable> scripts/test-installed-harness.cjs <app.asar/dsh/node_modules>
// No network, profile changes, or real credentials: exercise the installed catalog with an in-memory grant.
const assert = require('node:assert/strict')
const path = require('node:path')
const modules = process.argv[2]
assert.ok(modules, 'pass the installed Harness node_modules directory (inside app.asar on macOS)')
const load = name => require(path.join(modules, '@deepseek-ai', name, 'lib/index.js'))
const { Context } = load('cordis')
const { LlmRuntime } = load('dsh-llm')
const piAi = load('dsh-llm-pi-ai')
const bridge = require('../lib/index.js')
const settle = () => new Promise(resolve => setImmediate(resolve))

async function main() {
  const originalFetch = globalThis.fetch
  let metadataRequests = 0
  let usageRequests = 0
  globalThis.fetch = async (url, init) => {
    if (url === 'https://api.github.com/copilot_internal/user') {
      usageRequests++
      assert.equal(init.headers.Authorization, 'token fixture-only')
      assert.equal(init.redirect, 'error')
      return Response.json({ token_based_billing: true, quota_snapshots: { premium_interactions: { entitlement: 100000, quota_remaining: 53916.3, percent_remaining: 53.9 } } })
    }
    assert.equal(url, 'https://api.individual.githubcopilot.com/models', 'unexpected network request')
    assert.equal(init.redirect, 'error')
    metadataRequests++
    return Response.json({ data: [{ id: 'claude-haiku-4.5',
      billing: { token_prices: { batch_size: 1_000_000, default: { input_price: 5, output_price: 25, cache_read_price: 0 } }, promo: { discount_percent: 50 } },
      warning_text: { model_pending_deprecation: 'Provider retirement warning' },
    }] })
  }
  const ctx = new Context()
  new LlmRuntime(ctx)
  piAi.apply(ctx, piAi.Config({ providers: { 'github-copilot': {} } }))
  const consumer = ctx.extend().llm
  const baseline = await consumer.listModels('github-copilot')
  const hidden = 'claude-haiku-4.5'
  assert.ok(baseline.some(model => model.id === hidden), 'fixture must be in the installed catalog')
  const key = 'llm-pi-ai/github-copilot'
  let record = { kind: 'grant', payload: {
    type: 'oauth', access: 'fixture-only', refresh: 'fixture-only', expires: Number.MAX_SAFE_INTEGER,
    availableModelIds: baseline.map(model => model.id),
  } }
  ctx.provide('credentials', {
    async readRecord() { return record },
    async modifyRecord(_key, update) {
      const next = await update(record)
      if (next !== undefined) { record = next; ctx.emit('credentials/record-updated', key) }
      return record
    },
    async deleteRecord() { record = undefined },
  })
  const routes = new Map()
  ctx.provide('connection', { fetch: { register(route) {
    routes.set(route.path, route)
    return async () => { routes.delete(route.path) }
  } } })
  const fiber = ctx.plugin(bridge, { hiddenModels: [hidden] })
  try {
    await settle()
    const models = await consumer.listModels('github-copilot')
    assert.ok(!models.some(model => model.id === hidden), 'hidden model is still visible in the installed picker catalog')
    assert.equal(models.length, baseline.length - 1)
    assert.ok(!record.payload.availableModelIds.includes(hidden), 'grant filtering must still work')
    const response = await routes.get('/api/copilot-bridge/models').fetch(new Request('https://localhost/api/copilot-bridge/models'))
    assert.equal(response.status, 200)
    const catalog = (await response.json()).value
    assert.equal(catalog.models.length, baseline.length, 'management must include hidden rows')
    const row = catalog.models.find(model => model.id === hidden)
    assert.ok(row, 'a hidden model must remain restorable in Plugins')
    assert.notEqual(row.name, row.id, 'resolve actual display metadata from the installed pi-ai adapter')
    assert.ok(row.contextWindow > 0)
    assert.ok(row.inputModalities.includes('image'))
    assert.deepEqual(row.pricing, { input: 5, output: 25, cacheRead: 0 })
    assert.equal(row.promotion.discountPercent, 50)
    assert.equal(row.retiring, 'Provider retirement warning')
    assert.equal(metadataRequests, 1, 'metadata enriches management, not picker visibility')
    assert.ok(!JSON.stringify(catalog).includes('fixture-only'), 'never expose grant secrets')
    const usageResponse = await routes.get('/api/copilot-bridge/usage').fetch(new Request('https://localhost/api/copilot-bridge/usage'))
    assert.equal(usageResponse.status, 200)
    const usage = (await usageResponse.json()).value
    assert.equal(usage.used, 46083.7)
    assert.equal(usage.total, 100000)
    assert.equal(usageRequests, 1)
    assert.ok(!JSON.stringify(usage).includes('fixture-only'), 'quota must never expose credentials')
    console.log(JSON.stringify({ baseline: baseline.length, filtered: models.length, hiddenOmitted: true, management: catalog.models.length, hiddenMetadata: { name: row.name, contextWindow: row.contextWindow } }))
    await fiber.dispose()
    assert.equal((await consumer.listModels('github-copilot')).length, baseline.length, 'unload must restore the catalog')
    console.log('PASS: installed pi-ai adapter + LLM service + bridge; catalog restored on unload')
  } finally {
    globalThis.fetch = originalFetch
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
