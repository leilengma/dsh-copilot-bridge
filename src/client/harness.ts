/**
 * The slice of the Harness Web client this plugin uses, declared structurally.
 *
 * The client packages' own context types pull in `@deepseek-ai/dsh-client-ui-slots`
 * and other packages that are not published as standalone dependencies, so the
 * shapes below pin only what this plugin calls (verified against
 * `@deepseek-ai/dsh` 0.2.2-rc.5). A Harness change to any of them fails here,
 * in one place.
 */
import type { ComponentType } from 'react'

export type Dispose = () => void

/** `@deepseek-ai/dsh-client-locale`: dictionary registry plus active locale. */
export interface LocaleRuntime {
  register(namespace: string, dictionaries: Readonly<Record<string, Readonly<Record<string, string>>>>): Dispose
  getSnapshot(): { readonly active: string; readonly revision: number }
  subscribe(listener: () => void): Dispose
}

interface SlotBase {
  readonly id: string
  readonly order?: number
  readonly locale?: string
}

/**
 * Owner props of the Models page `settings.models.provider-card` keyed slot
 * (`@deepseek-ai/dsh-client-ui-settings-models` slot-contract), trimmed to
 * the fields this plugin reads.
 */
export interface ProviderCardProps {
  /** The card's directory row; `provider` is the route id, `settingsNs` the dispatch key. */
  readonly provider: { readonly provider: string; readonly settingsNs: string }
  /** Whether a profile already configures the route; false on the add-provider draft. */
  readonly configured: boolean
  /** Whether the row's api-key credential is confirmed configured. */
  readonly keyConfigured: boolean
}

/** `@deepseek-ai/dsh-client-ui-renderer`: the UI slot registry. */
export interface SlotRegistry {
  register(slot: SlotBase & { readonly name: 'conversation.input.overlay' }, component: ComponentType): Dispose
  register(slot: SlotBase & { readonly name: 'settings.section'; readonly label: () => string }, component: ComponentType): Dispose
  register(slot: { readonly name: 'settings.section.icon'; readonly id: string }, component: ComponentType<{ size?: number }>): Dispose
  /** Keyed slot: one entry per `key` and `priority`; a second entry at an occupied cell throws. */
  register(slot: {
    readonly name: 'settings.models.provider-card'
    readonly key: string
    readonly priority?: number
    readonly locale?: string
  }, component: ComponentType<ProviderCardProps>): Dispose
  /** Run `register` whenever the named slot becomes available; its disposer runs when the slot goes away. */
  inject(name: string, register: () => Dispose): void
}

export interface CommandConfirmation {
  readonly title: string
  readonly description: string
  readonly acknowledgeLabel: string
  readonly cancelLabel: string
  readonly confirmLabel: string
}

export interface PopupOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
  readonly confirmation?: CommandConfirmation
}

/** `@deepseek-ai/dsh-client-ui-commands`: client-side command decoration. */
export interface CommandUiRuntime {
  decorate(decoration: {
    readonly name: string
    readonly available: () => boolean
    readonly ui: {
      readonly kind: 'popupSelect'
      readonly options: () => Promise<readonly PopupOption[]>
      readonly onSelect: (option: PopupOption, session: { readonly sessionId: string }) => Promise<void>
    }
  }): Dispose
}

type CommandOutcome =
  | { readonly ok: true; readonly value: { readonly matched: boolean } }
  | { readonly ok: false; readonly error: { readonly message: string } }

/** `@deepseek-ai/dsh-api-session-controller`: live session bindings. */
export interface SessionsRuntime {
  binding(sessionId: string): { readonly session: { command(text: string): Promise<CommandOutcome> } } | undefined
}

/** `@deepseek-ai/dsh-api-remotes`: Host events forwarded to the browser. */
export interface ClientRemote {
  $on(event: 'credentials/reference-updated', listener: (ref: string) => void): Dispose
}

/** Command result as the `command/executed` event delivers it. */
export interface ExecutedCommandResult {
  readonly kind: 'success' | 'error'
  readonly text?: string
}

/** The client plugin context, restricted to the services listed in `inject`. */
export interface ClientContext {
  readonly locale: LocaleRuntime
  readonly slots: SlotRegistry
  readonly commandUi: CommandUiRuntime
  readonly sessions: SessionsRuntime
  readonly remote: ClientRemote
  effect(setup: () => Dispose | (() => Promise<void>), label?: string): void
  on(event: 'command/executed', listener: (sessionId: string, name: string, result: ExecutedCommandResult) => void): Dispose
}
