import { api } from './api.ts'

/** Minimal external store for `useSyncExternalStore`. */
export interface Store<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
  set(next: T): void
}

export function createStore<T>(initial: T): Store<T> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

/** Bumped whenever the Host reports a credential change, so status views re-read it. */
export const authRevision = createStore(0)

export const bumpAuthRevision = (): void => authRevision.set(authRevision.getSnapshot() + 1)

/** The device-code dialog shown over the composer after `/copilot-login`. */
export interface LoginDialogState {
  readonly open: boolean
  readonly verificationUri: string
  readonly userCode: string
}

const CLOSED: LoginDialogState = { open: false, verificationUri: '', userCode: '' }

export const loginDialog = createStore<LoginDialogState>(CLOSED)

export const closeLoginDialog = (): void => loginDialog.set(CLOSED)

/** Close the dialog once the Host reports a stored credential; keep it open on a transient failure. */
export async function closeLoginDialogWhenAuthenticated(): Promise<void> {
  if (!loginDialog.getSnapshot().open) return
  try {
    if ((await api.status()).authenticated) closeLoginDialog()
  } catch {
    // The polling fallback or the next credential event retries.
  }
}

/** Open the dialog from a `/copilot-login` result text, which carries the URL and code. */
export function showLoginResult(commandName: string, resultText: string | undefined): void {
  if (commandName !== 'copilot-login' || resultText === undefined) return
  const verificationUri = resultText.match(/https:\/\/\S+/)?.[0]
  const userCode = resultText.match(/Enter this code:\s*([A-Z0-9-]+)/i)?.[1]
  if (verificationUri === undefined || userCode === undefined) return
  loginDialog.set({ open: true, verificationUri, userCode })
}
