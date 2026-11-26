import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, SegmentedTabs, type SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthStatus } from '../shared/contract.ts'
import { api, errorMessage } from './api.ts'
import { text, useLocaleRevision } from './i18n.ts'
import { CopilotModelsPage } from './models-page.tsx'
import { CopilotAccount } from './settings-page.tsx'
import { authRevision } from './store.ts'
import { css } from './styles.ts'

type Tab = 'account' | 'models'

/** Plugins keeps one stable entry for both authentication and model management. */
export function CopilotPluginEntry({ view }: { readonly view: 'summary' | 'page' }) {
  useLocaleRevision()
  return view === 'summary' ? <>{text('modelsSummary')}</> : <CopilotPluginPage />
}

function CopilotPluginPage() {
  useLocaleRevision()
  const revision = useSyncExternalStore(authRevision.subscribe, authRevision.getSnapshot, authRevision.getSnapshot)
  const [status, setStatus] = useState<AuthStatus>()
  const [tab, setTab] = useState<Tab>('account')
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const acceptStatus = useCallback((value: AuthStatus) => {
    generation.current++
    setStatus(value)
    setError(undefined)
    if (!value.authenticated) setTab('account')
  }, [])

  useEffect(() => {
    let alive = true
    const request = ++generation.current
    api.status().then(
      value => { if (alive && request === generation.current && revision === authRevision.getSnapshot()) acceptStatus(value) },
      (cause: unknown) => { if (alive && request === generation.current && revision === authRevision.getSnapshot()) setError(errorMessage(cause)) },
    )
    return () => { alive = false }
  }, [revision, retry, acceptStatus])

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    {error === undefined ? null : <p role="alert" style={css.error}>
      {error}{' '}<Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}>{text('retry')}</Button>
    </p>}
    {status === undefined && error === undefined ? <p role="status" style={css.hint}>{text('loadingAccount')}</p> : null}
    <CopilotPluginTabs status={status} tab={tab} onTabChange={setTab} onStatusChange={acceptStatus} />
  </section>
}

export function CopilotPluginTabs({ status, tab, onTabChange, onStatusChange }: {
  readonly status: AuthStatus | undefined
  readonly tab: Tab
  readonly onTabChange: (tab: Tab) => void
  readonly onStatusChange: (status: AuthStatus) => void
}) {
  useLocaleRevision()
  const authenticated = status?.authenticated === true
  const selected = authenticated ? tab : 'account'
  const items: [SegmentedTab<Tab>, ...SegmentedTab<Tab>[]] = [
    { value: 'account', label: text('accountTab'), id: 'copilot-account-tab', panelId: 'copilot-account-panel' },
  ]
  if (authenticated) items.push({ value: 'models', label: text('modelsTab'), id: 'copilot-models-tab', panelId: 'copilot-models-panel' })
  return <>
    <div style={{ maxWidth: 320 }}><SegmentedTabs items={items} value={selected} onChange={onTabChange} label={text('nav')} size="sm" /></div>
    <div role="tabpanel" id="copilot-account-panel" aria-labelledby="copilot-account-tab" hidden={selected !== 'account'}>
      <CopilotAccount status={status} onStatusChange={onStatusChange} active={selected === 'account'} />
    </div>
    {authenticated ? <div role="tabpanel" id="copilot-models-panel" aria-labelledby="copilot-models-tab" hidden={selected !== 'models'}>
      {selected === 'models' ? <CopilotModelsPage onStatusChange={onStatusChange} /> : null}
    </div> : null}
  </>
}
