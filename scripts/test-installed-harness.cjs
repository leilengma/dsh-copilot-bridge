// Run with installed Harness Electron in Node mode so app.asar is readable:
// ELECTRON_RUN_AS_NODE=1 <Harness executable> scripts/test-installed-harness.cjs <app.asar/dsh/node_modules>
// Only synthetic credentials, fake exchange/discovery and in-memory profile entries.
const assert = require('node:assert/strict')
const { createHarnessFixture, BRIDGE, MODEL_IDS, modelIds } = require('./installed-harness-fixture.cjs')

async function main() {
  const h = await createHarnessFixture()
  try {
    const entryId = await h.mount()
    assert.deepEqual(h.runtime.listProviders().find(provider => provider.id === BRIDGE), {
      id: BRIDGE, name: 'GitHub Copilot Bridge',
    })
    const resolved = await h.runtime.resolveModelInfo(BRIDGE, 'mai-code-2')
    assert.equal(resolved.provider, BRIDGE)
    assert.equal(resolved.id, 'mai-code-2')
    assert.equal(resolved.name, 'Fixture mai-code-2')
    assert.deepEqual(resolved.context, { contextWindow: 200_000 })
    const picker = await h.catalog()
    const group = picker.groups.find(group => group.id === BRIDGE)
    assert.equal(group.name, 'GitHub Copilot Bridge')
    assert.deepEqual(modelIds(group.models), MODEL_IDS)
    assert.deepEqual(h.requests, [
      'https://api.github.com/copilot_internal/v2/token',
      'https://api.individual.githubcopilot.com/models',
    ], 'startup and picker resolution must share fixture exchange/discovery')
    const management = await h.request('models')
    assert.equal(management.state, 'ready')
    assert.equal(management.status.provider, BRIDGE)
    assert.deepEqual(modelIds(management.models), MODEL_IDS)
    assert.ok(management.models.every(model => model.protocol === 'openai-responses'))
    assert.equal(h.requests.length, 3, 'management metadata uses one additional fixture /models request')
    assert.deepEqual(h.credentialWrites, [], 'startup must not rewrite either credential')
    assert.deepEqual(h.settingWrites, [], 'startup must not auto-configure a native profile')
    await h.assertNativeUnchanged()
    console.log('PASS: installed Loader + LLM + bridge; fixture discovery lists and resolves copilot-bridge/mai-code-2 in SessionController.modelCatalog()')

    const fiber = h.loader.resolve(entryId).fiber
    await fiber.dispose()
    assert.ok(!h.runtime.listProviders().some(provider => provider.id === BRIDGE))
    assert.equal(h.routes.size, 0, 'unload must remove bridge HTTP routes')
    await h.assertNativeUnchanged()
    await h.mount()
    assert.deepEqual(modelIds((await h.catalog()).groups.find(group => group.id === BRIDGE).models), MODEL_IDS)
    await h.assertNativeUnchanged()
    assert.equal(h.requests.length, 5, 'reload must rediscover without reusing a disposed snapshot')
    console.log('PASS: installed bridge unload/reload; native github-copilot profile, credential and catalog untouched; no native listModels wrapper')
  } finally {
    await h.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
