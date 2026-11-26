import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelCatalog } from '../shared/contract.ts'
import { api, errorMessage } from './api.ts'
import { ModelsTable } from './hidden-models-card.tsx'
import { text, useLocaleRevision } from './i18n.ts'
import { modelCss } from './model-styles.ts'
import { authRevision } from './store.ts'
import { css } from './styles.ts'

/** Plugins list entries are rendered once as a summary and again as their own detail page. */
export function CopilotModelsEntry({ view }: { readonly view: 'summary' | 'page' }) {
  useLocaleRevision()
  return view === 'summary' ? <>{text('modelsSummary')}</> : <CopilotModelsPage />
}

function CopilotModelsPage() {
  useLocaleRevision()
  const revision = useSyncExternalStore(authRevision.subscribe, authRevision.getSnapshot, authRevision.getSnapshot)
  const [catalog, setCatalog] = useState<ModelCatalog>()
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const saving = useRef(false)

  useEffect(() => {
    if (busy) return
    let alive = true
    api.models().then(
      value => { if (alive) { setCatalog(value); setLoadError(undefined) } },
      (cause: unknown) => { if (alive) setLoadError(errorMessage(cause)) },
    )
    return () => { alive = false }
  }, [revision, retry, busy])

  const save = async (ids: readonly string[]) => {
    // Also guard the interval before React commits disabled buttons.
    if (saving.current) return
    saving.current = true
    setBusy(true)
    setSaveError(undefined)
    try {
      const status = await api.setHiddenModels(ids)
      setCatalog(current => current === undefined ? current : { ...current, status })
    } catch (cause) {
      // Retain the previous confirmed eye state and keep failures inline.
      setSaveError(errorMessage(cause))
    } finally {
      saving.current = false
      setBusy(false)
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
