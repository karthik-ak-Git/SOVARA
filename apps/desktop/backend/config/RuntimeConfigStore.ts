/**
 * Commit 6 — configuration boundary for local model runtimes.
 *
 * Single approved place for runtime endpoint strings + active-model
 * selection. Backed by the existing SovaraDb file (WAL, single-writer in
 * Main): a lazily-created `model_runtimes` table plus `app_meta` keys.
 * Schema version is untouched on purpose — the table is idempotent and
 * existing DBs migrate by simply existing.
 *
 * Secrets: none stored here (local runtimes need no API keys by design).
 */
import { z } from 'zod'
import { SovaraDb } from '../storage/db'
import type { ModelRuntimeEntry, RuntimeType } from '@shared/types/models'

const RUNTIME_TYPES: RuntimeType[] = ['openai-compatible', 'ollama', 'lmstudio', 'vllm', 'llama.cpp', 'custom']

const zRuntimeRow = z.object({
  id: z.string(),
  displayName: z.string(),
  type: z.enum(RUNTIME_TYPES as [RuntimeType, ...RuntimeType[]]),
  endpoint: z.string(),
  enabled: z.number().int().min(0).max(1),
  timeoutMs: z.number().int(),
  lastModels: z.string().nullable(),
  lastSeenAt: z.number().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.number(),
})

export interface RuntimeSnapshot {
  entry: ModelRuntimeEntry
  /** Last discovery snapshot (bounded at write). Empty until first probe. */
  lastModels: Array<{ modelId: string; displayName: string; contextLength?: number }>
  lastSeenAt: number | null
  lastError: string | null
}

/**
 * Persistent download lifecycle (Explorer → model library).
 *
 * One row per downloadable artifact identity:
 *   provider + repo + revision + rfilename  (NOT bare filename — two repos
 *   may ship the same basename).
 * Shard sets are ONE group row (kind='set', parts JSON); vision projectors
 * ride in `companion` JSON. Filesystem stays the truth for "installed", this
 * table is the truth for lifecycle/progress so pause/queue survive restart.
 */
export type DownloadRowStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'verifying'

export interface DownloadRow {
  id: string
  provider: string
  repoId: string
  revision: string
  rfilename: string
  downloadUrl: string
  destPath: string
  tempPath: string
  totalBytes: number | null
  downloadedBytes: number
  status: DownloadRowStatus
  /** 'single' file or 'set' (sharded GGUF group row). */
  kind: 'single' | 'set'
  /** JSON array of {rfilename, downloadUrl, sizeBytes} for kind='set'. */
  parts: string | null
  /** JSON {rfilename, downloadUrl, sizeBytes} vision sidecar, if any. */
  companion: string | null
  format: string | null
  quantization: string | null
  license: string | null
  gated: number | null
  error: string | null
  speedBps: number | null
  createdAt: number
  updatedAt: number
}

/** Stable identity: provider + repo + revision + file (all lowercased). */
export function downloadRowId(provider: string, repoId: string, revision: string, rfilename: string): string {
  const clean = (s: string): string => s.trim().toLowerCase().slice(0, 512)
  return `${clean(provider)}|${clean(repoId)}|${clean(revision || 'main')}|${clean(rfilename).replace(/^\/+/, '')}`
}

/** Installation truth for a library model: file present, gone, or only
 *  discovered on disk (no download sidecar). */
export type RegistryInstallStatus = 'installed' | 'missing' | 'unregistered'

/**
 * One model in the Library inventory (model_registry).
 *
 * Shares the SAME stable id as its model_downloads row
 * (`downloadRowId(provider | repo | revision | rfilename)`), so Explorer and
 * Library operate on one shared identity per artifact. Unlike download rows
 * (which are the truth for transfer lifecycle/progress), a registry row is
 * the truth for the installed artifact: resolved disk path, weight format,
 * source provider, architecture, and any runtime association.
 *
 * `source_provider` is the SOURCE (huggingface, ...) and must never be
 * confused with the runtime family — runtime association lives only in
 * `runtime_id`, which points at model_runtimes.id.
 */
export interface ModelRegistryRow {
  id: string
  /** Model SOURCE, never a runtime family. */
  sourceProvider: string
  /** org/repo on the source. */
  repository: string
  revision: string
  /** Repo-relative path of the weight file. */
  rfilename: string
  /** Weight format: gguf | safetensors | other. */
  format: string | null
  quantization: string | null
  /** Architecture family: llama, qwen3, gemma, mistral, ... */
  architecture: string | null
  /** Human shorthand: 7B, 27B, 70B, ... */
  parameterCount: string | null
  contextLength: number | null
  license: string | null
  /** Absolute path of the weight file on disk (resolved, never renderer text). */
  localPath: string
  fileSizeBytes: number | null
  /** Verified SHA-256 when known; null until verified. */
  checksum: string | null
  downloadStatus: DownloadRowStatus
  installStatus: RegistryInstallStatus
  /** Associated runtime (model_runtimes.id) when a runtime exposes it. */
  runtimeId: string | null
  displayName: string
  discoveredAt: number
  updatedAt: number
  /** Bounded JSON extras: capabilities[], tags[], sourceRepo, baseModel. */
  extraJson: string | null
}

const MAX_SNAPSHOT_MODELS = 200

export class RuntimeConfigStore {
  private readonly db: SovaraDb

  constructor(baseDir?: string) {
    this.db = new SovaraDb(baseDir)
    this.db.raw.exec(`
      CREATE TABLE IF NOT EXISTS model_runtimes (
        id TEXT PRIMARY KEY,
        displayName TEXT NOT NULL,
        type TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        timeoutMs INTEGER NOT NULL DEFAULT 8000,
        lastModels TEXT,
        lastSeenAt INTEGER,
        lastError TEXT,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_downloads (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'huggingface',
        repo_id TEXT NOT NULL,
        revision TEXT NOT NULL DEFAULT 'main',
        rfilename TEXT NOT NULL,
        download_url TEXT NOT NULL,
        dest_path TEXT NOT NULL,
        temp_path TEXT NOT NULL,
        total_bytes INTEGER,
        downloaded_bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        kind TEXT NOT NULL DEFAULT 'single',
        parts TEXT,
        companion TEXT,
        format TEXT,
        quantization TEXT,
        license TEXT,
        gated INTEGER,
        error TEXT,
        speed_bps REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_downloads_repo ON model_downloads(repo_id, revision);
      CREATE INDEX IF NOT EXISTS idx_model_downloads_status ON model_downloads(status);
      CREATE TABLE IF NOT EXISTS model_registry (
        id                  TEXT PRIMARY KEY,
        source_provider     TEXT NOT NULL,
        repository          TEXT NOT NULL,
        revision            TEXT NOT NULL DEFAULT 'main',
        rfilename           TEXT NOT NULL,
        format              TEXT,
        quantization        TEXT,
        architecture        TEXT,
        parameter_count     TEXT,
        context_length      INTEGER,
        license             TEXT,
        local_path          TEXT NOT NULL,
        file_size_bytes     INTEGER,
        checksum            TEXT,
        download_status     TEXT NOT NULL DEFAULT 'completed',
        installation_status TEXT NOT NULL DEFAULT 'installed',
        runtime_id          TEXT,
        display_name        TEXT NOT NULL,
        discovered_at       INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL,
        extra_json          TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_model_registry_runtime ON model_registry(runtime_id);
      CREATE INDEX IF NOT EXISTS idx_model_registry_path ON model_registry(local_path);
    `)
    // Restart recovery: an interrupted transfer is resumable, never auto-run.
    // downloading/verifying → paused (bytes kept in .part); queued stays queued.
    try {
      this.db.raw.exec(`UPDATE model_downloads SET status = 'paused', updated_at = ${Date.now()} WHERE status IN ('downloading', 'verifying')`)
    } catch {
      // best-effort — table may be locked mid-migration
    }
  }

  listRuntimes(): ModelRuntimeEntry[] {
    const rows = this.db.raw.prepare('SELECT * FROM model_runtimes ORDER BY updatedAt DESC, id DESC').all() as unknown[]
    const out: ModelRuntimeEntry[] = []
    for (const r of rows) {
      const parsed = zRuntimeRow.safeParse(r)
      if (!parsed.success) continue // never surface a corrupt row
      out.push({
        id: parsed.data.id,
        displayName: parsed.data.displayName,
        type: parsed.data.type,
        endpoint: parsed.data.endpoint,
        enabled: parsed.data.enabled === 1,
        timeoutMs: parsed.data.timeoutMs,
      })
    }
    return out
  }

  getRuntime(id: string): RuntimeSnapshot | null {
    const row = this.db.raw.prepare('SELECT * FROM model_runtimes WHERE id = ?').get(id) as unknown
    const parsed = zRuntimeRow.safeParse(row ?? null)
    if (!parsed.success || row === undefined || row === null) return null
    return this.toSnapshot(parsed.data)
  }

  upsertRuntime(entry: ModelRuntimeEntry): void {
    const now = Date.now()
    this.db.raw
      .prepare(
        `INSERT INTO model_runtimes (id, displayName, type, endpoint, enabled, timeoutMs, lastModels, lastSeenAt, lastError, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET displayName=excluded.displayName, type=excluded.type,
           endpoint=excluded.endpoint, enabled=excluded.enabled, timeoutMs=excluded.timeoutMs, updatedAt=excluded.updatedAt`
      )
      .run(entry.id, entry.displayName, entry.type, entry.endpoint, entry.enabled ? 1 : 0, entry.timeoutMs, null, null, null, now)
  }

  removeRuntime(id: string): boolean {
    const r = this.db.raw.prepare('DELETE FROM model_runtimes WHERE id = ?').run(id)
    const changes = (r as unknown as { changes: number }).changes ?? 0
    if (changes > 0 && this.getActiveSelection()?.runtimeId === id) {
      // Dropping the selected runtime clears the selection — never re-pick.
      this.clearActiveSelection()
    }
    return changes > 0
  }

  saveProbeSnapshot(
    id: string,
    models: Array<{ modelId: string; displayName: string; contextLength?: number }>,
    error: string | null
  ): void {
    const bounded = models.slice(0, MAX_SNAPSHOT_MODELS).map((m) => ({
      modelId: String(m.modelId).slice(0, 256),
      displayName: String(m.displayName).slice(0, 256),
      ...(typeof m.contextLength === 'number' && Number.isFinite(m.contextLength) ? { contextLength: Math.floor(m.contextLength) } : {}),
    }))
    const now = Date.now()
    this.db.raw
      .prepare('UPDATE model_runtimes SET lastModels = ?, lastSeenAt = ?, lastError = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(bounded), now, error, now, id)
  }

  getActiveSelection(): { runtimeId: string; modelId: string } | null {
    const raw = this.db.getMeta('active_model')
    if (!raw) return null
    try {
      const v = JSON.parse(raw) as unknown
      if (v !== null && typeof v === 'object') {
        const o = v as Record<string, unknown>
        if (typeof o['runtimeId'] === 'string' && typeof o['modelId'] === 'string') {
          return { runtimeId: o['runtimeId'], modelId: o['modelId'] }
        }
      }
    } catch {
      // corrupt selection reads as none
    }
    return null
  }

  setActiveSelection(sel: { runtimeId: string; modelId: string }): void {
    this.db.setMeta('active_model', JSON.stringify(sel))
  }

  clearActiveSelection(): void {
    this.db.setMeta('active_model', JSON.stringify(null))
  }

  getExecMode(): string {
    const raw = this.db.getMeta('exec_mode')
    return raw ?? 'ask'
  }

  setExecMode(mode: string): void {
    this.db.setMeta('exec_mode', mode)
  }

  /** Generic persisted app setting (General section and friends). Null when unset. */
  getAppSetting(key: string): string | null {
    return this.db.getMeta(key) ?? null
  }

  // ── Persistent download registry (Explorer lifecycle) ──
  // Thin wrappers over model_downloads; callers own identity + paths.

  upsertDownloadRow(row: Omit<DownloadRow, 'createdAt' | 'updatedAt'> & { createdAt?: number; updatedAt?: number }): void {
    const now = Date.now()
    this.db.raw
      .prepare(
        `INSERT INTO model_downloads (id, provider, repo_id, revision, rfilename, download_url, dest_path, temp_path,
          total_bytes, downloaded_bytes, status, kind, parts, companion, format, quantization, license, gated,
          error, speed_bps, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           download_url = excluded.download_url, dest_path = excluded.dest_path, temp_path = excluded.temp_path,
           total_bytes = COALESCE(excluded.total_bytes, model_downloads.total_bytes),
           downloaded_bytes = excluded.downloaded_bytes, status = excluded.status, kind = excluded.kind,
           parts = COALESCE(excluded.parts, model_downloads.parts),
           companion = COALESCE(excluded.companion, model_downloads.companion),
           format = COALESCE(excluded.format, model_downloads.format),
           quantization = COALESCE(excluded.quantization, model_downloads.quantization),
           license = COALESCE(excluded.license, model_downloads.license),
           gated = COALESCE(excluded.gated, model_downloads.gated),
           error = excluded.error, speed_bps = excluded.speed_bps, updated_at = excluded.updated_at`
      )
      .run(
        row.id, row.provider, row.repoId, row.revision, row.rfilename, row.downloadUrl, row.destPath, row.tempPath,
        row.totalBytes, row.downloadedBytes, row.status, row.kind, row.parts, row.companion, row.format,
        row.quantization, row.license, row.gated, row.error, row.speedBps,
        row.createdAt ?? now, row.updatedAt ?? now,
      )
  }

  getDownloadRow(id: string): DownloadRow | null {
    const r = this.db.raw.prepare('SELECT * FROM model_downloads WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return r ? this.toDownloadRow(r) : null
  }

  listDownloadRows(): DownloadRow[] {
    const rows = this.db.raw.prepare('SELECT * FROM model_downloads ORDER BY updated_at DESC').all() as Record<string, unknown>[]
    return rows.map((r) => this.toDownloadRow(r))
  }

  listDownloadRowsByRepo(repoId: string): DownloadRow[] {
    const rows = this.db.raw
      .prepare('SELECT * FROM model_downloads WHERE repo_id = ? COLLATE NOCASE ORDER BY updated_at DESC')
      .all(repoId) as Record<string, unknown>[]
    return rows.map((r) => this.toDownloadRow(r))
  }

  updateDownloadRow(id: string, patch: Partial<Pick<DownloadRow, 'totalBytes' | 'downloadedBytes' | 'status' | 'error' | 'speedBps' | 'destPath' | 'tempPath' | 'parts' | 'companion'>>): void {
    const sets: string[] = []
    const vals: Array<string | number | null> = []
    const push = (col: string, v: string | number | null): void => { sets.push(`${col} = ?`); vals.push(v) }
    if (patch.totalBytes !== undefined) push('total_bytes', patch.totalBytes)
    if (patch.downloadedBytes !== undefined) push('downloaded_bytes', patch.downloadedBytes)
    if (patch.status !== undefined) push('status', patch.status)
    if (patch.error !== undefined) push('error', patch.error)
    if (patch.speedBps !== undefined) push('speed_bps', patch.speedBps)
    if (patch.destPath !== undefined) push('dest_path', patch.destPath)
    if (patch.tempPath !== undefined) push('temp_path', patch.tempPath)
    if (patch.parts !== undefined) push('parts', patch.parts)
    if (patch.companion !== undefined) push('companion', patch.companion)
    if (sets.length === 0) return
    sets.push('updated_at = ?')
    vals.push(Date.now(), id)
    this.db.raw.prepare(`UPDATE model_downloads SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }

  removeDownloadRow(id: string): void {
    this.db.raw.prepare('DELETE FROM model_downloads WHERE id = ?').run(id)
  }

  /** Remove rows whose dest matches. Set-group rows share their first part's
   *  dest, so deleting the group file drops the group row; deleting a later
   *  part is picked up by reconciliation (set → failed/partial, resumable). */
  removeDownloadRowsByDest(destAbs: string): void {
    this.db.raw.prepare('DELETE FROM model_downloads WHERE dest_path = ?').run(destAbs)
  }

  // ── Model registry (Library inventory, shared identity with downloads) ──

  upsertRegistryRow(row: Partial<ModelRegistryRow> & Pick<ModelRegistryRow, 'id' | 'sourceProvider' | 'repository' | 'rfilename' | 'localPath' | 'displayName'>): void {
    const now = Date.now()
    const revision = row.revision ?? 'main'
    this.db.raw
      .prepare(
        `INSERT INTO model_registry (id, source_provider, repository, revision, rfilename, format, quantization,
           architecture, parameter_count, context_length, license, local_path, file_size_bytes, checksum,
           download_status, installation_status, runtime_id, display_name, discovered_at, updated_at, extra_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_provider = excluded.source_provider, repository = excluded.repository, revision = excluded.revision,
           rfilename = excluded.rfilename, format = COALESCE(excluded.format, model_registry.format),
           quantization = COALESCE(excluded.quantization, model_registry.quantization),
           architecture = COALESCE(excluded.architecture, model_registry.architecture),
           parameter_count = COALESCE(excluded.parameter_count, model_registry.parameter_count),
           context_length = COALESCE(excluded.context_length, model_registry.context_length),
           license = COALESCE(excluded.license, model_registry.license),
           local_path = excluded.local_path, file_size_bytes = COALESCE(excluded.file_size_bytes, model_registry.file_size_bytes),
           checksum = COALESCE(excluded.checksum, model_registry.checksum),
           download_status = excluded.download_status, installation_status = excluded.installation_status,
           runtime_id = excluded.runtime_id, display_name = excluded.display_name, updated_at = excluded.updated_at,
           extra_json = COALESCE(excluded.extra_json, model_registry.extra_json)`
      )
      .run(
        row.id, row.sourceProvider, row.repository, revision, row.rfilename, row.format ?? null, row.quantization ?? null,
        row.architecture ?? null, row.parameterCount ?? null, row.contextLength ?? null, row.license ?? null,
        row.localPath, row.fileSizeBytes ?? null, row.checksum ?? null, row.downloadStatus ?? 'completed',
        row.installStatus ?? 'installed', row.runtimeId ?? null, row.displayName,
        row.discoveredAt ?? now, now, row.extraJson ?? null,
      )
  }

  getRegistryRow(id: string): ModelRegistryRow | null {
    const r = this.db.raw.prepare('SELECT * FROM model_registry WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return r ? this.toRegistryRow(r) : null
  }

  listRegistryRows(): ModelRegistryRow[] {
    const rows = this.db.raw.prepare('SELECT * FROM model_registry ORDER BY updated_at DESC').all() as Record<string, unknown>[]
    return rows.map((r) => this.toRegistryRow(r))
  }

  listRegistryRowsByRuntime(runtimeId: string): ModelRegistryRow[] {
    const rows = this.db.raw
      .prepare('SELECT * FROM model_registry WHERE runtime_id = ? ORDER BY updated_at DESC')
      .all(runtimeId) as Record<string, unknown>[]
    return rows.map((r) => this.toRegistryRow(r))
  }

  updateRegistryRow(id: string, patch: Partial<Pick<
    ModelRegistryRow,
    'localPath' | 'fileSizeBytes' | 'checksum' | 'downloadStatus' | 'installStatus' | 'runtimeId' | 'displayName' | 'extraJson' | 'rfilename'
  >>): void {
    const sets: string[] = []
    const vals: Array<string | number | null> = []
    const push = (col: string, v: string | number | null): void => { sets.push(`${col} = ?`); vals.push(v) }
    if (patch.localPath !== undefined) push('local_path', patch.localPath)
    if (patch.fileSizeBytes !== undefined) push('file_size_bytes', patch.fileSizeBytes)
    if (patch.checksum !== undefined) push('checksum', patch.checksum)
    if (patch.downloadStatus !== undefined) push('download_status', patch.downloadStatus)
    if (patch.installStatus !== undefined) push('installation_status', patch.installStatus)
    if (patch.runtimeId !== undefined) push('runtime_id', patch.runtimeId)
    if (patch.displayName !== undefined) push('display_name', patch.displayName)
    if (patch.extraJson !== undefined) push('extra_json', patch.extraJson)
    if (patch.rfilename !== undefined) push('rfilename', patch.rfilename)
    if (sets.length === 0) return
    sets.push('updated_at = ?')
    vals.push(Date.now(), id)
    this.db.raw.prepare(`UPDATE model_registry SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }

  removeRegistryRow(id: string): void {
    this.db.raw.prepare('DELETE FROM model_registry WHERE id = ?').run(id)
  }

  /** Remove every registry row whose resolved file path matches. */
  removeRegistryRowsByPath(localPathAbs: string): void {
    this.db.raw.prepare('DELETE FROM model_registry WHERE local_path = ?').run(localPathAbs)
  }

  private toRegistryRow(r: Record<string, unknown>): ModelRegistryRow {
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const status = str(r['download_status'])
    const ok: DownloadRowStatus[] = ['queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled', 'verifying']
    const install = str(r['installation_status'])
    return {
      id: str(r['id']),
      sourceProvider: str(r['source_provider']) || 'huggingface',
      repository: str(r['repository']),
      revision: str(r['revision']) || 'main',
      rfilename: str(r['rfilename']),
      format: str(r['format']) || null,
      quantization: str(r['quantization']) || null,
      architecture: str(r['architecture']) || null,
      parameterCount: str(r['parameter_count']) || null,
      contextLength: numOrNull(r['context_length']),
      license: str(r['license']) || null,
      localPath: str(r['local_path']),
      fileSizeBytes: numOrNull(r['file_size_bytes']),
      checksum: str(r['checksum']) || null,
      downloadStatus: (ok as string[]).includes(status) ? (status as DownloadRowStatus) : 'completed',
      installStatus: install === 'missing' || install === 'unregistered' ? install : 'installed',
      runtimeId: str(r['runtime_id']) || null,
      displayName: str(r['display_name']),
      discoveredAt: typeof r['discovered_at'] === 'number' ? (r['discovered_at'] as number) : Date.now(),
      updatedAt: typeof r['updated_at'] === 'number' ? (r['updated_at'] as number) : Date.now(),
      extraJson: typeof r['extra_json'] === 'string' ? (r['extra_json'] as string) : null,
    }
  }

  private toDownloadRow(r: Record<string, unknown>): DownloadRow {
    const str = (v: unknown): string => (typeof v === 'string' ? v : '')
    const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const status = str(r['status'])
    const ok: DownloadRowStatus[] = ['queued', 'downloading', 'paused', 'completed', 'failed', 'cancelled', 'verifying']
    return {
      id: str(r['id']),
      provider: str(r['provider']) || 'huggingface',
      repoId: str(r['repo_id']),
      revision: str(r['revision']) || 'main',
      rfilename: str(r['rfilename']),
      downloadUrl: str(r['download_url']),
      destPath: str(r['dest_path']),
      tempPath: str(r['temp_path']),
      totalBytes: numOrNull(r['total_bytes']),
      downloadedBytes: typeof r['downloaded_bytes'] === 'number' ? r['downloaded_bytes'] : 0,
      status: (ok as string[]).includes(status) ? (status as DownloadRowStatus) : 'queued',
      kind: r['kind'] === 'set' ? 'set' : 'single',
      parts: typeof r['parts'] === 'string' ? (r['parts'] as string) : null,
      companion: typeof r['companion'] === 'string' ? (r['companion'] as string) : null,
      format: typeof r['format'] === 'string' ? (r['format'] as string) : null,
      quantization: typeof r['quantization'] === 'string' ? (r['quantization'] as string) : null,
      license: typeof r['license'] === 'string' ? (r['license'] as string) : null,
      gated: typeof r['gated'] === 'number' ? (r['gated'] as number) : null,
      error: typeof r['error'] === 'string' ? (r['error'] as string) : null,
      speedBps: numOrNull(r['speed_bps']),
      createdAt: typeof r['created_at'] === 'number' ? (r['created_at'] as number) : Date.now(),
      updatedAt: typeof r['updated_at'] === 'number' ? (r['updated_at'] as number) : Date.now(),
    }
  }

  setAppSetting(key: string, value: string): void {
    this.db.setMeta(key, value)
  }

  close(): void {
    this.db.close()
  }

  private toSnapshot(row: z.infer<typeof zRuntimeRow>): RuntimeSnapshot {
    let lastModels: RuntimeSnapshot['lastModels'] = []
    try {
      const v = row.lastModels ? (JSON.parse(row.lastModels) as unknown) : []
      if (Array.isArray(v)) {
        lastModels = v
          .filter((m): m is { modelId: unknown; displayName: unknown } => m !== null && typeof m === 'object')
          .filter((m) => typeof m.modelId === 'string' && typeof m.displayName === 'string')
          .map((m) => ({ modelId: m.modelId as string, displayName: m.displayName as string }))
      }
    } catch {
      lastModels = []
    }
    return {
      entry: {
        id: row.id,
        displayName: row.displayName,
        type: row.type,
        endpoint: row.endpoint,
        enabled: row.enabled === 1,
        timeoutMs: row.timeoutMs,
      },
      lastModels,
      lastSeenAt: row.lastSeenAt,
      lastError: row.lastError,
    }
  }
}
