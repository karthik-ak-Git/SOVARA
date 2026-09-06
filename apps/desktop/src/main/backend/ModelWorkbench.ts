/**
 * Commit 6 — ModelWorkbench: registry + probe + select behind the port wall.
 *
 * Owns: runtime entries (RuntimeConfigStore), discovery (adapter),
 * active-model selection (persisted, never silently re-picked), local
 * request logging, and the resource-boundary check on select.
 *
 * Lifecycle (`load`/`unload`/inference) stays unavailable — Commit 6 is
 * DETECT → CONNECT → PROBE → LIST → SELECT, not inference.
 */
import { isLoopbackUrl } from '../network/HttpClient'
import { appendRuntimeLog } from '../logging/runtimeLog'
import { RuntimeConfigStore } from '../config/RuntimeConfigStore'
import { CustomOpenAICompatibleAdapter, type HttpGet } from './ports/CustomOpenAICompatibleAdapter'
import type { SystemResourceManagerPort } from '@shared/types/ports'
import type {
  ActiveModelState,
  DiscoveredModel,
  ModelRuntimeEntry,
  RuntimeProbeResult,
  RuntimeType,
} from '@shared/types/models'

export class ModelWorkbenchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelWorkbenchError'
  }
}

const DISPLAY_MAX = 80
const ENDPOINT_MAX = 256

export function normalizeEndpoint(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (trimmed === '') throw new ModelWorkbenchError('invalid endpoint: empty')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new ModelWorkbenchError('invalid endpoint: not a URL')
  }
  if (url.protocol !== 'http:') throw new ModelWorkbenchError('invalid endpoint: only plain http loopback is supported')
  if (url.username !== '' || url.password !== '') throw new ModelWorkbenchError('invalid endpoint: credentials in URL are rejected')
  return `${url.origin}${url.pathname === '/' ? '/v1' : url.pathname}`
}

function rid(): string {
  return `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export class ModelWorkbench {
  private readonly adapter: CustomOpenAICompatibleAdapter

  constructor(
    private readonly config: RuntimeConfigStore,
    private readonly resources: SystemResourceManagerPort,
    private readonly baseDir?: string,
    httpGet?: HttpGet
  ) {
    this.adapter = new CustomOpenAICompatibleAdapter(httpGet)
  }

  listRuntimes(): ModelRuntimeEntry[] {
    return this.config.listRuntimes()
  }

  async addRuntime(input: { displayName: string; endpoint: string; type?: RuntimeType; timeoutMs?: number }): Promise<ModelRuntimeEntry> {
    const displayName = input.displayName.trim().slice(0, DISPLAY_MAX)
    if (displayName === '') throw new ModelWorkbenchError('invalid runtime: display name is required')
    if (input.endpoint.length > ENDPOINT_MAX) throw new ModelWorkbenchError('invalid endpoint: too long')
    const endpoint = normalizeEndpoint(input.endpoint)
    if (!(await isLoopbackUrl(endpoint))) {
      throw new ModelWorkbenchError('blocked: endpoint is not a local loopback address')
    }
    const timeoutMs = input.timeoutMs === undefined ? 8000 : Math.min(30_000, Math.max(1000, Math.floor(input.timeoutMs)))
    const entry: ModelRuntimeEntry = {
      id: rid(),
      displayName,
      type: input.type ?? 'openai-compatible',
      endpoint,
      enabled: true,
      timeoutMs,
    }
    this.config.upsertRuntime(entry)
    return entry
  }

  removeRuntime(runtimeId: string): boolean {
    return this.config.removeRuntime(runtimeId)
  }

  /** Live probe → persists snapshot → returns normalized result (never throws for probe failures). */
  async probeRuntime(runtimeId: string): Promise<RuntimeProbeResult> {
    const snap = this.config.getRuntime(runtimeId)
    if (!snap) throw new ModelWorkbenchError('unknown runtime')
    const started = Date.now()
    const { result, snapshot } = await this.adapter.probe(snap.entry)
    this.config.saveProbeSnapshot(runtimeId, snapshot, result.reachable ? null : (result.error ?? 'error'))
    appendRuntimeLog(this.baseDir, {
      time: Date.now(),
      runtimeId,
      method: 'GET',
      target: this.adapter.targetFor(snap.entry),
      latencyMs: Date.now() - started,
      status: result.reachable ? 200 : undefined,
      outcome: result.reachable ? 'ok' : classifyOutcome(result.error ?? ''),
    })
    return result
  }

  /** Snapshot reads — no network. Probe first via probeRuntime. */
  listModels(runtimeId?: string): DiscoveredModel[] {
    const entries = runtimeId ? [this.config.getRuntime(runtimeId)?.entry].filter((e): e is ModelRuntimeEntry => Boolean(e)) : this.config.listRuntimes()
    if (runtimeId && entries.length === 0) throw new ModelWorkbenchError('unknown runtime')
    const out: DiscoveredModel[] = []
    for (const entry of entries) {
      const snap = this.config.getRuntime(entry.id)
      if (!snap) continue
      for (const m of snap.lastModels) {
        out.push({
          modelId: m.modelId,
          displayName: m.displayName,
          runtimeId: entry.id,
          source: entry.type,
          capabilities: [],
          ...(m.contextLength !== undefined ? { contextLength: m.contextLength } : {}),
          available: snap.lastError === null,
        })
      }
    }
    return out
  }

  async selectModel(runtimeId: string, modelId: string): Promise<ActiveModelState> {
    const snap = this.config.getRuntime(runtimeId)
    if (!snap) throw new ModelWorkbenchError('unknown runtime')
    if (!snap.entry.enabled) throw new ModelWorkbenchError('runtime is disabled')
    const known = snap.lastModels.some((m) => m.modelId === modelId)
    if (!known) throw new ModelWorkbenchError('unknown model: probe the runtime first')
    // Resource boundary is advisory in this build (stub returns ok) but the
    // call path is real — a future blocking verdict refuses the select.
    const pressure = await this.resources.checkBeforeLoad(
      { id: modelId as never, displayName: modelId, source: 'custom', format: 'unknown' },
      {}
    )
    if (pressure.blocking) {
      throw new ModelWorkbenchError(`resource-pressure: ${pressure.reason ?? 'load refused'}`)
    }
    this.config.setActiveSelection({ runtimeId, modelId })
    return this.getActiveModel()
  }

  getActiveModel(): ActiveModelState {
    const sel = this.config.getActiveSelection()
    if (!sel) return { selection: null, available: false }
    const snap = this.config.getRuntime(sel.runtimeId)
    if (!snap || !snap.entry.enabled) return { selection: sel, available: false }
    const found = snap.lastModels.find((m) => m.modelId === sel.modelId)
    if (!found || snap.lastError !== null) return { selection: sel, available: false }
    return {
      selection: sel,
      available: true,
      displayName: found.displayName,
      runtimeDisplayName: snap.entry.displayName,
    }
  }

  dispose(): void {
    try {
      this.config.close()
    } catch {
      // ignore
    }
  }
}

function classifyOutcome(error: string): 'http-error' | 'timeout' | 'refused' | 'blocked' | 'invalid-response' | 'error' {
  if (error.startsWith('http-error')) return 'http-error'
  if (error.startsWith('timeout')) return 'timeout'
  if (error.startsWith('connection-refused')) return 'refused'
  if (error.startsWith('blocked')) return 'blocked'
  if (error.startsWith('invalid-response')) return 'invalid-response'
  return 'error'
}
