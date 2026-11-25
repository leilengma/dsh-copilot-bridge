import { useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthStatus } from '../shared/contract.ts'
import { errorMessage } from './api.ts'
import { text, useLocaleRevision } from './i18n.ts'
import { css } from './styles.ts'

/** Raw account ids remain visible here even when hidden from Harness model selection. */
export function HiddenModelsCard({ status, busy, onSave }: {
  readonly status: AuthStatus
  readonly busy: boolean
  readonly onSave: (ids: readonly string[]) => Promise<void>
}) {
  useLocaleRevision()
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string>()
  const models = status.availableModels
  if (models === undefined) return <p style={css.hint}>{text('modelListPending')}</p>
  const hidden = status.hiddenModels ?? []
  const shown = [...models].sort().filter(id => id.toLowerCase().includes(filter.toLowerCase()))
  const toggle = async (id: string, hide: boolean) => {
    setError(undefined)
    try {
      await onSave(hide ? [...hidden, id] : hidden.filter(value => value !== id))
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }
  return (
    <div style={css.card}>
      <h3 style={css.subtitle}>{text('hiddenModelsTitle')}</h3>
      <p role="status" style={css.body}>
        {text('modelCounts', { available: models.length, hidden: hidden.length })}
        {filter.length > 0 ? text('modelsShowing', { shown: shown.length }) : null}
      </p>
      <div style={css.field}>
        <label style={css.label} htmlFor="copilot-bridge-model-filter">{text('filterModels')}</label>
        <div style={css.inputRow}>
          <Input
            id="copilot-bridge-model-filter"
            type="search"
            value={filter}
            onChange={event => setFilter(event.currentTarget.value)}
            style={{ minWidth: 0, flex: '1 1 160px' }}
          />
          <Button type="button" variant="ghost" aria-label={text('clearModelFilter')} disabled={filter.length === 0} onClick={() => setFilter('')}>×</Button>
        </div>
      </div>
      <div role="group" aria-label={text('hiddenModelsTitle')} style={css.modelList}>
        {shown.map(id => (
          <div key={id} style={css.modelRow}>
            <Checkbox label={text('hideModel', { id })} checked={hidden.includes(id)} disabled={busy || !status.configWritable} onChange={hide => { void toggle(id, hide) }} />
          </div>
        ))}
        {shown.length === 0 ? <p style={css.hint}>{text('noMatchingModels')}</p> : null}
      </div>
      {!status.configWritable ? <p style={css.hint}>{text('hiddenModelsReadOnly')}</p> : null}
      {hidden.length > 0 ? <p style={css.hint}>{text('hiddenModelsWarning')}</p> : null}
      {error === undefined ? null : <p role="alert" style={css.error}>{error}</p>}
    </div>
  )
}
