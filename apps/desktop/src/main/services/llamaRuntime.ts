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
  const weightsMB = Math.max(64, Math.round(fileSizeBytes / (1024 * 1024)))
  const paramsB = parseParamsB(path.basename(filename)) ?? 7
  const scale = Math.min(2.2, Math.max(0.35, paramsB / 7))
  const kvMB = Math.round(((ctxLen || 4096) / 1024) * 430 * scale)
  return Math.round(weightsMB * 1.15) + kvMB
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
