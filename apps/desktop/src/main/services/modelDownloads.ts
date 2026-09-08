/**
 * Model library: global download directory + HF file downloads with
 * progress, resume, pause, cancel, 2-concurrent limit, and library sync.
 * Layout mirrors the repo: `<libraryDir>/<author>__<name>/<rfilename>`.
 *
 * All filesystem access is confined under the library dir (validated on
 * every entry point). Progress flows on the `events:download` push channel;
 * invokes resolve fast (started/queued) while the transfer runs detached.
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'fs'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { Readable } from 'stream'
import { finished } from 'stream/promises'
import type { RuntimeConfigStore } from '../config/RuntimeConfigStore'

export interface LibraryEntry {
  name: string
  file: string
  sizeBytes: number
  path: string
  modifiedAt: number
}

export type DownloadState = 'queued' | 'started' | 'progress' | 'paused' | 'done' | 'error' | 'cancelled'

export interface DownloadEvent {
  modelId: string
  rfilename: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number | null
  error?: string
}

type Emit = (event: DownloadEvent) => void

const HF_HOSTS = new Set(['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs.hf.co', 'huggingface.s3.amazonaws.com'])
const MODEL_EXTENSIONS = new Set(['.gguf', '.safetensors', '.bin', '.pt', '.mlx'])
const MAX_CONCURRENT = 2

const active = new Map<string, { ctrl: AbortController; modelId: string; rfilename: string; downloadUrl: string }>()
const paused = new Set<string>()
const queue: Array<{ modelId: string; rfilename: string; downloadUrl: string; config: RuntimeConfigStore; userData: string; emit: Emit }> = []

function key(modelId: string, rfilename: string): string {
  return `${modelId}\n${rfilename}`
}

export function defaultLibraryDir(userData: string): string {
  return join(userData, 'models')
}

export function resolveLibraryDir(config: RuntimeConfigStore, userData: string): string {
  const stored = (config.getAppSetting('model_library_dir') ?? '').trim()
  const dir = stored.length > 0 ? stored : defaultLibraryDir(userData)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function setLibraryDir(config: RuntimeConfigStore, dir: string): string {
  const clean = dir.trim()
  if (!clean) throw new Error('directory must not be empty')
  const abs = resolve(clean)
  mkdirSync(abs, { recursive: true })
  config.setAppSetting('model_library_dir', abs)
  return abs
}

/** Confine a library-relative path; throws when escaping the root. */
export function confinePath(root: string, ...parts: string[]): string {
  const abs = resolve(root, ...parts)
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error('path escapes the model library')
  return abs
}

export function repoFolder(modelId: string): string {
  return modelId.replace(/\//g, '__').slice(0, 128)
}

export function scanLibrary(root: string): LibraryEntry[] {
  const out: LibraryEntry[] = []
  const walk = (dir: string): void => {
    let entries: ReturnType<typeof readdirSync>
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as unknown as ReturnType<typeof readdirSync>
    } catch {
      return
    }
    for (const ent of entries) {
      const full = join(dir, (ent as unknown as { name: string }).name)
      if ((ent as unknown as { isDirectory(): boolean }).isDirectory()) {
        walk(full)
      } else {
        const lower = full.toLowerCase()
        // skip .part incomplete files
        if (lower.endsWith('.part')) continue
        const dot = lower.lastIndexOf('.')
        if (dot < 0 || !MODEL_EXTENSIONS.has(lower.slice(dot))) continue
        try {
          const st = statSync(full)
          const rel = relative(root, full)
          out.push({
            name: dirname(rel) === '.' ? basename(full) : dirname(rel).split(sep)[0] ?? basename(full),
            file: basename(full),
            sizeBytes: st.size,
            path: full,
            modifiedAt: st.mtimeMs,
          })
        } catch {
          // raced deletion — skip
        }
      }
    }
  }
  if (existsSync(root)) walk(root)
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

export function isDownloaded(root: string, modelId: string, rfilename: string): boolean {
  try {
    const dest = confinePath(root, repoFolder(modelId.trim().slice(0, 128)), rfilename.trim().replace(/^\/+/, '').slice(0, 512))
    return existsSync(dest) && !existsSync(`${dest}.part`)
  } catch {
    return false
  }
}

export function getActiveDownloads(): Array<{ modelId: string; rfilename: string; state: DownloadState }> {
  const out: Array<{ modelId: string; rfilename: string; state: DownloadState }> = []
  for (const v of active.values()) out.push({ modelId: v.modelId, rfilename: v.rfilename, state: 'progress' })
  for (const q of queue) out.push({ modelId: q.modelId, rfilename: q.rfilename, state: 'queued' })
  for (const k of paused) {
    const [modelId, rfilename] = k.split('\n')
    out.push({ modelId, rfilename, state: 'paused' })
  }
  return out
}

/** Test helper: clear all in-memory download state. */
export function __resetDownloadsForTests(): void {
  active.clear()
  queue.length = 0
  paused.clear()
}

function assertHuggingFaceUrl(downloadUrl: string): URL {
  let url: URL
  try {
    url = new URL(downloadUrl)
  } catch {
    throw new Error('download URL is not valid')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !HF_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('downloads are limited to huggingface.co file URLs')
  }
  return url
}

export function cancelDownload(modelId: string, rfilename: string): boolean {
  const k = key(modelId, rfilename)
  const entry = active.get(k)
  if (entry) {
    try { entry.ctrl.abort() } catch { /* already settled */ }
    // Abort will trigger cancelled emit in run(); also delete .part synchronously after
    // Do not delete here — run's catch handles it; but we also dequeue
    return true
  }
  // Also remove from queue if queued
  const qIdx = queue.findIndex((q) => q.modelId === modelId && q.rfilename === rfilename)
  if (qIdx >= 0) {
    queue.splice(qIdx, 1)
    return true
  }
  if (paused.has(k)) {
    paused.delete(k)
    // Delete .part on explicit cancel of paused item
    // Caller should provide config/userData to locate file, but we try best-effort via queued info
    return true
  }
  return false
}

export function pauseDownload(modelId: string, rfilename: string): boolean {
  const k = key(modelId, rfilename)
  const entry = active.get(k)
  if (!entry) return false
  paused.add(k)
  try { entry.ctrl.abort() } catch { /* already settled */ }
  return true
}

export function resumeDownload(
  config: RuntimeConfigStore,
  userData: string,
  modelId: string,
  rfilename: string,
  downloadUrl: string,
  emit: Emit
): boolean {
  const k = key(modelId, rfilename)
  if (!paused.has(k) && !queue.some((q) => q.modelId === modelId && q.rfilename === rfilename)) {
    // Not paused/queued — treat as fresh start if not active
    if (active.has(k)) return false
  }
  paused.delete(k)
  void startDownload(config, userData, modelId, rfilename, downloadUrl, emit)
  return true
}

export function deleteLibraryEntry(root: string, entryPath: string): void {
  const abs = confinePath(root, relative(root, resolve(entryPath)))
  if (!existsSync(abs)) return
  rmSync(abs, { force: true })
  // Prune the now-empty repo folder.
  try {
    const parent = dirname(abs)
    if (parent !== root && readdirSync(parent).length === 0) rmSync(parent, { recursive: true, force: true })
  } catch {
    // best-effort prune
  }
  // Also delete .part if exists
  try {
    const part = `${abs}.part`
    if (existsSync(part)) unlinkSync(part)
  } catch { /* ignore */ }
}

function dequeueIfNeeded(): void {
  if (active.size >= MAX_CONCURRENT) return
  const next = queue.shift()
  if (!next) return
  void startDownload(next.config, next.userData, next.modelId, next.rfilename, next.downloadUrl, next.emit)
}

/**
 * Start a download (detached). Emits queued? → started → progress* → done|error|paused|cancelled.
 * Resumes a leftover `.part` via Range. Throws only for invalid arguments; transfer failures arrive as events.
 * Enforces MAX_CONCURRENT=2, excess goes to queued.
 */
export async function startDownload(
  config: RuntimeConfigStore,
  userData: string,
  modelId: string,
  rfilename: string,
  downloadUrl: string,
  emit: Emit
): Promise<{ ok: true; resumed: boolean; queued?: boolean }> {
  const cleanId = modelId.trim().slice(0, 128)
  const cleanFile = rfilename.trim().replace(/^\/+/, '').slice(0, 512)
  if (!cleanId || !cleanFile || cleanFile.includes('..')) throw new Error('invalid download target')
  const url = assertHuggingFaceUrl(downloadUrl)
  const root = resolveLibraryDir(config, userData)
  const dest = confinePath(root, repoFolder(cleanId), cleanFile)
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const k = key(cleanId, cleanFile)
  if (active.has(k)) return { ok: true, resumed: true }
  if (queue.some((q) => q.modelId === cleanId && q.rfilename === cleanFile)) return { ok: true, resumed: true, queued: true }
  if (paused.has(k)) paused.delete(k)

  if (active.size >= MAX_CONCURRENT) {
    queue.push({ modelId: cleanId, rfilename: cleanFile, downloadUrl: url.toString(), config, userData, emit })
    emit({ modelId: cleanId, rfilename: cleanFile, state: 'queued', receivedBytes: 0, totalBytes: null })
    return { ok: true, resumed: false, queued: true }
  }

  const ctrl = new AbortController()
  active.set(k, { ctrl, modelId: cleanId, rfilename: cleanFile, downloadUrl: url.toString() })
  const base = { modelId: cleanId, rfilename: cleanFile }
  emit({ ...base, state: 'started', receivedBytes: 0, totalBytes: null })

  const run = async (): Promise<void> => {
    let received = 0
    let wasPaused = false
    try {
      let startAt = 0
      try {
        if (existsSync(part)) startAt = statSync(part).size
      } catch {
        startAt = 0
      }
      const res = await fetch(url.toString(), {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'SOVARA/1.0',
          ...(startAt > 0 ? { Range: `bytes=${startAt}-` } : {}),
        },
      })
      if (res.status !== 200 && res.status !== 206) {
        throw new Error(`download failed (HTTP ${res.status})`)
      }
      const totalHeader = res.headers.get('content-length')
      const remaining = totalHeader ? parseInt(totalHeader, 10) : NaN
      const total = Number.isFinite(remaining) ? remaining + (res.status === 206 ? startAt : 0) : null
      if (res.status !== 206 && startAt > 0) {
        try { unlinkSync(part) } catch { /* no stale part */ }
        startAt = 0
      }
      received = startAt
      if (!res.body) throw new Error('empty download response')
      const out = createWriteStream(part, { flags: startAt > 0 ? 'a' : 'w' })
      let lastEmit = 0
      const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
      nodeStream.on('data', (chunk: Buffer) => {
        received += chunk.length
        const now = Date.now()
        if (now - lastEmit > 250) {
          lastEmit = now
          emit({ ...base, state: 'progress', receivedBytes: received, totalBytes: total })
        }
      })
      await finished(nodeStream.pipe(out))
      emit({ ...base, state: 'progress', receivedBytes: received, totalBytes: total ?? received })
      renameSync(part, dest)
      // Write sidecar with minimal provenance (C drive global location)
      try {
        const sidecar = `${dest}.json`
        const meta = {
          modelId: cleanId,
          rfilename: cleanFile,
          downloadUrl: url.toString(),
          savedAt: new Date().toISOString(),
          sizeBytes: received,
          libraryDir: root,
          // Minimal system snapshot at download time (VRAM-aware)
          hardware: (() => {
            try { const os = require('node:os'); return { totalRamMB: Math.round(os.totalmem() / (1024 * 1024)), freeRamMB: Math.round(os.freemem() / (1024 * 1024)) } } catch { return {} }
          })(),
        }
        require('node:fs').writeFileSync(sidecar, JSON.stringify(meta, null, 2), 'utf8')
      } catch { /* best-effort sidecar */ }
      emit({ ...base, state: 'done', receivedBytes: received, totalBytes: total ?? received })
    } catch (e) {
      if (ctrl.signal.aborted) {
        wasPaused = paused.has(k)
        if (wasPaused) {
          emit({ ...base, state: 'paused', receivedBytes: received, totalBytes: null })
        } else {
          // Cancelled — delete .part to keep library clean
          try { if (existsSync(part)) unlinkSync(part) } catch { /* ignore */ }
          emit({ ...base, state: 'cancelled', receivedBytes: received, totalBytes: null })
        }
      } else {
        const message = e instanceof Error ? e.message : String(e)
        emit({ ...base, state: 'error', receivedBytes: received, totalBytes: null, error: message })
      }
    } finally {
      active.delete(k)
      if (wasPaused) {
        // keep in paused set, do not dequeue
      } else {
        paused.delete(k)
        dequeueIfNeeded()
      }
    }
  }
  void run()
  return { ok: true, resumed: false }
}
