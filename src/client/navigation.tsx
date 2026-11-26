import icon from '../../assets/github-copilot.svg'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { text, useLocaleRevision } from './i18n.ts'
import { CopilotPluginPage } from './plugin-page.tsx'
import { css } from './styles.ts'

/** Host supplies the size for expanded and collapsed sidebar rows. */
export function CopilotIcon({ size }: { readonly size: number }) {
  return <img src={icon} width={size} height={size} alt="" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }} />
}

/** Main-slot occupant: owns scrolling and uses the available center-column width. */
export function CopilotPanel() {
  useLocaleRevision()
  return <div style={{ height: '100%', minHeight: 0, minWidth: 0, overflowY: 'auto' }}>
    <main aria-labelledby="copilot-page-title" style={{ padding: '24px clamp(16px, 3vw, 40px)', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <CopilotIcon size={28} />
        <h1 id="copilot-page-title" style={css.title}>{text('nav')}</h1>
      </header>
      <CopilotPluginPage />
    </main>
  </div>
}

/** Keep bundle configuration discoverable without squeezing a second copy into it. */
export function CopilotShortcut({ onOpen }: { readonly onOpen: () => void }) {
  useLocaleRevision()
  return <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
    <p style={css.intro}>{text('openPageHint')}</p>
    <Button type="button" variant="outline" onClick={onOpen}>{text('openPage')}</Button>
  </div>
}
