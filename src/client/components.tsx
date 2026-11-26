import { Button, Input, StateDot, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthStatus } from '../shared/contract.ts'
import { text, useLocaleRevision } from './i18n.ts'
import { css } from './styles.ts'

export function StateLabel({ status }: { readonly status: AuthStatus | undefined }) {
  useLocaleRevision()
  const authenticated = status?.authenticated === true
  const pending = status?.state === 'pending'
  const state: StateDotState = authenticated ? 'done' : pending ? 'ongoing' : 'error'
  const label = authenticated ? text('signedIn') : pending ? text('pending') : text('signedOut')
  return <span style={css.status}><StateDot state={state} />{label}</span>
}

export function DeviceCodeField({ value, copied, onCopy }: {
  readonly value: string
  readonly copied: boolean
  readonly onCopy: () => void
}) {
  useLocaleRevision()
  return (
    <div style={css.field}>
      <span style={css.label}>{text('deviceCode')}</span>
      <div style={css.codeRow}>
        <Input
          readOnly
          value={value}
          aria-label={text('deviceCode')}
          onFocus={event => event.currentTarget.select()}
          style={css.code}
        />
        <Button variant="outline" size="sm" onClick={onCopy}>{copied ? text('copied') : text('copyCode')}</Button>
      </div>
    </div>
  )
}
