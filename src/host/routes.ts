import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { API_BASE, type ApiEnvelope, type EnterpriseUrlRequest, type CopilotUsage } from '../shared/contract.ts'
import type { AuthController } from './auth-controller.ts'
import { InvalidHiddenModelsError } from './hidden-models.ts'
import { modelCatalog } from './model-catalog.ts'
import type { CopilotMetadata } from './copilot-metadata.ts'
import type { LiveCatalog } from './live-catalog.ts'

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

function json<T>(status: number, payload: ApiEnvelope<T>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function route<T>(action: (request: Request) => Promise<T>): (request: Request) => Promise<Response> {
  return async request => {
    try {
      return json(200, { ok: true, value: await action(request) })
    } catch (error) {
      return json(error instanceof InvalidHiddenModelsError ? 400 : 500, { ok: false, error: errorMessage(error) })
    }
  }
}

async function readEnterpriseUrlRequest(request: Request): Promise<string> {
  const body: unknown = await request.json()
  const value = typeof body === 'object' && body !== null ? (body as Partial<EnterpriseUrlRequest>).enterpriseUrl : undefined
  if (typeof value !== 'string') throw new Error('request body must be {"enterpriseUrl": string}')
  return value
}

/** Registered exclusively on the authenticated connection.fetch channel. */
export function authRoutes(
  auth: AuthController,
  catalog?: LiveCatalog,
  metadata?: () => Promise<ReadonlyMap<string, CopilotMetadata>>,
  usage: () => Promise<CopilotUsage> = async () => ({ state: 'unavailable' }),
  vision: () => boolean = () => true,
): ConnectionFetchRoute[] {
  return [
    { path: `${API_BASE}/usage`, methods: ['GET'], requestBody: 'buffered', fetch: route(() => usage()) },
    { path: `${API_BASE}/status`, methods: ['GET'], requestBody: 'buffered', fetch: route(() => auth.status()) },
    { path: `${API_BASE}/models`, methods: ['GET'], requestBody: 'buffered', fetch: route(async () => modelCatalog(await auth.status(), catalog, metadata, vision())) },
    { path: `${API_BASE}/models/refresh`, methods: ['POST'], requestBody: 'buffered', fetch: route(async () => {
      if ((await auth.status()).authenticated) await catalog?.refresh().catch(() => {})
      return modelCatalog(await auth.status(), catalog, metadata, vision())
    }) },
    { path: `${API_BASE}/login`, methods: ['POST'], requestBody: 'buffered', fetch: route(() => auth.login()) },
    { path: `${API_BASE}/logout`, methods: ['POST'], requestBody: 'buffered', fetch: route(() => auth.logout()) },
    {
      path: `${API_BASE}/enterprise-url`, methods: ['POST'], requestBody: 'buffered',
      fetch: route(async request => auth.setEnterpriseUrl(await readEnterpriseUrlRequest(request))),
    },
    {
      path: `${API_BASE}/hidden-models`, methods: ['POST'], requestBody: 'buffered',
      fetch: route(async request => {
        let body: unknown
        try { body = await request.json() } catch { throw new InvalidHiddenModelsError('request body must be {"hiddenModels": string[]}') }
        return auth.setHiddenModels(typeof body === 'object' && body !== null && 'hiddenModels' in body ? body.hiddenModels : undefined)
      }),
    },
  ]
}
