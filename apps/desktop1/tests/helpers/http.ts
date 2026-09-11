/**
 * fetch mock for UI tests hitting the internal Next.js API.
 *
 * Usage:
 *   mockApi({
 *     'GET /api/sessions': [...],
 *     'POST /api/chat': { ok: true, userSeq: 0, assistantSeq: 1 },
 *     'POST /api/models/select': (body) => ({ selection: body, ... }),
 *   })
 *
 * Keys are `METHOD path` (query strings ignored); values are JSON payloads
 * or handler functions receiving the parsed JSON body. Return
 * `{ __status: <code>, __body: { error } }` to simulate HTTP errors.
 */
import { vi } from 'vitest'

type Handler = unknown | ((body: unknown, url: string) => unknown | Promise<unknown>)

function splitKey(key: string): { method: string; path: string } {
  const i = key.indexOf(' ')
  if (i < 0) return { method: 'GET', path: key }
  return { method: key.slice(0, i).toUpperCase(), path: key.slice(i + 1) }
}

export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const raw = String(input)
    const path = raw.split('?')[0] ?? raw
    const method = (init?.method ?? 'GET').toUpperCase()
    const exact = routes[`${method} ${path}`]
    const fallback = routes[path]
    const handler = exact !== undefined ? exact : fallback
    if (handler === undefined) throw new Error(`unmocked API: ${method} ${path}`)
    const body = init?.body ? (JSON.parse(init.body) as unknown) : undefined
    const data = (await (typeof handler === 'function'
      ? (handler as (b: unknown, u: string) => unknown)(body, raw)
      : handler)) as Record<string, unknown> | unknown[]
    if (data !== null && typeof data === 'object' && '__status' in (data as Record<string, unknown>)) {
      const err = data as { __status: number; __body?: unknown }
      return { ok: false, status: err.__status, json: async () => err.__body ?? { error: 'mock error' } }
    }
    return { ok: true, status: 200, json: async () => data }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Assert a fetch call was made with method + path + (partial) JSON body. */
export function expectFetch(
  fetchMock: ReturnType<typeof vi.fn>,
  method: string,
  path: string,
  body?: Record<string, unknown>
): void {
  const call = (fetchMock.mock.calls as unknown[][]).find((args) => {
    const [input, init] = args as [unknown, { method?: string; body?: string } | undefined]
    return String(input).split('?')[0] === path && (init?.method ?? 'GET').toUpperCase() === method.toUpperCase()
  })
  if (!call) throw new Error(`expected fetch ${method} ${path} — not called`)
  if (body !== undefined) {
    const init = call[1] as { body?: string } | undefined
    const sent = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
    for (const [k, v] of Object.entries(body)) {
      if (JSON.stringify(sent[k]) !== JSON.stringify(v)) {
        throw new Error(
          `expected fetch ${method} ${path} body ${k}=${JSON.stringify(v)}, got ${JSON.stringify(sent[k])}`
        )
      }
    }
  }
}
