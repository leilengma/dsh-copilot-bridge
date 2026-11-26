import { API_BASE, type ApiEnvelope, type AuthStatus, type EnterpriseUrlRequest, type HiddenModelsRequest, type ModelCatalog, type CopilotUsage } from '../shared/contract.ts'

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { accept: 'application/json', ...init.body === undefined ? {} : { 'content-type': 'application/json' } },
    cache: 'no-store',
  })
  let payload: ApiEnvelope<T>
  try {
    payload = await response.json() as ApiEnvelope<T>
  } catch {
    throw new Error(`GitHub Copilot request failed (HTTP ${response.status})`)
  }
  if (!payload.ok) throw new Error(payload.error)
  if (!response.ok) throw new Error(`GitHub Copilot request failed (HTTP ${response.status})`)
  return payload.value
}

/** Typed client for the Host routes in `src/host/index.ts`. */
export const api = {
  status: () => call<AuthStatus>('/status'),
  models: () => call<ModelCatalog>('/models'),
  usage: () => call<CopilotUsage>('/usage'),
  login: () => call<AuthStatus>('/login', { method: 'POST' }),
  logout: () => call<AuthStatus>('/logout', { method: 'POST' }),
  setHiddenModels: (hiddenModels: readonly string[]) => {
    const body: HiddenModelsRequest = { hiddenModels }
    return call<AuthStatus>('/hidden-models', { method: 'POST', body: JSON.stringify(body) })
  },
  setEnterpriseUrl: (enterpriseUrl: string) => {
    const body: EnterpriseUrlRequest = { enterpriseUrl }
    return call<AuthStatus>('/enterprise-url', { method: 'POST', body: JSON.stringify(body) })
  },
}

export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)
