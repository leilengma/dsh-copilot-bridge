import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CopilotUsage } from '../shared/contract.ts'
import { api } from './api.ts'
import { text, useLocaleRevision } from './i18n.ts'
import { authRevision } from './store.ts'
import { css } from './styles.ts'

/** Display only: no network or authentication work while rendering. */
export function UsageDisplay({ usage, loading, onRefresh }: {
  readonly usage?: CopilotUsage | undefined
  readonly loading: boolean
  readonly onRefresh: () => void
}) {
  useLocaleRevision()
  const quota = usage?.state === 'available' ? usage : undefined
  const percent = quota?.percentUsed === undefined ? undefined : Math.floor(Math.max(0, Math.min(100, quota.percentUsed)))
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 })
  const exact = quota?.used !== undefined && quota.total !== undefined ? text('usageExact', { used: format(quota.used), total: format(quota.total) }) : undefined
  const label = quota?.unlimited ? text('usageUnlimited') : percent === undefined ? '—' : text('usagePercent', { value: percent })
  const reset = quota?.reset ? new Intl.DateTimeFormat(undefined, quota.reset.hasTime
    ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(quota.reset.at)) : undefined
  return (
    <section aria-label={text('usageTitle')} aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <style>{`.copilot-usage-exact{display:none}.copilot-usage-value:hover .copilot-usage-percent,.copilot-usage-value:focus .copilot-usage-percent{display:none}.copilot-usage-value:hover .copilot-usage-exact,.copilot-usage-value:focus .copilot-usage-exact{display:inline}.copilot-usage-value:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px;border-radius:3px}`}</style>
      <div style={css.row}>
        <strong style={css.body}>{quota?.unit === 'requests' ? text('usageRequests') : text('usageCredits')}</strong>
        <div style={css.actions}>
          {reset ? <span style={css.hint}>{text('usageReset', { date: reset })}</span> : null}
          <Button type="button" variant="ghost" aria-label={text('usageRefresh')} title={text('usageRefresh')} disabled={loading} onClick={onRefresh} style={{ padding: 4 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></svg>
          </Button>
        </div>
      </div>
      {loading || !quota ? <p role="status" style={css.hint}>{text(loading ? 'usageLoading' : 'usageUnavailable')}</p> : <>
        <span className={exact ? 'copilot-usage-value' : undefined} tabIndex={exact ? 0 : undefined} aria-label={exact ? `${label}; ${exact}` : undefined} style={{ ...css.body, alignSelf: 'flex-start', fontVariantNumeric: 'tabular-nums' }}>
          <span className={exact ? 'copilot-usage-percent' : undefined}>{label}</span>
          {exact ? <span className="copilot-usage-exact">{exact}</span> : null}
        </span>
        {percent === undefined || quota.unlimited ? null : <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={text('usageTitle')} aria-valuetext={exact ?? label} style={{ height: 5, borderRadius: 4, overflow: 'hidden', background: 'var(--dsw-alias-border-l2)' }}>
          <div style={{ width: `${percent}%`, height: '100%', background: 'var(--dsw-alias-brand-primary, #4d9af1)' }} />
        </div>}
      </>}
    </section>
  )
}

/** Mounted only on the authenticated Account tab. No polling and no persistent quota cache. */
export function AccountUsage({ issuer }: { readonly issuer: string }) {
  const revision = useSyncExternalStore(authRevision.subscribe, authRevision.getSnapshot, authRevision.getSnapshot)
  const [attempt, setAttempt] = useState(0)
  const [usage, setUsage] = useState<CopilotUsage>()
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    const current = () => active && revision === authRevision.getSnapshot()
    setUsage(undefined)
    setLoading(true)
    void api.usage().then(value => {
      if (current()) setUsage(value)
    }).catch(() => {
      if (current()) setUsage({ state: 'unavailable' })
    }).finally(() => { if (current()) setLoading(false) })
    return () => { active = false }
  }, [issuer, revision, attempt])
  return <UsageDisplay usage={usage} loading={loading} onRefresh={() => setAttempt(value => value + 1)} />
}
