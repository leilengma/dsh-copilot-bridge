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

/** `@deepseek-ai/dsh-client-ui-renderer`: the UI slot registry. */
export interface SlotRegistry {
  /** Layout main panel and matching host-owned sidebar navigation entry. */
  register(slot: { readonly name: 'main'; readonly key: string; readonly locale?: string }, component: ComponentType): Dispose
  register(slot: {
    readonly name: 'sidebar.panellist'
    readonly id: string
    readonly order?: number
    readonly label: () => string
    readonly locale?: string
  }, component: ComponentType<{ readonly size: number; readonly active: boolean }>): Dispose
  /** Bundle configuration: keyed by npm package name, rendered under its metadata/icon header. */
  register(slot: {
    readonly name: 'plugins.bundle.config'
    readonly key: string
    readonly locale?: string
    readonly inject: () => { readonly onOpen: () => void }
  }, component: ComponentType<{ readonly onOpen: () => void }>): Dispose
  /** Run `register` whenever the named slot becomes available; its disposer runs when the slot goes away. */
  inject(name: string, register: () => Dispose): void
}

/** `@deepseek-ai/dsh-api-remotes`: Host events forwarded to the browser. */
export interface ClientRemote {
  $on(event: 'credentials/reference-updated' | 'credentials/record-updated' | 'llm/models-updated', listener: (ref: string) => void): Dispose
}

/** The client plugin context, restricted to the services listed in `inject`. */
export interface ClientContext {
  /** @deepseek-ai/dsh-client-ui-layout: selects a registered main slot key. */
  readonly layout: { selectPanel(panelId: string): void }
  readonly locale: LocaleRuntime
  readonly slots: SlotRegistry
  readonly remote: ClientRemote
  effect(setup: () => Dispose | (() => Promise<void>), label?: string): void
}
