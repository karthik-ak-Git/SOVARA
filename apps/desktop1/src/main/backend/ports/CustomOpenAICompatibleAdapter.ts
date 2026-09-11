/**
 * Commit 6 — first runtime adapter: local OpenAI-compatible HTTP.
 *
 * Speaks only `GET <endpoint>/models` (endpoint accepted with or without a
 * trailing `/v1`, per gateway docs publishing both spellings). Never assumes
 * more than the minimum list response; tolerates the standard `data` array
 * as well as enriched `models` maps (DSH llm-pi-ai discovery discipline:
 * normalize candidates, store nothing — the config snapshot decides).
 *
 * All HTTP flows through HttpClient (loopback-only). No fetch here.
 */
import { getLoopbackJson } from '../../network/HttpClient'
import { safeTarget } from '../../logging/runtimeLog'
import type { DiscoveredModel, ModelRuntimeEntry, RuntimeProbeResult } from '@shared/types/models'

export type HttpGet = typeof getLoopbackJson

export interface AdapterProbeOutcome {
  result: RuntimeProbeResult
  /** Normalized snapshot rows for config persistence. */
  snapshot: Array<{ modelId: string; displayName: string; contextLength?: number }>
}

function modelsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '')
  const base = /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
  return `${base}/models`
}

function toPositiveInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v)
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) > 0) {
    return Math.floor(Number(v))
  }
  return undefined
}

function contextFrom(item: Record<string, unknown>): number | undefined {
  const direct = ['context_window', 'context_length', 'contextLength', 'max_context', 'n_ctx']
  for (const k of direct) {
    const v = toPositiveInt(item[k])
    if (v !== undefined) return v
  }
  const meta = item['meta']
  if (meta !== null && typeof meta === 'object') {
    for (const v of Object.values(meta as Record<string, unknown>)) {
      const n = toPositiveInt(v)
      if (n !== undefined && n >= 1024) return n
    }
  }
  return undefined
}

function normalizeItem(runtime: ModelRuntimeEntry, raw: unknown): DiscoveredModel | null {
  if (raw === null || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const id = typeof item['id'] === 'string' && item['id'].trim() !== '' ? item['id'].trim() : null
  if (!id) return null
  const display =
    typeof item['display_name'] === 'string' && item['display_name'].trim() !== ''
      ? item['display_name'].trim()
      : typeof item['name'] === 'string' && item['name'].trim() !== ''
        ? item['name'].trim()
        : id
  const capsRaw = item['capabilities']
  const capabilities = Array.isArray(capsRaw) ? capsRaw.filter((c): c is string => typeof c === 'string').slice(0, 16) : []
  const owned = typeof item['owned_by'] === 'string' ? item['owned_by'].slice(0, 64) : undefined
  return {
    modelId: `${runtime.id}:${id}`,
    displayName: display.slice(0, 256),
    runtimeId: runtime.id,
    source: runtime.type,
    capabilities,
    ...(contextFrom(item) !== undefined ? { contextLength: contextFrom(item)! } : {}),
    ...(owned ? { metadata: { owned_by: owned } } : {}),
    available: true,
  }
}

function candidatesFrom(json: unknown): unknown[] {
  if (json === null || typeof json !== 'object') return []
  const o = json as Record<string, unknown>
  if (Array.isArray(o['data'])) return o['data']
  const m = o['models']
  if (Array.isArray(m)) return m
  if (m !== null && typeof m === 'object') {
    // Enriched map: key is the request id even when the entry disagrees.
    return Object.entries(m as Record<string, unknown>).map(([key, val]) => {
      if (val !== null && typeof val === 'object') return { ...(val as Record<string, unknown>), id: key }
      return { id: key }
    })
  }
  return []
}

export class CustomOpenAICompatibleAdapter {
  constructor(private readonly httpGet: HttpGet = getLoopbackJson) {}

  async probe(runtime: ModelRuntimeEntry): Promise<AdapterProbeOutcome> {
    const url = modelsUrl(runtime.endpoint)
    const started = Date.now()
    try {
      const { status, json } = await this.httpGet(url, { timeoutMs: runtime.timeoutMs })
      if (status < 200 || status >= 300) {
        return this.fail(runtime, started, `http-error: runtime answered ${status}`)
      }
      const models = candidatesFrom(json)
        .map((c) => normalizeItem(runtime, c))
        .filter((m): m is DiscoveredModel => m !== null)
        .slice(0, 500)
      return {
        result: { reachable: true, runtimeId: runtime.id, latencyMs: Date.now() - started, models },
        snapshot: models.map((m) => ({
          modelId: m.modelId,
          displayName: m.displayName,
          ...(m.contextLength !== undefined ? { contextLength: m.contextLength } : {}),
        })),
      }
    } catch (e) {
      return this.fail(runtime, started, classify(e))
    }
  }

  targetFor(runtime: ModelRuntimeEntry): string {
    return safeTarget(modelsUrl(runtime.endpoint))
  }

  private fail(runtime: ModelRuntimeEntry, started: number, error: string): AdapterProbeOutcome {
    return {
      result: { reachable: false, runtimeId: runtime.id, latencyMs: Date.now() - started, models: [], error },
      snapshot: [],
    }
  }
}

/** Raw throws → safe user-facing classification. No stacks, no URLs. */
export function classify(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'name' in e) {
    const name = String((e as Record<string, unknown>)['name'])
    if (name === 'LoopbackViolationError') return 'blocked: endpoint is not a local loopback address'
    if (name === 'TimeoutError') return 'timeout: runtime did not answer in time'
    if (name === 'AbortError') return 'timeout: runtime did not answer in time'
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/timeout|timed out|aborted/i.test(msg)) return 'timeout: runtime did not answer in time'
  if (/ECONNREFUSED|refused|connect/i.test(msg)) return 'connection-refused: is the local server running?'
  if (/response-too-large/i.test(msg)) return 'invalid-response: listing is too large'
  if (/did not return JSON|Unexpected token/i.test(msg)) return 'invalid-response: runtime did not return a model list'
  if (/redirect/i.test(msg)) return 'blocked: runtime redirected away from localhost'
  if (/non-loopback|loopback/i.test(msg)) return 'blocked: endpoint is not a local loopback address'
  return 'error: runtime probe failed'
}
