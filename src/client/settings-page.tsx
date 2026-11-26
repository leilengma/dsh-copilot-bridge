import { useEffect, useState } from 'react'
import { Button, Input, RiskConfirmation, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthStatus } from '../shared/contract.ts'
import { api, errorMessage } from './api.ts'
import { AccountUsage } from './account-usage.tsx'
import { DeviceCodeField, StateLabel } from './components.tsx'
import { text, useLocaleRevision } from './i18n.ts'
import { authRevision } from './store.ts'
import { css } from './styles.ts'

declare const __PLUGIN_VERSION__: string
const REPOSITORY = 'https://github.com/leilengma/dsh-copilot-bridge'

/**
 * Edits the GitHub Enterprise URL saved in the profile's configuration file.
 * The input starts empty; the saved value is shown as its placeholder.
 */
function EnterpriseUrlCard({ status, busy, onSave }: {
  readonly status: AuthStatus | undefined
  readonly busy: boolean
  readonly onSave: (enterpriseUrl: string) => Promise<boolean>
}) {
  useLocaleRevision()
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState<string>()
  const saveDraft = async (value: string) => {
    if (await onSave(value)) {
      setDraft('')
      setSaved(value)
    }
  }
  const writable = status?.configWritable === true
  const configured = status?.enterpriseUrl ?? ''
  const githubHost = status?.githubHost ?? 'github.com'
  return (
    <div style={css.card}>
      <h3 style={css.subtitle}>{text('hostTitle')}</h3>
      <p style={css.intro}>{text('hostIntro', { host: githubHost })}</p>
      <form
        style={css.field}
        onSubmit={event => { event.preventDefault(); if (draft.trim().length > 0) void saveDraft(draft) }}
      >
        <label style={css.label} htmlFor="copilot-bridge-enterprise-url">{text('hostLabel')}</label>
        <div style={css.inputRow}>
          <Input
            id="copilot-bridge-enterprise-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={draft}
            placeholder={configured.length > 0 ? configured : text('hostPlaceholder')}
            disabled={busy || !writable}
            onChange={event => { setDraft(event.currentTarget.value); setSaved(undefined) }}
            style={{ minWidth: 320, flex: '1 1 320px' }}
          />
          <Button type="submit" variant="primary" disabled={busy || !writable || draft.trim().length === 0}>
            {busy ? text('saving') : text('saveHost')}
          </Button>
          {configured.length > 0
            ? <Button type="button" variant="outline" disabled={busy || !writable} onClick={() => { void saveDraft('') }}>{text('resetHost')}</Button>
            : null}
        </div>
      </form>
      {!writable && status !== undefined ? <p style={css.hint}>{text('hostReadOnly')}</p> : null}
      {saved !== undefined ? <p role="status" style={css.hint}>{text('hostSaved', { host: githubHost })}</p> : null}
      {status?.signedInHost !== undefined
        ? <p role="status" style={css.body}>{text('hostMismatch', { signedIn: status.signedInHost, host: githubHost })}</p>
        : null}
    </div>
  )
}

/** Account tab: parent-owned authentication status also gates the Models tab. */
export function CopilotAccount({ status, onStatusChange, active }: {
  readonly status: AuthStatus | undefined
  readonly onStatusChange: (status: AuthStatus) => void
  readonly active: boolean
}) {
  useLocaleRevision()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  /** Run one Host action, show its status, and report whether it succeeded. */
  const act = async (action: () => Promise<AuthStatus>): Promise<boolean> => {
    setBusy(true)
    setError(undefined)
    try {
      onStatusChange(await action())
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setBusy(false)
    }
  }

  const refresh = async () => {
    const revision = authRevision.getSnapshot()
    try {
      const value = await api.status()
      if (revision !== authRevision.getSnapshot()) return
      onStatusChange(value)
      setError(undefined)
    } catch (cause) {
      if (revision === authRevision.getSnapshot()) setError(errorMessage(cause))
    }
  }

  useEffect(() => {
    if (status?.state !== 'pending' && status?.providerSetup !== 'pending') return
    setCopied(false)
    const timer = setInterval(() => { void refresh() }, 2000)
    return () => clearInterval(timer)
  }, [status?.state, status?.userCode, status?.providerSetup])

  const logout = async () => {
    if (await act(api.logout)) {
      setConfirmLogout(false)
      setAcknowledged(false)
    }
  }
  const copy = async () => { if (await writeClipboard(status?.userCode ?? '')) setCopied(true) }

  const pending = status?.state === 'pending'
  const authenticated = status?.authenticated === true
  return (
    <section style={css.section}>
      <p style={css.intro}>{text('intro')}</p>

      {!authenticated ? <EnterpriseUrlCard status={status} busy={busy} onSave={value => act(() => api.setEnterpriseUrl(value))} /> : null}

      <div style={css.card}>
        <div style={css.row}>
          <StateLabel status={status} />
          <div style={css.actions}>
            {authenticated
              ? (
                <Button variant="outline" disabled={busy} onClick={() => { setAcknowledged(false); setConfirmLogout(true) }}>
                  {busy ? text('processing') : text('signOut')}
                </Button>
              )
              : (
                <Button variant="primary" disabled={busy || pending || status === undefined} onClick={() => { void act(api.login) }}>
                  {busy ? text('requesting') : pending ? text('waiting') : text('signIn')}
                </Button>
              )}
            <Button variant="outline" disabled={busy} onClick={() => { void refresh() }}>{text('refresh')}</Button>
          </div>
        </div>
        {error === undefined ? null : <p role="alert" style={css.error}>{error}</p>}
        {pending
          ? (
            <>
              <p style={css.body}>{text('pendingIntro')}</p>
              <a href={status.verificationUri} target="_blank" rel="noreferrer" style={css.link}>{status.verificationUri}</a>
              <DeviceCodeField value={status.userCode ?? ''} copied={copied} onCopy={() => { void copy() }} />
              <p style={css.hint}>{text('pendingHint')}</p>
            </>
          )
          : null}
        {!authenticated && !pending && status?.message !== undefined ? <p style={css.error}>{status.message}</p> : null}
        {authenticated
          ? (
            <>
              <p style={css.body}>{text('signedInAt', { host: status.signedInHost ?? status.githubHost })}</p>
              {status.providerSetup === 'pending' ? <p role="status" style={css.hint}>{text('providerSetupPending')}</p> : null}
              {status.providerSetup === 'warning' ? <div role="alert" style={css.field}>
                <p style={css.body}>{text('providerSetupWarning')}</p>
                <Button type="button" variant="outline" disabled={busy} onClick={() => { void act(api.login) }}>{text('providerSetupRetry')}</Button>
              </div> : null}
              {active ? <AccountUsage issuer={status.signedInHost ?? status.githubHost} /> : null}
            </>
          )
          : null}
      </div>

      <p style={css.hint}>
        {text('pluginVersion')}{' '}
        <a href={`${REPOSITORY}/releases/tag/v${__PLUGIN_VERSION__}`} target="_blank" rel="noreferrer" style={css.versionLink}>
          dsh-copilot-bridge v{__PLUGIN_VERSION__}
        </a>
      </p>

      <RiskConfirmation
        open={confirmLogout}
        title={text('logoutConfirmTitle')}
        description={text('logoutConfirmDescription')}
        acknowledgeLabel={text('logoutAcknowledge')}
        cancelLabel={text('cancel')}
        closeLabel={text('close')}
        confirmLabel={text('logoutConfirm')}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { if (!busy) { setConfirmLogout(false); setAcknowledged(false) } }}
        onConfirm={() => { void logout() }}
      />
    </section>
  )
}
