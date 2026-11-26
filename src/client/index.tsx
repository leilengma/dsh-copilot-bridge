/**
 * dsh-copilot-bridge Web client: the Plugins Account/Models tabs,
 * the `/copilot-login` device-code dialog, and the
 * `/copilot-logout` confirmation.
 */
import type { ClientContext } from './harness.ts'
import { PI_AI_RECORD_KEY } from '../shared/contract.ts'
import { LoginDialog } from './components.tsx'
import { DICTIONARIES, LOCALE_NS, bindLocale, text } from './i18n.ts'
import { CopilotPluginEntry } from './plugin-page.tsx'
import { CopilotProviderCardNotice } from './provider-card.tsx'
import { bumpAuthRevision, closeLoginDialogWhenAuthenticated, showLoginResult } from './store.ts'

const SECTION_ID = 'copilot-bridge'
/** Settings namespace of the pi-ai adapter that owns the `github-copilot` route; the provider-card slot key. */
const PI_AI_SETTINGS_NS = 'llm-pi-ai'

export const inject = ['slots', 'commandUi', 'sessions', 'locale', 'remote']

export function apply(ctx: ClientContext): void {
  bindLocale(ctx.locale)
  ctx.effect(() => ctx.locale.register(LOCALE_NS, DICTIONARIES), `${SECTION_ID}: locale dictionaries`)

  ctx.on('command/executed', (_sessionId, commandName, result) => showLoginResult(commandName, result.text))

  // A committed credential closes the dialog as soon as the Host confirms it.
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', () => {
      bumpAuthRevision()
      void closeLoginDialogWhenAuthenticated()
    }),
    `${SECTION_ID}: close login dialog after credential commit`,
  )

  // Discovery and visibility edits update the grant record without necessarily
  // changing its credential reference. Refresh an already-open Models page too.
  ctx.effect(
    () => ctx.remote.$on('credentials/record-updated', ref => {
      if (ref === PI_AI_RECORD_KEY) bumpAuthRevision()
    }),
    `${SECTION_ID}: refresh discovered models`,
  )

  ctx.effect(() => ctx.commandUi.decorate({
    name: 'copilot-logout',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async () => [{
        id: 'logout',
        label: text('logoutOption'),
        detail: text('logoutOptionDetail'),
        confirmation: {
          title: text('logoutConfirmTitle'),
          description: text('logoutConfirmDescription'),
          acknowledgeLabel: text('logoutAcknowledge'),
          cancelLabel: text('cancel'),
          confirmLabel: text('logoutConfirm'),
        },
      }],
      onSelect: async (_option, session) => {
        const live = ctx.sessions.binding(session.sessionId)?.session
        if (live === undefined) throw new Error(text('sessionUnavailable'))
        const result = await live.command('/copilot-logout')
        if (!result.ok) throw new Error(text('logoutFailed', { message: result.error.message }))
        if (!result.value.matched) throw new Error(text('commandUnavailable'))
      },
    },
  }), `${SECTION_ID}: confirm /copilot-logout`)

  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay',
    id: `${SECTION_ID}-login-dialog`,
    order: 50,
    locale: LOCALE_NS,
  }, LoginDialog))

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
