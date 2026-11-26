import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthStatus, ModelCatalog } from '../shared/contract.ts'
import { api, errorMessage } from './api.ts'
import { ModelsTable } from './hidden-models-card.tsx'
import { text, useLocaleRevision } from './i18n.ts'
import { modelCss } from './model-styles.ts'
import { authRevision } from './store.ts'
import { css } from './styles.ts'

/** Catalog view keeps the last good rows visible during discovery and retryable failures. */
export function ModelsDisplay({ catalog, loading, busy, loadError, saveError, onRefresh, onSave, onSavePins }: {
  readonly catalog: ModelCatalog | undefined
  readonly loading: boolean
  readonly busy: boolean
  readonly loadError?: string | undefined
  readonly saveError?: string | undefined
  readonly onRefresh: () => void
  readonly onSave: (ids: readonly string[]) => Promise<void>
  readonly onSavePins: (ids: readonly string[]) => Promise<void>
}) {
  useLocaleRevision()
  const status = catalog?.status
  const error = loadError ?? (catalog?.state === 'error' ? catalog.error ?? text('modelCatalogError') : undefined)
  const discovering = loading || (catalog?.state === 'loading' && loadError === undefined)
  return (
    <section style={modelCss.page} aria-label={text('hiddenModelsTitle')} aria-busy={discovering}>
      <div style={css.actions}>
        <Button type="button" variant="outline" disabled={busy || loading} onClick={onRefresh}>{text('refreshModels')}</Button>
      </div>
      {error === undefined ? null : <div role="alert" style={css.error}>
        {error}{' '}<Button type="button" variant="outline" disabled={busy || loading} onClick={onRefresh}>{text('retry')}</Button>
      </div>}
      {saveError === undefined ? null : <p role="alert" style={css.error}>{saveError}</p>}
      {discovering ? <p role="status" style={css.hint}>{text('loadingModels')}</p> : null}
      {status?.authenticated === false ? <p style={css.body}>{text('modelsSignIn')}</p> : null}
      {status?.authenticated === true && catalog !== undefined && (catalog.models.length > 0 || catalog.state === 'ready') ? <>
        <ModelsTable status={status} models={catalog.models} busy={busy || discovering} onSave={onSave} onSavePins={onSavePins} />
        {!status.configWritable ? <p style={css.hint}>{text('hiddenModelsReadOnly')}</p> : null}
        {!!status.hiddenModels?.length ? <p style={css.hint}>{text('hiddenModelsWarning')}</p> : null}
        <p style={css.hint}>{text('modelMetadataNote')}</p>
      </> : null}
    </section>
  )
}

/** Mounted only while the signed-in user is viewing the Models tab. */
export function CopilotModelsPage({ onStatusChange }: { readonly onStatusChange: (status: AuthStatus) => void }) {
  useLocaleRevision()
  const revision = useSyncExternalStore(authRevision.subscribe, authRevision.getSnapshot, authRevision.getSnapshot)
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const refreshRequested = useRef(false)
  const saving = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (busy) return
    let alive = true
    const current = () => alive && revision === authRevision.getSnapshot()
    setLoading(true)
    setLoadError(undefined)
    const request = refreshRequested.current ? api.refreshModels() : api.models()
    refreshRequested.current = false
    void request.then(
      value => {
        if (!current()) return
        setCatalog(value)
        if (!value.status.authenticated) onStatusChange(value.status)
      },
      (cause: unknown) => { if (current()) setLoadError(errorMessage(cause)) },
    ).finally(() => { if (current()) setLoading(false) })
    return () => { alive = false }
  }, [revision, retry, busy, onStatusChange])

  const save = async (ids: readonly string[], preference: 'hidden' | 'pinned') => {
    // Also guard the interval before React commits disabled buttons.
    if (saving.current) return
    saving.current = true
    const saveRevision = authRevision.getSnapshot()
    const current = () => mounted.current && saveRevision === authRevision.getSnapshot()
    setBusy(true)
    setSaveError(undefined)
    try {
      const status = await (preference === 'hidden' ? api.setHiddenModels(ids) : api.setPinnedModels(ids))
      if (!current()) return
      setCatalog(current => current === undefined ? current : { ...current, status })
      if (!status.authenticated) onStatusChange(status)
    } catch (cause) {
      // Retain the confirmed visibility and pin states; the same action retries inline.
      if (current()) setSaveError(errorMessage(cause))
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const refresh = () => {
    if (busy || loading) return
    refreshRequested.current = true
    setRetry(value => value + 1)
  }
  return <ModelsDisplay catalog={catalog} loading={loading} busy={busy} loadError={loadError} saveError={saveError} onRefresh={refresh} onSave={ids => save(ids, 'hidden')} onSavePins={ids => save(ids, 'pinned')} />
}
