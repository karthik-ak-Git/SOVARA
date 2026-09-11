/**
 * LlamaCppServerAdapter — Sovara's OWN local runtime behind ModelRuntimePort.
 *
 * Lifecycle (spec): select → check → hardware → runtime → isolated runner →
 * readiness → register RunningModelInstance → route → stream → metrics →
 * unload (process stop + resource release, model file untouched).
 *
 * State machine (canonical `state`, IPC-compat `status` projection):
 *   OFFLINE → LOADING → ACTIVE → BUSY_DECODE → ACTIVE → EVICTING → OFFLINE
 *   LOADING/ACTIVE/BUSY → FAILED → OFFLINE (next load overwrites)
 * OFFLINE = absent from the registry map.
 *
 * Concurrency: per-model loading promises share ONE runner among all
 * simultaneous waiters; a mandatory re-check after acquiring the lock
 * prevents duplicate runners. A short global mutex serializes the
 * evict-decide-spawn section so two different models cannot both pass
 * the capacity gate at once.
 *
 * Honesty: estimates are labeled estimates; observed VRAM comes from
 * freeBefore−freeAfter only; CPU/GPU utilizations are left undefined
 * unless measured; failures are classified (OOM vs backend vs crash…)
 * and only port-conflicts retry once — never blind `-ngl` reduction.
 */

import type { ChildProcess } from 'node:child_process'
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { InstanceId, ModelId } from '@shared/types/branded'
import type {
  LocalModel,
  ModelInstance,
  ModelRuntimePort,
  RuntimeInstanceState,
} from '@shared/types/ports'
import type { RuntimeConfigStore } from '../../config/RuntimeConfigStore'
import { resolveLibraryDir } from '../../services/modelDownloads'
import { getSovaraDataDir } from '../../storage/paths'
import {
  appendLlamaLog,
  buildServerArgs,
  classifyLoadFailure,
  findFreePort,
  getLlamaServerPath,
  getLlamaVersion,
  killServer,
  kvCacheMBFromInfo,
  planMemory,
  planPartialFit,
  queryGpuVram,
  readGgufModelInfo,
  selectRuntimeForModel,
  spawnLlamaServer,
  waitForServerReady,
} from '../../services/llamaRuntime'

export interface AdapterDeps {
  spawn?: typeof spawnLlamaServer
  waitReady?: (port: number, timeoutMs: number) => Promise<void>
  queryVram?: typeof queryGpuVram
  findPort?: typeof findFreePort
  exePathOverride?: string | null
}

interface TrackedInstance extends ModelInstance {
  proc: ChildProcess
  port: number
  modelPath: string
  fileSizeBytes: number
}

function instanceIdFor(modelId: string): InstanceId {
  return `inst_${modelId.replace(/[^a-z0-9]/gi, '_')}` as InstanceId
}

function walkGguf(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walkGguf(full, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.gguf')) out.push(full)
  }
}

function parseQuant(filename: string): string | undefined {
  const m = filename.match(/(Q\d_[A-Z0-9]+|MXFP\d|F16|BF16|Q\d_0)/i)
  return m ? m[1].toUpperCase() : undefined
}

function parseParams(filename: string): string | undefined {
  const m = filename.match(/(\d+(?:\.\d+)?)\s*B\b/i)
  return m ? `${m[1]}B` : undefined
}

/**
 * Vision projector shard (llama.cpp `--mmproj`), not a runnable language
 * model. Small files, so they sail through VRAM size gates — they must be
 * excluded from loadable-model logic explicitly.
 */
function isMmprojFile(basename: string): boolean {
  const lower = basename.toLowerCase()
  return lower === 'mmproj.gguf' || lower.startsWith('mmproj-')
}

function statusFor(state: RuntimeInstanceState): ModelInstance['status'] {
  switch (state) {
    case 'LOADING': return 'loading'
    case 'ACTIVE': return 'loaded'
    case 'BUSY_DECODE': return 'generating'
    case 'EVICTING': return 'unloading'
    case 'FAILED': return 'failed'
    case 'OFFLINE': return 'unloaded'
  }
}

export class LlamaCppServerAdapter implements ModelRuntimePort {
  private readonly instances = new Map<string, TrackedInstance>()
  /** Per-model in-flight loads — all waiters share ONE promise (spec §4). */
  private readonly pendingLoads = new Map<string, Promise<TrackedInstance>>()
  /** Short global mutex for the evict-decide-spawn section. */
  private globalMutex: Promise<void> = Promise.resolve()
  private maxConcurrentModels = 1
  private readonly deps: Required<Pick<AdapterDeps, 'spawn' | 'waitReady' | 'queryVram' | 'findPort'>> & Pick<AdapterDeps, 'exePathOverride'>

  constructor(
    private readonly baseDir?: string,
    private config?: RuntimeConfigStore | null,
    private readonly libraryDirOverride?: string,
    deps?: AdapterDeps
  ) {
    this.deps = {
      spawn: deps?.spawn ?? spawnLlamaServer,
      waitReady: deps?.waitReady ?? ((port: number, t: number) => waitForServerReady(port, t)),
      queryVram: deps?.queryVram ?? queryGpuVram,
      findPort: deps?.findPort ?? findFreePort,
      ...(deps?.exePathOverride !== undefined ? { exePathOverride: deps.exePathOverride } : {}),
    }
  }

  /** Late-bind the real config once AppBackend creates it (registry resolution). */
  bindConfig(config: RuntimeConfigStore): void {
    this.config = config
  }

  /** Eviction policy is explicit and configurable (spec §14). */
  setMaxConcurrentModels(n: number): void {
    const v = Math.floor(n)
    if (Number.isFinite(v) && v >= 1) this.maxConcurrentModels = Math.min(8, v)
  }

  private exePath(): string | null {
    if (this.deps.exePathOverride !== undefined) return this.deps.exePathOverride
    return getLlamaServerPath(this.baseDir)
  }

  private libraryDir(): string {
    if (this.libraryDirOverride) return this.libraryDirOverride
    try {
      if (this.config) {
        let userData: string
        try {
          userData = app.isReady() ? app.getPath('userData') : getSovaraDataDir(this.baseDir)
        } catch {
          userData = getSovaraDataDir(this.baseDir)
        }
        return resolveLibraryDir(this.config, userData)
      }
    } catch { /* fall through to data-dir default */ }
    return path.join(getSovaraDataDir(this.baseDir), 'models')
  }

  private scanGgufFiles(): string[] {
    const out: string[] = []
    walkGguf(this.libraryDir(), out)
    return out.sort()
  }

  /**
   * Resolve a Chat/Workbench modelId to an absolute GGUF path.
   * Accepts: absolute path, registry `repository/rfilename`, bare basename
   * (with or without `.gguf`), or display name. Throws model-not-found.
   */
  resolveModelPath(modelId: string): string {
    const clean = String(modelId ?? '').trim()
    if (!clean) throw new Error('model-not-found: empty model id')
    if (path.isAbsolute(clean)) {
      if (fs.existsSync(clean) && clean.toLowerCase().endsWith('.gguf')) return clean
      throw new Error(`model-not-found: no GGUF at ${clean}`)
    }
    const norm = clean.replace(/\\/g, '/')
    const last = norm.split('/').pop() ?? norm
    const candidates = new Set([clean, norm, last, `${last.replace(/\.gguf$/i, '')}.gguf`, `${last}.gguf`].map((s) => s.toLowerCase()))
    // Registry first (authoritative localPath when present).
    try {
      for (const row of this.config?.listRegistryRows() ?? []) {
        if (!row.localPath) continue
        const base = path.basename(row.localPath).toLowerCase()
        if (candidates.has(base) || candidates.has(row.rfilename.toLowerCase()) || candidates.has(`${row.repository}/${row.rfilename}`.toLowerCase())) {
          if (fs.existsSync(row.localPath)) return row.localPath
        }
      }
    } catch { /* registry unavailable — filesystem scan decides */ }
    for (const file of this.scanGgufFiles()) {
      if (candidates.has(path.basename(file).toLowerCase())) return file
    }
    throw new Error(`model-not-found: "${clean}" is not in the Sovara library (Library -> download a GGUF first)`)
  }

  async listLocalModels(): Promise<LocalModel[]> {
    const files = this.scanGgufFiles()
    return files.map((file) => {
      const base = path.basename(file)
      return {
        id: base.replace(/\.gguf$/i, '') as ModelId,
        displayName: base,
        path: file,
        source: 'sovara' as const,
        format: 'gguf' as const,
        params: parseParams(base),
        quant: parseQuant(base),
        discoveredAt: Date.now(),
      }
    })
  }

  /**
   * Load a GGUF into VRAM with per-model concurrency safety (spec §4):
   * simultaneous requests for the same unloaded model share ONE loading
   * promise and receive the SAME verified instance. Failures propagate to
   * all waiters; no LOADING state sticks forever (map entry removed).
   */
  async load(modelId: ModelId, opts?: { ctxLen?: number; gpu?: 'auto' | 'cpu' | 'fit' | number; runtimeId?: string }): Promise<ModelInstance> {
    const key = String(instanceIdFor(String(modelId)))
    const pending = this.pendingLoads.get(key)
    if (pending) return this.publicView(await pending)
    const p = this.loadInner(String(modelId), opts)
    this.pendingLoads.set(key, p)
    try {
      return this.publicView(await p)
    } finally {
      if (this.pendingLoads.get(key) === p) this.pendingLoads.delete(key)
    }
  }

  /**
   * Routing seam (spec §10): resolve-or-load the verified healthy instance
   * for a model. Healthy instances route directly; otherwise the per-model
   * lock is acquired, the registry is RE-CHECKED (mandatory), then the
   * model loads, readiness is verified, and the request routes to THAT
   * exact endpoint. Never routes merely because a model is marked ACTIVE.
   */
  async ensureHealthy(modelId: ModelId, opts?: { ctxLen?: number; runtimeId?: string }): Promise<ModelInstance> {
    const key = String(instanceIdFor(String(modelId)))
    const cur = this.instances.get(key)
    if (cur) {
      const h = await this.health(cur.id)
      if (h.ok) {
        cur.lastActiveAt = Date.now()
        return this.publicView(cur)
      }
    }
    return this.load(modelId, opts)
  }

  /** Streaming accounting (spec §11–12): request start. */
  noteRequestStart(instanceId: InstanceId): void {
    const cur = this.instances.get(instanceId as string)
    if (!cur || cur.state === 'EVICTING' || cur.state === 'FAILED') return
    cur.activeRequests = (cur.activeRequests ?? 0) + 1
    cur.state = 'BUSY_DECODE'
    cur.status = statusFor('BUSY_DECODE')
    cur.health = 'healthy'
    cur.lastActiveAt = Date.now()
  }

  /** Streaming accounting: request end with measured throughput. */
  noteRequestEnd(instanceId: InstanceId, info?: { ttftMs?: number; tokensPerSec?: number }): void {
    const cur = this.instances.get(instanceId as string)
    if (!cur) return
    cur.activeRequests = Math.max(0, (cur.activeRequests ?? 1) - 1)
    if (cur.state === 'BUSY_DECODE' && (cur.activeRequests ?? 0) === 0) {
      cur.state = 'ACTIVE'
      cur.status = statusFor('ACTIVE')
    }
    if (typeof info?.ttftMs === 'number' && Number.isFinite(info.ttftMs)) cur.ttftMs = Math.round(info.ttftMs)
    if (typeof info?.tokensPerSec === 'number' && Number.isFinite(info.tokensPerSec)) {
      cur.metrics = { ...(cur.metrics ?? {}), tokensPerSec: info.tokensPerSec, lastUpdatedAt: Date.now() }
    }
    cur.lastActiveAt = Date.now()
  }

  /**
   * Library models whose preflight estimate fits this GPU (spec: actionable
   * refusal). Largest-first, excludes the refused model. Estimate only.
   */
  private fittingAlternatives(excludeBase: string, totalMB: number, limit = 3): string[] {
    const out: Array<{ base: string; est: number }> = []
    try {
      for (const file of this.scanGgufFiles()) {
        const base = path.basename(file)
        if (base === excludeBase) continue
        if (isMmprojFile(base)) continue // projector shard, not loadable
        let size = 0
        try { size = fs.statSync(file).size } catch { continue }
        if (size <= 0) continue
        const est = planMemory(size, 4096, file, { nParallel: 1, overheadMB: 256 }).estimatedMB
        if (est <= totalMB) out.push({ base, est })
      }
    } catch { return [] }
    return out.sort((a, b) => b.est - a.est).slice(0, limit).map((e) => e.base)
  }

  private async withGlobalMutex<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.globalMutex
    let release!: () => void
    this.globalMutex = new Promise<void>((r) => { release = r })
    await prev
    try {
      return await fn()
    } finally {
      release()
    }
  }

  private async loadInner(modelId: string, opts?: { ctxLen?: number; gpu?: 'auto' | 'cpu' | 'fit' | number; runtimeId?: string }): Promise<TrackedInstance> {
    const t0 = Date.now()
    const runtimeId = opts?.runtimeId ?? 'local'
    const ctxLen = opts?.ctxLen ?? 4096
    const id = instanceIdFor(modelId)
    const key = id as string

    // Mandatory re-check after acquiring the per-model lock (spec §10).
    const recheck = this.instances.get(key)
    if (recheck && (recheck.state === 'ACTIVE' || recheck.state === 'BUSY_DECODE')) {
      const h = await this.health(recheck.id)
      if (h.ok) {
        appendLlamaLog(this.baseDir, 'load-skip', { modelId, state: recheck.state, port: recheck.port })
        return recheck
      }
      // Stale/unhealthy — drop it before loading fresh (never route to it).
      this.instances.delete(key)
    }
    if (recheck && recheck.state === 'LOADING') {
      // Should be impossible via pendingLoads, but never return a
      // merely-started process as ready — wait briefly then reload.
      await new Promise((r) => setTimeout(r, 250))
      const again = this.instances.get(key)
      if (again && (again.state === 'ACTIVE' || again.state === 'BUSY_DECODE') && (await this.health(again.id)).ok) return again
      this.instances.delete(key)
    }

    const modelPath = this.resolveModelPath(modelId)
    if (isMmprojFile(path.basename(modelPath))) {
      throw new Error(`invalid-model: "${path.basename(modelPath)}" is a vision projector shard (--mmproj), not a runnable language model -- load its companion LLM GGUF instead`)
    }
    let fileSize = 0
    try { fileSize = fs.statSync(modelPath).size } catch { /* resolved above, race-proof anyway */ }

    // GPU placement mode (explicit only — never silent reduction):
    // 'auto' = full offload, refuse when it does not fit (default).
    // 'cpu'  = no GPU layers, VRAM gate skipped (RAM load, slower).
    // 'fit'  = partial offload sized to this GPU, refused when even the
    //          minimum useful offload does not fit.
    // number = explicit -ngl layer count, estimate-gated like 'fit'.
    const gpuMode = opts?.gpu ?? 'auto'
    let explicitNgl: number | null = null
    if (typeof gpuMode === 'number') {
      if (!Number.isFinite(gpuMode) || gpuMode < 0) throw new Error(`invalid-model: GPU layer count must be a non-negative number (got ${String(gpuMode)})`)
      explicitNgl = Math.floor(gpuMode)
    }
    const forceCpu = gpuMode === 'cpu'

    // Preflight is an ESTIMATE (weights + KV×parallel + workspace + overhead).
    const plan = planMemory(fileSize, ctxLen, modelPath, { nParallel: 1, overheadMB: 256 })
    let estimatedVramMB = plan.estimatedMB
    let ngl = 999 // full offload unless a mode says otherwise
    let partialOffload = false

    // Evict + capacity decision under the global mutex (spec §14).
    const gpu = await this.deps.queryVram().catch(() => null)
    if (forceCpu) {
      ngl = 0
      appendLlamaLog(this.baseDir, 'load-cpu-mode', { modelId, detail: 'explicit CPU placement, VRAM gate skipped' })
    } else if (gpuMode === 'fit' || explicitNgl !== null) {
      if (!gpu?.totalMB) throw new Error('resource-pressure: Fit mode needs a detectable GPU (nvidia-smi unreadable) -- cannot size a partial offload')
      if (explicitNgl !== null) {
        const info = readGgufModelInfo(modelPath)
        if (!info) throw new Error(`resource-pressure: explicit ${explicitNgl} GPU layers need a readable GGUF header to verify the fit ("${path.basename(modelPath)}" header unreadable)`)
        ngl = Math.min(explicitNgl, info.blockCount)
        const kv = kvCacheMBFromInfo(info, ctxLen, 1) ?? plan.kvCacheMB
        const weightsMB = Math.max(64, Math.round(fileSize / (1024 * 1024)))
        estimatedVramMB = Math.round(ngl * (weightsMB / info.blockCount)) + kv + Math.round(weightsMB * 0.05) + 256
        partialOffload = ngl < info.blockCount
        if (estimatedVramMB > gpu.totalMB) {
          throw new Error(`resource-pressure: "${path.basename(modelPath)}" with ${ngl}/${info.blockCount} GPU layers needs ~${estimatedVramMB}MB VRAM but the GPU has ${gpu.totalMB}MB total${gpu.name ? ` (${gpu.name})` : ''}`)
        }
      } else {
        const fit = planPartialFit({ modelPath, fileSizeBytes: fileSize, ctxLen, totalMB: gpu.totalMB, nParallel: 1, overheadMB: 256 })
        if (!fit) {
          throw new Error(`resource-pressure: "${path.basename(modelPath)}" cannot fit this GPU even with minimum partial offload (GPU ${gpu.totalMB}MB total${gpu.name ? ` (${gpu.name})` : ''}) -- pick a smaller quant`)
        }
        ngl = fit.fitLayers
        estimatedVramMB = fit.estimatedMB
        partialOffload = true
        appendLlamaLog(this.baseDir, 'load-fit-plan', { modelId, fitLayers: fit.fitLayers, totalLayers: fit.totalLayers, estimatedVramMB })
      }
    }
    await this.withGlobalMutex(async () => {
      // Honest capacity gate against REAL total VRAM (not a simulated 8GB).
      // Skipped for explicit CPU placement (no VRAM claimed).
      if (!forceCpu && gpuMode !== 'fit' && explicitNgl === null && gpu?.totalMB && estimatedVramMB > gpu.totalMB) {
        const alternatives = this.fittingAlternatives(path.basename(modelPath), gpu.totalMB)
        const altHint = alternatives.length > 0
          ? ` Models in your library that fit this GPU: ${alternatives.join(', ')}.`
          : ' No model in your library fits this GPU -- download a smaller quant (Q4_K_M 0.6B-7B) from Library.'
        let fitHint = ''
        try {
          const fit = planPartialFit({ modelPath, fileSizeBytes: fileSize, ctxLen, totalMB: gpu.totalMB, nParallel: 1, overheadMB: 256 })
          if (fit) fitHint = ` Fit mode could offload ${fit.fitLayers}/${fit.totalLayers} layers (~${fit.estimatedMB}MB) -- retry with Fit mode for partial GPU offload.`
        } catch { /* hint is best-effort only */ }
        const msg = `resource-pressure: "${path.basename(modelPath)}" needs ~${estimatedVramMB}MB VRAM but the GPU has ${gpu.totalMB}MB total${gpu.name ? ` (${gpu.name})` : ''} -- pick a smaller quant.${altHint}${fitHint}`
        appendLlamaLog(this.baseDir, 'load-refused', { modelId, estimatedVramMB, vramTotalMB: gpu.totalMB }, 'error')
        throw new Error(msg)
      }
      // Make room: evict LRU eligible residents until under the cap.
      while (this.liveCount() >= this.maxConcurrentModels) {
        const victim = this.pickEvictionVictim(key)
        if (!victim) {
          throw new Error(`resource-pressure: ${this.maxConcurrentModels} model(s) already resident and none is eligible for eviction (all busy/loading/evicting) -- wait or unload one first`)
        }
        appendLlamaLog(this.baseDir, 'lru-evict', { evicting: victim.modelId, for: modelId })
        await this.unloadInner(victim.id).catch(() => {})
      }
    })

    // Structured runtime selection (spec §5) — GGUF → llama.cpp only.
    const exe = this.exePath()
    const useCuda = !forceCpu && Boolean(gpu?.totalMB && gpu.totalMB > 0)
    const selection = selectRuntimeForModel({
      format: 'gguf',
      exePath: exe,
      modelPath,
      port: 0, // placeholder; real port bound below
      ctxLen,
      alias: path.basename(modelPath, '.gguf').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64),
      gpuAvailable: useCuda,
    })
    if (!useCuda) ngl = 0

    const vramBefore = (await this.deps.queryVram().catch(() => null))?.freeMB
    appendLlamaLog(this.baseDir, 'load-start', {
      modelId, modelPath, fileSizeMB: Math.round(fileSize / (1024 * 1024)),
      estimatedVramMB, plan, ctxLen, gpuMode: typeof gpuMode === 'number' ? `ngl:${gpuMode}` : gpuMode,
      offloadedLayers: ngl, partialOffload, vramFreeBeforeMB: vramBefore ?? 'unknown',
    })

    const port = await this.deps.findPort()
    const alias = path.basename(modelPath, '.gguf').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)
    const args = buildServerArgs({ modelPath, port, ctxLen, nGpuLayers: ngl, alias })
    const endpoint = `http://127.0.0.1:${port}/v1`
    const tracked: TrackedInstance = {
      id, modelId: modelId as ModelId, runtimeId, status: statusFor('LOADING'), state: 'LOADING', ctxLen, port,
      endpoint, health: 'unknown', hardwareDevice: selection.device,
      configuration: { ctxLen, nGpuLayers: ngl, nParallel: 1, alias },
      estimatedVramMB, vramEstimated: true, offloadedLayers: ngl, partialOffload,
      startedAt: Date.now(), lastActiveAt: Date.now(), activeRequests: 0,
      metrics: { vramUsedMB: estimatedVramMB, vramEstimated: true, lastUpdatedAt: Date.now() },
      proc: undefined as unknown as ChildPort, modelPath, fileSizeBytes: fileSize,
    }
    this.instances.set(key, tracked)
    appendLlamaLog(this.baseDir, 'spawn', { modelId, port, backend: selection.backend, device: selection.device, args: JSON.stringify(args) })

    let proc: ChildProcess
    try {
      const logDir = path.join(getSovaraDataDir(this.baseDir), 'logs')
      proc = this.deps.spawn({ exePath: selection.executable, modelPath, port, ctxLen, nGpuLayers: ngl, alias, logDir })
    } catch (e) {
      this.instances.delete(key)
      const raw = e instanceof Error ? e.message : String(e)
      const c = classifyLoadFailure(raw)
      throw new Error(c.kind === 'runner-missing' ? raw : `model-load-failed: could not start the local runtime (${raw})`)
    }
    tracked.proc = proc
    tracked.pid = proc.pid
    proc.once('exit', (code, signal) => {
      const cur = this.instances.get(key)
      if (!cur || cur.state === 'EVICTING') return // expected shutdown path
      cur.state = 'FAILED'
      cur.status = statusFor('FAILED')
      cur.health = 'unhealthy'
      cur.failureReason = 'runner-crash'
      cur.lastError = `runner exited unexpectedly (code=${code ?? 'unknown'} signal=${signal ?? 'none'})`
      appendLlamaLog(this.baseDir, 'server-died', { modelId, code: code ?? 'unknown', signal: signal ?? 'none' }, 'error')
    })

    try {
      await this.deps.waitReady(port, 240_000)
    } catch (e) {
      await killServer(proc).catch(() => {})
      this.instances.delete(key) // OFFLINE — never leave a stuck LOADING
      const raw = e instanceof Error ? e.message : String(e)
      const c = classifyLoadFailure(raw)
      appendLlamaLog(this.baseDir, 'load-failed', { modelId, port, kind: c.kind, error: raw.slice(0, 300) }, 'error')
      if (c.kind === 'readiness-timeout') {
        throw new Error(`readiness-timeout: "${path.basename(modelPath)}" started but never confirmed model loaded within 240s -- runner terminated, no state kept`)
      }
      // Recoverable ONCE (port conflict): retry with a fresh port, same config.
      if (c.recoverable) {
        appendLlamaLog(this.baseDir, 'load-retry', { modelId, kind: c.kind })
        const retryPort = await this.deps.findPort()
        const retryEndpoint = `http://127.0.0.1:${retryPort}/v1`
        const logDir = path.join(getSovaraDataDir(this.baseDir), 'logs')
        let proc2: ChildProcess
        try {
          proc2 = this.deps.spawn({ exePath: selection.executable, modelPath, port: retryPort, ctxLen, nGpuLayers: ngl, alias, logDir })
        } catch (e2) {
          throw new Error(`model-load-failed: retry spawn failed (${e2 instanceof Error ? e2.message : String(e2)})`)
        }
        const t2: TrackedInstance = { ...tracked, port: retryPort, endpoint: retryEndpoint, proc: proc2, pid: proc2.pid }
        this.instances.set(key, t2)
        proc2.once('exit', (code, signal) => {
          const cur = this.instances.get(key)
          if (!cur || cur.state === 'EVICTING') return
          cur.state = 'FAILED'; cur.status = statusFor('FAILED'); cur.health = 'unhealthy'
          cur.failureReason = 'runner-crash'; cur.lastError = `runner exited (code=${code ?? 'unknown'} signal=${signal ?? 'none'})`
        })
        try {
          await this.deps.waitReady(retryPort, 240_000)
        } catch (e2) {
          await killServer(proc2).catch(() => {})
          this.instances.delete(key)
          const raw2 = e2 instanceof Error ? e2.message : String(e2)
          throw new Error(`model-load-failed: "${path.basename(modelPath)}" did not become ready on retry (${raw2.slice(0, 200)})`)
        }
        return this.finishLoad(t2, { modelId, modelPath, fileSize, estimatedVramMB, plan, ctxLen, vramBefore, t0 })
      }
      if (c.kind === 'oom') throw new Error(`oom: "${path.basename(modelPath)}" exhausted GPU memory during load -- pick a smaller quant or lower context (no automatic -ngl reduction applied)`)
      throw new Error(`model-load-failed: "${path.basename(modelPath)}" did not become ready (${raw.slice(0, 200)})`)
    }

    return this.finishLoad(tracked, { modelId, modelPath, fileSize, estimatedVramMB, plan, ctxLen, vramBefore, t0 })
  }

  private async finishLoad(
    tracked: TrackedInstance,
    ctx: { modelId: string; modelPath: string; fileSize: number; estimatedVramMB: number; plan: ReturnType<typeof planMemory>; ctxLen: number; vramBefore: number | undefined; t0: number }
  ): Promise<TrackedInstance> {
    // Observed allocation (spec §6): freeBefore − freeAfter when measurable.
    const vramAfter = await this.deps.queryVram().catch(() => null)
    const observed = ctx.vramBefore !== undefined && vramAfter?.freeMB !== undefined
      ? Math.max(0, ctx.vramBefore - vramAfter.freeMB)
      : undefined
    tracked.state = 'ACTIVE'
    tracked.status = statusFor('ACTIVE')
    tracked.health = 'healthy'
    tracked.lastActiveAt = Date.now()
    tracked.loadTimeMs = Date.now() - ctx.t0
    if (observed !== undefined) {
      tracked.observedVramMB = observed
      tracked.vramEstimated = false
    }
    tracked.metrics = {
      vramUsedMB: observed ?? ctx.estimatedVramMB,
      vramEstimated: observed === undefined,
      ramUsedMB: undefined, // unmeasured — never fabricated
      cpuUsage: undefined,
      gpuUtilization: undefined,
      tokensPerSec: 0,
      lastUpdatedAt: Date.now(),
    }
    appendLlamaLog(this.baseDir, 'load-done', {
      modelId: ctx.modelId, port: tracked.port, pid: tracked.proc?.pid ?? 'unknown',
      vramFreeBeforeMB: ctx.vramBefore ?? 'unknown', vramFreeAfterMB: vramAfter?.freeMB ?? 'unknown',
      vramTotalMB: vramAfter?.totalMB ?? 'unknown',
      estimatedVramMB: ctx.estimatedVramMB, observedVramMB: observed ?? 'unmeasured',
      loadTimeMs: tracked.loadTimeMs,
    })
    return tracked
  }

  private liveCount(): number {
    let n = 0
    for (const t of this.instances.values()) {
      if (t.state === 'ACTIVE' || t.state === 'BUSY_DECODE' || t.state === 'LOADING' || t.state === 'EVICTING') n++
    }
    return n
  }

  /** LRU victim among eligible residents (spec §14). Never evicts busy/loading/evicting. */
  private pickEvictionVictim(excludeKey: string): TrackedInstance | null {
    let victim: TrackedInstance | null = null
    for (const t of this.instances.values()) {
      if (String(t.id) === excludeKey) continue
      if (t.state === 'LOADING' || t.state === 'EVICTING' || t.state === 'FAILED') continue
      if ((t.activeRequests ?? 0) > 0) continue // currently generating
      if (t.state !== 'ACTIVE' && t.state !== 'BUSY_DECODE') continue
      if (!victim || (t.lastActiveAt ?? t.startedAt ?? 0) < (victim.lastActiveAt ?? victim.startedAt ?? 0)) victim = t
    }
    return victim
  }

  async unload(instanceId: InstanceId): Promise<void> {
    await this.unloadInner(instanceId)
  }

  /**
   * Unload = stop runtime + release resources (spec §13). The GGUF file is
   * never touched. Graceful SIGTERM first, taskkill fallback, verified exit.
   */
  private async unloadInner(instanceId: InstanceId): Promise<void> {
    const key = instanceId as string
    const cur = this.instances.get(key)
    if (!cur) throw new Error('unknown instance')
    if (cur.state === 'EVICTING') {
      // Another caller is already evicting — wait for it to finish.
      for (let i = 0; i < 50; i++) {
        if (!this.instances.has(key)) return
        await new Promise((r) => setTimeout(r, 100))
      }
      return
    }
    cur.state = 'EVICTING'
    cur.status = statusFor('EVICTING')
    cur.health = 'unhealthy' // stop routing new requests immediately
    const vramBefore = (await this.deps.queryVram().catch(() => null))?.freeMB
    appendLlamaLog(this.baseDir, 'unload-start', { modelId: cur.modelId, port: cur.port, vramFreeBeforeMB: vramBefore ?? 'unknown', activeRequests: cur.activeRequests ?? 0 })
    // Policy: wait briefly for in-flight generations to finish (≤5s),
    // then proceed — an explicit unload must not hang forever.
    for (let i = 0; i < 50 && (cur.activeRequests ?? 0) > 0; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    cur.activeRequests = 0
    try {
      if (cur.proc) {
        // Graceful first, fallback inside killServer (taskkill /F on win32).
        try { cur.proc.kill('SIGTERM') } catch { /* fallback handles it */ }
        await killServer(cur.proc)
        // Verify the process is actually gone.
        for (let i = 0; i < 20 && cur.proc.exitCode === null && cur.proc.signalCode === null; i++) {
          await new Promise((r) => setTimeout(r, 100))
        }
        if (cur.proc.exitCode === null && cur.proc.signalCode === null) {
          throw new Error(`unload failed: runner pid=${cur.proc.pid ?? 'unknown'} did not exit after SIGTERM+taskkill`)
        }
      }
    } finally {
      this.instances.delete(key) // OFFLINE
    }
    const vramAfter = (await this.deps.queryVram().catch(() => null))?.freeMB
    appendLlamaLog(this.baseDir, 'unload-done', {
      modelId: cur.modelId, vramFreeBeforeMB: vramBefore ?? 'unknown', vramFreeAfterMB: vramAfter ?? 'unknown',
    })
  }

  async health(instanceId: InstanceId): Promise<{ ok: boolean; vramUsedMB?: number; error?: string; state?: RuntimeInstanceState; activeRequests?: number }> {
    const cur = this.instances.get(instanceId as string)
    if (!cur) return { ok: false, error: 'not-found', state: 'OFFLINE' }
    if (cur.state === 'LOADING') return { ok: false, error: 'loading', state: 'LOADING' }
    if (cur.state === 'EVICTING') return { ok: false, error: 'unloading', state: 'EVICTING' }
    if (cur.state === 'FAILED') return { ok: false, error: cur.lastError ?? cur.failureReason ?? 'failed', state: 'FAILED' }
    if (!cur.proc || cur.proc.exitCode !== null) return { ok: false, error: 'process-exited', state: 'FAILED', activeRequests: cur.activeRequests ?? 0 }
    return { ok: true, vramUsedMB: cur.metrics?.vramUsedMB ?? cur.estimatedVramMB, state: cur.state, activeRequests: cur.activeRequests ?? 0 }
  }

  baseUrl(instanceId: InstanceId): string {
    const cur = this.instances.get(instanceId as string)
    if (!cur) throw new Error('instance not found (OFFLINE — load the model first)')
    if (cur.state === 'LOADING') throw new Error('model is still loading into VRAM')
    if (cur.state === 'EVICTING') throw new Error('instance is unloading — wait and retry')
    if (cur.state === 'FAILED') throw new Error(`instance failed (${cur.lastError ?? cur.failureReason ?? 'runner error'}) -- unload and load again`)
    if (cur.state !== 'ACTIVE' && cur.state !== 'BUSY_DECODE') {
      throw new Error(`instance not serving (state=${cur.state})`)
    }
    if (!cur.proc || cur.proc.exitCode !== null) throw new Error('instance not serving (process-exited)')
    // Route to THAT exact endpoint (spec §10) — never guess by name/port.
    const url = cur.endpoint ?? `http://127.0.0.1:${cur.port}/v1`
    if (!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(url)) throw new Error('stale endpoint rejected (not loopback)')
    return url
  }

  async listInstances(): Promise<ModelInstance[]> {
    return [...this.instances.values()].map((t) => this.publicView(t))
  }

  async probeRuntime(runtimeId: string): Promise<{ available: boolean; version?: string; path?: string }> {
    void runtimeId
    const exe = this.exePath()
    if (!exe) return { available: false }
    const version = await getLlamaVersion(exe).catch(() => null)
    return { available: true, version: version ?? undefined, path: exe }
  }

  /** App shutdown — kill every sidecar so no VRAM stays claimed. */
  async disposeAll(): Promise<void> {
    for (const inst of [...this.instances.values()]) {
      try { await this.unloadInner(inst.id) } catch { /* best-effort */ }
    }
  }

  private publicView(t: TrackedInstance): ModelInstance {
    // Strip the ChildProcess + local path (never cross IPC) — plain data only.
    // Estimated/observed VRAM stay visible so the UI can label est. vs obs.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { proc, modelPath, fileSizeBytes, ...rest } = t
    void modelPath; void fileSizeBytes
    return { ...rest, metrics: rest.metrics ? { ...rest.metrics } : undefined }
  }
}

type ChildPort = ChildProcess
