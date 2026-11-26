import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button, Input, Modal, StateDot, writeClipboard, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthStatus } from '../shared/contract.ts'
import { text, useLocaleRevision } from './i18n.ts'
import { closeLoginDialog, closeLoginDialogWhenAuthenticated, loginDialog } from './store.ts'
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

/** Device-code dialog over the composer, opened by `/copilot-login`. */
export function LoginDialog() {
  useLocaleRevision()
  const state = useSyncExternalStore(loginDialog.subscribe, loginDialog.getSnapshot, loginDialog.getSnapshot)
  const [copied, setCopied] = useState(false)
  useEffect(() => { if (state.open) setCopied(false) }, [state.open, state.userCode])
  useEffect(() => {
    if (!state.open) return
    // Bounded fallback for a reconnect or a missed credential event.
    const timer = setInterval(() => { void closeLoginDialogWhenAuthenticated() }, 2000)
    return () => clearInterval(timer)
  }, [state.open, state.userCode])
  const copy = async () => { if (await writeClipboard(state.userCode)) setCopied(true) }
  return (
    <Modal
      open={state.open}
      onClose={closeLoginDialog}
      title={text('loginDialogTitle')}
      closeLabel={text('close')}
      description={text('loginDialogDescription')}
      footer={
        <>
          <Button variant="outline" onClick={closeLoginDialog}>{text('close')}</Button>
          <Button variant="primary" onClick={() => { globalThis.open(state.verificationUri, '_blank', 'noopener,noreferrer') }}>
            {text('openGitHub')}
          </Button>
        </>
      }
    >
      <div style={css.modalBody}>
        <a href={state.verificationUri} target="_blank" rel="noreferrer" style={css.link}>{state.verificationUri}</a>
        <DeviceCodeField value={state.userCode} copied={copied} onCopy={() => { void copy() }} />
      </div>
    </Modal>
  )
}
