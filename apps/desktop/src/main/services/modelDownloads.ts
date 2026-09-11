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
import { downloadRowId, type DownloadRowStatus, type ModelRegistryRow, type RegistryInstallStatus } from '../config/RuntimeConfigStore'

export type LibrarySource = 'registry' | 'filesystem'

export interface LibraryEntry {
  name: string
  file: string
  sizeBytes: number
  path: string
  modifiedAt: number
  source: LibrarySource
  installStatus?: RegistryInstallStatus
  downloadStatus?: DownloadRowStatus
  runtimeId?: string | null
}

export type DownloadState = 'queued' | 'started' | 'progress' | 'paused' | 'done' | 'error' | 'cancelled'

export interface DownloadEvent {
  modelId: string
  rfilename: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number | null
  error?: string
  /** Measured transfer rate at emit time (bytes/sec). Absent when unknown. */
  speedBps?: number
  /** Estimated seconds remaining (from real measurements). Absent when unknown. */
  etaSeconds?: number
}

type Emit = (event: DownloadEvent) => void

/** Extra provenance recorded in the persistent registry (all optional). */
export interface DownloadMeta {
  revision?: string
  format?: string
  quantization?: string
  license?: string
  gated?: boolean
}

export const DEFAULT_REVISION = 'main'

function revisionOf(meta?: DownloadMeta): string {
  const r = (meta?.revision ?? DEFAULT_REVISION).trim().replace(/^\/+/, '').slice(0, 128)
  return r || DEFAULT_REVISION
}

function rowIdFor(modelId: string, rfilename: string, revision: string): string {
  return downloadRowId('huggingface', modelId, revision, rfilename)
}

/** Test fakes pass {getAppSetting} only — registry access degrades to null. */
function regOf(config: RuntimeConfigStore | undefined): Pick<RuntimeConfigStore, 'upsertDownloadRow' | 'getDownloadRow' | 'listDownloadRows' | 'updateDownloadRow' | 'removeDownloadRow' | 'removeDownloadRowsByDest' | 'upsertRegistryRow' | 'removeRegistryRowsByPath'> | null {
  if (!config) return null
  const c = config as unknown as Record<string, unknown>
  return typeof c['upsertDownloadRow'] === 'function' && typeof c['getDownloadRow'] === 'function' && typeof c['upsertRegistryRow'] === 'function'
    ? (config as unknown as Pick<RuntimeConfigStore, 'upsertDownloadRow' | 'getDownloadRow' | 'listDownloadRows' | 'updateDownloadRow' | 'removeDownloadRow' | 'removeDownloadRowsByDest' | 'upsertRegistryRow' | 'removeRegistryRowsByPath'>)
    : null
}

function isUnder(root: string, abs: string): boolean {
  const r = resolve(root)
  const a = resolve(abs)
  return a === r || a.startsWith(r + sep)
}

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

export function scanLibraryFiles(root: string): LibraryEntry[] {
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
            // Filesystem walk origin (registry enrichment happens downstream).
            source: 'filesystem',
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

export function scanLibrary(root: string, rows?: readonly ModelRegistryRow[]): LibraryEntry[] {
  const files = scanLibraryFiles(root)
  if (!rows || rows.length === 0) return files

  const byDisk = new Map(files.map((e) => [resolve(e.path), e] as const))
  const out: LibraryEntry[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (!row.localPath || !isUnder(root, row.localPath)) continue
    const key = resolve(row.localPath)
    if (seen.has(key)) continue
    seen.add(key)
    const disk = byDisk.get(key)
    out.push({
      name: row.displayName,
      file: row.rfilename,
      sizeBytes: disk?.sizeBytes ?? row.fileSizeBytes ?? 0,
      path: row.localPath,
      modifiedAt: disk?.modifiedAt ?? row.updatedAt,
      source: 'registry',
      installStatus: disk ? row.installStatus : 'missing',
      downloadStatus: row.downloadStatus,
      runtimeId: row.runtimeId,
    })
  }

  for (const file of files) {
    if (seen.has(resolve(file.path))) continue
    out.push(file)
  }

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

export function getActiveDownloads(config?: RuntimeConfigStore, userData?: string): Array<{ modelId: string; rfilename: string; state: DownloadState; receivedBytes?: number; totalBytes?: number | null }> {
  const out: Array<{ modelId: string; rfilename: string; state: DownloadState; receivedBytes?: number; totalBytes?: number | null }> = []
  const seen = new Set<string>()
  const push = (modelId: string, rfilename: string, state: DownloadState, extra?: { receivedBytes?: number; totalBytes?: number | null }): void => {
    const k = key(modelId, rfilename)
    if (seen.has(k)) return
    seen.add(k)
    out.push({ modelId, rfilename, state, ...extra })
  }
  const hidden = new Set<string>()
  for (const job of sets.values()) {
    for (const k of setPartKeys(job)) hidden.add(k)
    push(job.modelId, job.groupFile, job.paused ? 'paused' : 'progress', { receivedBytes: job.doneBytes, totalBytes: job.totalBytes })
  }
  // Individual set parts stay hidden: the group row carries the aggregate.
  for (const v of active.values()) {
    if (hidden.has(key(v.modelId, v.rfilename))) continue
    push(v.modelId, v.rfilename, 'progress')
  }
  for (const q of queue) {
    if (hidden.has(key(q.modelId, q.rfilename))) continue
    push(q.modelId, q.rfilename, 'queued')
  }
  for (const k of paused) {
    if (hidden.has(k)) continue
    const [modelId, rfilename] = k.split('\n')
    push(modelId as string, rfilename as string, 'paused')
  }
  // Persistent tail: paused/queued/failed rows survive restart (in-memory above
  // is empty after a reboot). Completed rows are NOT active — the registry +
  // filesystem answer "installed" instead.
  if (config && userData) {
    try {
      const reg = regOf(config)
      for (const row of reg?.listDownloadRows() ?? []) {
        if (row.status === 'completed') continue
        let st: DownloadState
        if (row.status === 'failed') st = 'error'
        else if (row.status === 'cancelled') st = 'cancelled'
        else if (row.status === 'downloading' || row.status === 'verifying') st = 'progress'
        else st = row.status // queued | paused
        push(row.repoId, row.rfilename, st, { receivedBytes: row.downloadedBytes, totalBytes: row.totalBytes })
      }
    } catch { /* registry unavailable — in-memory view only */ }
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
  /** Registry revision for the group row (Explorer pins 'main'). */
  revision: string
  /** Provenance captured at download time for the inventory row. */
  meta?: DownloadMeta
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

export function cancelDownload(modelId: string, rfilename: string, config?: RuntimeConfigStore, revision = DEFAULT_REVISION): boolean {
  const markCancelled = (): void => {
    try { regOf(config)?.updateDownloadRow(rowIdFor(modelId, rfilename, revision), { status: 'cancelled', error: null, speedBps: null }) } catch { /* best-effort */ }
  }
  const k = key(modelId, rfilename)
  const job = sets.get(k)
  if (job) {
    job.cancelled = true
    job.paused = false
    const cur = job.parts[Math.min(job.idx, job.parts.length - 1)]
    const entry = cur ? active.get(key(modelId, cur.rfilename)) : undefined
    if (entry) {
      try { entry.ctrl.abort() } catch { /* already settled */ }
      markCancelled()
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
    markCancelled()
    return true
  }
  // Also remove from queue if queued
  const qIdx = queue.findIndex((q) => q.modelId === modelId && q.rfilename === rfilename)
  if (qIdx >= 0) {
    queue.splice(qIdx, 1)
    markCancelled()
    return true
  }
  if (paused.has(k)) {
    paused.delete(k)
    // Delete .part on explicit cancel of paused item
    // Caller should provide config/userData to locate file, but we try best-effort via queued info
    markCancelled()
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
  emit: Emit,
  meta?: DownloadMeta
): boolean {
  const revision = revisionOf(meta)
  const k = key(modelId, rfilename)
  const markDownloading = (): void => {
    try { regOf(config)?.updateDownloadRow(rowIdFor(modelId, rfilename, revision), { status: 'downloading', error: null }) } catch { /* best-effort */ }
  }
  const job = sets.get(k)
  if (job) {
    // Resume a paused set from the first incomplete part.
    if (!job.paused || job.cancelled) return false
    job.paused = false
    for (const p of job.parts) paused.delete(key(modelId, p.rfilename))
    markDownloading()
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
        cancelled: false, paused: false, config, userData, emit, root, revision,
      }
      sets.set(k, rebuilt)
      markDownloading()
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
  markDownloading()
  // startDownload validates again and can reject — surface as an error event,
  // never an unhandled rejection (main-process crash dialog).
  void startDownload(config, userData, modelId, rfilename, downloadUrl, emit, meta).catch((e: unknown) => {
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

export function deleteLibraryEntry(root: string, entryPath: string, config?: RuntimeConfigStore): void {
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
  // Delete every associated artifact: partial, provenance + set sidecars.
  for (const suffix of ['.part', '.json', '.set.json']) {
    try {
      const sidecar = `${abs}${suffix}`
      if (existsSync(sidecar)) unlinkSync(sidecar)
    } catch { /* ignore */ }
  }
  // Drop the persistent lifecycle + inventory rows so the UI offers Download again.
  try {
    const reg = regOf(config)
    reg?.removeDownloadRowsByDest(abs)
    reg?.removeRegistryRowsByPath(abs)
  } catch { /* best-effort */ }
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
  emit: Emit,
  meta?: DownloadMeta
): Promise<{ ok: true; resumed: boolean; queued?: boolean }> {
  const cleanId = modelId.trim().slice(0, 128)
  const cleanFile = rfilename.trim().replace(/^\/+/, '').slice(0, 512)
  if (!cleanId || !cleanFile || cleanFile.includes('..')) throw new Error('invalid download target')
  const url = assertHuggingFaceUrl(downloadUrl)
  const revision = revisionOf(meta)
  const root = resolveLibraryDir(config, userData)
  const dest = confinePath(root, repoFolder(cleanId), cleanFile)
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const k = key(cleanId, cleanFile)
  if (active.has(k)) return { ok: true, resumed: true }
  if (queue.some((q) => q.modelId === cleanId && q.rfilename === cleanFile)) return { ok: true, resumed: true, queued: true }
  if (paused.has(k)) paused.delete(k)

  const reg = regOf(config)
  const rowId = rowIdFor(cleanId, cleanFile, revision)
  // Bytes already on disk: resume continues from here — the UI must show
  // 2.7/5.2 GB (≈52%), never a fake 0%.
  let existingBytes = 0
  try { if (existsSync(part)) existingBytes = statSync(part).size } catch { existingBytes = 0 }

  // Persisting wrapper: every lifecycle event lands in the registry so the
  // authoritative state survives restart. Speed/ETA come from real deltas.
  let lastMark = { t: Date.now(), bytes: existingBytes }
  const measure = (received: number): { speedBps?: number; etaSeconds?: number; totalForEta?: null } => {
    const now = Date.now()
    const dt = (now - lastMark.t) / 1000
    const db = received - lastMark.bytes
    lastMark = { t: now, bytes: received }
    if (!(dt > 0) || db < 0) return {}
    const speed = db / dt
    if (!(speed > 0)) return {}
    return { speedBps: Math.round(speed) }
  }
  const track = (ev: DownloadEvent): void => {
    try {
      if (ev.state === 'progress') {
        const m = measure(ev.receivedBytes)
        const withSpeed: DownloadEvent = { ...ev, ...m }
        if (m.speedBps && ev.totalBytes && ev.totalBytes > ev.receivedBytes) {
          withSpeed.etaSeconds = Math.round((ev.totalBytes - ev.receivedBytes) / m.speedBps)
        }
        reg?.updateDownloadRow(rowId, {
          status: 'downloading',
          downloadedBytes: ev.receivedBytes,
          ...(ev.totalBytes !== null ? { totalBytes: ev.totalBytes } : {}),
          ...(withSpeed.speedBps !== undefined ? { speedBps: withSpeed.speedBps } : {}),
          error: null,
        })
        safeEmitTo(emit, withSpeed)
      } else if (ev.state === 'done') {
        // Size verification before declaring victory: the file on disk must
        // match the observed total. No checksum exists upstream, so "complete
        // + size matches" is honestly reported as Downloaded (never Verified).
        reg?.updateDownloadRow(rowId, { status: 'verifying', downloadedBytes: ev.receivedBytes, ...(ev.totalBytes !== null ? { totalBytes: ev.totalBytes } : {}) })
        let okSize = true
        try {
          const st = statSync(dest)
          if (ev.totalBytes !== null && ev.totalBytes > 0) okSize = st.size === ev.totalBytes
          else okSize = st.size === ev.receivedBytes && st.size > 0
        } catch { okSize = false }
        if (okSize) {
          reg?.updateDownloadRow(rowId, { status: 'completed', downloadedBytes: ev.receivedBytes, ...(ev.totalBytes !== null ? { totalBytes: ev.totalBytes } : {}), error: null, speedBps: null })
          // Inventory row: size-verified local file, honestly imported (never Verified).
          try {
            let fileSize = 0
            try { fileSize = statSync(dest).size } catch { fileSize = 0 }
            reg?.upsertRegistryRow({
              id: rowId,
              sourceProvider: 'huggingface',
              repository: cleanId,
              revision,
              rfilename: cleanFile,
              localPath: dest,
              displayName: basename(dest).replace(/\.gguf$/i, ''),
              format: meta?.format ?? null,
              quantization: meta?.quantization ?? null,
              license: meta?.license ?? null,
              fileSizeBytes: fileSize > 0 ? fileSize : null,
              downloadStatus: 'completed',
              installStatus: 'installed',
            })
          } catch { /* best-effort */ }
          safeEmitTo(emit, ev)
        } else {
          const msg = 'Downloaded file failed size verification — resume to repair.'
          reg?.updateDownloadRow(rowId, { status: 'failed', error: msg, speedBps: null })
          safeEmitTo(emit, { ...ev, state: 'error', error: msg })
        }
      } else if (ev.state === 'error') {
        reg?.updateDownloadRow(rowId, { status: 'failed', downloadedBytes: ev.receivedBytes, error: ev.error ?? 'Download failed', speedBps: null })
        safeEmitTo(emit, ev)
      } else if (ev.state === 'paused') {
        reg?.updateDownloadRow(rowId, { status: 'paused', downloadedBytes: ev.receivedBytes, speedBps: null })
        safeEmitTo(emit, ev)
      } else if (ev.state === 'cancelled') {
        reg?.updateDownloadRow(rowId, { status: 'cancelled', error: null, speedBps: null })
        safeEmitTo(emit, ev)
      } else {
        safeEmitTo(emit, ev)
      }
    } catch {
      safeEmitTo(emit, ev)
    }
  }

  if (active.size >= MAX_CONCURRENT) {
    queue.push({ modelId: cleanId, rfilename: cleanFile, downloadUrl: url.toString(), config, userData, emit })
    try {
      reg?.upsertDownloadRow({
        id: rowId, provider: 'huggingface', repoId: cleanId, revision, rfilename: cleanFile,
        downloadUrl: url.toString(), destPath: dest, tempPath: part,
        totalBytes: null, downloadedBytes: existingBytes, status: 'queued', kind: 'single',
        parts: null, companion: null,
        format: meta?.format ?? null, quantization: meta?.quantization ?? null,
        license: meta?.license ?? null, gated: meta?.gated === undefined ? null : (meta.gated ? 1 : 0),
        error: null, speedBps: null,
      })
    } catch { /* best-effort */ }
    safeEmitTo(emit, { modelId: cleanId, rfilename: cleanFile, state: 'queued', receivedBytes: existingBytes, totalBytes: null })
    return { ok: true, resumed: false, queued: true }
  }

  try {
    reg?.upsertDownloadRow({
      id: rowId, provider: 'huggingface', repoId: cleanId, revision, rfilename: cleanFile,
      downloadUrl: url.toString(), destPath: dest, tempPath: part,
      totalBytes: null, downloadedBytes: existingBytes, status: 'downloading', kind: 'single',
      parts: null, companion: null,
      format: meta?.format ?? null, quantization: meta?.quantization ?? null,
      license: meta?.license ?? null, gated: meta?.gated === undefined ? null : (meta.gated ? 1 : 0),
      error: null, speedBps: null,
    })
  } catch { /* best-effort */ }

  const ctrl = new AbortController()
  active.set(k, { ctrl, modelId: cleanId, rfilename: cleanFile, downloadUrl: url.toString() })
  const base = { modelId: cleanId, rfilename: cleanFile }
  safeEmitTo(emit, { ...base, state: 'started', receivedBytes: existingBytes, totalBytes: null })

  const run = async (): Promise<void> => {
    // Nothing inside run() may ever escape: every emit is guarded and the
    // whole body is covered, so pause/cancel aborts can only surface as
    // paused/cancelled/error EVENTS — never an uncaught main-process error.
    // All terminal/progress events go through track() so the persistent
    // registry mirrors the transfer byte-for-byte.
    const safeEmit: Emit = (event) => track(event)
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
      track({ ...base, state: 'progress', receivedBytes: received, totalBytes: total })
      const out = createWriteStream(part, { flags: startAt > 0 ? 'a' : 'w' })
      let lastEmit = 0
      const source = Readable.fromWeb(res.body as import('stream/web').ReadableStream)
      // Pause/cancel must propagate even if the response body ignores the
      // request abort (stalled servers, non-standard runtimes): destroying
      // the source rejects the pipeline below, which can only surface as a
      // paused/cancelled event — never a hang, never a fake completion.
      const onAbortDestroy = (): void => {
        try { source.destroy(new Error('cancelled')) } catch { /* already settled */ }
      }
      if (ctrl.signal.aborted) onAbortDestroy()
      else ctrl.signal.addEventListener('abort', onAbortDestroy, { once: true })
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
      try { ctrl.signal.removeEventListener('abort', onAbortDestroy) } catch { /* ignore */ }
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
  meta?: DownloadMeta
): Promise<{ ok: true; resumed: boolean }> {
  const cleanId = modelId.trim().slice(0, 128)
  if (!cleanId) throw new Error('invalid download target')
  if (!Array.isArray(parts) || parts.length < 2 || parts.length > 8) throw new Error('invalid shard set')
  const revision = revisionOf(meta)
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
  // Bytes already on disk across finished parts — resume starts here, not 0.
  let existingBytes = 0
  for (const p of cleanParts) {
    if (partComplete(root, cleanId, p.rfilename)) existingBytes += fileSizeOnDisk(root, cleanId, p.rfilename)
  }
  const reg = regOf(config)
  try {
    const groupDest = partDest(root, cleanId, groupFile)
    reg?.upsertDownloadRow({
      id: rowIdFor(cleanId, groupFile, revision), provider: 'huggingface', repoId: cleanId, revision,
      rfilename: groupFile, downloadUrl: cleanParts[0].downloadUrl, destPath: groupDest, tempPath: `${groupDest}.part`,
      totalBytes: total, downloadedBytes: existingBytes, status: 'downloading', kind: 'set',
      parts: JSON.stringify(cleanParts), companion: cleanCompanion ? JSON.stringify(cleanCompanion) : null,
      format: meta?.format ?? null, quantization: meta?.quantization ?? null,
      license: meta?.license ?? null, gated: meta?.gated === undefined ? null : (meta.gated ? 1 : 0),
      error: null, speedBps: null,
    })
  } catch { /* best-effort */ }
  const job: SetJob = { modelId: cleanId, groupFile, parts: cleanParts, companion: cleanCompanion, idx: 0, doneBytes: 0, totalBytes: total, cancelled: false, paused: false, config, userData, emit, root, revision, meta }
  sets.set(gk, job)
  persistSetRow(job, 'downloading', existingBytes, null)
  safeEmitTo(emit, { modelId: cleanId, rfilename: groupFile, state: 'started', receivedBytes: existingBytes, totalBytes: total })
  void runSet(job).catch(() => {})
  return { ok: true, resumed: false }
}

/** Persist the shard-set group row (aggregate bytes across parts). */
function persistSetRow(job: SetJob, status: DownloadRowStatus, received: number, error: string | null): void {
  try {
    regOf(job.config)?.updateDownloadRow(rowIdFor(job.modelId, job.groupFile, job.revision), {
      status, downloadedBytes: received,
      ...(job.totalBytes !== null ? { totalBytes: job.totalBytes } : {}),
      error, speedBps: null,
    })
  } catch { /* best-effort */ }
}

function finishSetCancelled(job: SetJob): void {
  sets.delete(key(job.modelId, job.groupFile))
  persistSetRow(job, 'cancelled', job.doneBytes, null)
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
        const agg = job.doneBytes + ev.receivedBytes
        persistSetRow(job, 'downloading', agg, null)
        safeEmitTo(emit, {
          modelId: job.modelId,
          rfilename: job.groupFile,
          state: ev.state,
          receivedBytes: agg,
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
    if (state === 'progress' || state === 'started') persistSetRow(job, 'downloading', received, null)
    else if (state === 'paused') persistSetRow(job, 'paused', received, null)
    else if (state === 'cancelled') persistSetRow(job, 'cancelled', received, null)
    else if (state === 'error') persistSetRow(job, 'failed', received, error ?? null)
    safeEmitTo(emit, { modelId: job.modelId, rfilename: job.groupFile, state, receivedBytes: received, totalBytes: job.totalBytes, ...(error ? { error } : {}) })
  }
  // Resume: skip finished parts, crediting their bytes to the aggregate.
  job.doneBytes = 0
  let i = 0
  while (i < job.parts.length && partComplete(root, job.modelId, job.parts[i].rfilename)) {
    job.doneBytes += fileSizeOnDisk(root, job.modelId, job.parts[i].rfilename)
    i++
  }
  persistSetRow(job, 'downloading', job.doneBytes, null)
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
  // Verify EVERY part on disk before declaring the set complete.
  const allPresent = job.parts.every((p) => partComplete(root, job.modelId, p.rfilename))
  if (!allPresent) {
    emitGroup('error', job.doneBytes, 'Shard set incomplete — resume to fetch the missing parts.')
    return
  }
  persistSetRow(job, 'completed', job.doneBytes, null)
  // Inventory row: every part verified on disk → group's first part is the
  // library's honest handle (shard files join on the same repo folder).
  try {
    const groupDest = partDest(root, job.modelId, job.groupFile)
    let fileSize = 0
    try { fileSize = statSync(groupDest).size } catch { fileSize = 0 }
    regOf(job.config)?.upsertRegistryRow({
      id: rowIdFor(job.modelId, job.groupFile, job.revision),
      sourceProvider: 'huggingface',
      repository: job.modelId,
      revision: job.revision,
      rfilename: job.groupFile,
      localPath: groupDest,
      displayName: basename(groupDest).replace(/\.gguf$/i, ''),
      format: job.meta?.format ?? null,
      quantization: job.meta?.quantization ?? null,
      license: job.meta?.license ?? null,
      fileSizeBytes: fileSize > 0 ? fileSize : null,
      downloadStatus: 'completed',
      installStatus: 'installed',
    })
  } catch { /* best-effort */ }
  emitGroupDone(job)
  // Re-emit with a concrete total when every byte was observed.
  if (job.totalBytes === null) {
    safeEmitTo(emit, { modelId: job.modelId, rfilename: job.groupFile, state: 'done', receivedBytes: job.doneBytes, totalBytes: job.doneBytes })
  }
}

// ── Persistent installed-state oracle ────────────────────────────────
// Identity is provider + repo + revision + rfilename (never bare basename:
// repoA/model-Q4_K_M.gguf and repoB/model-Q4_K_M.gguf are different rows in
// different folders). Filesystem is the truth for "complete"; the registry
// is the truth for lifecycle/progress.

export type FileState = 'downloaded' | 'partial' | 'paused' | 'queued' | 'downloading' | 'failed' | 'missing'

export interface FileStatus {
  state: FileState
  downloadedBytes: number
  totalBytes: number | null
  /** Absolute dest path when resolvable (for open-folder). */
  destPath?: string
  error?: string
  partsPresent?: number
  partsTotal?: number
  companionMissing?: boolean
  /** 'registry' = tracked row; 'filesystem' = complete file, no row (adopted on reconcile). */
  source: 'registry' | 'filesystem' | 'none'
}

function parsePartsJson(raw: string | null): SetPart[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((p): p is SetPart => Boolean(p) && typeof (p as SetPart).rfilename === 'string' && typeof (p as SetPart).downloadUrl === 'string')
  } catch { return [] }
}

function parseCompanionJson(raw: string | null): SetPart | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as SetPart
    return v && typeof v.rfilename === 'string' && typeof v.downloadUrl === 'string' ? v : null
  } catch { return null }
}

function partFileSize(root: string, modelId: string, rfilename: string): number {
  try {
    const dest = partDest(root, modelId, rfilename)
    if (existsSync(dest)) return statSync(dest).size
    if (existsSync(`${dest}.part`)) return statSync(`${dest}.part`).size
  } catch { /* ignore */ }
  return 0
}

/**
 * Exact per-variant status for Explorer: does THIS repo+revision+file exist,
 * is it partial, paused, failed, or missing? Survives restart (registry +
 * filesystem, never React state).
 */
export function getFileStatus(
  config: RuntimeConfigStore,
  userData: string,
  modelId: string,
  rfilename: string,
  revision = DEFAULT_REVISION,
): FileStatus {
  const cleanId = modelId.trim().slice(0, 128)
  const cleanFile = rfilename.trim().replace(/^\/+/, '').slice(0, 512)
  const root = resolveLibraryDir(config, userData)
  const reg = regOf(config)
  const row = reg?.getDownloadRow(rowIdFor(cleanId, cleanFile, revision)) ?? null
  const k = key(cleanId, cleanFile)

  // Live in-memory jobs win over stored rows (same process, mid-transfer).
  if (sets.has(k) || active.has(k)) {
    const job = sets.get(k)
    if (job) {
      let present = 0
      for (const p of job.parts) if (partComplete(root, job.modelId, p.rfilename)) present++
      const total = job.totalBytes
      if (present === job.parts.length) {
        return { state: 'downloaded', downloadedBytes: job.doneBytes, totalBytes: total, destPath: safeDest(root, cleanId, cleanFile), source: 'registry' }
      }
      return {
        state: job.paused ? 'paused' : 'downloading',
        downloadedBytes: job.doneBytes, totalBytes: total,
        partsPresent: present, partsTotal: job.parts.length, source: 'registry',
      }
    }
    return { state: paused.has(k) ? 'paused' : 'downloading', downloadedBytes: 0, totalBytes: null, source: 'registry' }
  }

  // Shard-set group row (or restart sidecar): complete only when EVERY part
  // is present — 2/3 shards is Partial + Resume, never Downloaded.
  const setParts = row?.kind === 'set' ? parsePartsJson(row.parts) : []
  const sidecar = !row && setParts.length === 0 ? readSetSidecar(root, cleanId, cleanFile) : null
  const parts = setParts.length > 0 ? setParts : (sidecar?.parts ?? [])
  if (parts.length >= 2) {
    let present = 0
    let bytes = 0
    for (const p of parts) {
      if (partComplete(root, cleanId, p.rfilename)) { present++; bytes += partFileSize(root, cleanId, p.rfilename) }
    }
    const total = row?.totalBytes ?? setTotalBytes(parts.map((p) => ({ ...p, sizeBytes: typeof p.sizeBytes === 'number' ? p.sizeBytes : 0 })))
    if (present === parts.length) {
      return { state: 'downloaded', downloadedBytes: bytes, totalBytes: total, destPath: safeDest(root, cleanId, cleanFile), partsPresent: present, partsTotal: parts.length, source: row ? 'registry' : 'filesystem' }
    }
    if (row?.status === 'failed') return { state: 'failed', downloadedBytes: bytes, totalBytes: total, error: row.error ?? 'Download failed', partsPresent: present, partsTotal: parts.length, source: 'registry' }
    if (present > 0 || row?.status === 'paused' || row?.status === 'queued' || row?.status === 'downloading') {
      return { state: row?.status === 'paused' ? 'paused' : 'partial', downloadedBytes: bytes, totalBytes: total, partsPresent: present, partsTotal: parts.length, source: 'registry' }
    }
    return { state: 'missing', downloadedBytes: 0, totalBytes: total, partsPresent: 0, partsTotal: parts.length, source: 'none' }
  }

  // Single file.
  let dest: string | null = null
  try { dest = partDest(root, cleanId, cleanFile) } catch { dest = null }
  const complete = dest !== null && existsSync(dest) && !existsSync(`${dest}.part`)
  const partBytes = dest !== null && existsSync(`${dest}.part`) ? partFileSize(root, cleanId, cleanFile) : 0
  const companion = row ? parseCompanionJson(row.companion) : null
  const companionMissing = companion ? !partComplete(root, cleanId, companion.rfilename) : false

  if (complete) {
    if (companionMissing) {
      return { state: 'partial', downloadedBytes: dest ? statSize(dest) : 0, totalBytes: row?.totalBytes ?? null, destPath: dest ?? undefined, companionMissing: true, source: row ? 'registry' : 'filesystem' }
    }
    return { state: 'downloaded', downloadedBytes: dest ? statSize(dest) : (row?.downloadedBytes ?? 0), totalBytes: row?.totalBytes ?? null, destPath: dest ?? undefined, source: row ? 'registry' : 'filesystem' }
  }
  if (partBytes > 0 || row?.status === 'paused' || row?.status === 'queued' || row?.status === 'downloading' || row?.status === 'verifying') {
    if (row?.status === 'failed') return { state: 'failed', downloadedBytes: partBytes, totalBytes: row.totalBytes, error: row.error ?? 'Download failed', destPath: dest ?? undefined, source: 'registry' }
    return { state: row?.status === 'paused' ? 'paused' : row?.status === 'queued' ? 'queued' : 'partial', downloadedBytes: partBytes || row?.downloadedBytes || 0, totalBytes: row?.totalBytes ?? null, destPath: dest ?? undefined, source: 'registry' }
  }
  if (row?.status === 'failed') return { state: 'failed', downloadedBytes: 0, totalBytes: row.totalBytes, error: row.error ?? 'Download failed', source: 'registry' }
  if (row?.status === 'cancelled') return { state: 'missing', downloadedBytes: 0, totalBytes: row.totalBytes, source: 'registry' }
  return { state: 'missing', downloadedBytes: 0, totalBytes: row?.totalBytes ?? null, source: row ? 'registry' : 'none' }
}

function safeDest(root: string, modelId: string, rfilename: string): string | undefined {
  try { return partDest(root, modelId, rfilename) } catch { return undefined }
}

function statSize(abs: string): number {
  try { return statSync(abs).size } catch { return 0 }
}

// ── Filesystem ↔ registry reconciliation ─────────────────────────────
// Run at startup and when Explorer/Library becomes active. Filesystem wins
// for "complete"; the registry is repaired to match, never the reverse.

export interface ReconcileReport {
  checked: number
  fixed: number
  adopted: number
  /** Complete files with no registry row and no provenance sidecar. */
  unregistered: string[]
  /** .part files with no usable metadata (cannot be safely resumed). */
  orphanPartials: string[]
  /** Registry rows whose files vanished. */
  missing: string[]
}

export function reconcileLibrary(config: RuntimeConfigStore, userData: string): ReconcileReport {
  const report: ReconcileReport = { checked: 0, fixed: 0, adopted: 0, unregistered: [], orphanPartials: [], missing: [] }
  const root = resolveLibraryDir(config, userData)
  const reg = regOf(config)
  if (!reg) return report
  const rows = reg.listDownloadRows()
  const byDest = new Map<string, string>()
  for (const r of rows) byDest.set(resolve(r.destPath), r.id)

  // 1. Repair rows from disk truth.
  for (const row of rows) {
    report.checked++
    if (row.kind === 'set') {
      const parts = parsePartsJson(row.parts)
      if (parts.length < 2) continue
      const present = parts.filter((p) => partComplete(root, row.repoId, p.rfilename))
      if (present.length === parts.length && row.status !== 'completed') {
        reg.updateDownloadRow(row.id, { status: 'completed', error: null })
        report.fixed++
      } else if (present.length === 0 && (row.status === 'completed' || row.status === 'downloading' || row.status === 'paused' || row.status === 'queued')) {
        reg.updateDownloadRow(row.id, { status: 'failed', error: 'Files missing on disk' })
        report.fixed++
        report.missing.push(`${row.repoId}/${row.rfilename}`)
      } else if (present.length > 0 && present.length < parts.length && row.status === 'completed') {
        reg.updateDownloadRow(row.id, { status: 'paused', error: null })
        report.fixed++
      }
      continue
    }
    let destExists = false
    let partExists = false
    try { destExists = existsSync(row.destPath) && !existsSync(`${row.destPath}.part`) } catch { destExists = false }
    try { partExists = existsSync(`${row.destPath}.part`) } catch { partExists = false }
    if (destExists && row.status !== 'completed') {
      let size = 0
      try { size = statSync(row.destPath).size } catch { size = row.downloadedBytes }
      reg.updateDownloadRow(row.id, { status: 'completed', downloadedBytes: size, error: null })
      report.fixed++
    } else if (!destExists && !partExists && (row.status === 'completed' || row.status === 'downloading' || row.status === 'paused' || row.status === 'queued' || row.status === 'verifying')) {
      reg.updateDownloadRow(row.id, { status: 'failed', error: 'File missing on disk' })
      report.fixed++
      report.missing.push(`${row.repoId}/${row.rfilename}`)
    } else if (partExists && row.status === 'completed') {
      let size = 0
      try { size = statSync(`${row.destPath}.part`).size } catch { size = 0 }
      reg.updateDownloadRow(row.id, { status: 'paused', downloadedBytes: size })
      report.fixed++
    }
  }

  // 2. Adopt complete files that predate the registry (provenance sidecar) or
  //    list the rest as unregistered — never blindly verified.
  interface SidecarMeta { modelId?: string; rfilename?: string; downloadUrl?: string; sizeBytes?: number }
  for (const entry of scanLibraryFiles(root)) {
    if (byDest.has(resolve(entry.path))) continue
    const sidecar = `${entry.path}.json`
    let meta: SidecarMeta | null = null
    try {
      if (existsSync(sidecar)) meta = JSON.parse(readFileSync(sidecar, 'utf8')) as SidecarMeta
    } catch { meta = null }
    if (meta?.modelId && meta?.downloadUrl) {
      const rfilename = typeof meta.rfilename === 'string' && meta.rfilename ? meta.rfilename : entry.file
      try {
        reg.upsertDownloadRow({
          id: rowIdFor(meta.modelId, rfilename, DEFAULT_REVISION), provider: 'huggingface',
          repoId: meta.modelId, revision: DEFAULT_REVISION, rfilename,
          downloadUrl: meta.downloadUrl, destPath: entry.path, tempPath: `${entry.path}.part`,
          totalBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : entry.sizeBytes,
          downloadedBytes: entry.sizeBytes, status: 'completed', kind: 'single',
          parts: null, companion: null, format: null, quantization: null,
          license: null, gated: null, error: null, speedBps: null,
        })
        reg.upsertRegistryRow({
          id: rowIdFor(meta.modelId, rfilename, DEFAULT_REVISION),
          sourceProvider: 'huggingface',
          repository: meta.modelId,
          revision: DEFAULT_REVISION,
          rfilename,
          localPath: entry.path,
          displayName: entry.file,
          fileSizeBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : entry.sizeBytes,
          downloadStatus: 'completed',
          installStatus: 'installed',
        })
        report.adopted++
      } catch { report.unregistered.push(entry.path) }
    } else {
      report.unregistered.push(entry.path)
    }
  }

  // 3. Orphan .part files (no row, no sidecar context) — resumable only with metadata.
  try {
    const walk = (dir: string): void => {
      let entries: Array<{ name: string; isDirectory(): boolean }>
      try {
        entries = readdirSync(dir, { withFileTypes: true }) as unknown as Array<{ name: string; isDirectory(): boolean }>
      } catch { return }
      for (const ent of entries) {
        const full = join(dir, ent.name)
        if (ent.isDirectory()) { walk(full); continue }
        if (!full.toLowerCase().endsWith('.part')) continue
        const dest = full.slice(0, -'.part'.length)
        if (byDest.has(resolve(dest))) continue
        report.orphanPartials.push(full)
      }
    }
    if (existsSync(root)) walk(root)
  } catch { /* best-effort */ }
  return report
}

/**
 * Resolve the trusted on-disk folder for open-folder. The stored registry
 * path wins when it is still under the managed root; otherwise the path is
 * rebuilt from repo+file and confined. Never trusts renderer text.
 */
export function resolveModelFolder(config: RuntimeConfigStore, userData: string, modelId: string, rfilename: string, revision = DEFAULT_REVISION): string {
  const root = resolveLibraryDir(config, userData)
  const row = regOf(config)?.getDownloadRow(rowIdFor(modelId, rfilename, revision)) ?? null
  let dest: string | null = null
  if (row && isUnder(root, row.destPath)) dest = row.destPath
  if (!dest) dest = partDest(root, modelId.trim().slice(0, 128), rfilename.trim().replace(/^\/+/, '').slice(0, 512))
  if (!existsSync(dest) && !existsSync(`${dest}.part`)) {
    throw new Error('model file not found — it may have been moved or deleted')
  }
  return dirname(dest)
}

/** Terminal done emit for a verified set (persisted as completed first). */
function emitGroupDone(job: SetJob): void {
  safeEmitTo(job.emit, { modelId: job.modelId, rfilename: job.groupFile, state: 'done', receivedBytes: job.doneBytes, totalBytes: job.totalBytes })
}
