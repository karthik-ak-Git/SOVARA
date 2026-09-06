/**
 * Commit 6 — the ONLY place in shipped code allowed to perform HTTP.
 *
 * Sovereignty rules (fail closed):
 * - `http:` scheme only, loopback hosts only: `127.0.0.1`, `localhost`,
 *   `::1` (literal), or any hostname that resolves exclusively to loopback
 *   addresses (verified via DNS, not string prefixes — Hermes' naive
 *   `"127.0.0.1" in base_url` substring check is exactly what we avoid).
 * - No credentials in URL, no remote hosts, no public IPs.
 * - Manual redirect handling: each hop re-validated, max 3, remote → blocked.
 * - Bounded: caller timeout + response size cap. No telemetry, no fallback.
 */
import dns from 'node:dns/promises'
import net from 'node:net'

export const DEFAULT_RUNTIME_TIMEOUT_MS = 8_000
export const MAX_RUNTIME_RESPONSE_BYTES = 1_000_000
const MAX_REDIRECTS = 3

export class LoopbackViolationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoopbackViolationError'
  }
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

function isLoopbackLiteral(host: string): boolean {
  const h = stripBrackets(host).toLowerCase()
  if (h === 'localhost') return true
  if (net.isIP(h) === 4) {
    // 127.0.0.0/8
    const first = Number(h.split('.')[0])
    return first === 127
  }
  if (net.isIP(h) === 6) return h === '::1'
  return false
}

function isLoopbackAddress(addr: string): boolean {
  const a = stripBrackets(addr).toLowerCase()
  if (net.isIP(a) === 4) return Number(a.split('.')[0]) === 127
  if (net.isIP(a) === 6) return a === '::1'
  return false
}

/** True when `input` is an http(s)-parsed URL whose host is loopback-verified. */
export async function isLoopbackUrl(input: string): Promise<boolean> {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return false
  }
  if (url.protocol !== 'http:') return false
  if (url.username !== '' || url.password !== '') return false
  const host = stripBrackets(url.hostname)
  if (host === '') return false
  if (isLoopbackLiteral(host)) return true
  if (net.isIP(host) !== 0) return false // non-loopback literal IP
  // Non-literal hostname: resolve and require ALL addresses loopback.
  try {
    const addrs = await dns.lookup(host, { all: true })
    if (addrs.length === 0) return false
    return addrs.every((a) => isLoopbackAddress(a.address))
  } catch {
    return false // fail closed on DNS failure
  }
}

export interface RuntimeHttpResult {
  status: number
  json: unknown
  latencyMs: number
}

/**
 * GET JSON from a loopback URL. Throws LoopbackViolationError for
 * non-local targets, AbortError-derived timeout, or Error for
 * oversize/invalid payloads. Exactly one redirect chain, re-validated.
 */
export async function getLoopbackJson(
  url: string,
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<RuntimeHttpResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS
  const maxBytes = opts?.maxBytes ?? MAX_RUNTIME_RESPONSE_BYTES
  const started = Date.now()
  let current = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isLoopbackUrl(current))) {
      throw new LoopbackViolationError(`blocked non-loopback runtime URL`)
    }
    let res: Response
    try {
      res = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      })
    } catch (e) {
      throw e instanceof Error ? e : new Error('runtime request failed')
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc || hop === MAX_REDIRECTS) {
        throw new LoopbackViolationError('blocked runtime redirect')
      }
      try {
        current = new URL(loc, current).toString()
      } catch {
        throw new LoopbackViolationError('blocked runtime redirect')
      }
      continue
    }
    const body = await readBounded(res, maxBytes)
    let json: unknown
    try {
      json = JSON.parse(body)
    } catch {
      throw new Error('invalid-response: runtime did not return JSON')
    }
    return { status: res.status, json, latencyMs: Date.now() - started }
  }
  throw new LoopbackViolationError('blocked runtime redirect')
}

async function readBounded(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) {
    const text = await res.text()
    if (text.length > maxBytes) throw new Error('response-too-large')
    return text
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
      throw new Error('response-too-large')
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.byteLength
  }
  return Buffer.from(merged).toString('utf8')
}
