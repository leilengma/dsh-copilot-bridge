import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthStatus, CopilotModel, ModelPrices } from '../shared/contract.ts'
import { text, useLocaleRevision } from './i18n.ts'
import { promotionActive, watchPromotionExpiry } from './promotion-expiry.ts'
import { modelCss as css } from './model-styles.ts'

function Eye({ visible }: { readonly visible: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible ? <path d="m3 3 18 18" /> : null}
    </svg>
  )
}

const contextSize = (tokens: number | undefined): string => tokens === undefined ? '—'
  : tokens >= 1_000_000 ? `${Number((tokens / 1_000_000).toFixed(2))}M`
    : tokens >= 1_000 ? `${Number((tokens / 1_000).toFixed(1))}K` : String(tokens)

function PriceLine({ prices }: { readonly prices: ModelPrices }) {
  const amount = (value: number | undefined) => value === undefined ? '—' : new Intl.NumberFormat(undefined, { maximumSignificantDigits: 10 }).format(value)
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontVariantNumeric: 'tabular-nums' }}>
    <span>{text('priceInput', { amount: amount(prices.input) })}</span>
    <span>{text('priceOutput', { amount: amount(prices.output) })}</span>
    <span>{text('priceCacheRead', { amount: amount(prices.cacheRead) })}</span>
    <span>{text('priceCacheWrite', { amount: amount(prices.cacheWrite) })}</span>
  </div>
}

function MetadataBadge({ label, details }: { readonly label: string; readonly details: string }) {
  return <details style={{ maxWidth: '100%' }}>
    <summary style={{ ...css.badge, cursor: 'pointer' }} title={details}>{label}</summary>
    <div style={{ ...css.modelId, whiteSpace: 'pre-line', maxWidth: 360 }}>{details}</div>
  </details>
}

/** All account models stay in this table, including hidden rows, so toggling is reversible. */
export function ModelsTable({ status, models, busy, onSave }: {
  readonly status: AuthStatus
  readonly models: readonly CopilotModel[]
  readonly busy: boolean
  readonly onSave: (ids: readonly string[]) => Promise<void>
}) {
  useLocaleRevision()
  const [filter, setFilter] = useState('')
  const [, refreshPromotion] = useState(0)
  useEffect(() => watchPromotionExpiry(models, () => refreshPromotion(value => value + 1)), [models])
  const hidden = status.hiddenModels ?? []
  const query = filter.trim().toLowerCase()
  const shown = models.filter(model => `${model.name}\n${model.id}`.toLowerCase().includes(query))
  return (
    <>
      <div style={css.toolbar}>
        <div style={css.search}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
          <Input type="search" aria-label={text('filterModels')} placeholder={text('searchModels')} value={filter} onChange={event => setFilter(event.currentTarget.value)} style={{ minWidth: 0, width: '100%' }} />
        </div>
        <p role="status" style={css.counts}>
          {text('modelCounts', { available: models.length, hidden: hidden.length })}
          {query.length > 0 ? text('modelsShowing', { shown: shown.length }) : null}
        </p>
      </div>
      <div style={css.viewport} role="region" aria-label={text('hiddenModelsTitle')} tabIndex={0}>
        <table style={css.table} aria-label={text('hiddenModelsTitle')} aria-busy={busy}>
          <thead><tr>
            <th scope="col" style={{ ...css.heading, width: 48 }}><span title={text('visibility')}>{text('visibility')}</span></th>
            <th scope="col" style={css.heading}>{text('modelName')}</th>
            <th scope="col" style={css.heading}>{text('contextSize')}</th>
            <th scope="col" style={css.heading}>{text('capabilities')}</th>
            <th scope="col" style={css.heading}>{text('modelCost')}</th>
          </tr></thead>
          <tbody>
            {shown.map(model => {
              const visible = !hidden.includes(model.id)
              const label = text(visible ? 'hideModel' : 'showModel', { id: model.name })
              return <tr key={model.id}>
                <td style={css.eyeCell}>
                  <Button type="button" variant="ghost" style={css.eye} aria-label={label} title={label} aria-pressed={visible} disabled={busy || !status.configWritable} onClick={() => { void onSave(visible ? [...hidden, model.id] : hidden.filter(id => id !== model.id)) }}>
                    <Eye visible={visible} />
                  </Button>
                </td>
                <td style={css.cell}>
                  <div style={{ ...css.badges, alignItems: 'center' }}>
                    <span style={{ ...css.modelName, color: visible ? undefined : 'var(--dsw-alias-label-tertiary)' }}>{model.name}</span>
                    {model.retiring ? <MetadataBadge label={text('retiring')} details={model.retiring} /> : null}
                    {model.promotion && promotionActive(model.promotion) ? <MetadataBadge label={text('modelDiscount', { percent: model.promotion.discountPercent })} details={[
                      model.promotion.message,
                      model.promotion.endsAt ? text('promotionEnds', { date: model.promotion.endsAt }) : undefined,
                    ].filter(Boolean).join('\n') || text('defaultPricing')} /> : null}
                  </div>
                  {model.name !== model.id ? <div style={css.modelId}>{model.id}</div> : null}
                </td>
                <td style={{ ...css.cell, ...css.numeric }}>{contextSize(model.contextWindow)}</td>
                <td style={css.cell}>
                  <div style={css.badges}>
                    {model.inputModalities?.includes('text') ? <span style={css.badge}>{text('textInput')}</span> : null}
                    {model.inputModalities?.includes('image') ? <span style={css.badge}>{text('vision')}</span> : null}
                    {model.inputModalities?.includes('audio') ? <span style={css.badge}>{text('audioInput')}</span> : null}
                    {model.inputModalities?.includes('video') ? <span style={css.badge}>{text('videoInput')}</span> : null}
                    {!model.inputModalities?.length ? '—' : null}
                  </div>
                </td>
                <td style={{ ...css.cell, minWidth: 280 }}>
                  {model.pricing ? <div title={text('defaultPricing')}><PriceLine prices={model.pricing} /></div> : <span title={text('modelMetadataNote')}>—</span>}
                  {model.longContextPricing ? <details style={{ marginTop: 6, fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer' }}>{model.defaultContextMax === undefined ? text('longContextPricing') : text('aboveContextPricing', { context: contextSize(model.defaultContextMax) })}</summary>
                    <PriceLine prices={model.longContextPricing} />
                  </details> : null}
                </td>
              </tr>
            })}
            {shown.length === 0 ? <tr><td colSpan={5} style={css.empty}>{text(models.length === 0 ? 'noAvailableModels' : 'noMatchingModels')}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </>
  )
}
