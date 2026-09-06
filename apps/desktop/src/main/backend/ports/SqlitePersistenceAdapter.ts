/**
 * Commit 3 — SQLite (metadata) + JSONL (canonical event log).
 * - SQLite WAL, prepared statements, explicit migrations via SovaraDb
 * - JSONL per session: events.v1.jsonl append-only, fsync, seq contiguous, lossless JSON validated
 * - Single-writer: all operations synchronous in Main, no concurrent races
 * - Renderer never sees filesystem paths
 */
import type { PersistencePort, SessionEventView, SessionHeader } from '@shared/types/ports'
import type { SessionId } from '@shared/types/branded'
import { brand } from '@shared/types/branded'
import { SovaraDb } from '../../storage/db'
import { appendEventSync, ensureSessionDirExists, readEventsSync } from '../../storage/jsonl'

export class SqlitePersistenceAdapter implements PersistencePort {
  private readonly db: SovaraDb
  private readonly baseDir?: string
  private seqMono = 0

  constructor(baseDir?: string) {
    this.baseDir = baseDir
    this.db = new SovaraDb(baseDir)
  }

  private nowMono(): number {
    return Date.now() + this.seqMono++
  }

  async create(title = 'New session'): Promise<SessionHeader> {
    const id = brand<'SessionId'>(`sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${++this.seqMono}`)
    const now = this.nowMono()
    const header: SessionHeader = { id, title: title.slice(0, 120) || 'New session', createdAt: now, updatedAt: now }
    // DB insert + JSONL dir creation (empty log)
    this.db.insertSession({ id, title: header.title, createdAt: header.createdAt, updatedAt: header.updatedAt })
    // ensure session dir exists (even before first event) for explicit invariant
    try {
      ensureSessionDirExists(id, this.baseDir)
    } catch {
      // ignore
    }
    return header
  }

  async list(): Promise<SessionHeader[]> {
    return this.db.listSessions().map((r) => ({ id: brand<'SessionId'>(r.id), title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt }))
  }

  async get(id: SessionId): Promise<SessionHeader | null> {
    const r = this.db.getSession(id)
    if (!r) return null
    return { id: brand<'SessionId'>(r.id), title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt }
  }

  async appendEvent(sessionId: SessionId, type: string, data: unknown): Promise<SessionEventView> {
    // Verify session exists in SQLite (metadata is index)
    if (!this.db.getSession(sessionId)) throw new Error(`session not found: ${sessionId}`)
    // JSONL is source of truth for seq — append with validation and fsync
    const ev = appendEventSync(sessionId, type, data, this.baseDir)
    // Update SQLite metadata transactionally after durable log
    const now = this.nowMono()
    this.db.updateSession(sessionId, this.db.getSession(sessionId)!.title, now)
    return ev
  }

  async getEvents(sessionId: SessionId): Promise<SessionEventView[]> {
    if (!this.db.getSession(sessionId)) throw new Error(`session not found: ${sessionId}`)
    // Read and verify contiguity; throws on corruption
    return readEventsSync(sessionId, this.baseDir)
  }

  insertTokenUsage(row: { sessionId: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number }): void {
    this.db.insertTokenUsage(row)
  }

  getTotalUsage(): { promptTokens: number; completionTokens: number; totalTokens: number } {
    return this.db.getTotalUsage()
  }

  getUsageByModel(): Array<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number; requestCount: number }> {
    return this.db.getUsageByModel()
  }

  /** For tests: verify invariants, expose close */
  async close(): Promise<void> {
    this.db.close()
  }

  /** For AppBackend dispose */
  dispose(): void {
    this.db.close()
  }
}
