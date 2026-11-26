// External Harness presentation primitives only. Production components and state are not mocked.
// This adapter keeps semantic DOM attributes for SSR and isolated browser tests without
// booting the desktop shell's full (non-published) workspace dependency graph.
import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren } from 'react'

export function Button({ variant: _variant, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) { return <button {...props} /> }
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} /> }
export function Modal({ open, children }: PropsWithChildren<{ open?: boolean }>) { return open ? <div role="dialog">{children}</div> : null }
export function StateDot() { return <span aria-hidden="true">●</span> }
export function RiskConfirmation() { return null }
export async function writeClipboard() { /* No real clipboard in isolated UI tests. */ }
