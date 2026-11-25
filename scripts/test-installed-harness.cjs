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
  const fiber = ctx.plugin(bridge, { hiddenModels: [hidden] })
  try {
    await settle()
    const models = await consumer.listModels('github-copilot')
    assert.ok(!models.some(model => model.id === hidden), 'hidden model is still visible in the installed picker catalog')
    assert.equal(models.length, baseline.length - 1)
    assert.ok(!record.payload.availableModelIds.includes(hidden), 'grant filtering must still work')
    console.log(JSON.stringify({ baseline: baseline.length, filtered: models.length, hiddenOmitted: true }))
    await fiber.dispose()
    assert.equal((await consumer.listModels('github-copilot')).length, baseline.length, 'unload must restore the catalog')
    console.log('PASS: installed pi-ai adapter + LLM service + bridge; catalog restored on unload')
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
