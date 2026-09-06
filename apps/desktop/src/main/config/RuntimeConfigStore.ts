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
    `)
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
