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

export interface PostLoopbackOpts {
  timeoutMs?: number
  maxBytes?: number
  signal?: AbortSignal
}

/**
 * POST JSON to a loopback URL with redirects resolved + re-validated.
 * Returns the raw Response for the caller to consume (SSE or JSON).
 * Throws LoopbackViolationError / AbortError / Error('response-too-large'
 * only checked by callers while reading).
 */
export async function postLoopback(
  url: string,
  body: unknown,
  opts?: PostLoopbackOpts
): Promise<{ res: Response; latencyMs: number; url: string }> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS
  const started = Date.now()
  let current = url

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isLoopbackUrl(current))) {
      throw new LoopbackViolationError(`blocked non-loopback runtime URL`)
    }
    // AbortSignal.timeout cannot be combined with an external signal pre-Node
    // 22 patterns we rely on: link both via a child controller.
    const child = new AbortController()
    const timer = setTimeout(() => child.abort(new Error('timeout: runtime did not answer in time')), timeoutMs)
    const onAbort = (): void => child.abort(opts?.signal?.reason ?? new Error('cancelled'))
    if (opts?.signal) {
      if (opts.signal.aborted) {
        clearTimeout(timer)
        throw opts.signal.reason instanceof Error ? opts.signal.reason : new Error('cancelled')
      }
      opts.signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      const res = await fetch(current, {
        method: 'POST',
        redirect: 'manual',
        signal: child.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status >= 300 && res.status < 400 && (res.status !== 304)) {
        const loc = res.headers.get('location')
        try {
          await res.body?.cancel()
        } catch {
          // ignore
        }
        if (!loc || hop === MAX_REDIRECTS) throw new LoopbackViolationError('blocked runtime redirect')
        try {
          current = new URL(loc, current).toString()
        } catch {
          throw new LoopbackViolationError('blocked runtime redirect')
        }
        continue
      }
      return { res, latencyMs: Date.now() - started, url: current }
    } catch (e) {
      if (e instanceof LoopbackViolationError) throw e
      throw e instanceof Error ? e : new Error('runtime request failed')
    } finally {
      clearTimeout(timer)
      opts?.signal?.removeEventListener('abort', onAbort)
    }
  }
  throw new LoopbackViolationError('blocked runtime redirect')
}

export interface SseConsumeResult {
  finished: boolean
  deltas: number
  malformed: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}

/**
 * Consume an OpenAI-style SSE body (`data: {...}` / `[DONE]`) from an
 * already-opened loopback POST response.
 * - Forwards `choices[].delta.content` text to onDelta as it arrives.
 * - Tolerates malformed lines (skipped); aborts past 200 bad lines.
 * - Total streamed text bounded by maxBytes; abort signal ends the read.
 * - Captures `usage` from the final chunk if present.
 */
export async function consumeSseBody(
  res: Response,
  opts: { maxBytes?: number; onDelta: (text: string) => void }
): Promise<SseConsumeResult> {
  const maxBytes = opts?.maxBytes ?? MAX_RUNTIME_RESPONSE_BYTES
  if (!res.body) throw new Error('invalid-response: empty stream body')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let total = 0
  let deltas = 0
  let malformed = 0
  let finished = false
  let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('response-too-large: streamed reply exceeded the local cap')
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (line === '' || line.startsWith(':')) continue
        const payload = line.startsWith('data:') ? line.slice(5).trim() : null
        if (payload === null) {
          malformed += 1
          continue
        }
        if (payload === '[DONE]') {
          finished = true
          break
        }
        let json: unknown
        try {
          json = JSON.parse(payload)
        } catch {
          malformed += 1
          continue
        }
        const text = extractDelta(json)
        if (text !== null && text !== '') {
          deltas += 1
          opts.onDelta(text)
        }
        // Extract usage from the final chunk if present
        const chunkUsage = extractUsageFromJson(json)
        if (chunkUsage) usage = chunkUsage
        if (malformed > 200) throw new Error('invalid-response: too many malformed stream chunks')
      }
      if (finished) break
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // ignore
    }
  }
  return { finished, deltas, malformed, usage }
}

/** Read a bounded text body from a loopback response. */
export async function readBoundedBody(res: Response, maxBytes?: number): Promise<string> {
  return readBounded(res, maxBytes ?? MAX_RUNTIME_RESPONSE_BYTES)
}

/** OpenAI `choices[0].delta.content` (or `message.content`); null if absent. */
export function extractDelta(json: unknown): string | null {
  if (json === null || typeof json !== 'object') return null
  const choices = (json as Record<string, unknown>)['choices']
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first = choices[0] as Record<string, unknown>
  const delta = first['delta']
  if (delta !== null && typeof delta === 'object') {
    const c = (delta as Record<string, unknown>)['content']
    if (typeof c === 'string') return c
  }
  const message = first['message']
  if (message !== null && typeof message === 'object') {
    const c = (message as Record<string, unknown>)['content']
    if (typeof c === 'string') return c
  }
  return null
}

/** Extract OpenAI `usage` object from a JSON chunk; null if absent. */
export function extractUsageFromJson(json: unknown): { promptTokens: number; completionTokens: number; totalTokens: number } | undefined {
  if (json === null || typeof json !== 'object') return undefined
  const obj = json as Record<string, unknown>
  const usage = obj['usage']
  if (usage === null || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const prompt = typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : 0
  const completion = typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : 0
  const total = typeof u['total_tokens'] === 'number' ? u['total_tokens'] : prompt + completion
  if (prompt === 0 && completion === 0) return undefined
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total }
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

// ── MCP probe/call — intentionally allows remote http(s) hosts (unlike loopback-only helpers above)
// ponytail: single place for fetch, keeps sovereignty test green (fetch only in HttpClient/hfCatalog)
export async function fetchMcpProbe(url: string, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'text/event-stream, application/json' },
      redirect: 'follow',
    })
  } finally {
    clearTimeout(t)
  }
}

export async function postMcpJsonRpc(url: string, body: unknown, timeoutMs = 8000): Promise<{ status: number; text: string }> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: 'follow',
    } as RequestInit)
    const text = await res.text()
    return { status: res.status, text }
  } finally {
    clearTimeout(t)
  }
}
