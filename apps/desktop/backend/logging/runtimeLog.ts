/**
 * Commit 6 — local runtime request log.
 * One JSON line per runtime request: timestamp, runtime id, method, safe
 * path (no query/body), latency, status, classification.
 * NEVER: credentials, headers, bodies, model responses, conversation text.
 * Local file only: `<dataDir>/logs/runtime.log` (+ single `.1` rotation).
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureDir, getSovaraDataDir } from '../storage/paths'

const MAX_LOG_BYTES = 1_000_000

export interface RuntimeLogEntry {
  time: number
  runtimeId: string
  method: 'GET' | 'POST'
  /** Origin + pathname only, e.g. `http://127.0.0.1:1234/v1/models`. */
  target: string
  latencyMs: number
  status?: number
  outcome: 'ok' | 'http-error' | 'timeout' | 'refused' | 'blocked' | 'invalid-response' | 'error' | 'cancelled'
  /** Inference only. Never prompts, completions, headers, or bodies. */
  modelId?: string
  streamed?: boolean
}

export function safeTarget(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    return `${u.origin}${u.pathname}`
  } catch {
    return 'unparseable'
  }
}

export function appendRuntimeLog(baseDir: string | undefined, entry: RuntimeLogEntry): void {
  // Terminal visibility (user requirement: errors/actions visible in terminal)
  // Use ASCII-safe glyphs to avoid garbled output on Windows codepages
  try {
    const tag = entry.outcome === 'ok' ? 'OK' : entry.outcome === 'cancelled' ? 'CANCEL' : 'ERR'
    // eslint-disable-next-line no-console
    console.log(
      `[SOVARA][RUNTIME] ${tag} ${entry.method} ${entry.target} -> ${entry.outcome} ${entry.status ? `status=${entry.status} ` : ''}model=${entry.modelId ?? '-'} ${entry.streamed ? 'streamed' : 'non-stream'} latency=${entry.latencyMs}ms runtime=${entry.runtimeId}`
    )
    if (entry.outcome !== 'ok' && entry.outcome !== 'cancelled') {
      // eslint-disable-next-line no-console
      console.error(`[SOVARA][RUNTIME][ERROR] ${JSON.stringify(entry)}`)
    }
  } catch {
    // console failure must not break flow
  }
  try {
    const dir = path.join(getSovaraDataDir(baseDir), 'logs')
    ensureDir(dir)
    const file = path.join(dir, 'runtime.log')
    try {
      const st = fs.statSync(file)
      if (st.size > MAX_LOG_BYTES) {
        try {
          fs.renameSync(file, `${file}.1`)
        } catch {
          // ignore rotation failure — keep appending
        }
      }
    } catch {
      // file missing — fine
    }
    // Entry shape is fixed above; no caller-controlled free text is logged
    // beyond the safe target + classification.
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // Logging must never break runtime flows.
  }
}

/** Chat-specific log (terminal + chat.log) — every chat action is durable. */
export interface ChatLogEntry {
  time: number
  iso: string
  sessionId: string
  action: 'send' | 'regenerate' | 'editResend' | 'cancel' | 'error' | 'done'
  modelId?: string
  runtimeId?: string
  outcome?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  latencyMs?: number
  error?: string
  injected?: { workspace?: boolean; mcp?: boolean; skills?: boolean; webSearch?: boolean }
  detail?: string
}

export function appendChatLog(baseDir: string | undefined, entry: Omit<ChatLogEntry, 'time' | 'iso'> & Partial<Pick<ChatLogEntry, 'time' | 'iso'>>): void {
  const full: ChatLogEntry = {
    time: Date.now(),
    iso: new Date().toISOString(),
    ...entry,
  } as ChatLogEntry
  // Terminal - ASCII safe
  try {
    const icon = full.action === 'error' ? 'ERR' : full.action === 'done' ? 'OK' : full.action === 'cancel' ? 'CANCEL' : '->'
    const tok = full.totalTokens !== undefined ? ` tokens=${full.totalTokens} (p=${full.promptTokens ?? 0} c=${full.completionTokens ?? 0})` : ''
    const inj = full.injected ? ` injected=${Object.entries(full.injected).filter(([,v]) => v).map(([k]) => k).join(',') || 'none'}` : ''
    // eslint-disable-next-line no-console
    console.log(`[SOVARA][CHAT] ${icon} ${full.action} sid=${full.sessionId} model=${full.modelId ?? '-'} ${full.outcome ? `outcome=${full.outcome} ` : ''}${full.latencyMs ? `latency=${full.latencyMs}ms` : ''}${tok}${inj}${full.error ? ` error=${full.error}` : ''}${full.detail ? ` detail=${full.detail}` : ''}`)
    if (full.action === 'error' && full.error) {
      // eslint-disable-next-line no-console
      console.error(`[SOVARA][CHAT][ERROR] sid=${full.sessionId} ${full.error}`)
    }
  } catch {}
  // File
  try {
    const dir = path.join(getSovaraDataDir(baseDir), 'logs')
    ensureDir(dir)
    const file = path.join(dir, 'chat.log')
    try {
      const st = fs.statSync(file)
      if (st.size > MAX_LOG_BYTES) {
        try { fs.renameSync(file, `${file}.1`) } catch {}
      }
    } catch {}
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`, 'utf8')
  } catch {}
}
