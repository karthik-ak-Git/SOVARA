/**
 * Sovara-owned local runtime — llama.cpp sidecar provisioning + lifecycle.
 *
 * This is how Sovara becomes its own "LM Studio / Ollama": instead of
 * depending on an external loopback server, Main owns one `llama-server`
 * child process per loaded GGUF model:
 *
 *   GGUF on disk → spawn llama-server.exe (CUDA, -ngl 999) → VRAM
 *     → OpenAI-compatible http://127.0.0.1:<port>/v1 → LlmPort
 *   switch model → kill old process (VRAM freed, verified) → spawn new
 *
 * Boundaries (ARCHITECTURE_PHASE1 §6):
 * - Chat/Renderer never import this file. Only the ModelRuntimePort
 *   adapter (`LlamaCppServerAdapter`) uses it, behind AppBackend.
 * - The ONLY network use here is the one-time runtime-binary download
 *   from github.com (pinned build, logged). Inference itself is always
 *   loopback (`HttpClient`), GGUF weights are local files.
 * - Logs carry metadata only (paths, sizes, ports, VRAM) — never prompts.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { getLoopbackJson } from '../network/HttpClient'
import { ensureDir, getSovaraDataDir } from '../storage/paths'

// ── Pinned owned-runtime build ──────────────────────────────────────────
// Pinned deliberately, never floating: every install resolves the same
// bytes. Bump by changing these two lines + the extraction smoke test.
export const LLAMA_BUILD = 'b10900'
export const LLAMA_CUDA_ASSET = `llama-${LLAMA_BUILD}-bin-win-cuda-12.4-x64.zip`
export const LLAMA_DOWNLOAD_URL =
  `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${LLAMA_CUDA_ASSET}`
/** Small CPU fallback (proves the pipeline when CUDA binary is missing). */
export const LLAMA_CPU_ASSET = `llama-${LLAMA_BUILD}-bin-win-cpu-x64.zip`

export interface GpuVram {
  name?: string
  totalMB?: number
  freeMB?: number
}

export interface RuntimeProgress {
  /** 'checking' | 'downloading' | 'extracting' | 'verifying' | 'ready' */
  phase: string
  receivedBytes: number
  totalBytes: number | null
}

// ── Logging (terminal + file, metadata only) ────────────────────────────

function logFile(baseDir: string | undefined): string {
  const dir = path.join(getSovaraDataDir(baseDir), 'logs')
  ensureDir(dir)
  return path.join(dir, 'llama-runtime.log')
}

export function appendLlamaLog(
  baseDir: string | undefined,
  event: string,
  extra: Record<string, unknown> = {},
  level: 'info' | 'error' = 'info'
): void {
  const line = JSON.stringify({ time: Date.now(), iso: new Date().toISOString(), event, ...extra })
  try {
    // eslint-disable-next-line no-console
    console.log(`[SOVARA][LLAMA] ${event} ${Object.entries(extra).map(([k, v]) => `${k}=${String(v)}`).join(' ')}`)
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(`[SOVARA][LLAMA][ERROR] ${line}`)
    }
  } catch { /* console must never break flows */ }
  try {
    fs.appendFileSync(logFile(baseDir), `${line}\n`, 'utf8')
  } catch { /* logging must never break flows */ }
}

// ── Paths ───────────────────────────────────────────────────────────────

export function getLlamaRuntimeDir(baseDir?: string): string {
  return path.join(getSovaraDataDir(baseDir), 'runtime', 'llama.cpp', LLAMA_BUILD)
}

function findExeRecursive(dir: string, depth = 0): string | null {
  if (depth > 3) return null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isFile() && e.name.toLowerCase() === 'llama-server.exe') return full
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findExeRecursive(path.join(dir, e.name), depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/** Absolute llama-server.exe when provisioned, else null (never throws). */
export function getLlamaServerPath(baseDir?: string): string | null {
  try {
    const dir = getLlamaRuntimeDir(baseDir)
    if (!fs.existsSync(dir)) return null
    return findExeRecursive(dir)
  } catch {
    return null
  }
}

export function getLlamaVersion(exePath: string, timeoutMs = 15_000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(exePath, ['--version'], { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve(null)
      const first = String(stdout || stderr || '').split('\n').map((s) => s.trim()).filter(Boolean)[0]
      resolve(first ? first.slice(0, 160) : null)
    })
  })
}

// ── Real GPU / VRAM probing (nvidia-smi, no fabrication) ────────────────

/** Pure parser — unit-tested. Accepts headerless or header CSV rows. */
export function parseNvidiaSmiCsv(stdout: string): GpuVram | null {
  const lines = stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  for (const line of lines) {
    if (/^name/i.test(line) || /^memory/i.test(line)) continue // header row
    const parts = line.split(',').map((s) => s.trim())
    if (parts.length < 2) continue
    const total = parseInt(parts[0], 10)
    const free = parseInt(parts[1], 10)
    const name = parts.slice(2).join(', ').trim() || undefined
    if (Number.isFinite(total) && total > 0) {
      return {
        totalMB: total,
        freeMB: Number.isFinite(free) && free >= 0 ? free : undefined,
        name,
      }
    }
  }
  return null
}

export function queryGpuVram(timeoutMs = 5000): Promise<GpuVram | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.total,memory.free,name', '--format=csv,noheader,nounits'],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null)
        try {
          resolve(parseNvidiaSmiCsv(String(stdout ?? '')))
        } catch {
          resolve(null)
        }
      }
    )
  })
}

// ── GGUF header probing (architecture-aware memory math) ────────────────

export interface GgufModelInfo {
  arch: string
  blockCount: number
  embeddingLength: number
  headCount: number
  kvHeadCount: number
  /** Per-head KV dim override (attention.key_length), else embd/heads. */
  keyLength?: number
}

const GGUF_SCALAR_SIZES: Record<number, number> = {
  0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8,
}

/** Read one GGUF metadata value from a cursor. Throws on short reads. */
function readGgufValue(buf: Buffer, cursor: { off: number }, type: number): unknown {
  const take = (n: number): Buffer => {
    if (cursor.off + n > buf.length) throw new Error('short read')
    const slice = buf.subarray(cursor.off, cursor.off + n)
    cursor.off += n
    return slice
  }
  if (type === 8) {
    const len = Number(take(8).readBigUInt64LE())
    if (len > 1 << 20) throw new Error('string too long')
    return take(len).toString('utf8')
  }
  if (type === 9) {
    const itemType = take(4).readUInt32LE()
    const len = Number(take(8).readBigUInt64LE())
    if (len > 1 << 16) throw new Error('array too long')
    const out: unknown[] = []
    for (let i = 0; i < len; i++) out.push(readGgufValue(buf, cursor, itemType))
    return out
  }
  const size = GGUF_SCALAR_SIZES[type]
  if (!size) throw new Error(`unknown GGUF type ${type}`)
  const raw = take(size)
  switch (type) {
    case 0: return raw.readUInt8()
    case 1: return raw.readInt8()
    case 2: return raw.readUInt16LE()
    case 3: return raw.readInt16LE()
    case 4: return raw.readUInt32LE()
    case 5: return raw.readInt32LE()
    case 6: return raw.readFloatLE()
    case 7: return raw.readUInt8() !== 0
    case 10: return Number(raw.readBigUInt64LE())
    case 11: return Number(raw.readBigInt64LE())
    case 12: return raw.readDoubleLE()
    default: throw new Error(`unknown GGUF type ${type}`)
  }
}

/**
 * Read transformer shape from a GGUF header (first 1MB is plenty —
 * metadata lives up front). Null when unreadable/missing (never throws).
 * Pure sync; used for honest KV-cache sizing instead of one-size-fits-all.
 */
export function readGgufModelInfo(modelPath: string): GgufModelInfo | null {
  try {
    if (!modelPath.toLowerCase().endsWith('.gguf')) return null
    const fd = fs.openSync(modelPath, 'r')
    try {
      const stat = fs.fstatSync(fd)
      if (stat.size < 32) return null
      const buf = Buffer.alloc(Math.min(1 << 20, stat.size))
      fs.readSync(fd, buf, 0, buf.length, 0)
      const cursor = { off: 0 }
      const take = (n: number): Buffer => {
        if (cursor.off + n > buf.length) throw new Error('short read')
        const s = buf.subarray(cursor.off, cursor.off + n)
        cursor.off += n
        return s
      }
      if (take(4).toString('binary') !== 'GGUF') return null
      take(4) // version
      take(8) // tensor count
      const kvCount = Number(take(8).readBigUInt64LE())
      if (!Number.isFinite(kvCount) || kvCount > 1 << 16) return null
      const meta = new Map<string, unknown>()
      for (let i = 0; i < kvCount; i++) {
        const keyLen = Number(take(8).readBigUInt64LE())
        if (keyLen > 1 << 16) return null
        const key = take(keyLen).toString('utf8')
        const type = take(4).readUInt32LE()
        meta.set(key, readGgufValue(buf, cursor, type))
        if (meta.size > kvCount + 8) return null
      }
      const arch = meta.get('general.architecture')
      if (typeof arch !== 'string' || !arch) return null
      const num = (k: string): number | null => {
        const v = meta.get(`${arch}.${k}`)
        return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
      }
      const blockCount = num('block_count')
      const embeddingLength = num('embedding_length')
      const headCount = num('attention.head_count')
      const kvHeadCount = num('attention.head_count_kv')
      if (!blockCount || !embeddingLength || !headCount || !kvHeadCount) return null
      const keyLength = num('attention.key_length') ?? undefined
      return {
        arch,
        blockCount: Math.floor(blockCount),
        embeddingLength: Math.floor(embeddingLength),
        headCount: Math.floor(headCount),
        kvHeadCount: Math.floor(kvHeadCount),
        ...(keyLength ? { keyLength: Math.floor(keyLength) } : {}),
      }
    } finally {
      try { fs.closeSync(fd) } catch { /* ignore */ }
    }
  } catch {
    return null
  }
}

/**
 * Exact KV-cache sizing from GGUF shape: 2 (k+v) × layers × kvHeads ×
 * headDim × 2 bytes (fp16 cache, conservative — v-cache may quantize
 * smaller). Null when the header is unreadable (caller falls back).
 */
export function kvCacheMBFromInfo(info: GgufModelInfo, ctxLen: number, nParallel: number): number | null {
  try {
    const headDim = info.keyLength ?? info.embeddingLength / info.headCount
    if (!Number.isFinite(headDim) || headDim <= 0) return null
    const bytesPerToken = 2 * info.blockCount * info.kvHeadCount * headDim * 2
    const total = bytesPerToken * Math.max(1, ctxLen || 4096) * Math.max(1, nParallel)
    return Math.max(1, Math.ceil(total / (1024 * 1024)))
  } catch {
    return null
  }
}

// ── VRAM estimation (local-llm-expert sizing, honest ranges) ────────────

/** Parse `0.6B` / `27B` from a GGUF filename. Null when unknown. */
export function parseParamsB(filename: string): number | null {
  const m = filename.match(/(\d+(?:\.\d+)?)\s*B\b/i)
  if (!m) return null
  const v = parseFloat(m[1])
  return Number.isFinite(v) && v > 0 && v < 10_000 ? v : null
}

/**
 * Estimated VRAM for full GPU offload: weights×1.15 + KV cache.
 * KV ≈ 0.42GB per 1k ctx @7B, scaled by params (hardwareCheck.ts basis).
 */
export function estimateVramMB(fileSizeBytes: number, ctxLen: number, filename: string): number {
  return planMemory(fileSizeBytes, ctxLen, filename).estimatedMB
}

/**
 * Memory plan (spec §6): weights + activation/workspace + KV cache +
 * context length + parallel slots + runtime overhead.
 * KV scales with BOTH ctxLen and nParallel — never assume one sequence.
 * This is a PREFLIGHT ESTIMATE only; the adapter records observed
 * allocation separately after load (freeBefore − freeAfter).
 */
export function planMemory(
  fileSizeBytes: number,
  ctxLen: number,
  filename: string,
  opts?: { nParallel?: number; overheadMB?: number; workspaceMB?: number }
): { estimatedMB: number; weightsMB: number; kvCacheMB: number; workspaceMB: number; overheadMB: number; ctxLen: number; nParallel: number; archAware: boolean } {
  const nParallel = Math.max(1, Math.floor(opts?.nParallel ?? 1))
  const weightsMB = Math.max(64, Math.round(fileSizeBytes / (1024 * 1024)))
  const resolvedCtx = ctxLen || 4096
  // Prefer exact KV sizing from the GGUF header (GQA models carry a
  // fraction of the legacy heuristic). Unreadable header → legacy path.
  let kvCacheMB: number | null = null
  let archAware = false
  try {
    if (typeof filename === 'string' && fs.existsSync(filename)) {
      const info = readGgufModelInfo(filename)
      if (info) {
        const exact = kvCacheMBFromInfo(info, resolvedCtx, nParallel)
        if (exact !== null) {
          kvCacheMB = exact
          archAware = true
        }
      }
    }
  } catch { /* fall through to legacy heuristic */ }
  if (kvCacheMB === null) {
    const paramsB = parseParamsB(path.basename(filename)) ?? 7
    const scale = Math.min(2.2, Math.max(0.35, paramsB / 7))
    // KV per sequence, then × parallel slots (spec §6: never assume one request).
    const kvPerSeqMB = Math.round((resolvedCtx / 1024) * 430 * scale)
    kvCacheMB = kvPerSeqMB * nParallel
  }
  const workspaceMB = opts?.workspaceMB ?? Math.round(weightsMB * 0.05)
  const overheadMB = opts?.overheadMB ?? 256
  const estimatedMB = Math.round(weightsMB * 1.1) + kvCacheMB + workspaceMB + overheadMB
  return { estimatedMB, weightsMB, kvCacheMB, workspaceMB, overheadMB, ctxLen: resolvedCtx, nParallel, archAware }
}

export interface PartialFitPlan {
  /** GPU layers that fit (passed as -ngl). */
  fitLayers: number
  totalLayers: number
  estimatedMB: number
  kvCacheMB: number
  perLayerMB: number
  archAware: boolean
}

/**
 * Explicit partial-offload planner ("Fit mode"): how many transformer
 * layers fit in totalMB alongside the KV cache. Returns null when even
 * the minimum useful offload (20% of layers, at least 4) does not fit,
 * or when the GGUF header is unreadable (no per-layer math possible).
 * Never silently applied — callers surface fitLayers/totalLayers and
 * require an explicit user opt-in.
 */
export function planPartialFit(args: {
  modelPath: string
  fileSizeBytes: number
  ctxLen: number
  totalMB: number
  nParallel?: number
  overheadMB?: number
}): PartialFitPlan | null {
  try {
    const nParallel = Math.max(1, Math.floor(args.nParallel ?? 1))
    const info = readGgufModelInfo(args.modelPath)
    if (!info || info.blockCount < 1) return null
    const resolvedCtx = args.ctxLen || 4096
    const kvCacheMB = kvCacheMBFromInfo(info, resolvedCtx, nParallel)
      ?? planMemory(args.fileSizeBytes, resolvedCtx, args.modelPath, { nParallel }).kvCacheMB
    const weightsMB = Math.max(64, Math.round(args.fileSizeBytes / (1024 * 1024)))
    const workspaceMB = Math.round(weightsMB * 0.05)
    const overheadMB = args.overheadMB ?? 256
    const perLayerMB = weightsMB / info.blockCount
    if (!(perLayerMB > 0)) return null
    const budgetMB = args.totalMB - overheadMB - kvCacheMB - workspaceMB
    const fitLayers = Math.min(info.blockCount, Math.floor(budgetMB / perLayerMB))
    const minLayers = Math.max(4, Math.ceil(info.blockCount * 0.2))
    if (fitLayers < minLayers) return null
    return {
      fitLayers,
      totalLayers: info.blockCount,
      estimatedMB: Math.round(fitLayers * perLayerMB) + kvCacheMB + workspaceMB + overheadMB,
      kvCacheMB,
      perLayerMB,
      archAware: true,
    }
  } catch {
    return null
  }
}

/**
 * Classify a load/runner failure deliberately (spec §7).
 * Only port-conflicts are recoverable-by-retry; OOM/invalid-model/
 * backend failures must surface with actionable messages instead of
 * blind `-ngl` reduction loops.
 */
export function classifyLoadFailure(raw: string): { kind: 'invalid-model' | 'runner-missing' | 'startup-failure' | 'readiness-timeout' | 'oom' | 'backend-failure' | 'runner-crash' | 'cancelled' | 'unknown'; recoverable: boolean; message: string } {
  const msg = String(raw ?? '')
  const lower = msg.toLowerCase()
  if (/cancelled/.test(lower)) return { kind: 'cancelled', recoverable: false, message: msg }
  if (/model-not-found|invalid model|no gguf|empty model id|not in the sovara library/i.test(msg)) return { kind: 'invalid-model', recoverable: false, message: msg }
  if (/not installed|local runtime not installed|runner.*missing|llama-server.*not found/i.test(msg)) return { kind: 'runner-missing', recoverable: false, message: msg }
  if (/did not become ready|readiness|timed out waiting/i.test(msg)) return { kind: 'readiness-timeout', recoverable: false, message: msg }
  if (/cuda.*out of memory|out of memory|oom|insufficient.*vram|memory.*exhausted|alloc.*fail/i.test(msg)) return { kind: 'oom', recoverable: false, message: msg }
  if (/eaddrinuse|address already in use|port.*in use|no free port/i.test(msg)) return { kind: 'startup-failure', recoverable: true, message: msg }
  if (/cuda.*error|nvrtc|cublas|backend.*fail|failed to initialize|no compatible gpu|driver/i.test(msg)) return { kind: 'backend-failure', recoverable: false, message: msg }
  if (/exit|crash|signal|died|killed/i.test(msg)) return { kind: 'runner-crash', recoverable: false, message: msg }
  if (/could not start|spawn|enoent/i.test(msg)) return { kind: 'startup-failure', recoverable: false, message: msg }
  return { kind: 'unknown', recoverable: false, message: msg }
}

/**
 * Runtime selection (spec §5): GGUF → project's llama.cpp path.
 * Considers format + OS + CPU arch + GPU/backend. Structured result keeps
 * runtime-specific logic behind this seam instead of scattered call sites.
 */
export function selectRuntimeForModel(args: {
  format: string
  exePath: string | null
  modelPath: string
  port: number
  ctxLen: number
  alias: string
  gpuAvailable: boolean
  mmprojPath?: string
}): { runtime: 'llama.cpp'; backend: 'cuda' | 'cpu'; executable: string; args: string[]; device: string } {
  if (args.format !== 'gguf') throw new Error(`unsupported model format "${args.format}" — this runtime serves GGUF via llama.cpp only`)
  if (!args.exePath) throw new Error('local runtime not installed — open Models and choose "Install local runtime" (one-time download), then try again')
  if (process.platform !== 'win32') throw new Error(`unsupported OS "${process.platform}" — pinned llama.cpp build targets Windows x64`)
  if (process.arch !== 'x64') throw new Error(`unsupported CPU arch "${process.arch}" — pinned llama.cpp build targets x64`)
  const backend = args.gpuAvailable ? 'cuda' : 'cpu'
  const serverArgs = buildServerArgs({
    modelPath: args.modelPath,
    port: args.port,
    ctxLen: args.ctxLen,
    nGpuLayers: backend === 'cuda' ? 999 : 0,
    alias: args.alias,
    ...(args.mmprojPath ? { mmprojPath: args.mmprojPath } : {}),
  })
  return { runtime: 'llama.cpp', backend, executable: args.exePath, args: serverArgs, device: backend === 'cuda' ? 'cuda:0' : 'cpu' }
}

// ── Server args (pure, unit-tested) ─────────────────────────────────────

export interface ServerArgsOpts {
  modelPath: string
  port: number
  ctxLen?: number
  nGpuLayers?: number
  alias?: string
  mmprojPath?: string
}

export function buildServerArgs(opts: ServerArgsOpts): string[] {
  const args = [
    '-m', opts.modelPath,
    '--host', '127.0.0.1',
    '--port', String(opts.port),
    '-c', String(opts.ctxLen ?? 4096),
    '-ngl', String(opts.nGpuLayers ?? 999),
  ]
  if (opts.alias) args.push('--alias', opts.alias)
  if (opts.mmprojPath) args.push('--mmproj', opts.mmprojPath)
  return args
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))))
    })
  })
}

// ── Provisioning (one-time binary download, logged) ─────────────────────

async function downloadFile(url: string, destPart: string, onProgress?: (p: RuntimeProgress) => void): Promise<{ received: number; total: number | null }> {
  const res = await fetch(url, { headers: { 'User-Agent': 'SOVARA-runtime-provisioner' }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`runtime download failed (HTTP ${res.status})`)
  const totalHeader = res.headers.get('content-length')
  const total = totalHeader && Number.isFinite(parseInt(totalHeader, 10)) ? parseInt(totalHeader, 10) : null
  const out = fs.createWriteStream(destPart)
  const reader = res.body.getReader()
  let received = 0
  let lastEmit = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    await new Promise<void>((res2, rej) => out.write(value, (e) => (e ? rej(e) : res2())))
    const now = Date.now()
    if (now - lastEmit > 300) {
      lastEmit = now
      try { onProgress?.({ phase: 'downloading', receivedBytes: received, totalBytes: total }) } catch { /* ignore */ }
    }
  }
  await new Promise<void>((res2, rej) => out.end((e?: unknown) => (e ? rej(e as Error) : res2())))
  return { received, total }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  ensureDir(destDir)
  if (process.platform === 'win32') {
    // Zero-dependency extraction on Windows (no new npm deps for provisioning).
    const ps = [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ]
    await new Promise<void>((resolve, reject) => {
      execFile('powershell.exe', ps, { timeout: 180_000, windowsHide: true }, (err, _out, stderr) => {
        if (err) reject(new Error(`extract failed: ${String(stderr || err.message).slice(0, 300)}`))
        else resolve()
      })
    })
    return
  }
  throw new Error('runtime provisioning is currently supported on Windows only')
}

/**
 * Ensure the owned llama-server binary exists. Downloads the pinned CUDA
 * build ONCE (user-approved), then stays offline forever.
 */
export async function ensureLlamaRuntime(
  baseDir?: string,
  onProgress?: (p: RuntimeProgress) => void
): Promise<{ path: string; version: string | null; downloaded: boolean }> {
  const dir = getLlamaRuntimeDir(baseDir)
  ensureDir(dir)
  const existing = getLlamaServerPath(baseDir)
  if (existing) {
    const version = await getLlamaVersion(existing)
    appendLlamaLog(baseDir, 'runtime-ready', { path: existing, version: version ?? 'unknown', downloaded: false })
    return { path: existing, version, downloaded: false }
  }
  appendLlamaLog(baseDir, 'runtime-download-start', { url: LLAMA_DOWNLOAD_URL, asset: LLAMA_CUDA_ASSET })
  try { onProgress?.({ phase: 'downloading', receivedBytes: 0, totalBytes: null }) } catch { /* ignore */ }
  const zipPath = path.join(dir, LLAMA_CUDA_ASSET)
  const partPath = `${zipPath}.part`
  try {
    const { received, total } = await downloadFile(LLAMA_DOWNLOAD_URL, partPath, onProgress)
    appendLlamaLog(baseDir, 'runtime-download-done', { bytes: received, totalBytes: total })
    fs.renameSync(partPath, zipPath)
    try { onProgress?.({ phase: 'extracting', receivedBytes: received, totalBytes: total }) } catch { /* ignore */ }
    appendLlamaLog(baseDir, 'runtime-extract-start', { zip: zipPath })
    await extractZip(zipPath, dir)
    appendLlamaLog(baseDir, 'runtime-extract-done', { dir })
    try { fs.unlinkSync(zipPath) } catch { /* keep the zip when unsure */ }
    const exe = getLlamaServerPath(baseDir)
    if (!exe) throw new Error('archive extracted but llama-server.exe was not found')
    try { onProgress?.({ phase: 'verifying', receivedBytes: received, totalBytes: total }) } catch { /* ignore */ }
    const version = await getLlamaVersion(exe)
    if (!version) throw new Error('downloaded llama-server.exe failed its --version self-check')
    appendLlamaLog(baseDir, 'runtime-ready', { path: exe, version, downloaded: true })
    try { onProgress?.({ phase: 'ready', receivedBytes: received, totalBytes: total }) } catch { /* ignore */ }
    return { path: exe, version, downloaded: true }
  } catch (e) {
    try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath) } catch { /* ignore */ }
    const msg = e instanceof Error ? e.message : String(e)
    appendLlamaLog(baseDir, 'runtime-provision-failed', { error: msg.slice(0, 300) }, 'error')
    throw new Error(`local runtime install failed: ${msg}`)
  }
}

// ── Process lifecycle ───────────────────────────────────────────────────

export interface SpawnOpts {
  exePath: string
  modelPath: string
  port: number
  ctxLen?: number
  nGpuLayers?: number
  alias?: string
  logDir?: string
}

export function spawnLlamaServer(opts: SpawnOpts): ChildProcess {
  const args = buildServerArgs({
    modelPath: opts.modelPath,
    port: opts.port,
    ctxLen: opts.ctxLen,
    nGpuLayers: opts.nGpuLayers,
    alias: opts.alias,
  })
  const logDir = opts.logDir ?? path.join(os.tmpdir(), 'sovara-llama-logs')
  ensureDir(logDir)
  const safeAlias = (opts.alias ?? 'model').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)
  const logPath = path.join(logDir, `llama-${safeAlias}-${opts.port}.log`)
  const stream = fs.createWriteStream(logPath, { flags: 'a' })
  stream.write(`\n=== spawn ${new Date().toISOString()} exe=${opts.exePath} args=${JSON.stringify(args)} ===\n`)
  const child = spawn(opts.exePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', (d) => { try { stream.write(`[out] ${String(d)}`) } catch { /* ignore */ } })
  child.stderr?.on('data', (d) => { try { stream.write(`[err] ${String(d)}`) } catch { /* ignore */ } })
  child.once('exit', (code, signal) => {
    try { stream.write(`\n=== exit code=${code} signal=${signal} ===\n`); stream.end() } catch { /* ignore */ }
  })
  return child
}

/** Kill a sidecar: SIGTERM first, then taskkill fallback on Windows. */
export async function killServer(proc: ChildProcess, timeoutMs = 8000): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => resolve(), timeoutMs)
    proc.once('exit', () => { clearTimeout(timer); resolve() })
    try {
      if (process.platform === 'win32' && proc.pid) {
        execFile('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => resolve())
      } else {
        try { proc.kill('SIGTERM') } catch { resolve() }
      }
    } catch {
      resolve()
    }
  })
  if (proc.exitCode === null && proc.signalCode === null) {
    try { proc.kill('SIGKILL') } catch { /* last resort */ }
  }
}

/** Poll /health until the sidecar serves (model fully in VRAM). */
export async function waitForServerReady(
  port: number,
  timeoutMs = 240_000,
  isCancelled?: () => boolean
): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`
  const started = Date.now()
  for (;;) {
    if (isCancelled?.()) throw new Error('cancelled while waiting for the local model to load')
    try {
      const { status } = await getLoopbackJson(url, { timeoutMs: 2500 })
      if (status === 200) return
    } catch {
      // not up yet — keep polling (connection-refused is the normal pre-ready state)
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`local model did not become ready within ${Math.round(timeoutMs / 1000)}s`)
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}
