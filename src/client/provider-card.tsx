import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AuthStatus } from '../shared/contract.ts'
import { PI_AI_PROVIDER } from '../shared/contract.ts'
import { api } from './api.ts'
import type { ProviderCardProps } from './harness.ts'
import { text, useLocaleRevision } from './i18n.ts'
import { authRevision } from './store.ts'
import { css } from './styles.ts'

const notice = {
  ...css.hint,
  color: 'var(--dsw-alias-label-secondary)',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
} as const

/**
 * Notice on the Models page `github-copilot` card. The Harness key field still
 * offers to read COPILOT_GITHUB_TOKEN; this tells the user the plugin's
 * sign-in already authenticates the route, so the key stays empty.
 */
export function CopilotProviderCardNotice({ provider, configured }: ProviderCardProps) {
  useLocaleRevision()
  const revision = useSyncExternalStore(authRevision.subscribe, authRevision.getSnapshot)
  const [status, setStatus] = useState<AuthStatus>()
  const isCopilot = provider.provider === PI_AI_PROVIDER

  useEffect(() => {
    if (!isCopilot) return
    let live = true
    api.status().then(next => { if (live) setStatus(next) }, () => { if (live) setStatus(undefined) })
    return () => { live = false }
  }, [isCopilot, revision])

  if (!isCopilot || status === undefined) return null

  if (!status.authenticated) {
    return <p role="note" style={notice}>{text('cardSignedOut')}</p>
  }
  const host = status.signedInHost ?? status.githubHost
  return (
    <p role="note" style={notice}>
      {'✓ '}
      {text('cardSignedIn', { host })}
      {configured ? null : <>{' '}{text('cardApply', { apply: text('modelsApply') })}</>}
    </p>
  )
}
