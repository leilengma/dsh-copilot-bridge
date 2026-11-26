// External Harness presentation primitives only. Production components and state are not mocked.
// This adapter keeps semantic DOM attributes for SSR and isolated browser tests without
// booting the desktop shell's full (non-published) workspace dependency graph.
import type { SegmentedTab } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren } from 'react'

export function Button({ variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) { return <button {...props} /> }
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} /> }
export function SegmentedTabs<Value extends string>({ items, value, onChange, label }: {
  items: readonly SegmentedTab<Value>[]; value: Value; onChange: (value: Value) => void; label: string; size?: string
}) {
  return <div role="tablist" aria-label={label}>{items.map(item => <button key={item.value} id={item.id} role="tab" aria-selected={value === item.value} aria-controls={item.panelId} tabIndex={value === item.value ? 0 : -1} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>
}
export function Modal({ open, children }: PropsWithChildren<{ open?: boolean }>) { return open ? <div role="dialog">{children}</div> : null }
export function StateDot() { return <span aria-hidden="true">●</span> }
export function RiskConfirmation() { return null }
export async function writeClipboard() { /* No real clipboard in isolated UI tests. */ }
