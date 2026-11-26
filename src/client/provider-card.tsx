import { text, useLocaleRevision } from './i18n.ts'
import { css } from './styles.ts'

/** Bridge-owned Account notice; never attached to the user's native provider card. */
export function CopilotProviderCardNotice() {
  useLocaleRevision()
  return <aside role="note" style={css.card}>
    <h3 style={css.subtitle}>{text('bridgeProviderTitle')}</h3>
    <p style={css.body}>{text('bridgeProviderNotice')}</p>
    <p style={css.hint}>{text('bridgeMigrationNotice')}</p>
  </aside>
}
