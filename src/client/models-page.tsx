import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthStatus, ModelCatalog } from '../shared/contract.ts'
import { api, errorMessage } from './api.ts'
import { ModelsTable } from './hidden-models-card.tsx'
import { text, useLocaleRevision } from './i18n.ts'
import { modelCss } from './model-styles.ts'
import { authRevision } from './store.ts'
import { css } from './styles.ts'

/** Mounted only while the signed-in user is viewing the Models tab. */
export function CopilotModelsPage({ onStatusChange }: { readonly onStatusChange: (status: AuthStatus) => void }) {
  useLocaleRevision()
  const revision = useSyncExternalStore(authRevision.subscribe, authRevision.getSnapshot, authRevision.getSnapshot)
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const saving = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (busy) return
    let alive = true
    api.models().then(
      value => {
        if (!alive || revision !== authRevision.getSnapshot()) return
        setCatalog(value)
        setLoadError(undefined)
        if (!value.status.authenticated) onStatusChange(value.status)
      },
      (cause: unknown) => { if (alive) setLoadError(errorMessage(cause)) },
    )
    return () => { alive = false }
  }, [revision, retry, busy, onStatusChange])

  const save = async (ids: readonly string[]) => {
    // Also guard the interval before React commits disabled buttons.
    if (saving.current) return
    saving.current = true
    const saveRevision = authRevision.getSnapshot()
    const current = () => mounted.current && saveRevision === authRevision.getSnapshot()
    setBusy(true)
    setSaveError(undefined)
    try {
      const status = await api.setHiddenModels(ids)
      if (!current()) return
      setCatalog(current => current === undefined ? current : { ...current, status })
      if (!status.authenticated) onStatusChange(status)
    } catch (cause) {
      // Retain the previous confirmed eye state and keep failures inline.
      if (current()) setSaveError(errorMessage(cause))
    } finally {
      saving.current = false
      if (mounted.current) setBusy(false)
    }
  }

  const status = catalog?.status
  return (
    <section style={modelCss.page} aria-label={text('hiddenModelsTitle')}>
      {loadError === undefined ? null : <div role="alert" style={css.error}>
        {loadError}{' '}<Button type="button" variant="outline" disabled={busy} onClick={() => setRetry(value => value + 1)}>{text('retry')}</Button>
      </div>}
      {saveError === undefined ? null : <p role="alert" style={css.error}>{saveError}</p>}
      {catalog === undefined && loadError === undefined ? <p role="status" style={css.hint}>{text('loadingModels')}</p> : null}
      {status?.authenticated === false ? <p style={css.body}>{text('modelsSignIn')}</p> : null}
      {status?.authenticated === true && status.availableModels === undefined ? <p style={css.hint}>{text('modelListPending')}</p> : null}
      {status?.authenticated === true && status.availableModels !== undefined && catalog !== undefined ? <>
        <ModelsTable status={status} models={catalog.models.filter(model => status.availableModels?.includes(model.id))} busy={busy} onSave={save} />
        {!status.configWritable ? <p style={css.hint}>{text('hiddenModelsReadOnly')}</p> : null}
        {!!status.hiddenModels?.length ? <p style={css.hint}>{text('hiddenModelsWarning')}</p> : null}
        <p style={css.hint}>{text('modelMetadataNote')}</p>
      </> : null}
    </section>
  )
}
