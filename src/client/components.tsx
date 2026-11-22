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

const COPILOT_ICON_PATHS = [
  'M7.998 15.035c-4.562 0-7.873-2.914-7.998-3.749V9.338c.085-.628.677-1.686 1.588-2.065.013-.07.024-.143.036-.218.029-.183.06-.384.126-.612-.201-.508-.254-1.084-.254-1.656 0-.87.128-1.769.693-2.484.579-.733 1.494-1.124 2.724-1.261 1.206-.134 2.262.034 2.944.765.05.053.096.108.139.165.044-.057.094-.112.143-.165.682-.731 1.738-.899 2.944-.765 1.23.137 2.145.528 2.724 1.261.566.715.693 1.614.693 2.484 0 .572-.053 1.148-.254 1.656.066.228.098.429.126.612.012.076.024.148.037.218.924.385 1.522 1.471 1.591 2.095v1.872c0 .766-3.351 3.795-8.002 3.795Zm0-1.485c2.28 0 4.584-1.11 5.002-1.433V7.862l-.023-.116c-.49.21-1.075.291-1.727.291-1.146 0-2.059-.327-2.71-.991A3.222 3.222 0 0 1 8 6.303a3.24 3.24 0 0 1-.544.743c-.65.664-1.563.991-2.71.991-.652 0-1.236-.081-1.727-.291l-.023.116v4.255c.419.323 2.722 1.433 5.002 1.433ZM6.762 2.83c-.193-.206-.637-.413-1.682-.297-1.019.113-1.479.404-1.713.7-.247.312-.369.789-.369 1.554 0 .793.129 1.171.308 1.371.162.181.519.379 1.442.379.853 0 1.339-.235 1.638-.54.315-.322.527-.827.617-1.553.117-.935-.037-1.395-.241-1.614Zm4.155-.297c-1.044-.116-1.488.091-1.681.297-.204.219-.359.679-.242 1.614.091.726.303 1.231.618 1.553.299.305.784.54 1.638.54.922 0 1.28-.198 1.442-.379.179-.2.308-.578.308-1.371 0-.765-.123-1.242-.37-1.554-.233-.296-.693-.587-1.713-.7Z',
  'M6.25 9.037a.75.75 0 0 1 .75.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 .75-.75Zm4.25.75v1.501a.75.75 0 0 1-1.5 0V9.787a.75.75 0 0 1 1.5 0Z',
] as const

/** Settings navigation icon (Harness `settings.section.icon` slot). */
export function CopilotNavIcon({ size = 16 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {COPILOT_ICON_PATHS.map(d => <path key={d} d={d} />)}
    </svg>
  )
}
