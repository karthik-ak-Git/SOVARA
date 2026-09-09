/**
 * Model library: global download directory + HF file downloads with
 * progress, resume, pause, cancel, 2-concurrent limit, and library sync.
 * Layout mirrors the repo: `<libraryDir>/<author>__<name>/<rfilename>`.
 *
 * All filesystem access is confined under the library dir (validated on
 * every entry point). Progress flows on the `events:download` push channel;
 * invokes resolve fast (started/queued) while the transfer runs detached.
 */

import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'fs'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
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
    // Shard set (restart-safe via sidecar): installed only when EVERY part is
    // present — a lone first part must never read as "Already in library".
    const set = readSetSidecar(root, modelId, rfilename)
    if (set) return set.parts.every((p) => partComplete(root, modelId, p.rfilename))
    const dest = confinePath(root, repoFolder(modelId.trim().slice(0, 128)), rfilename.trim().replace(/^\/+/, '').slice(0, 512))
    return existsSync(dest) && !existsSync(`${dest}.part`)
  } catch {
    return false
  }
}

function setPartKeys(job: SetJob): Set<string> {
  const s = new Set<string>()
  for (const p of job.parts) s.add(key(job.modelId, p.rfilename))
  return s
}

export function getActiveDownloads(): Array<{ modelId: string; rfilename: string; state: DownloadState }> {
  const out: Array<{ modelId: string; rfilename: string; state: DownloadState }> = []
  const hidden = new Set<string>()
  for (const job of sets.values()) {
    for (const k of setPartKeys(job)) hidden.add(k)
    out.push({ modelId: job.modelId, rfilename: job.groupFile, state: job.paused ? 'paused' : 'progress' })
  }
  // Individual set parts stay hidden: the group row carries the aggregate.
  for (const v of active.values()) {
    if (hidden.has(key(v.modelId, v.rfilename))) continue
    out.push({ modelId: v.modelId, rfilename: v.rfilename, state: 'progress' })
  }
  for (const q of queue) {
    if (hidden.has(key(q.modelId, q.rfilename))) continue
    out.push({ modelId: q.modelId, rfilename: q.rfilename, state: 'queued' })
  }
  for (const k of paused) {
    if (hidden.has(k)) continue
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
  sets.clear()
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

export interface SetPart {
  rfilename: string
  downloadUrl: string
  sizeBytes?: number
}

interface SetJob {
  modelId: string
  /** First part's rfilename — the group's public key (progress, pause, installed). */
  groupFile: string
  parts: SetPart[]
  companion?: SetPart
  /** Index of the part currently (or next) transferring. */
  idx: number
  doneBytes: number
  totalBytes: number | null
  cancelled: boolean
  paused: boolean
  config: RuntimeConfigStore
  userData: string
  emit: Emit
  root: string
}

const sets = new Map<string, SetJob>()

function setSidecarPath(root: string, modelId: string, groupFile: string): string {
  const dest = confinePath(root, repoFolder(modelId.trim().slice(0, 128)), groupFile.trim().replace(/^\/+/, '').slice(0, 512))
  return `${dest}.set.json`
}

function writeSetSidecar(root: string, modelId: string, groupFile: string, parts: SetPart[], companion?: SetPart): void {
  try {
    const sidecar = setSidecarPath(root, modelId, groupFile)
    mkdirSync(dirname(sidecar), { recursive: true })
    writeFileSync(
      sidecar,
      JSON.stringify({ version: 1, modelId, parts, companion: companion ?? null, savedAt: new Date().toISOString() }),
      'utf8',
    )
  } catch { /* best-effort */ }
}

function readSetSidecar(root: string, modelId: string, groupFile: string): { parts: SetPart[]; companion?: SetPart } | null {
  try {
    const raw = readFileSync(setSidecarPath(root, modelId, groupFile), 'utf8') as string
    const j = JSON.parse(raw) as { parts?: SetPart[]; companion?: SetPart | null }
    if (!j || !Array.isArray(j.parts) || j.parts.length < 2) return null
    const parts = j.parts.filter((p) => p && typeof p.rfilename === 'string' && typeof p.downloadUrl === 'string')
    if (parts.length < 2) return null
    const out: { parts: SetPart[]; companion?: SetPart } = { parts }
    if (j.companion && typeof j.companion.rfilename === 'string' && typeof j.companion.downloadUrl === 'string') {
      out.companion = j.companion
    }
    return out
  } catch {
    return null
  }
}

function partDest(root: string, modelId: string, rfilename: string): string {
  return confinePath(root, repoFolder(modelId.trim().slice(0, 128)), rfilename.trim().replace(/^\/+/, '').slice(0, 512))
}

function partComplete(root: string, modelId: string, rfilename: string): boolean {
  try {
    const dest = partDest(root, modelId, rfilename)
    return existsSync(dest) && !existsSync(`${dest}.part`)
  } catch {
    return false
  }
}

export function cancelDownload(modelId: string, rfilename: string): boolean {
  const k = key(modelId, rfilename)
  const job = sets.get(k)
  if (job) {
    job.cancelled = true
    job.paused = false
    const cur = job.parts[Math.min(job.idx, job.parts.length - 1)]
    const entry = cur ? active.get(key(modelId, cur.rfilename)) : undefined
    if (entry) {
      try { entry.ctrl.abort() } catch { /* already settled */ }
      return true
    }
    const qIdx = cur ? queue.findIndex((q) => q.modelId === modelId && q.rfilename === cur.rfilename) : -1
    if (qIdx >= 0) {
      queue.splice(qIdx, 1)
      finishSetCancelled(job)
      return true
    }
    // Nothing transferring (between parts): finish cancelled immediately.
    finishSetCancelled(job)
    return true
  }
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
  const job = sets.get(k)
  if (job) {
    if (job.cancelled) return false
    const cur = job.parts[Math.min(job.idx, job.parts.length - 1)]
    const entry = cur ? active.get(key(modelId, cur.rfilename)) : undefined
    if (!entry) return false
    job.paused = true
    // Mark the part paused so run() emits paused (keeps .part) instead of
    // cancelled (which would delete it).
    paused.add(key(modelId, cur.rfilename))
    try { entry.ctrl.abort() } catch { /* already settled */ }
    return true
  }
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
  const job = sets.get(k)
  if (job) {
    // Resume a paused set from the first incomplete part.
    if (!job.paused || job.cancelled) return false
    job.paused = false
    for (const p of job.parts) paused.delete(key(modelId, p.rfilename))
    void runSet(job).catch(() => {})
    return true
  }
  // Restart-safe resume: a set sidecar outlives restarts — rebuild the job
  // from it (cancel/retry/download-after-restart all converge here).
  // Completed sets simply re-verify and emit done (idempotent).
  try {
    const root = resolveLibraryDir(config, userData)
    const set = readSetSidecar(root, modelId, rfilename)
    if (set && !sets.has(k) && !active.has(k)) {
      const parts = set.parts.map((p) => ({
        rfilename: p.rfilename,
        downloadUrl: assertHuggingFaceUrl(p.downloadUrl).toString(),
        sizeBytes: typeof p.sizeBytes === 'number' ? p.sizeBytes : 0,
      }))
      const rebuilt: SetJob = {
        modelId, groupFile: rfilename, parts,
        companion: set.companion, idx: 0, doneBytes: 0, totalBytes: setTotalBytes(parts),
        cancelled: false, paused: false, config, userData, emit, root,
      }
      sets.set(k, rebuilt)
      safeEmitTo(emit, { modelId, rfilename, state: 'started', receivedBytes: 0, totalBytes: rebuilt.totalBytes })
      void runSet(rebuilt).catch(() => {})
      return true
    }
  } catch { /* fall through to single-file resume */ }
  if (!paused.has(k) && !queue.some((q) => q.modelId === modelId && q.rfilename === rfilename)) {
    // Not paused/queued — treat as fresh start if not active
    if (active.has(k)) return false
  }
  // Validate upfront: an empty/invalid URL must return false, never an
  // unhandled rejection from the detached startDownload below.
  try {
    assertHuggingFaceUrl(downloadUrl)
  } catch {
    return false
  }
  paused.delete(k)
  // startDownload validates again and can reject — surface as an error event,
  // never an unhandled rejection (main-process crash dialog).
  void startDownload(config, userData, modelId, rfilename, downloadUrl, emit).catch((e: unknown) => {
    safeEmitTo(emit, { modelId, rfilename, state: 'error', receivedBytes: 0, totalBytes: null, error: e instanceof Error ? e.message : String(e) })
  })
  return true
}

/** Emit that can never throw — a dead renderer must not crash main. */
function safeEmitTo(emit: Emit, event: DownloadEvent): void {
  try {
    emit(event)
  } catch {
    // ignore — channel torn down
  }
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
  void startDownload(next.config, next.userData, next.modelId, next.rfilename, next.downloadUrl, next.emit).catch((e: unknown) => {
    safeEmitTo(next.emit, { modelId: next.modelId, rfilename: next.rfilename, state: 'error', receivedBytes: 0, totalBytes: null, error: e instanceof Error ? e.message : String(e) })
  })
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
    safeEmitTo(emit, { modelId: cleanId, rfilename: cleanFile, state: 'queued', receivedBytes: 0, totalBytes: null })
    return { ok: true, resumed: false, queued: true }
  }

  const ctrl = new AbortController()
  active.set(k, { ctrl, modelId: cleanId, rfilename: cleanFile, downloadUrl: url.toString() })
  const base = { modelId: cleanId, rfilename: cleanFile }
  safeEmitTo(emit, { ...base, state: 'started', receivedBytes: 0, totalBytes: null })

  const run = async (): Promise<void> => {
    // Nothing inside run() may ever escape: every emit is guarded and the
    // whole body is covered, so pause/cancel aborts can only surface as
    // paused/cancelled/error EVENTS — never an uncaught main-process error.
    const safeEmit: Emit = (event) => safeEmitTo(emit, event)
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
      // Report headers immediately so the UI shows the real total instead of 0%.
      safeEmit({ ...base, state: 'progress', receivedBytes: received, totalBytes: total })
      const out = createWriteStream(part, { flags: startAt > 0 ? 'a' : 'w' })
      let lastEmit = 0
      const source = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
      // pipeline() owns error forwarding on every leg: an abort during the
      // body can only reject the awaited promise (handled below) — it can
      // never surface as an uncaught 'error' event the way manual
      // .on('data') + .pipe() + finished() does.
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          received += chunk.length
          const now = Date.now()
          if (now - lastEmit > 250) {
            lastEmit = now
            safeEmit({ ...base, state: 'progress', receivedBytes: received, totalBytes: total })
          }
          cb(null, chunk)
        },
      })
      await pipeline(source, tap, out)
      safeEmit({ ...base, state: 'progress', receivedBytes: received, totalBytes: total ?? received })
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
      safeEmit({ ...base, state: 'done', receivedBytes: received, totalBytes: total ?? received })
    } catch (e) {
      if (ctrl.signal.aborted) {
        wasPaused = paused.has(k)
        if (wasPaused) {
          safeEmit({ ...base, state: 'paused', receivedBytes: received, totalBytes: null })
        } else {
          // Cancelled — delete .part to keep library clean
          try { if (existsSync(part)) unlinkSync(part) } catch { /* ignore */ }
          safeEmit({ ...base, state: 'cancelled', receivedBytes: received, totalBytes: null })
        }
      } else {
        const message = e instanceof Error ? e.message : String(e)
        safeEmit({ ...base, state: 'error', receivedBytes: received, totalBytes: null, error: message })
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
  // run() is exhaustive by construction, but never let a rejection escape
  // into an unhandled main-process error under any future edit.
  void run().catch(() => {})
  return { ok: true, resumed: false }
}

// ── Multi-part shard-set downloads ───────────────────────────────────
// A sharded model (`-00001-of-0000N`) loads only with EVERY part present, so
// parts download sequentially as ONE job. All progress surfaces under the
// FIRST part's key (the row's rfilename) — renderer plumbing is untouched —
// and a `<first-part>.set.json` sidecar makes the set restart-safe for
// resume and installed checks.

function setTotalBytes(parts: SetPart[]): number | null {
  let sum = 0
  for (const p of parts) {
    const n = typeof p.sizeBytes === 'number' ? p.sizeBytes : 0
    if (!(n > 0)) return null
    sum += n
  }
  return sum
}

function fileSizeOnDisk(root: string, modelId: string, rfilename: string): number {
  try {
    return statSync(partDest(root, modelId, rfilename)).size
  } catch {
    return 0
  }
}

export async function startModelSetDownload(
  config: RuntimeConfigStore,
  userData: string,
  modelId: string,
  parts: SetPart[],
  companion: SetPart | undefined,
  emit: Emit,
): Promise<{ ok: true; resumed: boolean }> {
  const cleanId = modelId.trim().slice(0, 128)
  if (!cleanId) throw new Error('invalid download target')
  if (!Array.isArray(parts) || parts.length < 2 || parts.length > 8) throw new Error('invalid shard set')
  const cleanParts = parts.map((p) => {
    const rfilename = (p.rfilename ?? '').trim().replace(/^\/+/, '').slice(0, 512)
    if (!rfilename || rfilename.includes('..')) throw new Error('invalid download target')
    return { rfilename, downloadUrl: assertHuggingFaceUrl(p.downloadUrl).toString(), sizeBytes: typeof p.sizeBytes === 'number' && p.sizeBytes > 0 ? p.sizeBytes : 0 }
  })
  let cleanCompanion: SetPart | undefined
  if (companion && companion.rfilename && companion.downloadUrl) {
    const rfilename = companion.rfilename.trim().replace(/^\/+/, '').slice(0, 512)
    if (!rfilename || rfilename.includes('..')) throw new Error('invalid download target')
    cleanCompanion = { rfilename, downloadUrl: assertHuggingFaceUrl(companion.downloadUrl).toString(), sizeBytes: 0 }
  }
  const groupFile = cleanParts[0].rfilename
  const gk = key(cleanId, groupFile)
  if (sets.has(gk)) return { ok: true, resumed: true }
  const root = resolveLibraryDir(config, userData)
  const total = setTotalBytes(cleanParts)
  writeSetSidecar(root, cleanId, groupFile, cleanParts, cleanCompanion)
  const job: SetJob = { modelId: cleanId, groupFile, parts: cleanParts, companion: cleanCompanion, idx: 0, doneBytes: 0, totalBytes: total, cancelled: false, paused: false, config, userData, emit, root }
  sets.set(gk, job)
  safeEmitTo(emit, { modelId: cleanId, rfilename: groupFile, state: 'started', receivedBytes: 0, totalBytes: total })
  void runSet(job).catch(() => {})
  return { ok: true, resumed: false }
}

function finishSetCancelled(job: SetJob): void {
  sets.delete(key(job.modelId, job.groupFile))
  // Sidecar + finished parts stay: a later download resumes the set instead
  // of restarting gigabytes (same as single-file cancel keeping dest).
  safeEmitTo(job.emit, { modelId: job.modelId, rfilename: job.groupFile, state: 'cancelled', receivedBytes: job.doneBytes, totalBytes: job.totalBytes })
}

type PartOutcome = { status: 'done' | 'error' | 'paused' | 'cancelled'; received: number; error?: string }

/** Download one part, resolving on its terminal event. */
function downloadPartOnce(
  config: RuntimeConfigStore,
  userData: string,
  job: SetJob,
  part: SetPart,
  emit: Emit,
  root: string,
  aggregate: boolean,
): Promise<PartOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const done = (o: PartOutcome): void => {
      if (!settled) { settled = true; resolve(o) }
    }
    // Already complete on disk (resume / race): no transfer needed.
    if (partComplete(root, job.modelId, part.rfilename)) {
      done({ status: 'done', received: fileSizeOnDisk(root, job.modelId, part.rfilename) })
      return
    }
    const wrapped: Emit = (ev) => {
      if (ev.rfilename !== part.rfilename) return
      if (aggregate && (ev.state === 'started' || ev.state === 'progress' || ev.state === 'queued')) {
        safeEmitTo(emit, {
          modelId: job.modelId,
          rfilename: job.groupFile,
          state: ev.state,
          receivedBytes: job.doneBytes + ev.receivedBytes,
          totalBytes: job.totalBytes,
        })
      } else if (!aggregate) {
        safeEmitTo(emit, ev)
      }
      if (ev.state === 'done') done({ status: 'done', received: ev.receivedBytes })
      else if (ev.state === 'error') done({ status: 'error', received: 0, error: ev.error })
      else if (ev.state === 'paused') done({ status: 'paused', received: ev.receivedBytes })
      else if (ev.state === 'cancelled') done({ status: 'cancelled', received: ev.receivedBytes })
    }
    try {
      void startDownload(config, userData, job.modelId, part.rfilename, part.downloadUrl, wrapped).catch((e: unknown) => {
        done({ status: 'error', received: 0, error: e instanceof Error ? e.message : String(e) })
      })
    } catch (e) {
      done({ status: 'error', received: 0, error: e instanceof Error ? e.message : String(e) })
    }
  })
}

async function runSet(job: SetJob): Promise<void> {
  const { config, userData, emit, root } = job
  const gk = key(job.modelId, job.groupFile)
  const emitGroup = (state: DownloadState, received: number, error?: string): void => {
    safeEmitTo(emit, { modelId: job.modelId, rfilename: job.groupFile, state, receivedBytes: received, totalBytes: job.totalBytes, ...(error ? { error } : {}) })
  }
  // Resume: skip finished parts, crediting their bytes to the aggregate.
  job.doneBytes = 0
  let i = 0
  while (i < job.parts.length && partComplete(root, job.modelId, job.parts[i].rfilename)) {
    job.doneBytes += fileSizeOnDisk(root, job.modelId, job.parts[i].rfilename)
    i++
  }
  for (; i < job.parts.length; i++) {
    job.idx = i
    if (job.cancelled) { finishSetCancelled(job); return }
    if (job.paused) { emitGroup('paused', job.doneBytes); return }
    const part = job.parts[i]
    const res = await downloadPartOnce(config, userData, job, part, emit, root, true)
    if (res.status === 'done') {
      job.doneBytes += res.received
      continue
    }
    if (res.status === 'paused') { emitGroup('paused', job.doneBytes); return }
    if (res.status === 'cancelled') { finishSetCancelled(job); return }
    // error: sidecar stays so a later download resumes the set.
    sets.delete(gk)
    emitGroup('error', job.doneBytes, res.error ?? `part ${i + 1}/${job.parts.length} failed`)
    return
  }
  // Vision projector sidecar: own event row (retryable/cancellable alone); a
  // projector failure never fails the weights, which are complete here.
  if (job.companion && !partComplete(root, job.modelId, job.companion.rfilename)) {
    await downloadPartOnce(config, userData, job, job.companion, emit, root, false)
  }
  sets.delete(gk)
  emitGroup('done', job.doneBytes, undefined)
  // Re-emit with a concrete total when every byte was observed.
  if (job.totalBytes === null) {
    safeEmitTo(emit, { modelId: job.modelId, rfilename: job.groupFile, state: 'done', receivedBytes: job.doneBytes, totalBytes: job.doneBytes })
  }
}
