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
import { RuntimeConfigStore, type ModelRegistryRow, type RegistryInstallStatus } from '../config/RuntimeConfigStore'
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
    this.ensureLocalLibraryRuntime()
    return this.config.listRuntimes()
  }

  /** Read-only entry lookup for inference-time resolution (no network). */
  describeRuntime(runtimeId: string): ModelRuntimeEntry | null {
    return this.config.getRuntime(runtimeId)?.entry ?? null
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

  /** Registry inventory (no network). Optional runtimeId narrows to one runtime's models. */
  listRegistryRows(runtimeId?: string): ModelRegistryRow[] {
    return runtimeId ? this.config.listRegistryRowsByRuntime(runtimeId) : this.config.listRegistryRows()
  }

  /** UI-settable fields only — download status is written by the download manager, not the UI. */
  updateRegistryRow(
    id: string,
    patch: { installStatus?: RegistryInstallStatus; runtimeId?: string | null; displayName?: string }
  ): void {
    this.config.updateRegistryRow(id, patch)
  }

  removeRegistryRow(id: string): void {
    this.config.removeRegistryRow(id)
  }

  removeRegistryRowsByPath(localPath: string): void {
    this.config.removeRegistryRowsByPath(localPath)
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
    this.ensureLocalLibraryRuntime()
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

  /** Ensure the library's local files appear as a runtime so Chat orchestration (ARCHITECTURE_PHASE1 §6) can select them without a probe. */
  private ensureLocalLibraryRuntime(): void {
    try {
      if (this.config.getRuntime('local')) return
      // Only create if there is at least one file in library
      const lib = this.loadLocalLibrarySnapshot()
      if (lib.length === 0) return
      const entry: ModelRuntimeEntry = { id: 'local', displayName: 'Local Library', type: 'openai-compatible', endpoint: 'local', enabled: true, timeoutMs: 8000 }
      this.config.upsertRuntime(entry)
      this.config.saveProbeSnapshot('local', lib, null)
      // Auto-select first if nothing selected (so Pill shows Ready)
      if (!this.config.getActiveSelection()) {
        this.config.setActiveSelection({ runtimeId: 'local', modelId: lib[0].modelId })
        try { const { registerLoadedInstance } = require('./ports/ModelRuntimeStub') as typeof import('./ports/ModelRuntimeStub'); registerLoadedInstance(lib[0].modelId, 'local', 4096) } catch {}
      }
      // Log: connected models discovered
      try { this.logLocalDiscovery(lib) } catch {}
    } catch { /* never block */ }
  }

  private loadLocalLibrarySnapshot(): Array<{ modelId: string; displayName: string }> {
    try {
      // Avoid importing modelDownloads (circular) — scan via RuntimeConfigStore registry + filesystem heuristic
      const rows = this.config.listRegistryRows()
      if (rows.length > 0) return rows.filter(r => r.installStatus !== 'missing').map(r => ({ modelId: r.repository ? `${r.repository}/${r.rfilename}` : r.rfilename, displayName: r.displayName || r.rfilename }))
      // Fallback: check AppBackend library dir via config's library path setting, or default data dir
      let libDir = this.config.getAppSetting('model_library_dir') || this.config.getAppSetting('library_dir') || ''
      if (!libDir) {
        try { const { getSovaraDataDir } = require('../storage/paths') as typeof import('../storage/paths'); const { join } = require('node:path') as typeof import('node:path'); libDir = join(getSovaraDataDir(undefined), 'models') } catch { return [] }
      }
      const { readdirSync } = require('node:fs') as typeof import('node:fs')
      const { join } = require('node:path') as typeof import('node:path')
      const scan = (dir: string, acc: string[]): void => {
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name)
            if (e.isDirectory()) scan(p, acc)
            else if (e.name.toLowerCase().endsWith('.gguf')) acc.push(e.name)
          }
        } catch {}
      }
      const ggufs: string[] = []
      scan(libDir, ggufs)
      return ggufs.slice(0, 20).map(f => ({ modelId: f.replace(/\.gguf$/i,''), displayName: f }))
    } catch { return [] }
  }

  private logLocalDiscovery(models: Array<{ modelId: string }>): void {
    try {
      const { join } = require('node:path') as typeof import('node:path')
      const { appendFileSync, statSync } = require('node:fs') as typeof import('node:fs')
      const { getSovaraDataDir, ensureDir } = require('../storage/paths') as typeof import('../storage/paths')
      let dir: string; try { dir = join(getSovaraDataDir(undefined), 'logs') } catch { dir = join(require('node:os').tmpdir(), 'sovara-logs') }
      ensureDir(dir)
      const file = join(dir, 'runtime.log')
      // also detection.log mirror for Library visibility
      const entry = JSON.stringify({ time: Date.now(), iso: new Date().toISOString(), event: 'connected-models', runtimeId: 'local', count: models.length, models: models.map(m=>m.modelId) })+'\n'
      appendFileSync(file, entry, 'utf8')
      try { appendFileSync(join(dir, 'detection.log'), entry, 'utf8') } catch {}
    } catch {}
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
    try {
      const { registerLoadedInstance } = await import('./ports/ModelRuntimeStub')
      // try library size for accurate VRAM target
      let bytes: number | undefined
      try {
        const rows = this.config.listRegistryRows().find(r => r.rfilename === modelId || r.rfilename.replace(/\.gguf$/i,'')===modelId || r.displayName===modelId)
        if (rows?.fileSizeBytes) bytes = rows.fileSizeBytes
        else {
          const { join } = require('node:path') as typeof import('node:path')
          const { statSync } = require('node:fs') as typeof import('node:fs')
          let libDir = this.config.getAppSetting('model_library_dir') || ''
          if (!libDir) { try { const { getSovaraDataDir } = require('../storage/paths') as typeof import('../storage/paths'); libDir = join(getSovaraDataDir(undefined), 'models') } catch {}}
          // search for file matching modelId
          const { readdirSync } = require('node:fs') as typeof import('node:fs')
          const scan = (dir: string): string | undefined => {
            try {
              for (const e of readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, e.name)
                if (e.isDirectory()) { const f = scan(p); if (f) return f }
                else if (e.name.replace(/\.gguf$/i,'')===modelId || e.name===modelId) return p
              }
            } catch {}
            return undefined
          }
          const fp = libDir ? scan(libDir) : undefined
          if (fp) { try { bytes = statSync(fp).size } catch {} }
        }
      } catch {}
      registerLoadedInstance(modelId, runtimeId, 4096, bytes)
    } catch { /* ignore */ }
    return this.getActiveModel()
  }

  getActiveModel(): ActiveModelState {
    const sel = this.config.getActiveSelection()
    if (!sel) return this.resolveRootModel()
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

  /**
   * Root-model fallback (Settings → Agent): when nothing is explicitly
   * selected, the configured default resolves against probed runtimes.
   * Read-only — it never writes a selection.
   */
  private resolveRootModel(): ActiveModelState {
    const root = this.config.getAppSetting('root_model')
    if (!root || root === 'no-default') return { selection: null, available: false }
    for (const entry of this.config.listRuntimes()) {
      if (!entry.enabled) continue
      const snap = this.config.getRuntime(entry.id)
      const found = snap?.lastModels.find((m) => m.modelId === root)
      if (found && snap && snap.lastError === null) {
        return {
          selection: { runtimeId: entry.id, modelId: found.modelId },
          available: true,
          displayName: found.displayName,
          runtimeDisplayName: entry.displayName,
        }
      }
    }
    return { selection: null, available: false }
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
