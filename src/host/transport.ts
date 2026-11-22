/**
 * GitHub request transport for the device flow, honoring the ambient proxy.
 *
 * An undici `ProxyAgent` routes each request through `https_proxy` /
 * `HTTPS_PROXY` / `http_proxy` / `HTTP_PROXY` (minus `NO_PROXY`); without a
 * proxy the global fetch is used. Corporate networks usually need this.
 */
import { ProxyAgent } from 'undici'

let cache: { readonly url: string; readonly agent: ProxyAgent } | undefined

function resolveHttpProxy(): string | undefined {
  for (const key of ['https_proxy', 'HTTPS_PROXY', 'http_proxy', 'HTTP_PROXY']) {
    const value = process.env[key]
    if (value === undefined || value.length === 0) continue
    try {
      const { protocol } = new URL(value)
      if (protocol === 'http:' || protocol === 'https:') return value
    } catch {
      // Ignore a malformed proxy variable and try the next one.
    }
  }
  return undefined
}

function isProxyBypassed(hostname: string): boolean {
  const raw = process.env.no_proxy ?? process.env.NO_PROXY
  if (raw === undefined || raw.length === 0) return false
  const host = hostname.toLowerCase()
  return raw.split(',').map(part => part.trim().toLowerCase()).filter(Boolean).some(pattern => {
    if (pattern === '*') return true
    if (pattern.includes('/')) return false // CIDR ranges are not supported
    const base = pattern.startsWith('.') ? pattern.slice(1) : pattern
    return host === base || host.endsWith(`.${base}`)
  })
}

function proxyDispatcher(): ProxyAgent | undefined {
  const url = resolveHttpProxy()
  if (url === undefined) return undefined
  if (cache?.url !== url) cache = { url, agent: new ProxyAgent(url) }
  return cache.agent
}

/** `fetch` that goes through the ambient HTTP(S) proxy when one applies. */
export async function githubFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url)
  const dispatcher = target.protocol === 'https:' && !isProxyBypassed(target.hostname) ? proxyDispatcher() : undefined
  if (dispatcher === undefined) return fetch(url, init)
  // Node's fetch is undici; it accepts `dispatcher`, which the DOM RequestInit type lacks.
  return fetch(url, { ...init, dispatcher } as RequestInit)
}
