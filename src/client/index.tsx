/**
 * dsh-copilot-bridge Web client: the Plugins Account/Models tabs.
 */
import type { ClientContext } from './harness.ts'
import { PI_AI_RECORD_KEY } from '../shared/contract.ts'
import { DICTIONARIES, LOCALE_NS, bindLocale, text } from './i18n.ts'
import { CopilotPluginEntry } from './plugin-page.tsx'
import { CopilotProviderCardNotice } from './provider-card.tsx'
import { bumpAuthRevision } from './store.ts'

const SECTION_ID = 'copilot-bridge'
/** Settings namespace of the pi-ai adapter that owns the `github-copilot` route; the provider-card slot key. */
const PI_AI_SETTINGS_NS = 'llm-pi-ai'

export const inject = ['slots', 'locale', 'remote']

export function apply(ctx: ClientContext): void {
  bindLocale(ctx.locale)
  ctx.effect(() => ctx.locale.register(LOCALE_NS, DICTIONARIES), `${SECTION_ID}: locale dictionaries`)

  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', bumpAuthRevision),
    `${SECTION_ID}: refresh account after credential changes`,
  )

  // Discovery and visibility edits update the grant record without necessarily
  // changing its credential reference. Refresh an already-open Models page too.
  ctx.effect(
    () => ctx.remote.$on('credentials/record-updated', ref => {
      if (ref === PI_AI_RECORD_KEY) bumpAuthRevision()
    }),
    `${SECTION_ID}: refresh discovered models`,
  )

  ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item',
    id: `${SECTION_ID}-models`,
    order: 20,
    locale: LOCALE_NS,
    label: () => text('nav'),
  }, CopilotPluginEntry))

  // Models page: tell the user the github-copilot card needs no API key. The
  // slot is keyed by adapter namespace, so the entry receives every pi-ai
  // card and renders only on github-copilot. Another plugin already holding
  // this key must not take the rest of this plugin down with it.
  ctx.slots.inject('settings.models.provider-card', () => {
    try {
      return ctx.slots.register({
        name: 'settings.models.provider-card',
        key: PI_AI_SETTINGS_NS,
        locale: LOCALE_NS,
      }, CopilotProviderCardNotice)
    } catch (error) {
      console.warn(`[${SECTION_ID}] Models page notice not registered:`, error)
      return () => {}
    }
  })
}
