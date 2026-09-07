import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqlitePersistenceAdapter } from '../src/main/backend/ports/SqlitePersistenceAdapter'
import { SovaraDb } from '../src/main/storage/db'
import { getDbPath, getEventsPath, getSessionsDir } from '../src/main/storage/paths'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-persist-'))
}

describe('Commit 3 — SQLite + JSONL persistence', () => {
  let dir: string

  beforeEach(() => {
    dir = mkTmp()
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('initializes database with WAL, schema, and metadata', () => {
    const db = new SovaraDb(dir)
    expect(fs.existsSync(getDbPath(dir))).toBe(true)
    // WAL mode
    expect(db.getJournalMode().toLowerCase()).toBe('wal')
    // schema_version = 2
    expect(db.getMeta('schema_version')).toBe('2')
    expect(db.getMeta('installId')).toBeDefined()
    // tables exist
    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('sessions')
    expect(names).toContain('projects')
    expect(names).toContain('session_indexes')
    expect(names).toContain('model_library')
    expect(names).toContain('app_meta')
    db.close()
  })

  it('migrates cleanly on reopen (missing/empty DB recovery)', () => {
    // first open creates
    const db1 = new SovaraDb(dir)
    db1.close()
    // second open should not throw and keep version
    const db2 = new SovaraDb(dir)
    expect(db2.getMeta('schema_version')).toBe('2')
    db2.close()
    // third open after deleting db file should recreate cleanly
    fs.rmSync(getDbPath(dir))
    const db3 = new SovaraDb(dir)
    expect(db3.getMeta('schema_version')).toBe('2')
    db3.close()
  })

  it('persists sessions across AppBackend recreation (SQLite metadata)', async () => {
    const a1 = new SqlitePersistenceAdapter(dir)
    const s1 = await a1.create('first')
    const s2 = await a1.create('second')
    await a1.close()
    // recreate with same dir — simulating app restart
    const a2 = new SqlitePersistenceAdapter(dir)
    const list = await a2.list()
    expect(list.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort())
    expect(await a2.get(s1.id)).not.toBeNull()
    await a2.close()
  })

  it('persists events across restart and keeps contiguous seq', async () => {
    const a1 = new SqlitePersistenceAdapter(dir)
    const s = await a1.create('s')
    await a1.appendEvent(s.id, 'user/message', { content: 'a' })
    await a1.appendEvent(s.id, 'user/message', { content: 'b' })
    await a1.close()

    const a2 = new SqlitePersistenceAdapter(dir)
    const evts = await a2.getEvents(s.id)
    expect(evts.map((e) => e.seq)).toEqual([0, 1])
    // append after restart continues seq 2
    const e2 = await a2.appendEvent(s.id, 'user/message', { content: 'c' })
    expect(e2.seq).toBe(2)
    const all = await a2.getEvents(s.id)
    expect(all.length).toBe(3)
    await a2.close()
  })

  it('writes JSONL file with correct lines and offsets', async () => {
    const p = new SqlitePersistenceAdapter(dir)
    const s = await p.create('s')
    await p.appendEvent(s.id, 'user/message', { content: 'hello' })
    await p.appendEvent(s.id, 'assistant/message', { content: 'world' })
    const file = getEventsPath(s.id, dir)
    expect(fs.existsSync(file)).toBe(true)
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    const j0 = JSON.parse(lines[0])
    const j1 = JSON.parse(lines[1])
    expect(j0.seq).toBe(0)
    expect(j1.seq).toBe(1)
    expect(j0.type).toBe('user/message')
    await p.close()
  })

  it('reconstructs from JSONL after close/reopen', async () => {
    const p1 = new SqlitePersistenceAdapter(dir)
    const s = await p1.create('s')
    for (let i = 0; i < 3; i++) await p1.appendEvent(s.id, 'user/message', { content: `m${i}` })
    await p1.close()

    const p2 = new SqlitePersistenceAdapter(dir)
    const evts = await p2.getEvents(s.id)
    expect(evts.map((e) => (e.data as { content: string }).content)).toEqual(['m0', 'm1', 'm2'])
    await p2.close()
  })

  it('handles malformed JSONL explicitly (no silent discard)', async () => {
    const p = new SqlitePersistenceAdapter(dir)
    const s = await p.create('s')
    await p.appendEvent(s.id, 'user/message', { content: 'ok' })
    await p.close()
    // corrupt file: append bad line
    const file = getEventsPath(s.id, dir)
    fs.appendFileSync(file, 'NOT_JSON\n')
    const p2 = new SqlitePersistenceAdapter(dir)
    await expect(p2.getEvents(s.id)).rejects.toThrow(/corrupt JSONL/)
    await p2.close()
  })

  it('detects non-contiguous seq as corruption', async () => {
    const p = new SqlitePersistenceAdapter(dir)
    const s = await p.create('s')
    await p.appendEvent(s.id, 'user/message', { content: 'a' })
    await p.appendEvent(s.id, 'user/message', { content: 'b' })
    await p.close()
    // tamper: change second line seq to 5
    const file = getEventsPath(s.id, dir)
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    const j = JSON.parse(lines[1])
    j.seq = 5
    lines[1] = JSON.stringify(j)
    fs.writeFileSync(file, lines.join('\n') + '\n')
    const p2 = new SqlitePersistenceAdapter(dir)
    await expect(p2.getEvents(s.id)).rejects.toThrow(/expected seq 1 got 5/)
    await p2.close()
  })

  it('handles truncation (partial last line) as corruption', async () => {
    const p = new SqlitePersistenceAdapter(dir)
    const s = await p.create('s')
    await p.appendEvent(s.id, 'user/message', { content: 'a' })
    await p.close()
    const file = getEventsPath(s.id, dir)
    // truncate last line in middle
    const raw = fs.readFileSync(file, 'utf8')
    fs.writeFileSync(file, raw.slice(0, raw.length - 5))
    const p2 = new SqlitePersistenceAdapter(dir)
    await expect(p2.getEvents(s.id)).rejects.toThrow(/corrupt JSONL/)
    await p2.close()
  })

  it('keeps SQLite metadata consistent with JSONL (updatedAt touches)', async () => {
    const p = new SqlitePersistenceAdapter(dir)
    const s = await p.create('s')
    const before = (await p.get(s.id))!.updatedAt
    await p.appendEvent(s.id, 'user/message', { content: 'x' })
    const after = (await p.get(s.id))!.updatedAt
    expect(after).toBeGreaterThan(before)
    await p.close()
  })

  it('safe close/reopen does not leak handles', async () => {
    const p1 = new SqlitePersistenceAdapter(dir)
    const s = await p1.create('s')
    await p1.appendEvent(s.id, 'user/message', { content: 'a' })
    await p1.close()
    // second close should be safe (idempotent)
    await p1.close()
    const p2 = new SqlitePersistenceAdapter(dir)
    expect(await p2.get(s.id)).not.toBeNull()
    const evts = await p2.getEvents(s.id)
    expect(evts.length).toBe(1)
    await p2.close()
  })

  it('renderer remains isolated from filesystem/database APIs', () => {
    const rendererFiles = ['src/renderer/src/App.tsx', 'src/renderer/src/main.tsx']
    for (const f of rendererFiles) {
      const txt = fs.readFileSync(f, 'utf8')
      expect(txt, `fs in ${f}`).not.toMatch(/from 'node:fs'|from "node:fs"|better-sqlite3|node:sqlite/)
      expect(txt, `better-sqlite3 in ${f}`).not.toMatch(/better-sqlite3/)
      expect(txt, `DatabaseSync in ${f}`).not.toMatch(/DatabaseSync/)
    }
    // verify storage dir is under userData, not hard-coded home
    const pathsSrc = fs.readFileSync('src/main/storage/paths.ts', 'utf8')
    expect(pathsSrc).toMatch(/app\.getPath\('userData'\)/)
    expect(pathsSrc).not.toMatch(/get_hermes_home/)
  })

  it('uses temp dirs for tests, never real userData', () => {
    // Prove we use tmp — create a dedicated adapter so DB file exists
    const tmpCheck = new SovaraDb(dir)
    expect(dir).toMatch(/sovara-persist|tmp/)
    expect(fs.existsSync(getDbPath(dir))).toBe(true)
    // Ensure we didn't write to repo root
    expect(fs.existsSync('sovara.db')).toBe(false)
    tmpCheck.close()
  })
})
