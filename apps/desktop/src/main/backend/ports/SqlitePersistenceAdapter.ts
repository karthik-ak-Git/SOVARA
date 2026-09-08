/**
 * Commit 3 — SQLite (metadata) + JSONL (canonical event log).
 * - SQLite WAL, prepared statements, explicit migrations via SovaraDb
 * - JSONL per session: events.v1.jsonl append-only, fsync, seq contiguous, lossless JSON validated
 * - Single-writer: all operations synchronous in Main, no concurrent races
 * - Renderer never sees filesystem paths
 */
import type { PersistencePort, ProjectHeader, SessionEventView, SessionHeader } from '@shared/types/ports'
import type { SessionId } from '@shared/types/branded'
import { brand } from '@shared/types/branded'
import { SovaraDb } from '../../storage/db'
import { appendEventSync, deleteSessionDirSync, ensureSessionDirExists, readEventsSync } from '../../storage/jsonl'

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

  async create(title = 'New session', projectId: string | null = null): Promise<SessionHeader> {
    const id = brand<'SessionId'>(`sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${++this.seqMono}`)
    const now = this.nowMono()
    const header: SessionHeader = { id, title: title.slice(0, 120) || 'New session', createdAt: now, updatedAt: now, projectId }
    // DB insert + JSONL dir creation (empty log)
    this.db.insertSession({ id, title: header.title, createdAt: header.createdAt, updatedAt: header.updatedAt, projectId })
    // ensure session dir exists (even before first event) for explicit invariant
    try {
      ensureSessionDirExists(id, this.baseDir)
    } catch {
      // ignore
    }
    return header
  }

  async list(projectId?: string | null): Promise<SessionHeader[]> {
    const rows = projectId === undefined
      ? this.db.listSessions()
      : projectId === null
        ? this.db.listGlobalSessions()
        : this.db.listSessionsByProject(projectId)
    return rows.map((r) => ({ id: brand<'SessionId'>(r.id), title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, archived: r.archived, projectId: r.projectId ?? null }))
  }

  async rename(id: SessionId, title: string): Promise<SessionHeader> {
    const clean = title.trim().slice(0, 120)
    if (!clean) throw new Error('title must not be empty')
    const existing = this.db.getSession(id)
    if (!existing) throw new Error(`session not found: ${id}`)
    const now = this.nowMono()
    this.db.renameSession(id, clean, now)
    return { id: brand<'SessionId'>(existing.id), title: clean, createdAt: existing.createdAt, updatedAt: now, archived: existing.archived, projectId: existing.projectId ?? null }
  }

  async deletePermanently(id: SessionId): Promise<void> {
    const existing = this.db.getSession(id)
    if (!existing) throw new Error(`session not found: ${id}`)
    // Files first, then DB row (row + token_usage rows).
    try {
      deleteSessionDirSync(id, this.baseDir)
    } catch {
      // ignore missing dir
    }
    this.db.deleteSession(id)
  }

  async createProject(name: string, rootPath: string): Promise<ProjectHeader> {
    const clean = name.trim().slice(0, 120)
    if (!clean) throw new Error('project name must not be empty')
    if (!rootPath) throw new Error('project rootPath is required')
    const now = this.nowMono()
    const header: ProjectHeader = { id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: clean, rootPath, createdAt: now, updatedAt: now }
    this.db.insertProject(header)
    return header
  }

  async listProjects(): Promise<ProjectHeader[]> {
    return this.db.listProjects()
  }

  async renameProject(id: string, name: string): Promise<ProjectHeader> {
    const clean = name.trim().slice(0, 120)
    if (!clean) throw new Error('project name must not be empty')
    const existing = this.db.getProject(id)
    if (!existing) throw new Error(`project not found: ${id}`)
    const now = this.nowMono()
    this.db.renameProject(id, clean, now)
    return { ...existing, name: clean, updatedAt: now }
  }

  async deleteProject(id: string): Promise<void> {
    const existing = this.db.getProject(id)
    if (!existing) throw new Error(`project not found: ${id}`)
    // Permanently remove every project-scoped chat's files, then rows.
    const scoped = this.db.listSessionsByProject(id)
    for (const s of scoped) {
      try {
        deleteSessionDirSync(s.id, this.baseDir)
      } catch {
        // ignore
      }
      this.db.deleteSession(s.id)
    }
    this.db.deleteProject(id)
  }

  getProjectSync(id: string): ProjectHeader | null {
    const r = this.db.getProject(id)
    if (!r) return null
    return { id: r.id, name: r.name, rootPath: r.rootPath, createdAt: r.createdAt, updatedAt: r.updatedAt }
  }

  async listArchived(): Promise<SessionHeader[]> {
    return this.db.listArchivedSessions().map((r) => ({ id: brand<'SessionId'>(r.id), title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, archived: r.archived, projectId: r.projectId ?? null }))
  }

  async get(id: SessionId): Promise<SessionHeader | null> {
    const r = this.db.getSession(id)
    if (!r) return null
    return { id: brand<'SessionId'>(r.id), title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt, archived: r.archived, projectId: r.projectId ?? null }
  }

  async archive(id: SessionId): Promise<void> {
    this.db.archiveSession(id)
  }

  async unarchive(id: SessionId): Promise<void> {
    this.db.unarchiveSession(id)
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
