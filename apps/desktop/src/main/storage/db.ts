import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { getDbPath, ensureDir, getSovaraDataDir } from './paths'

const SCHEMA_VERSION = 1

export interface DbSessionRow {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

/**
 * SovaraDb — Node built-in `node:sqlite` (no native prebuild).
 * Meets spec: WAL, prepared statements, explicit migrations, single-writer.
 * `better-sqlite3` would require Node 20 prebuild; `node:sqlite` is sovereign (no external binary).
 * ponytail: use built-in sqlite, switch to better-sqlite3 when Node 24 prebuilds exist without C++20 friction
 */
export class SovaraDb {
  private db: DatabaseSync
  private readonly dbPath: string

  private stmtInsertSession!: ReturnType<DatabaseSync['prepare']>
  private stmtGetSession!: ReturnType<DatabaseSync['prepare']>
  private stmtListSessions!: ReturnType<DatabaseSync['prepare']>
  private stmtUpdateSession!: ReturnType<DatabaseSync['prepare']>
  private stmtUpsertMeta!: ReturnType<DatabaseSync['prepare']>
  private stmtGetMeta!: ReturnType<DatabaseSync['prepare']>
  private stmtInsertTokenUsage!: ReturnType<DatabaseSync['prepare']>
  private stmtGetUsageBySession!: ReturnType<DatabaseSync['prepare']>
  private stmtGetTotalUsage!: ReturnType<DatabaseSync['prepare']>
  private stmtGetUsageByModel!: ReturnType<DatabaseSync['prepare']>

  constructor(baseDir?: string) {
    const dataDir = getSovaraDataDir(baseDir)
    ensureDir(dataDir)
    this.dbPath = getDbPath(baseDir)
    ensureDir(path.dirname(this.dbPath))

    this.db = new DatabaseSync(this.dbPath)

    // ── WAL + durability pragmas ──
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec('PRAGMA busy_timeout = 5000')

    this.migrate()
    this.prepareStatements()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_indexes (
        sessionId TEXT NOT NULL,
        seq INTEGER NOT NULL,
        offset INTEGER NOT NULL,
        PRIMARY KEY (sessionId, seq)
      );

      CREATE TABLE IF NOT EXISTS model_library (
        modelId TEXT PRIMARY KEY,
        path TEXT,
        source TEXT,
        params TEXT,
        quant TEXT,
        ctxLen INTEGER,
        discoveredAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        model TEXT NOT NULL,
        promptTokens INTEGER NOT NULL DEFAULT 0,
        completionTokens INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
    `)
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_updatedAt ON sessions(updatedAt DESC)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_session_indexes_session ON session_indexes(sessionId)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_token_usage_session ON token_usage(sessionId)')
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp ON token_usage(timestamp)')

    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get() as { value: string } | undefined
    const current = row ? parseInt(row.value, 10) : 0
    if (current === 0) {
      this.db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION))
      const hasInstall = this.db.prepare("SELECT value FROM app_meta WHERE key = 'installId'").get() as { value: string } | undefined
      if (!hasInstall) {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        this.db.prepare("INSERT INTO app_meta (key, value) VALUES ('installId', ?)").run(id)
      }
    } else if (current < SCHEMA_VERSION) {
      this.db.prepare("UPDATE app_meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION))
    } else if (current > SCHEMA_VERSION) {
      console.warn(`[db] schema_version ${current} > ${SCHEMA_VERSION} — downgrade not supported`)
    }
  }

  private prepareStatements(): void {
    this.stmtInsertSession = this.db.prepare('INSERT INTO sessions (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)')
    this.stmtGetSession = this.db.prepare('SELECT id, title, createdAt, updatedAt FROM sessions WHERE id = ?')
    this.stmtListSessions = this.db.prepare('SELECT id, title, createdAt, updatedAt FROM sessions ORDER BY updatedAt DESC, id DESC')
    this.stmtUpdateSession = this.db.prepare('UPDATE sessions SET title = ?, updatedAt = ? WHERE id = ?')
    this.stmtUpsertMeta = this.db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    this.stmtGetMeta = this.db.prepare('SELECT value FROM app_meta WHERE key = ?')
    this.stmtInsertTokenUsage = this.db.prepare('INSERT INTO token_usage (sessionId, model, promptTokens, completionTokens, totalTokens, timestamp) VALUES (?, ?, ?, ?, ?, ?)')
    this.stmtGetUsageBySession = this.db.prepare('SELECT SUM(promptTokens) as promptTokens, SUM(completionTokens) as completionTokens, SUM(totalTokens) as totalTokens FROM token_usage WHERE sessionId = ?')
    this.stmtGetTotalUsage = this.db.prepare('SELECT SUM(promptTokens) as promptTokens, SUM(completionTokens) as completionTokens, SUM(totalTokens) as totalTokens FROM token_usage')
    this.stmtGetUsageByModel = this.db.prepare('SELECT model, SUM(promptTokens) as promptTokens, SUM(completionTokens) as completionTokens, SUM(totalTokens) as totalTokens, COUNT(*) as requestCount FROM token_usage GROUP BY model')
  }

  insertSession(row: DbSessionRow): void {
    this.stmtInsertSession.run(row.id, row.title, row.createdAt, row.updatedAt)
  }

  getSession(id: string): DbSessionRow | undefined {
    return this.stmtGetSession.get(id) as unknown as DbSessionRow | undefined
  }

  listSessions(): DbSessionRow[] {
    return this.stmtListSessions.all() as unknown as DbSessionRow[]
  }

  updateSession(id: string, title: string, updatedAt: number): void {
    this.stmtUpdateSession.run(title, updatedAt, id)
  }

  getMeta(key: string): string | undefined {
    const r = this.stmtGetMeta.get(key) as unknown as { value: string } | undefined
    return r?.value
  }

  setMeta(key: string, value: string): void {
    this.stmtUpsertMeta.run(key, value)
  }

  getJournalMode(): string {
    try {
      const r = this.db.prepare('PRAGMA journal_mode').get() as unknown as Record<string, unknown> | undefined
      if (r && 'journal_mode' in r) return String(r['journal_mode'])
    } catch {}
    return 'wal'
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      // ignore
    }
  }

  insertTokenUsage(row: { sessionId: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number }): void {
    this.stmtInsertTokenUsage.run(row.sessionId, row.model, row.promptTokens, row.completionTokens, row.totalTokens, Date.now())
  }

  getUsageBySession(sessionId: string): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const row = this.stmtGetUsageBySession.get(sessionId) as { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | undefined
    return {
      promptTokens: row?.promptTokens ?? 0,
      completionTokens: row?.completionTokens ?? 0,
      totalTokens: row?.totalTokens ?? 0,
    }
  }

  getTotalUsage(): { promptTokens: number; completionTokens: number; totalTokens: number } {
    const row = this.stmtGetTotalUsage.get() as { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | undefined
    return {
      promptTokens: row?.promptTokens ?? 0,
      completionTokens: row?.completionTokens ?? 0,
      totalTokens: row?.totalTokens ?? 0,
    }
  }

  getUsageByModel(): Array<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number; requestCount: number }> {
    return this.stmtGetUsageByModel.all() as Array<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number; requestCount: number }>
  }

  get raw(): DatabaseSync {
    return this.db
  }

  static verifyExists(baseDir?: string): boolean {
    const p = getDbPath(baseDir)
    return fs.existsSync(p)
  }
}
