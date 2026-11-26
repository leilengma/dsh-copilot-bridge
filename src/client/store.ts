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
