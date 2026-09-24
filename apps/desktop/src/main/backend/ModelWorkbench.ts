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
import { appendLlamaLog } from '../services/llamaRuntime'
import { RuntimeConfigStore, type ModelRegistryRow, type RegistryInstallStatus } from '../config/RuntimeConfigStore'
import { CustomOpenAICompatibleAdapter, type HttpGet } from './ports/CustomOpenAICompatibleAdapter'
import type { ModelRuntimePort, SystemResourceManagerPort } from '@shared/types/ports'
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
    httpGet?: HttpGet,
    private readonly models?: ModelRuntimePort
  ) {
    this.adapter = new CustomOpenAICompatibleAdapter(httpGet)
  }

  listRuntimes(): ModelRuntimeEntry[] {
    this.ensureLocalLibraryRuntime()
    this.ensureExternalRuntimes()
    return this.config.listRuntimes()
  }

  /**
   * Detect-only: LM Studio (:1234) and Ollama (:11434) are NEVER used for
   * inference. Sovara is sovereign — every prompt runs through the owned
   * llama.cpp sidecar (runtimeId=local). These entries exist ONLY so
   * Library can list GGUFs the user already has in ~/.lmstudio/models or
   * Ollama store. The adapter's scanGgufFiles reads their paths; we never
   * POST to their HTTP endpoints.
   *
   * They are created DISABLED and are filtered out of routing. The user
   * can still see files discovered there, but selecting one migrates to
   * local:GGUF via resolveModelPath.
   */
  private ensureExternalRuntimes(): void {
    try {
      // Endpoints are user-editable defaults (persisted via app settings), not literals.
      // Once a row exists, the user's stored endpoint always wins.
      const want: Array<{ id: string; displayName: string; type: 'lmstudio' | 'ollama'; endpointKey: string; defaultEndpoint: string }> = [
        { id: 'lmstudio', displayName: 'LM Studio — file discovery only (not a runner)', type: 'lmstudio', endpointKey: 'runtime_endpoint_lmstudio', defaultEndpoint: 'http://127.0.0.1:1234/v1' },
        { id: 'ollama', displayName: 'Ollama — file discovery only (not a runner)', type: 'ollama', endpointKey: 'runtime_endpoint_ollama', defaultEndpoint: 'http://127.0.0.1:11434/v1' },
      ]
      for (const w of want) {
        const existing = this.config.getRuntime(w.id)
        if (!existing) {
          const stored = this.config.getAppSetting(w.endpointKey)
          this.config.upsertRuntime({ id: w.id, displayName: w.displayName, type: w.type, endpoint: stored ?? w.defaultEndpoint, enabled: false, timeoutMs: 8000 })
        } else if (existing.entry.enabled) {
          // Force-disable even if an older install left it enabled — sovereign invariant.
          this.config.upsertRuntime({ ...existing.entry, enabled: false })
        }
      }
    } catch { /* never block listing */ }
  }

  /** Update the discovery endpoint for a detect-only external runtime (LM Studio / Ollama). */
  setExternalRuntimeEndpoint(runtimeId: 'lmstudio' | 'ollama', endpoint: string): ModelRuntimeEntry {
    const normalized = normalizeEndpoint(endpoint)
    const snap = this.config.getRuntime(runtimeId)
    if (!snap) throw new ModelWorkbenchError('unknown runtime: external runtime not initialized yet')
    const entry: ModelRuntimeEntry = { ...snap.entry, endpoint: normalized }
    this.config.upsertRuntime(entry)
    this.config.setAppSetting(`runtime_endpoint_${runtimeId}`, normalized)
    return entry
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
    // Owned runtime: probe the real binary + library, no HTTP involved.
    if (snap.entry.endpoint === 'local' || snap.entry.id === 'local') {
      return this.probeLocalRuntime(snap.entry)
    }
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

  /** Owned-runtime probe: binary present + GGUF library scan (no network). */
  private async probeLocalRuntime(entry: ModelRuntimeEntry): Promise<RuntimeProbeResult> {
    const started = Date.now()
    try {
      if (!this.models) {
        const err = 'local runtime port unavailable in this context'
        this.config.saveProbeSnapshot(entry.id, [], err)
        return { reachable: false, runtimeId: entry.id, latencyMs: Date.now() - started, models: [], error: err }
      }
      const probe = await this.models.probeRuntime('local')
      if (!probe.available) {
        const err = 'local runtime not installed yet — install it from Models to load GGUFs into VRAM'
        this.config.saveProbeSnapshot(entry.id, [], err)
        appendLlamaLog(this.baseDir, 'probe', { runtimeId: entry.id, reachable: false, detail: 'binary missing' })
        return { reachable: false, runtimeId: entry.id, latencyMs: Date.now() - started, models: [], error: err }
      }
      const localModels = await this.models.listLocalModels()
      const snapshot = localModels.map((m) => ({ modelId: String(m.id), displayName: m.displayName }))
      this.config.saveProbeSnapshot(entry.id, snapshot, snapshot.length > 0 ? null : 'no GGUF models in the Sovara library')
      const discovered: DiscoveredModel[] = localModels.map((m) => ({
        modelId: String(m.id),
        displayName: m.displayName,
        runtimeId: entry.id,
        source: 'llama.cpp' as const,
        capabilities: [],
        available: true,
      }))
      appendRuntimeLog(this.baseDir, {
        time: Date.now(), runtimeId: entry.id, method: 'GET', target: 'local/llama.cpp',
        latencyMs: Date.now() - started, status: 200, outcome: 'ok',
      })
      appendLlamaLog(this.baseDir, 'probe', { runtimeId: entry.id, reachable: true, models: discovered.length, version: probe.version ?? 'unknown' })
      return { reachable: true, runtimeId: entry.id, latencyMs: Date.now() - started, models: discovered }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      this.config.saveProbeSnapshot(entry.id, [], err.slice(0, 200))
      return { reachable: false, runtimeId: entry.id, latencyMs: Date.now() - started, models: [], error: err.slice(0, 200) }
    }
  }

  /** Snapshot reads — no network. Probe first via probeRuntime. */
  listModels(runtimeId?: string): DiscoveredModel[] {
    this.ensureLocalLibraryRuntime()
    this.ensureExternalRuntimes()
    // Prune ghosts: any local model whose GGUF no longer exists is removed
    // from the snapshot so the dropdown never shows a hard-coded stale entry.
    // The user's explicit active selection is kept until end-of-chat (sticky),
    // but the list itself is always the live detected set.
    this.pruneMissingFromLocalSnapshot()
    const allEntries = runtimeId ? [this.config.getRuntime(runtimeId)?.entry].filter((e): e is ModelRuntimeEntry => Boolean(e)) : this.config.listRuntimes()
    if (runtimeId && allEntries.length === 0) throw new ModelWorkbenchError('unknown runtime')
    // Sovereign: when listing all, hide disabled external runtimes (LM Studio/Ollama are file-discovery only).
    // Their GGUFs are already surfaced via the local snapshot (see registerExternalModelDir), so showing them twice is duplicate.
    const entries = runtimeId ? allEntries : allEntries.filter((e) => e.enabled || e.id === 'local')
    const localSnapCheck = this.config.getRuntime('local')
    if (localSnapCheck && localSnapCheck.lastModels.length === 0) {
      const fresh = this.loadLocalLibrarySnapshot()
      if (fresh.length > 0) {
        this.config.saveProbeSnapshot('local', fresh, null)
      }
    }
    if (!runtimeId && entries.length === 0) {
      // Fallback: if local was pruned, still show local if it has snapshot
      const localSnap = this.config.getRuntime('local')
      if (localSnap && localSnap.lastModels.length > 0) {
        const fake: ModelRuntimeEntry = { id: 'local', displayName: 'Sovara Local (llama.cpp)', type: 'llama.cpp', endpoint: 'local', enabled: true, timeoutMs: 8000 }
        entries.push(fake)
      }
    }
    const out: DiscoveredModel[] = []
    for (const entry of entries) {
      const snap = this.config.getRuntime(entry.id)
      if (!snap) continue
      for (const m of snap.lastModels) {
        // Extra safety: skip any residual entry that cannot be resolved now
        if (entry.id === 'local' && !this.isModelLive(m.modelId)) continue
        // Skip LM Studio entries that are already present as local via external file path — file path is truth
        if (entry.id !== 'local') {
          try {
            const row = this.config.listRegistryRows().find((r) => r.displayName === m.displayName || r.rfilename === m.displayName || r.repository.endsWith(m.displayName))
            if (row && this.isModelLive(row.rfilename)) continue // local already covers this file
          } catch {}
        }
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
    // Deduplicate: same GGUF via LM Studio + Local + Registry → single entry
    // Normalizes by file basename without quant/version noise so GLM-4.6V-Flash-Q4_K_M and unsloth/.../GLM-4.6V-Flash-Q4_K_M.gguf collapse to one.
    if (!runtimeId) {
      const prio = (r: string): number => r === 'local' ? 10 : r === 'lmstudio' ? 1 : r === 'ollama' ? 1 : 0
      const normalizeKey = (m: DiscoveredModel): string => {
        // Prefer registry localPath when available — that's the on-disk truth
        try {
          const row = this.config.listRegistryRows().find((r) => r.displayName === m.displayName || r.rfilename === m.displayName || m.modelId.toLowerCase().includes(r.rfilename.toLowerCase().replace(/\.gguf$/i,'')))
          if (row?.localPath) return `path:${row.localPath.toLowerCase().replace(/\\/g,'/')}`
        } catch {}
        const base = (m.modelId.split('/').pop() || m.modelId).toLowerCase().replace(/\.gguf$/i,'').replace(/\.bin$/i,'')
        // Strip quant suffix (Q4_K_M, Q8_0, etc.) and version/flash noise for dedup, keep core family token
        const core = base.replace(/[-_]?q\d.*$/i,'').replace(/[-_\.]/g,'').trim()
        // For vision families keep the family token distinct: glm46vflash vs glm46v
        return `core:${core}`
      }
      const dedup = new Map<string, DiscoveredModel>()
      for (const m of out) {
        const key = normalizeKey(m)
        const existing = dedup.get(key)
        if (!existing) dedup.set(key, m)
        else if (prio(m.runtimeId) > prio(existing.runtimeId)) dedup.set(key, m)
        else if (prio(m.runtimeId) === prio(existing.runtimeId)) {
          // Prefer the shorter, cleaner modelId (without full HF path) for display
          if (String(m.modelId).length < String(existing.modelId).length) dedup.set(key, m)
        }
      }
      return Array.from(dedup.values())
    }
    return out
  }

  /** Hook kept (deprecated) so any out-of-tree callers don't break; returns null.
   *  The hidden-needle3 model is gone — routing now uses Laya for decisions. */
  private getHiddenNeedleForRouting(): DiscoveredModel | null {
    return null
  }

  listModelsForRouting(): DiscoveredModel[] {
    // The hidden-needle3 auto-router is gone — routing decisions now go through
    // the Laya decision sidecar (`services/layaDecision.ts`), which asks a real
    // user-visible classifier to break ties instead of shoving a hidden model
    // into the candidate list. Visible candidate list equals discovered list.
    return this.listModels()
  }

  private isMmprojId(modelId: string): boolean {
    const b = String(modelId).split('/').pop()?.toLowerCase() ?? ''
    return b === 'mmproj.gguf' || b.startsWith('mmproj-')
  }

  private isModelLive(modelId: string): boolean {
    if (this.isMmprojId(modelId)) return false // projector shard — never a runnable selection
    try {
      if (!this.models?.resolveModelPath) return true // adapter without path check — don't prune
      // Direct check + fuzzy contains fallback (handles Qwen/Qwen3-0.6B vs Qwen3-0.6B-Q4_K_M.gguf)
      try { this.models.resolveModelPath(modelId); return true } catch {}
      const last = String(modelId).split('/').pop()?.replace(/\.gguf$/i,'').toLowerCase() ?? ''
      if (last.length >= 4) {
        const files = (this.models as unknown as { scanGgufFiles?: () => string[] })?.scanGgufFiles?.() ?? []
        if (Array.isArray(files) && files.some(f => f.toLowerCase().includes(last))) return true
      }
      if (this.isMmprojId(modelId)) return false
      // Last resort: don't prune on fuzzy — allow selection attempt to try fuzzy resolve
      return true
    } catch {
      if (this.isMmprojId(modelId)) return false
      return true
    }
  }

  private pruneMissingFromLocalSnapshot(): void {
    try {
      if (!this.models) return
      const snap = this.config.getRuntime('local')
      if (!snap || snap.lastModels.length === 0) return
      const kept = snap.lastModels.filter((m) => this.isModelLive(m.modelId))
      if (kept.length === snap.lastModels.length) return
      const err = kept.length === 0 ? 'no GGUF models in the Sovara library' : null
      this.config.saveProbeSnapshot('local', kept, err)
      appendLlamaLog(this.baseDir, 'prune-ghosts', { before: snap.lastModels.length, after: kept.length, removed: snap.lastModels.filter((m) => !kept.some((k) => k.modelId === m.modelId)).map((m) => m.modelId) })
    } catch { /* never block listing */ }
  }

  /** Ensure the library's local files appear as a runtime so Chat orchestration (ARCHITECTURE_PHASE1 §6) can select them without a probe. */
  private ensureLocalLibraryRuntime(): void {
    try {
      const snap = this.config.getRuntime('local')
      if (!snap) {
        // Only create if there is at least one file in library
        const lib = this.loadLocalLibrarySnapshot()
        if (lib.length === 0) return
        const entry: ModelRuntimeEntry = { id: 'local', displayName: 'Sovara Local (llama.cpp)', type: 'llama.cpp', endpoint: 'local', enabled: true, timeoutMs: 8000 }
        this.config.upsertRuntime(entry)
        this.config.saveProbeSnapshot('local', lib, null)
        // Auto-select first if nothing selected (selection only — VRAM load
        // happens on select/send, never silently here).
        if (!this.config.getActiveSelection()) {
          this.config.setActiveSelection({ runtimeId: 'local', modelId: lib[0].modelId })
        }
        // Log: connected models discovered
        try { this.logLocalDiscovery(lib) } catch {}
      } else if (snap.lastModels.length === 0) {
        const lib = this.loadLocalLibrarySnapshot()
        if (lib.length > 0) {
          this.config.saveProbeSnapshot('local', lib, null)
          if (!this.config.getActiveSelection()) {
            this.config.setActiveSelection({ runtimeId: 'local', modelId: lib[0].modelId })
          }
          try { this.logLocalDiscovery(lib) } catch {}
        }
      }
      // Sovereign invariant: stale external active (lmstudio/ollama) must be
      // cleared on startup if no local GGUF matches — otherwise Chat would
      // POST to :1234 and hit connection-refused.
      const sel = this.config.getActiveSelection()
      if (sel && sel.runtimeId !== 'local') {
        const live = this.isModelLive(sel.modelId)
        if (!live) {
          appendLlamaLog(this.baseDir, 'clear-stale-external-selection', { runtimeId: sel.runtimeId, modelId: sel.modelId })
          this.config.clearActiveSelection()
        } else {
          // External id is live only because the file exists on disk — migrate
          // it to local so the next Chat uses the sidecar, not the external HTTP.
          try {
            const localSnap = this.config.getRuntime('local')
            const needle = String(sel.modelId).toLowerCase().replace(/\.gguf$/i, '').split('/').pop()?.trim() ?? String(sel.modelId).toLowerCase()
            const hit = localSnap?.lastModels.find((m) => m.displayName.toLowerCase().replace(/\.gguf$/i,'').trim() === needle || m.modelId.toLowerCase().includes(needle))
            if (hit) {
              this.config.setActiveSelection({ runtimeId: 'local', modelId: hit.modelId })
              appendLlamaLog(this.baseDir, 'startup-migrate-external-to-local', { from: `${sel.runtimeId}:${sel.modelId}`, to: `local:${hit.modelId}` })
            } else {
              // Has a file but no snapshot hit — keep as local live file
              this.config.setActiveSelection({ runtimeId: 'local', modelId: sel.modelId })
            }
          } catch { this.config.clearActiveSelection() }
        }
      }
    } catch { /* never block */ }
  }

  private loadLocalLibrarySnapshot(): Array<{ modelId: string; displayName: string }> {
    try {
      const outMap = new Map<string, { modelId: string; displayName: string }>()

      // 1. If models port is available, use its scanned GGUF files
      if (this.models) {
        try {
          const files = (this.models as unknown as { scanGgufFiles?: () => string[] })?.scanGgufFiles?.() ?? []
          for (const file of files) {
            const base = require('node:path').basename(file)
            if (this.isMmprojId(base)) continue
            const mid = base.replace(/\.gguf$/i, '')
            outMap.set(mid.toLowerCase(), { modelId: mid, displayName: base })
          }
        } catch {}
      }

      // 2. Scan via RuntimeConfigStore registry rows
      try {
        const rows = this.config.listRegistryRows()
        for (const r of rows) {
          if (r.installStatus === 'missing') continue
          const file = r.rfilename || require('node:path').basename(r.localPath || '')
          if (!file || this.isMmprojId(file)) continue
          const mid = r.repository ? `${r.repository}/${r.rfilename}` : file.replace(/\.gguf$/i, '')
          if (!outMap.has(mid.toLowerCase()) && this.isModelLive(mid)) {
            outMap.set(mid.toLowerCase(), { modelId: mid, displayName: r.displayName || file })
          }
        }
      } catch {}

      // 3. Fallback / candidate dirs scan (AppData, .lmstudio, .node-llama-cpp, etc.)
      let libDir = this.config.getAppSetting('model_library_dir') || this.config.getAppSetting('library_dir') || ''
      if (!libDir) {
        try {
          const { getSovaraDataDir } = require('../storage/paths') as typeof import('../storage/paths')
          const { join } = require('node:path') as typeof import('node:path')
          libDir = join(getSovaraDataDir(this.baseDir), 'models')
        } catch {}
      }
      const external = this.baseDir ? [] : (() => {
        try { return (this.config as unknown as { getExternalModelDirs?: () => string[] }).getExternalModelDirs?.() ?? [] } catch { return [] }
      })()
      const dirs = [libDir, ...external].filter(Boolean)

      const { readdirSync } = require('node:fs') as typeof import('node:fs')
      const { join, basename } = require('node:path') as typeof import('node:path')
      const scan = (dir: string): void => {
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name)
            if (e.isDirectory()) {
              scan(p)
            } else if (e.name.toLowerCase().endsWith('.gguf')) {
              const b = basename(p)
              if (this.isMmprojId(b)) continue
              try {
                const { preflightGgufArchitecture } = require('../services/llamaRuntime') as typeof import('../services/llamaRuntime')
                if (!preflightGgufArchitecture(p).ok) continue
              } catch {}
              const mid = b.replace(/\.gguf$/i, '')
              if (!outMap.has(mid.toLowerCase())) {
                outMap.set(mid.toLowerCase(), { modelId: mid, displayName: b })
              }
            }
          }
        } catch {}
      }
      for (const d of dirs) scan(d)

      return Array.from(outMap.values())
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

  async selectModel(runtimeId: string, modelId: string, opts?: { fit?: boolean }): Promise<ActiveModelState> {
    // Auto smart-routing: user wants per-task best model, not pinned.
    if (runtimeId === 'auto' && modelId === '__auto__') {
      this.config.setAppSetting('sovara_auto_routing', 'true')
      // Clear pinned selection so getActiveModel returns Auto
      try { this.config.clearActiveSelection() } catch {}
      appendLlamaLog(this.baseDir, 'select-auto', { detail: 'auto smart-routing enabled' })
      return this.getActiveModel()
    }
    // Any explicit model pick disables Auto
    if (this.config.getAppSetting('sovara_auto_routing') === 'true') {
      this.config.setAppSetting('sovara_auto_routing', 'false')
    }
    // Always prune stale ghosts before any selection decision
    this.pruneMissingFromLocalSnapshot()
    let snap = this.config.getRuntime(runtimeId)
    if (!snap) throw new ModelWorkbenchError('unknown runtime')
    if (!snap.entry.enabled) {
      if (snap.entry.id === 'lmstudio' || snap.entry.id === 'ollama') {
        throw new ModelWorkbenchError(`runtime is disabled — ${snap.entry.id} is file-discovery only, not a runner. Select a local model (Sovara Local (llama.cpp)) — every prompt runs through the owned sidecar. Files found in ${snap.entry.id} appear in Library and run locally.`)
      }
      throw new ModelWorkbenchError('runtime is disabled')
    }
    // Live check first — if the file is truly missing, give the library hint
    // and ensure the ghost is gone from the list; sticky selection is still
    // kept (tracked) until the user picks a new available model.
    if (snap.entry.id === 'local' && !this.isModelLive(modelId)) {
      // Re-prune in case the missing id was the one being selected
      this.pruneMissingFromLocalSnapshot()
      snap = this.config.getRuntime(runtimeId) ?? snap
      const stillKnown = snap.lastModels.some((m) => m.modelId === modelId)
      if (!stillKnown) {
        throw new ModelWorkbenchError(`model-not-found: "${modelId}" is not in the Sovara library (Library -> download a GGUF first) — removed from list`)
      }
    }
    let known = snap.lastModels.some((m) => m.modelId === modelId)
    if (!known) {
      const needle = String(modelId).split('/').pop()?.replace(/\.gguf$/i,'').toLowerCase() ?? ''
      const hit = needle.length >= 2 ? snap.lastModels.find(m => m.modelId.toLowerCase().includes(needle) || needle.includes(m.modelId.toLowerCase().replace(/\.gguf$/i,'')) || m.displayName.toLowerCase().includes(needle)) : undefined
      if (hit) {
        modelId = hit.modelId
        known = true
      } else {
        try {
          const fresh = this.loadLocalLibrarySnapshot()
          if (fresh.length) { this.config.saveProbeSnapshot(snap.entry.id, fresh, null); snap = this.config.getRuntime(runtimeId) ?? snap }
          known = snap.lastModels.some(m => m.modelId === modelId || (needle && m.modelId.toLowerCase().includes(needle)))
          if (known) {
            const hit2 = snap.lastModels.find(m => m.modelId === modelId || m.modelId.toLowerCase().includes(needle))
            if (hit2) modelId = hit2.modelId
          }
        } catch {}
        // Last resort: if file exists on disk, accept selection regardless of snapshot (snapshot was stale/empty)
        if (!known && runtimeId === 'local' && this.isModelLive(modelId)) {
          console.warn(`[workbench] accepting live file not in snapshot: ${modelId}`)
          known = true
        }
        if (!known && needle) {
          try {
            const avail = this.models ? await this.models.listLocalModels() : []
            const hit3 = avail.find(a => a.displayName.toLowerCase().includes(needle) || String(a.id).toLowerCase().includes(needle))
            if (hit3) { modelId = String(hit3.id); known = true; this.config.saveProbeSnapshot(snap.entry.id, avail.map(a=>({modelId:String(a.id), displayName:a.displayName})), null); snap = this.config.getRuntime(runtimeId) ?? snap }
          } catch {}
        }
      }
    }
    if (!known) throw new ModelWorkbenchError('unknown model: probe the runtime first')
    // Sovereign local: never block the *selection* on VRAM pressure — the adapter
    // will LRU-evict the old resident and try partial/CPU before honest fail.
    // Blocking here would show the red banner instead of transparently shifting.
    // Only non-local (disabled) runtimes are already filtered; for local we
    // just log and allow the deferred load to decide.
    if (runtimeId !== 'local') {
      const pressure = await this.resources.checkBeforeLoad(
        { id: modelId as never, displayName: modelId, source: 'custom', format: 'unknown' },
        {}
      )
      if (pressure.blocking) {
        throw new ModelWorkbenchError(`resource-pressure: ${pressure.reason ?? 'load refused'}`)
      }
    } else {
      try {
        const pressure = await this.resources.checkBeforeLoad(
          { id: modelId as never, displayName: modelId, source: 'custom', format: 'unknown' },
          {}
        )
        if (pressure.blocking) {
          appendLlamaLog(this.baseDir, 'select-pressure-warn', { modelId, runtimeId, level: pressure.level, reason: pressure.reason })
        }
      } catch { /* never block local select */ }
    }
    this.config.setActiveSelection({ runtimeId, modelId })
    // Dropdown selection is instant — don't block UI loading VRAM. Actual
    // load is deferred to chat:send (AgentOrchestrator ensures healthy). Log only.
    appendLlamaLog(this.baseDir, 'select', { modelId, runtimeId, detail: 'selection updated (load deferred to next chat)', fit: opts?.fit === true })
    return this.getActiveModel()
  }

  getActiveModel(): ActiveModelState {
    // Auto smart-routing takes precedence — pill shows Auto, router picks per-task best
    if (this.config.getAppSetting('sovara_auto_routing') === 'true') {
      return { selection: { runtimeId: 'auto', modelId: '__auto__' }, available: true, displayName: 'Auto', runtimeDisplayName: 'Smart routing' }
    }
    let sel = this.config.getActiveSelection()
    // If active selection is a stale flat LMStudio id (pre-fix: "GLM-4.6V-Flash-Q4_K_M" without nested path), clear it so dropdown is user-driven
    if (sel && (sel.modelId === 'GLM-4.6V-Flash-Q4_K_M' || sel.modelId === 'GLM-4.6V-Flash-Q4_K_M.gguf')) {
      try { this.config.clearActiveSelection() } catch {}
      try { this.config.setAppSetting('root_model', 'no-default') } catch {}
      sel = null
    }
    // Root model must never override an explicit user selection — only used when sel is null
    // If root was set to the stale flat GLM, reset it
    try { const root = this.config.getAppSetting('root_model'); if (root && root.includes('GLM-4.6V-Flash')) this.config.setAppSetting('root_model', 'no-default') } catch {}
    // Auto-migrate stale mmproj selection (vision projector shard) to a real LLM
    if (sel && this.isMmprojId(sel.modelId)) {
      const snap0 = this.config.getRuntime(sel.runtimeId)
      const live = snap0?.lastModels.find((m) => !this.isMmprojId(m.modelId) && this.isModelLive(m.modelId))
      if (live) {
        this.config.setActiveSelection({ runtimeId: sel.runtimeId, modelId: live.modelId })
        sel = this.config.getActiveSelection()
        appendLlamaLog(this.baseDir, 'migrate-mmproj-selection', { from: sel?.modelId, to: live.modelId })
      } else {
        this.config.setActiveSelection(null as unknown as never)
        try { (this.config as unknown as { clearActiveSelection?: () => void }).clearActiveSelection?.() } catch {}
        return { selection: null, available: false }
      }
    }
    // Sovereign: external selections (lmstudio/ollama) are NEVER runnable — they are
    // detect-only. Try to migrate to a local GGUF with the same basename; if no
    // local file exists, mark unavailable so the UI shows "Open Models" instead
    const selSnap = sel ? this.config.getRuntime(sel.runtimeId) : null
    if (sel && selSnap && (selSnap.entry.type === 'lmstudio' || selSnap.entry.type === 'ollama')) {
      let migrated = false
      try {
        const localSnap = this.config.getRuntime('local')
        if (localSnap) {
          const needle = String(sel.modelId).toLowerCase().replace(/\.gguf$/i, '').split('/').pop()?.trim() ?? String(sel.modelId).toLowerCase()
          const dNeedle = sel.modelId.toLowerCase()
          const localHit = localSnap.lastModels.find((m) =>
            m.modelId.toLowerCase() === dNeedle ||
            m.displayName.toLowerCase() === needle ||
            m.modelId.toLowerCase().includes(needle) ||
            needle.includes(m.modelId.toLowerCase().replace(/\.gguf$/i, '').split('/').pop() ?? '')
          )
          if (localHit && this.isModelLive(localHit.modelId)) {
            this.config.setActiveSelection({ runtimeId: 'local', modelId: localHit.modelId })
            sel = this.config.getActiveSelection()
            migrated = true
            appendLlamaLog(this.baseDir, 'migrate-external-to-local', { from: `${sel?.runtimeId}:${sel?.modelId}`, to: `local:${localHit.modelId}` })
          }
        }
      } catch { /* keep original selection */ }
      if (!migrated) {
        // No local GGUF matches this external id — e.g. lmstudio:qwen/qwen3.5-9b with no local file.
        // Tell the renderer the selection is not runnable; ChatService will surface
        // "No active local model selected. Open Models and select a model first."
        appendLlamaLog(this.baseDir, 'external-selection-blocked', { runtimeId: sel!.runtimeId, modelId: sel!.modelId })
        return { selection: sel, available: false }
      }
    }
    if (!sel) return this.resolveRootModel()
    const snap = this.config.getRuntime(sel.runtimeId)
    if (!snap || !snap.entry.enabled) return { selection: sel, available: false }
    let found = snap.lastModels.find((m) => m.modelId === sel!.modelId)
    // Fuzzy fallback for Qwen/Qwen3-0.6B vs Qwen3-0.6B-Q4_K_M style ids
    if (!found) {
      const needle = String(sel!.modelId).split('/').pop()?.replace(/\.gguf$/i,'').toLowerCase() ?? ''
      found = needle ? snap.lastModels.find(m => m.modelId.toLowerCase().includes(needle) || m.displayName.toLowerCase().includes(needle)) : undefined
      if (found) { try { this.config.setActiveSelection({ runtimeId: sel!.runtimeId, modelId: found.modelId }); sel = found.modelId as unknown as typeof sel; } catch {} }
    }
    // Local runtime: available if file exists, even if snapshot had lastError (probe not re-run after Use)
    const isLocal = snap.entry.id === 'local'
    const live = found ? this.isModelLive(found.modelId) : false
    if (!found || (!live && snap.lastError !== null) ) return { selection: sel, available: false }
    if (isLocal && live) { /* force available */ }
    else if (snap.lastError !== null) return { selection: sel, available: false }
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
