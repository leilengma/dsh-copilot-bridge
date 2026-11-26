import type { CSSProperties } from 'react'

/** Dense, full-width management table using the host's semantic theme tokens. */
export const modelCss = {
  page: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, paddingBottom: 24 },
  toolbar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  // Grid stretches Input's wrapper span as well as the native input it contains.
  search: { display: 'grid', gridTemplateColumns: '18px minmax(0, 1fr)', alignItems: 'center', gap: 8, flex: '1 1 240px', minWidth: 0 },
  counts: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13, fontVariantNumeric: 'tabular-nums' },
  viewport: { overflow: 'auto', maxHeight: '65vh', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8 },
  table: { width: '100%', minWidth: 680, borderCollapse: 'collapse', textAlign: 'left', fontSize: 14, color: 'var(--dsw-alias-label-primary)' },
  heading: { position: 'sticky', top: 0, zIndex: 1, padding: '12px 16px', background: 'var(--dsw-alias-bg-layer-1)', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
  cell: { padding: '8px 16px', borderTop: '1px solid var(--dsw-alias-border-l2)', verticalAlign: 'middle' },
  eyeCell: { padding: '4px 8px', width: 92, borderTop: '1px solid var(--dsw-alias-border-l2)' },
  rowActions: { display: 'inline-flex', gap: 4, flexWrap: 'nowrap', alignItems: 'center' },
  eye: { padding: 8, minWidth: 36, width: 36, height: 36, color: 'var(--dsw-alias-label-secondary)' },
  modelName: { fontWeight: 500, lineHeight: '22px' },
  modelId: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)', overflowWrap: 'anywhere' },
  numeric: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  badges: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  badge: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 4, padding: '1px 6px', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)' },
  empty: { padding: 32, textAlign: 'center', color: 'var(--dsw-alias-label-secondary)' },
} satisfies Record<string, CSSProperties>
