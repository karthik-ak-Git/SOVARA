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
