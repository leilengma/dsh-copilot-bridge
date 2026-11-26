// Real Loader -> bridge routes -> SessionController picker catalog, with the
// installed api-remotes Host-to-Gateway event source driving a consumer cache.
// This is not a browser DOM/WebSocket test; no user profile, credentials or network.
// ELECTRON_RUN_AS_NODE=1 <Harness executable> scripts/test-installed-picker.cjs <app.asar/dsh/node_modules>
const assert = require('node:assert/strict')
const { createHarnessFixture, BRIDGE, BRIDGE_KEY, modelIds, settle } = require('./installed-harness-fixture.cjs')

async function main() {
  const h = await createHarnessFixture()
  const abort = new AbortController()
  let consumeEvents
  try {
    let eventSource
    h.ctx.provide('typertGateway', { registerRemoteEvents(source) {
      assert.equal(eventSource, undefined, 'only one installed forwarding source is expected')
      eventSource = source
      return () => {}
    } })
    h.load('dsh-api-remotes').apply(h.ctx)
    assert.equal(typeof eventSource, 'function', 'installed api-remotes must register its Gateway event source')
    let forwardedUpdates = 0
    let cached
    let streamError
    const pickerIds = catalog => modelIds(catalog.groups.find(group => group.id === BRIDGE)?.models ?? [])
    // Deliberately refresh only from forwarded frames, never from ctx.on: a
    // Host-only notification cannot make these cached-picker assertions pass.
    consumeEvents = (async () => {
      try {
        for await (const frame of eventSource(abort.signal)) {
          if (frame.event !== 'llm/models-updated') continue
          assert.deepEqual(frame.args, [BRIDGE], 'forwarded updates must identify the bridge, not the native route')
          cached = pickerIds(await h.catalog())
          forwardedUpdates++
        }
      } catch (error) {
        streamError = error
      }
    })()
    const expectPicker = async (expected, after) => {
      // All I/O is immediate fixture data; bound the wait so a missing forwarded
      // notification fails instead of hanging or silently using a fresh read.
      for (let turn = 0; turn < 100; turn++) {
        if (streamError) throw streamError
        if (forwardedUpdates > after && JSON.stringify(cached) === JSON.stringify(expected)) break
        await settle()
      }
      assert.ok(forwardedUpdates > after, 'visibility/pin/auth change must cross the installed Host-to-Gateway event source')
      assert.deepEqual(cached, expected, 'forwarded event must refresh the consumer picker cache')
      assert.deepEqual(pickerIds(await h.catalog()), expected, 'actual SessionController catalog must match the consumer cache')
      await h.assertNativeUnchanged()
    }

    const id = await h.mount({ enterpriseUrl: '' })
    const fiber = h.loader.resolve(id).fiber
    await expectPicker(['mai-code-2', 'mai-code-2-flash'], 0)
    const pin = async (pinnedModels, expected) => {
      // Drain prior immediate fixture events before measuring this mutation.
      await settle()
      const before = forwardedUpdates
      const status = await h.request('pinned-models', { pinnedModels })
      assert.deepEqual(status.pinnedModels ?? [], pinnedModels)
      await expectPicker(expected, before)
      assert.equal(h.loader.resolve(id).fiber, fiber, 'pin changes must not restart the plugin')
    }
    await pin(['mai-code-2-flash'], ['mai-code-2-flash', 'mai-code-2'])
    await pin([], ['mai-code-2', 'mai-code-2-flash'])
    assert.equal(Object.hasOwn(h.loader.resolve(id).options.config, 'pinnedModels'), false, 'unpinning all must unset pinnedModels')
    // Pin insertion order must not replace the catalog-relative ordering.
    await pin(['mai-code-2-flash', 'mai-code-2'], ['mai-code-2', 'mai-code-2-flash'])
    await pin(['mai-code-2-flash'], ['mai-code-2-flash', 'mai-code-2'])
    console.log('PASS: installed pin/unpin routes reorder actual SessionController.modelCatalog and forwarded consumer cache; pinned-first is stable, native route untouched, no restart')
    const save = async (hiddenModels, expected) => {
      await settle()
      const before = forwardedUpdates
      const status = await h.request('hidden-models', { hiddenModels })
      assert.deepEqual(status.hiddenModels, hiddenModels)
      await expectPicker(expected, before)
      assert.equal(h.loader.resolve(id).fiber, fiber, 'visibility changes must not restart the plugin')
    }
    await save(['mai-code-2'], ['mai-code-2-flash'])
    assert.equal((await h.runtime.resolveModelInfo(BRIDGE, 'mai-code-2')).id, 'mai-code-2', 'hiding remains advisory for an existing session')
    const hidden = await h.request('models')
    assert.deepEqual(modelIds(hidden.models), ['mai-code-2-flash', 'mai-code-2'], 'management rows must remain pinned-first and restorable when hidden')
    assert.deepEqual(hidden.status.hiddenModels, ['mai-code-2'])
    await save([], ['mai-code-2-flash', 'mai-code-2'])
    assert.equal(Object.hasOwn(h.loader.resolve(id).options.config, 'hiddenModels'), false, 'revealing all must unset hiddenModels')
    await save(['mai-code-2', 'mai-code-2-flash'], [])
    assert.deepEqual(modelIds((await h.request('models')).models), ['mai-code-2-flash', 'mai-code-2'], 'all-hidden must retain the full pinned-first management table')
    await save(['mai-code-2-flash'], ['mai-code-2'])
    assert.deepEqual((await h.request('models')).status.pinnedModels, ['mai-code-2-flash'], 'hiding a pin must retain it')
    await pin([], ['mai-code-2'])
    assert.deepEqual((await h.request('models')).status.hiddenModels, ['mai-code-2-flash'], 'unpinning hidden rows must not reveal them')
    await save([], ['mai-code-2', 'mai-code-2-flash'])
    await pin(['mai-code-2-flash'], ['mai-code-2-flash', 'mai-code-2'])
    console.log('PASS: installed Loader + visibility routes + SessionController; hide/reveal/all-hidden/reveal-one, hidden pin retention/unpin without reveal, hidden resolution and restorable management rows')

    const beforeLogout = forwardedUpdates
    assert.equal((await h.request('logout', {})).authenticated, false)
    await expectPicker([], beforeLogout)
    assert.equal(h.records.has(BRIDGE_KEY), false, 'sign-out must delete the bridge fixture credential')
    assert.deepEqual(h.credentialWrites, [BRIDGE_KEY], 'native credentials must never be written or deleted')
    assert.equal(Object.hasOwn(h.loader.resolve(id).options.config, 'hiddenModels'), false, 'sign-out must unset hiddenModels')
    assert.equal(Object.hasOwn(h.loader.resolve(id).options.config, 'pinnedModels'), false, 'sign-out must unset pinnedModels')
    assert.equal(h.loader.resolve(id).options.config.enterpriseUrl, '', 'sign-out must retain bridge enterprise configuration')
    assert.deepEqual((await h.request('models')).models, [], 'sign-out must drop the management snapshot')
    assert.equal(h.loader.resolve(id).fiber, fiber, 'sign-out must update without restart')
    console.log('PASS: installed sign-out empties direct and event-refreshed picker catalogs; native profile, credential and catalog untouched')
    console.log('PASS: installed api-remotes forwards llm/models-updated(copilot-bridge) to its Gateway event source and refreshes the consumer cache')
    console.log('LIMIT: headless Gateway-source proof only; physical browser transport, rendered picker selection and live inference not exercised')
    abort.abort()
    await consumeEvents
    if (streamError) throw streamError
  } finally {
    abort.abort()
    await consumeEvents
    await h.close()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
