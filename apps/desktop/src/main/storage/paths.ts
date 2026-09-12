import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Storage roots — never hard-code home paths, env HOME, or repo paths.
 * Renderer never imports this file.
 */
export function getSovaraDataDir(baseDirOverride?: string): string {
  if (baseDirOverride) return path.resolve(baseDirOverride)
  // In tests Electron `app` may not be ready; fallback to env or throw
  try {
    if (app.isReady()) return app.getPath('userData')
  } catch {
    // ignore — app not ready in unit tests
  }
  // Fallback for unit tests without Electron: use temp from env or OS tmp
  const env = process.env['SOVARA_DATA_DIR']
  if (env) return path.resolve(env)
  // Last resort: use os.tmpdir + pid to avoid polluting real userData
  const tmp = process.env['TMP'] || process.env['TEMP'] || '/tmp'
  return path.join(tmp, `sovara-test-${process.pid}`)
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function getDbPath(baseDir?: string): string {
  return path.join(getSovaraDataDir(baseDir), 'sovara.db')
}

export function getSessionsDir(baseDir?: string): string {
  return path.join(getSovaraDataDir(baseDir), 'sessions')
}

export function getSessionDir(sessionId: string, baseDir?: string): string {
  // sanitize: sessionId is branded but treat as path component safely
  const safe = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(getSessionsDir(baseDir), safe)
}

export function getEventsPath(sessionId: string, baseDir?: string): string {
  return path.join(getSessionDir(sessionId, baseDir), 'events.v1.jsonl')
}

export function getAttachmentsDir(sessionId: string, baseDir?: string): string {
  return path.join(getSessionDir(sessionId, baseDir), 'attachments')
}

export function getArtifactsDir(sessionId: string, baseDir?: string): string {
  return path.join(getSessionDir(sessionId, baseDir), 'artifacts')
}

export function getMcpDir(baseDir?: string): string {
  return path.join(getSovaraDataDir(baseDir), 'mcp')
}

export function getMcpFolderPath(mcpId: string, baseDir?: string): string {
  const safe = mcpId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64)
  return path.join(getMcpDir(baseDir), safe)
}
