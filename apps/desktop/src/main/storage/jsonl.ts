import fs from 'node:fs'
import path from 'node:path'
import { getEventsPath, ensureDir, getSessionDir } from './paths'
import type { SessionEventView } from '@shared/types/ports'

/**
 * Append-only JSONL per session. Each line is one SessionEventView.
 * Validation is done by caller (isJsonValue); we verify seq contiguity on read.
 * Durable: append with fsync.
 */

function isJsonValue(v: unknown, seen = new WeakSet<object>()): boolean {
  if (v === null) return true
  const t = typeof v
  if (t === 'string' || t === 'boolean') return true
  if (t === 'number') return Number.isFinite(v)
  if (t === 'bigint' || t === 'function' || t === 'symbol' || t === 'undefined') return false
  if (Array.isArray(v)) {
    if (seen.has(v)) return false
    seen.add(v)
    for (let i = 0; i < v.length; i++) if (!(i in v)) return false
    return v.every((e) => isJsonValue(e, seen))
  }
  if (v instanceof Date || v instanceof Map || v instanceof Set || v instanceof RegExp) return false
  if (t === 'object') {
    const o = v as Record<string, unknown>
    if (seen.has(o)) return false
    seen.add(o)
    if (Object.getPrototypeOf(o) !== Object.prototype && Object.getPrototypeOf(o) !== null) return false
    return Object.values(o).every((e) => isJsonValue(e, seen))
  }
  return false
}

export function ensureSessionDirExists(sessionId: string, baseDir?: string): void {
  ensureDir(getSessionDir(sessionId, baseDir))
}

export function getNextSeq(sessionId: string, baseDir?: string): number {
  const events = readEventsSync(sessionId, baseDir)
  return events.length
}

export function appendEventSync(
  sessionId: string,
  type: string,
  data: unknown,
  baseDir?: string
): SessionEventView {
  if (typeof type !== 'string' || !type) throw new Error('invalid event type')
  if (!isJsonValue(data)) throw new Error('event data must be lossless JSON (no BigInt/undefined/function/sparse/NaN/Map/Date)')

  ensureSessionDirExists(sessionId, baseDir)
  const file = getEventsPath(sessionId, baseDir)

  // Determine next seq by reading current file (small, append-only, single writer)
  const existing = readEventsSync(sessionId, baseDir)
  const seq = existing.length
  const ev: SessionEventView = { seq, time: Date.now(), type, data: structuredClone(data) }

  const line = JSON.stringify(ev) + '\n'
  // Durable append: open, write, fsync, close
  const fd = fs.openSync(file, 'a')
  try {
    fs.writeSync(fd, line, null, 'utf8')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  return ev
}

export function readEventsSync(sessionId: string, baseDir?: string): SessionEventView[] {
  const file = getEventsPath(sessionId, baseDir)
  if (!fs.existsSync(file)) return []

  const raw = fs.readFileSync(file, 'utf8')
  if (raw === '') return []

  // Split on \n — last line may be empty due to trailing newline
  const lines = raw.split('\n')
  // If raw ends with '\n', last element is '' — drop it
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const out: SessionEventView[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      throw new Error(`corrupt JSONL for session ${sessionId} at line ${i}: empty line`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (e) {
      throw new Error(`corrupt JSONL for session ${sessionId} at line ${i}: ${(e as Error).message}`)
    }
    // verify shape
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`corrupt JSONL for session ${sessionId} at line ${i}: not an object`)
    }
    const ev = parsed as SessionEventView
    if (typeof ev.seq !== 'number' || typeof ev.time !== 'number' || typeof ev.type !== 'string') {
      throw new Error(`corrupt JSONL for session ${sessionId} at line ${i}: missing seq/time/type`)
    }
    if (ev.seq !== i) {
      throw new Error(`corrupt JSONL for session ${sessionId} at line ${i}: expected seq ${i} got ${ev.seq}`)
    }
    out.push(ev)
  }
  return out
}

export function readEventsSafe(sessionId: string, baseDir?: string): { events: SessionEventView[]; corrupt?: string } {
  try {
    return { events: readEventsSync(sessionId, baseDir) }
  } catch (e) {
    return { events: [], corrupt: (e as Error).message }
  }
}

export { isJsonValue }
