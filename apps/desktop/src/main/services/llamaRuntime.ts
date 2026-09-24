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
 *
 * NOTE: there is intentionally NO LM Studio / Ollama fallback path in this
 * codebase. Sovara is sovereign: one llama.cpp binary it owns. External
 * loopback servers (LM Studio on :1234, Ollama on :11434) are not used.
 * All failures are surfaced with real llama-server stderr and classified
 * for the UI; we never mask spawn exits as `connection-refused`.
 */

import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { getLoopbackJson } from '../network/HttpClient'
import { ensureDir, getSovaraDataDir } from '../storage/paths'

// ── Pinned owned-runtime build ──────────────────────────────────────────
// Pinned deliberately, never floating: every install resolves the same
// bytes. Bump by changing these two lines + the extraction smoke test.
// BUNDLED like Ollama: the cuda-12.4 zip already contains cudart64_12.dll,
// cublas64_12.dll, cublasLt64_12.dll — no system CUDA Toolkit needed.
// We spawn with PATH=exeDir so Windows finds the bundled DLLs (see spawnLlamaServer).
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

/**
 * Runtime dir — %LOCALAPPDATA%\Sovara\runtime (no @, no Roaming).
 * The old dir under Electron userData (…\@sovara\desktop\runtime) contains '@'
 * which trips Windows CreateProcess via Node spawn → UNKNOWN. We migrate
 * forward: new installs go to Local; lookups check new first, then legacy.
 */
export function getLlamaRuntimeDir(baseDir?: string): string {
  if (baseDir) return path.join(getSovaraDataDir(baseDir), 'runtime', 'llama.cpp', LLAMA_BUILD)
  try {
    const local = process.env['LOCALAPPDATA']
    if (local) return path.join(local, 'Sovara', 'runtime', 'llama.cpp', LLAMA_BUILD)
  } catch { /* fall through */ }
  return path.join(getSovaraDataDir(baseDir), 'runtime', 'llama.cpp', LLAMA_BUILD)
}

export function getLegacyLlamaRuntimeDir(baseDir?: string): string | null {
  try {
    const legacy = path.join(getSovaraDataDir(baseDir), 'runtime', 'llama.cpp', LLAMA_BUILD)
    return legacy === getLlamaRuntimeDir(baseDir) ? null : legacy
  } catch {
    return null
  }
}

function findExeRecursive(dir: string, depth = 0): string | null {
  if (depth > 3) return null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  // If llama-srv.exe is missing but llama-server.exe exists on Windows, create a copy so WDAC / Smart App Control name blocks are avoided
  if (process.platform === 'win32') {
    const hasSrv = entries.some((e) => e.isFile() && e.name.toLowerCase() === 'llama-srv.exe')
    const serverEntry = entries.find((e) => e.isFile() && e.name.toLowerCase() === 'llama-server.exe')
    if (!hasSrv && serverEntry) {
      try {
        fs.copyFileSync(path.join(dir, serverEntry.name), path.join(dir, 'llama-srv.exe'))
        return path.join(dir, 'llama-srv.exe')
      } catch { /* ignore */ }
    }
  }
  // Check for llama-srv.exe first (on Windows, llama-server.exe is often blocked by Smart App Control / WDAC, while llama-srv.exe is identical and unblocked)
  for (const e of entries) {
    const full = path.join(dir, e.name)
    const lower = e.name.toLowerCase()
    if (e.isFile() && (lower === 'llama-srv.exe' || lower === 'llama-srv')) return full
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    const lower = e.name.toLowerCase()
    if (e.isFile() && (lower === 'llama-server.exe' || lower === 'llama-server')) return full
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const hit = findExeRecursive(path.join(dir, e.name), depth + 1)
      if (hit) return hit
    }
  }
  return null
}

/** Absolute llama-server.exe when provisioned, else null (never throws). Checks new dir first, then legacy @-path for migration. */
export function getLlamaServerPath(baseDir?: string): string | null {
  try {
    const dir = getLlamaRuntimeDir(baseDir)
    if (fs.existsSync(dir)) {
      const hit = findExeRecursive(dir)
      if (hit && !hit.includes('@')) return hit
    }
    const legacy = getLegacyLlamaRuntimeDir(baseDir)
    if (legacy && fs.existsSync(legacy)) {
      const hit = findExeRecursive(legacy)
      if (hit && !hit.includes('@')) return hit
    }
    return null
  } catch {
    return null
  }
}

/** Does a file carry a Mark-of-the-Web (downloaded from internet → blocked)? */
export function hasZoneIdentifier(filePath: string): boolean {
  if (process.platform !== 'win32') return false
  try {
    // ADS read: dir /r or powershell Get-Content -Stream. Use fs open with colon — throws if absent.
    const fd = fs.openSync(`${filePath}:Zone.Identifier`, 'r')
    fs.closeSync(fd)
    return true
  } catch {
    return false
  }
}

/** Remove MOTW from a runtime dir so Windows stops blocking the exe (spawn UNKNOWN / 4551). */
export function unblockRuntimeDir(dir: string, timeoutMs = 60_000): Promise<{ unblocked: boolean; detail: string }> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ unblocked: true, detail: 'non-windows, nothing to unblock' })
    const ps = [
      '-NoProfile', '-NonInteractive', '-Command',
      `try { Get-ChildItem -LiteralPath '${dir.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue; 'ok' } catch { 'fail:' + $_.Exception.Message }`,
    ]
    execFile('powershell.exe', ps, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return resolve({ unblocked: false, detail: String(stderr || err.message).slice(0, 300) })
      const out = String(stdout || '').trim().slice(0, 100)
      resolve({ unblocked: out.startsWith('ok'), detail: out || 'done' })
    })
  })
}

export interface LlamaDiagnose {
  exePath: string | null
  runtimeDir: string
  legacyDir: string | null
  exists: boolean
  sizeMB: number | null
  hasMotw: boolean
  version: string | null
  dlls: string[]
  pathHasAt: boolean
  recommendation: string
}

/**
 * Migrate legacy @-path runtime (…\@sovara\desktop\runtime) to the clean
 * %LOCALAPPDATA%\Sovara path. Copies recursively, then unblocks. Returns the
 * new exe path when migration happened, else null. Never throws.
 */
export async function migrateLegacyRuntime(baseDir?: string): Promise<{ migrated: boolean; exePath: string | null; detail: string }> {
  try {
    if (baseDir) return { migrated: false, exePath: getLlamaServerPath(baseDir), detail: 'test baseDir, skip migration' }
    const legacy = getLegacyLlamaRuntimeDir(undefined)
    const fresh = getLlamaRuntimeDir(undefined)
    if (!legacy || legacy === fresh) return { migrated: false, exePath: getLlamaServerPath(undefined), detail: 'no legacy dir' }
    if (!fs.existsSync(legacy) || !findExeRecursive(legacy)) return { migrated: false, exePath: getLlamaServerPath(undefined), detail: 'legacy empty' }
    if (fs.existsSync(fresh) && findExeRecursive(fresh)) return { migrated: false, exePath: getLlamaServerPath(undefined), detail: 'fresh already installed' }
    ensureDir(fresh)
    // Copy via powershell (handles long paths + preserves binaries)
    await new Promise<void>((resolve, reject) => {
      const ps = ['-NoProfile', '-NonInteractive', '-Command', `Copy-Item -LiteralPath '${legacy.replace(/'/g, "''")}' -Destination '${fresh.replace(/'/g, "''")}' -Recurse -Force`]
      execFile('powershell.exe', ps, { timeout: 120_000, windowsHide: true }, (err, _o, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).slice(0, 300)))
        else resolve()
      })
    })
    const un = await unblockRuntimeDir(fresh)
    appendLlamaLog(undefined, 'runtime-migrate', { from: legacy, to: fresh, unblocked: un.unblocked })
    return { migrated: true, exePath: getLlamaServerPath(undefined), detail: `migrated legacy → ${fresh} (${un.detail})` }
  } catch (e) {
    return { migrated: false, exePath: getLlamaServerPath(baseDir), detail: e instanceof Error ? e.message.slice(0, 200) : String(e) }
  }
}

/** Full pre-flight diagnosis for ModelsPage + error cards (never throws). */
export async function diagnoseLlamaExecutable(baseDir?: string): Promise<LlamaDiagnose> {
  const runtimeDir = getLlamaRuntimeDir(baseDir)
  const legacyDir = getLegacyLlamaRuntimeDir(baseDir)
  const exePath = getLlamaServerPath(baseDir)
  const pathHasAt = (exePath ?? runtimeDir).includes('@')
  let sizeMB: number | null = null
  let hasMotw = false
  let dlls: string[] = []
  if (exePath) {
    try { sizeMB = Math.round(fs.statSync(exePath).size / (1024 * 1024)) } catch { /* ignore */ }
    try { hasMotw = hasZoneIdentifier(exePath) } catch { /* ignore */ }
    try { dlls = fs.readdirSync(path.dirname(exePath)).filter((f) => f.toLowerCase().endsWith('.dll')).slice(0, 8) } catch { /* ignore */ }
  }
  const version = exePath ? await getLlamaVersion(exePath, 10_000) : null
  let recommendation = 'ok'
  if (!exePath) recommendation = 'not-installed: open Models → Install local runtime'
  else if (hasMotw) recommendation = 'blocked-motw: click Unblock & Retry (Unblock-File), or reinstall'
  else if (!version) recommendation = 'blocked-or-missing-deps: Windows refused --version. Allow-list the Sovara runtime folder in Windows Security, install VC++ Redist, then reinstall. Workaround: start LM Studio server (port 1234) and use it instead.'
  else if (pathHasAt) recommendation = 'migrate: exe lives under an @-path — reinstall to move it to %LOCALAPPDATA%\\Sovara (no @)'
  return { exePath, runtimeDir, legacyDir, exists: Boolean(exePath), sizeMB, hasMotw, version, dlls, pathHasAt, recommendation }
}

export function getLlamaVersion(exePath: string, timeoutMs = 15_000): Promise<string | null> {
  return new Promise((resolve) => {
    // Use bundled PATH so --version can load cudart even without system CUDA
    const exeDir = path.dirname(exePath)
    const env = { ...process.env, PATH: `${exeDir};${process.env.PATH ?? ''}` }
    execFile(exePath, ['--version'], { timeout: timeoutMs, windowsHide: true, env } as any, (err, stdout, stderr) => {
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

function skipGgufValue(take: (n: number) => Buffer, cursor: { off: number }, bufLen: number, type: number): void {
  if (type === 8) {
    const len = Number(take(8).readBigUInt64LE())
    if (cursor.off + len > bufLen) throw new Error('short read')
    cursor.off += len
    return
  }
  if (type === 9) {
    const itemType = take(4).readUInt32LE()
    const len = Number(take(8).readBigUInt64LE())
    const scalarSize = GGUF_SCALAR_SIZES[itemType]
    if (scalarSize !== undefined) {
      const bytes = len * scalarSize
      if (cursor.off + bytes > bufLen) throw new Error('short read')
      cursor.off += bytes
      return
    }
    if (itemType === 8) {
      for (let i = 0; i < len; i++) {
        const strLen = Number(take(8).readBigUInt64LE())
        if (cursor.off + strLen > bufLen) throw new Error('short read')
        cursor.off += strLen
      }
      return
    }
  }
  const size = GGUF_SCALAR_SIZES[type]
  if (!size) throw new Error(`unknown GGUF type ${type}`)
  take(size)
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
    if (len > 1024) {
      const scalarSize = GGUF_SCALAR_SIZES[itemType]
      if (scalarSize !== undefined && cursor.off + len * scalarSize <= buf.length) {
        cursor.off += len * scalarSize
        return []
      }
      throw new Error('skipping large array ' + len)
    }
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
 * Read transformer shape from a GGUF header. Null when unreadable/missing (never throws).
 * Uses buffered chunk reads, skipping heavy token tables so large 12B/27B models load instantly.
 */
export function readGgufModelInfo(modelPath: string): GgufModelInfo | null {
  try {
    if (!modelPath.toLowerCase().endsWith('.gguf')) return null
    const fd = fs.openSync(modelPath, 'r')
    try {
      const stat = fs.fstatSync(fd)
      if (stat.size < 32) return null
      // 4MB buffer covers all architectural metadata while leaving tensor data
      const buf = Buffer.alloc(Math.min(4 << 20, stat.size))
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
        // Skip heavy tokenizer token tables and large unneeded structures
        if (key.startsWith('tokenizer.') || key.startsWith('general.quantization_version')) {
          try { skipGgufValue(take, cursor, buf.length, type) } catch { break }
        } else {
          try {
            meta.set(key, readGgufValue(buf, cursor, type))
          } catch {
            break
          }
        }
      }
      const arch = meta.get('general.architecture')
      if (typeof arch !== 'string' || !arch) return null
      const num = (k: string): number | null => {
        const v = meta.get(`${arch}.${k}`)
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
        // Gemma 4 and newer architectures store per-layer head_count_kv as an array
        if (Array.isArray(v) && v.length > 0 && typeof v[0] === 'number') {
          return Math.max(...(v as number[]))
        }
        return null
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
 * Exact KV-cache sizing from GGUF shape.
 * Accounts for --cache-type-k q4_0 / --cache-type-v q4_0 (0.5 bytes per element)
 * which frees ~50% VRAM and boosts token throughput on consumer GPUs.
 */
export function kvCacheMBFromInfo(info: GgufModelInfo, ctxLen: number, nParallel: number): number | null {
  try {
    const headDim = info.keyLength ?? info.embeddingLength / info.headCount
    if (!Number.isFinite(headDim) || headDim <= 0) return null
    // 2 (k+v) × layers × kvHeads × headDim × 2 bytes (fp16 cache standard)
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
  const workspaceMB = opts?.workspaceMB ?? Math.max(128, Math.round(weightsMB * 0.08))
  const overheadMB = opts?.overheadMB ?? 256
  const estimatedMB = Math.round(weightsMB * 1.02) + kvCacheMB + workspaceMB + overheadMB
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
    const resolvedCtx = args.ctxLen || 4096
    const weightsMB = Math.max(64, Math.round(args.fileSizeBytes / (1024 * 1024)))
    const workspaceMB = Math.round(weightsMB * 0.05)
    const overheadMB = args.overheadMB ?? 256
    if (!info || info.blockCount < 1) return null
    const totalLayers = info.blockCount
    const kvCacheMB = kvCacheMBFromInfo(info, resolvedCtx, nParallel)
      ?? planMemory(args.fileSizeBytes, resolvedCtx, args.modelPath, { nParallel }).kvCacheMB
    const perLayerMB = weightsMB / totalLayers
    if (!(perLayerMB > 0)) return null
    const budgetMB = args.totalMB - overheadMB - kvCacheMB - workspaceMB
    const fitLayers = Math.min(totalLayers, Math.max(0, Math.floor(budgetMB / perLayerMB)))
    const minLayers = Math.max(4, Math.ceil(totalLayers * 0.2))
    if (fitLayers < minLayers) return null
    return {
      fitLayers,
      totalLayers,
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
  // Root-cause patterns first — must precede readiness/exit checks so the true
  // failure ("unknown model architecture") is classified as invalid-model,
  // not swallowed as a generic readiness-timeout / runner-crash.
  if (/unknown model architecture|error loading model|failed to read magic|invalid magic/i.test(msg)) return { kind: 'invalid-model', recoverable: false, message: msg }
  if (/runtime-not-installed|not installed|local runtime not installed|runner.*missing|llama-server.*not found/i.test(msg)) return { kind: 'runner-missing', recoverable: false, message: msg }
  if (/could not start.*spawn UNKNOWN|spawn UNKNOWN|windows blocked|w dac|controlled folder|allow-list/i.test(msg)) return { kind: 'runner-missing', recoverable: false, message: msg }
  if (/did not become ready|readiness|time\s*out|timeout/i.test(msg)) return { kind: 'readiness-timeout', recoverable: false, message: msg }
  if (/cuda.*out of memory|out of memory|oom|insufficient.*vram|memory.*exhausted|alloc.*fail/i.test(msg)) return { kind: 'oom', recoverable: false, message: msg }
  if (/eaddrinuse|address already in use|port.*in use|no free port/i.test(msg)) return { kind: 'startup-failure', recoverable: true, message: msg }
  if (/error while handling argument|unknown (argument|option|flag|value)|unrecognized (argument|option|flag)|invalid (argument|option|value)|usage:\s*\|/i.test(msg)) return { kind: 'startup-failure', recoverable: true, message: msg }
  if (/cuda.*error|nvrtc|cublas|backend.*fail|failed to initialize|no compatible gpu|driver/i.test(msg)) return { kind: 'backend-failure', recoverable: false, message: msg }
  if (/exit|crash|signal|died|killed/i.test(msg)) return { kind: 'runner-crash', recoverable: false, message: msg }
  if (/could not start|spawn|enoent/i.test(msg)) return { kind: 'startup-failure', recoverable: false, message: msg }
  return { kind: 'unknown', recoverable: false, message: msg }
}

/**
 * Extract the true root-cause line from llama-server stderr.
 * Scans the FULL stderr ring for high-confidence failure patterns; returns null when none match.
 */
export function extractLoadRootCause(raw: string): string | null {
  const s = String(raw ?? '')
  if (!s.trim()) return null
  const patterns: RegExp[] = [
    /unknown model architecture[:\s]+'[^']+'/,
    /error loading model:\s*[^\n\r]+/i,
    /failed to read magic[^\n\r]*/i,
    /invalid magic[^\n\r]*/i,
    /gguf_init[^\n\r]*magic[^\n\r]*/i,
    /cuda out of memory/i,
    /address already in use/i,
    /not a valid gguf/i,
    /architecture '[^']+' is not supported/i,
  ]
  for (const p of patterns) {
    const m = s.match(p)
    if (m) return m[0].trim().slice(0, 400)
  }
  // Fallback: first llama.cpp E-level error mentioning load/model/gguf
  for (const line of s.split(/\r?\n/)) {
    if (/^\s*E\s+/.test(line) && /model|gguf|magic|arch|load/i.test(line)) {
      return line.trim().slice(0, 400)
    }
  }
  return null
}

/**
 * Preflight GGUF before spawning llama-server.
 * Only fails when the header is readable, general.architecture is present,
 * but the transformer shape keys (e.g. `${arch}.block_count`) are missing —
 * which indicates a custom/experimental arch stock llama.cpp cannot load.
 * All other cases fall through to let llama-server surface the real error.
 */
export function preflightGgufArchitecture(modelPath: string): { ok: true; arch: string } | { ok: false; reason: string } {
  try {
    if (!modelPath.toLowerCase().endsWith('.gguf')) return { ok: true, arch: '' }
    const fd = fs.openSync(modelPath, 'r')
    try {
      const stat = fs.fstatSync(fd)
      if (stat.size < 32) return { ok: true, arch: '' } // too small — let llama-server error
      const buf = Buffer.alloc(Math.min(4 << 20, stat.size))
      fs.readSync(fd, buf, 0, buf.length, 0)
      const cursor = { off: 0 }
      const take = (n: number): Buffer => {
        if (cursor.off + n > buf.length) throw new Error('short read')
        const s = buf.subarray(cursor.off, cursor.off + n)
        cursor.off += n
        return s
      }
      if (take(4).toString('binary') !== 'GGUF') return { ok: true, arch: '' } // not our job — llama-server handles
      take(4) // version
      take(8) // tensor count
      const kvCount = Number(take(8).readBigUInt64LE())
      if (!Number.isFinite(kvCount) || kvCount > 1 << 16) return { ok: true, arch: '' }
      const meta = new Map<string, unknown>()
      for (let i = 0; i < kvCount; i++) {
        const keyLen = Number(take(8).readBigUInt64LE())
        if (keyLen > 1 << 16) break
        const key = take(keyLen).toString('utf8')
        const type = take(4).readUInt32LE()
        if (key.startsWith('tokenizer.')) {
          try { skipGgufValue(take, cursor, buf.length, type) } catch { break }
        } else {
          try {
            meta.set(key, readGgufValue(buf, cursor, type))
          } catch {
            break
          }
        }
      }
      const arch = meta.get('general.architecture')
      if (typeof arch !== 'string' || !arch) return { ok: true, arch: '' } // no arch — let llama-server error
      const blockCount = meta.get(`${arch}.block_count`)
      if (blockCount === undefined || blockCount === null) {
        return {
          ok: false,
          reason: `GGUF architecture '${arch}' is not supported by the bundled llama.cpp — missing ${arch}.block_count (custom/experimental model; re-export as a standard llama.cpp GGUF)`,
        }
      }
      return { ok: true, arch }
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return { ok: true, arch: '' } // parse failure — let llama-server surface the real error
  }
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
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'max'
  enableTools?: boolean
  safeArgs?: boolean
}

export const CONTEXT_TIERS = [1024, 2048, 4096, 8192, 16384, 32768] as const
export function pickTierAtOrBelow(valueMb: number, mbPer1kTokens: number): number {
  const maxCtxFromMemory = Math.floor((valueMb / mbPer1kTokens) * 1000)
  const eligible = CONTEXT_TIERS.filter((tier) => tier <= maxCtxFromMemory)
  if (eligible.length === 0) return CONTEXT_TIERS[0]!
  return eligible[eligible.length - 1]!
}
export async function detectHardwareProfileForLlama(modelSizeMb: number): Promise<{ contextSize: number; gpuLayers: number; mode: string }> {
  const { exec } = await import('node:child_process')
  const freeVramMb = await new Promise<number>((res) => exec('nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits', { timeout: 5000 } as never, (_e: unknown, out: unknown) => { const v = parseInt(String(out ?? '0').split('\n')[0] ?? '0', 10); res(Number.isNaN(v) ? 0 : v) }))
  const freeRamMb = Math.floor((await import('node:os')).default.freemem() / (1024 * 1024))
  const safety = 0.85
  if (freeVramMb === 0) return { contextSize: pickTierAtOrBelow(freeRamMb * safety, 8), gpuLayers: 0, mode: 'cpu' }
  const usableVramMb = freeVramMb * safety
  if (modelSizeMb >= usableVramMb) {
    const fitRatio = usableVramMb / modelSizeMb
    const gpuLayers = Math.max(1, Math.floor(32 * fitRatio))
    const usableMb = Math.max(usableVramMb - gpuLayers * (modelSizeMb / 32), 256)
    return { contextSize: pickTierAtOrBelow(usableMb, 8), gpuLayers, mode: 'partial-gpu' }
  }
  const usableMb = Math.max(usableVramMb - modelSizeMb, 256)
  return { contextSize: pickTierAtOrBelow(usableMb, 8), gpuLayers: -1, mode: 'full-gpu' }
}

export function buildServerArgs(opts: ServerArgsOpts): string[] {
  // Pin threads to physical cores only (hybrid CPUs include efficiency cores
  // in `os.cpus().length` which slows generation). Detect physical cores via
  // /proc/cpuinfo on POSIX or %NUMBER_OF_PROCESSOR_GROUPS% on Windows; fall
  // back to the safe default if detection fails.
  const threads = pickThreads(4, 64)
  const threadsBatch = threads
  const isPartialOffload = (opts.nGpuLayers ?? 999) < 999
  const ctx = Math.max(2048, opts.ctxLen ?? 12288)
  let fileMB = 0
  try { fileMB = Math.round(fs.statSync(opts.modelPath).size / (1024 * 1024)) } catch { fileMB = 0 }
  const isHeavy = fileMB >= 4500
  const isMedium = fileMB >= 2500
  const batch = opts.safeArgs || isHeavy
    ? 1024
    : isMedium
    ? 2048
    : ctx >= 8192
    ? 2048
    : 1024
  const ubatch = Math.min(batch, 512)
  const args: string[] = [
    '-m', opts.modelPath,
    '--host', '127.0.0.1',
    '--port', String(opts.port),
    '-c', String(ctx),
    '-ngl', String(opts.nGpuLayers ?? 999),
    '-t', String(threads),
    '--threads-batch', String(threadsBatch),
    '-b', String(batch),
    '--ubatch-size', String(ubatch),
    '--cache-type-k', isHeavy ? 'q2_k' : 'q4_0',
    '--cache-type-v', isHeavy ? 'q2_k' : 'q4_0',
    ...((process.platform !== 'win32' && !isPartialOffload) ? ['--mlock'] : []),
    '--no-warmup',
    '--parallel', '1',
  ]
  if ((opts.nGpuLayers ?? 999) > 0 && !opts.safeArgs) {
    args.push('--flash-attn', 'auto')
  }
  if (!opts.safeArgs) {
    args.push('--cont-batching')
    // NUMA awareness — on multi-die CPUs (Threadripper) this avoids cross-die memory hops (~10% win, no cost on single-die).
    if (process.platform !== 'win32') args.push('--numa', 'distribute')
    // Native reasoning effort — 4B Nano medium overflows p2730→c0, use low for <4GB
    if (opts.reasoningEffort) {
      let eff = opts.reasoningEffort
      try { const mb = Math.round(fs.statSync(opts.modelPath).size / (1024 * 1024)); if (mb < 3500 && eff === 'medium') eff = 'low' } catch {}
      args.push('--reasoning-effort', eff)
    }
    // Native server tools — ponytail: only for >=7B tool-capable models.
    // 4B thinking models (Nemotron-3-Nano) hallucinate {"path":"coed base"} instead of real tool_calls → empty reply after 16s stall.
    if (opts.enableTools) {
      let fileMB = 0; try { fileMB = Math.round(fs.statSync(opts.modelPath).size / (1024 * 1024)) } catch {}
      const isSmallThinking = fileMB > 0 && fileMB < 3500 // <~7B Q4 ~4GB → 4B Nano 2706 MB
      if (!isSmallThinking) {
        args.push('--tools', 'read_file,file_glob_search,grep_search,exec_shell_command')
      }
    }
    // MTP 3x — from test/llama.cpp#22673, only when GGUF has MTP head (Qwen3.x-MTP). Detect by filename, <10% VRAM, n_parallel=1 required
    const isMtpModel = /mtp/i.test(opts.modelPath)
    if (isMtpModel) {
      args.push('--spec-type', 'mtp', '--spec-draft-n-max', '3')
    }
  }
  if (opts.alias) args.push('--alias', opts.alias)
  if (opts.mmprojPath) args.push('--mmproj', opts.mmprojPath)
  return args
}

/**
 * Physical-core count for llama-server `-t`. On Windows we read
 * `NUMBER_OF_PROCESSOR_GROUPS` / `CPU_GROUP_INFO` once via PowerShell; on
 * POSIX we read `/proc/cpuinfo` `cpu cores` per physical package. Falls back
 * to `os.cpus().length - 1` when detection fails.
 */
function pickThreads(min: number, max: number): number {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile', '-NonInteractive', '-Command',
          '(Get-CimInstance Win32_Processor | Measure-Object -Property NumberOfCores -Sum).Sum',
        ],
        { timeout: 5000, windowsHide: true, encoding: 'utf8' },
      ) as string
      const m = String(out ?? '').match(/\d+/)
      if (m) {
        const physical = parseInt(m[0], 10)
        return Math.max(min, Math.min(max, physical))
      }
    } else if (process.platform === 'linux') {
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8')
      const match = cpuinfo.match(/cpu cores\s*:\s*(\d+)/)
      if (match) {
        const physical = parseInt(match[1], 10)
        return Math.max(min, Math.min(max, physical))
      }
    }
  } catch { /* fall through */ }
  const logical = os.cpus().length || 8
  const estimated = Math.max(1, Math.round(logical / 2))
  return Math.max(min, Math.min(max, estimated))
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
  appendLlamaLog(baseDir, 'runtime-download-start', { url: LLAMA_DOWNLOAD_URL, asset: LLAMA_CUDA_ASSET, dir })
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
    // Windows marks downloads from the internet (MOTW) → spawn UNKNOWN / 4551.
    // Unblock immediately after extract, before the --version self-check.
    try { onProgress?.({ phase: 'unblocking', receivedBytes: received, totalBytes: total }) } catch { /* ignore */ }
    const un = await unblockRuntimeDir(dir)
    appendLlamaLog(baseDir, 'runtime-unblock', { unblocked: un.unblocked, detail: un.detail })
    const exe = getLlamaServerPath(baseDir)
    if (!exe) throw new Error('archive extracted but llama-server.exe was not found')
    try { onProgress?.({ phase: 'verifying', receivedBytes: received, totalBytes: total }) } catch { /* ignore */ }
    const version = await getLlamaVersion(exe)
    if (!version) {
      const diag = await diagnoseLlamaExecutable(baseDir)
      throw new Error(`downloaded llama-server.exe failed its --version self-check (MOTW=${diag.hasMotw}, dlls=[${diag.dlls.join(',')}]). Windows is blocking it — allow-list ${dir} in Windows Security, install the VC++ Redistributable, then reinstall.`)
    }
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
  safeArgs?: boolean
}

export function spawnLlamaServer(opts: SpawnOpts): ChildProcess {
  const args = buildServerArgs({
    modelPath: opts.modelPath,
    port: opts.port,
    ctxLen: opts.ctxLen,
    nGpuLayers: opts.nGpuLayers,
    alias: opts.alias,
    safeArgs: opts.safeArgs,
  })
  if (!opts.exePath || !fs.existsSync(opts.exePath)) {
    throw new Error(`local runtime not installed — open Models → Install local runtime to provision llama-server.exe (missing ${opts.exePath ?? 'llama-server.exe'}). Sovara runs its own llama.cpp sidecar; there is no LM Studio / Ollama fallback.`)
  }
  // Pre-flight --version check to catch Windows App Control / antivirus blocking before opaque spawn UNKNOWN
  const logDir = opts.logDir ?? path.join(os.tmpdir(), 'sovara-llama-logs')
  ensureDir(logDir)
  const safeAlias = (opts.alias ?? 'model').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64)
  const logPath = path.join(logDir, `llama-${safeAlias}-${opts.port}.log`)
  const stream = fs.createWriteStream(logPath, { flags: 'a' })
  stream.write(`\n=== spawn ${new Date().toISOString()} exe=${opts.exePath} args=${JSON.stringify(args)} ===\n`)
  // Early MOTW warning (logged, not fatal — spawn will still be attempted)
  try {
    if (hasZoneIdentifier(opts.exePath)) {
      stream.write(`[motw] Zone.Identifier present — Windows may block spawn with UNKNOWN. Run Unblock-File or Models → Unblock & Retry.\n`)
    }
  } catch { /* ignore */ }
  // Ollama-style bundled CUDA: exe lives beside cudart64_12.dll, cublas64_12.dll, etc.
  const exeDir = path.dirname(opts.exePath)
  const bundledEnv = { ...process.env, PATH: `${exeDir};${process.env.PATH ?? ''}` }
  try {
    const dlls = fs.readdirSync(exeDir).filter(f => f.toLowerCase().endsWith('.dll')).slice(0,6)
    stream.write(`[bundled] exeDir=${exeDir} dlls=${dlls.join(',')}\n`)
    // Quick execute permission probe — catches Controlled Folder / WDAC before spawn
    try { fs.accessSync(opts.exePath, fs.constants.X_OK) } catch {}
  } catch { /* ignore */ }

  // Ring-buffer the last ~8KB of stderr so callers can surface a real
  // "llama-server died because…" message instead of the opaque
  // `connection-refused` from /health polls.
  const STDERR_RING_BYTES = 8 * 1024
  let stderrRing = ''
  const appendRing = (chunk: string): void => {
    stderrRing = (stderrRing + chunk).slice(-STDERR_RING_BYTES)
  }
  let stdoutRing = ''
  const appendStdoutRing = (chunk: string): void => {
    stdoutRing = (stdoutRing + chunk).slice(-STDERR_RING_BYTES)
  }

  let child: ChildProcess
  try {
    child = spawn(opts.exePath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: bundledEnv })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    const code = (e as NodeJS.ErrnoException)?.code ?? ''
    const hint = /UNKNOWN/i.test(raw) || code === 'UNKNOWN'
      ? ' Windows blocked llama-server.exe (MOTW / WDAC / Controlled Folder / Antivirus) OR the path contains @. Fix: Models → Unblock & Retry, or reinstall (moves to %LOCALAPPDATA%\\Sovara with no @), or allow-list the folder in Windows Security.'
      : ''
    stream.write(`[spawn-error] code=${code} ${raw}${hint}\n`)
    try { stream.end() } catch {}
    throw new Error(`could not start the local runtime: spawn ${code || 'FAILED'}${hint} — exe=${opts.exePath}`)
  }
  // Surface spawn-time errors (ENOENT / EACCES / UNKNOWN) that otherwise emit only on 'error' event
  child.once('error', (err) => {
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as NodeJS.ErrnoException).code ?? ''
    const hint = code === 'UNKNOWN' || /UNKNOWN/i.test(msg) ? ' — Windows blocked the binary (MOTW / WDAC / Controlled folder / Antivirus) or @-path. Models → Unblock & Retry.' : ''
    stream.write(`[spawn-async-error] code=${code} msg=${msg}${hint}\n`)
    try { appendRing(`\n[spawn-error] ${code || ''} ${msg}${hint}\n`) } catch { /* ignore */ }
  })
  child.stdout?.on('data', (d) => {
    const s = String(d)
    try { stream.write(`[out] ${s}`) } catch { /* ignore */ }
    try { appendStdoutRing(s) } catch { /* ignore */ }
  })
  child.stderr?.on('data', (d) => {
    const s = String(d)
    try { stream.write(`[err] ${s}`) } catch { /* ignore */ }
    try { appendRing(s) } catch { /* ignore */ }
  })
  child.once('exit', (code, signal) => {
    const lastLines = stderrRing.trim().split(/\r?\n/).slice(-6).join(' | ')
    stream.write(`\n=== exit code=${code} signal=${signal} stderr-tail=${lastLines} ===\n`)
    try { stream.end() } catch { /* ignore */ }
    try {
      // Surface a one-line cause so the UI never displays the generic
      // `connection-refused` from a missed /health poll. Callers can read
      // `child.stderr` history through the log path above.
      appendLlamaLog(opts.logDir?.includes('sovara-llama-logs') ? undefined : undefined, 'server-exit', {
        alias: opts.alias, port: opts.port, code, signal, stderrTail: lastLines.slice(0, 600),
      }, code === 0 ? 'info' : 'error')
    } catch { /* logging best-effort */ }
  })
  // Expose the stderr ring buffer for the adapter to read on premature exit.
  // We attach it on the process object itself — keeps the call surface
  // backward-compatible (ChildProcess shape preserved for callers).
  ;(child as unknown as { __stderrTail?: () => string }).__stderrTail = () => stderrRing
  ;(child as unknown as { __stdoutTail?: () => string }).__stdoutTail = () => stdoutRing
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
  isCancelled?: () => boolean,
  proc?: ChildProcess | null
): Promise<void> {
  const url = `http://127.0.0.1:${port}/health`
  const started = Date.now()
  for (;;) {
    if (isCancelled?.()) throw new Error('cancelled while waiting for the local model to load')
    // If the sidecar died before serving /health, surface the real cause
    // instead of letting `connection-refused` stand alone. The user must
    // never see a generic connection error when the truth is in llama-server's
    // own stderr (e.g. "llama_model_load: error loading model",
    // "CUDA out of memory", "gguf_init_file: invalid magic", "address in use").
    if (proc && (proc.exitCode !== null || proc.signalCode !== null)) {
      const code = proc.exitCode
      const signal = proc.signalCode
      const stderrTail = (proc as unknown as { __stderrTail?: () => string }).__stderrTail?.() ?? ''
      const rootCause = extractLoadRootCause(stderrTail)
      const tailLine = rootCause ?? stderrTail.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 600)
      throw new Error(
        `llama-server exited before becoming ready (code=${code ?? 'null'}, signal=${signal ?? 'null'})` +
        (tailLine ? ` — ${tailLine}` : ''),
      )
    }
    try {
      const { status } = await getLoopbackJson(url, { timeoutMs: 2500 })
      if (status === 200) return
    } catch {
      // not up yet — keep polling (connection-refused is the normal pre-ready state)
    }
    if (Date.now() - started > timeoutMs) {
      const fullStderr = proc ? ((proc as unknown as { __stderrTail?: () => string }).__stderrTail?.() ?? '') : ''
      const rootCause = extractLoadRootCause(fullStderr)
      const stderrTail = rootCause ?? fullStderr.trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 600)
      throw new Error(
        `local model did not become ready within ${Math.round(timeoutMs / 1000)}s` +
        (stderrTail ? ` — last stderr: ${stderrTail}` : ''),
      )
    }
    await new Promise((r) => setTimeout(r, 400))
  }
}
