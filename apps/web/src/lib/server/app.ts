/**
 * App/system service — server info, setup (Python env), voice, logs.
 * Same surface as the `app:*` / `setup:*` / `voice:*` / `logs:*` IPC handlers.
 */

import 'server-only'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zVoiceTranscribe } from '@shared/ipc/schemas'
import { getBackend } from './backend'

export async function getInfo() {
  const backend = await getBackend()
  const base = backend.getInfo()
  return {
    name: base.name,
    version: base.version,
    // Web runtime: no Electron shell; report the actual server runtime.
    electron: null as string | null,
    runtime: `node ${base.node}`,
    node: base.node,
    platform: base.platform,
    arch: base.arch,
  }
}

export async function getPythonStatus() {
  const { getPythonStatus } = await import('@sovara-main/services/pythonEnv')
  return getPythonStatus()
}

export async function ensurePython() {
  const { ensurePythonEnv } = await import('@sovara-main/services/pythonEnv')
  return ensurePythonEnv()
}

export async function getVoiceStatus() {
  const { isVoiceReady } = await import('@sovara-main/services/voiceServer')
  return { ready: isVoiceReady() }
}

export async function transcribe(raw: unknown) {
  const data = zVoiceTranscribe.parse(raw)
  const { transcribeAudio } = await import('@sovara-main/services/voiceServer')
  try {
    const buf = Buffer.from(data.audio, 'base64')
    const result = await transcribeAudio(buf, data.filename)
    return { ok: true, ...result }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function getRecentLogs(kind: string) {
  const { getSovaraDataDir } = await import('@sovara-main/storage/paths')
  const tail = (file: string, n = 40): string[] => {
    try {
      const t = fs.readFileSync(file, 'utf8').trim().split('\n').slice(-n)
      return t.filter(Boolean)
    } catch {
      return []
    }
  }
  let dir: string
  try {
    dir = path.join(getSovaraDataDir(undefined), 'logs')
  } catch {
    dir = path.join(os.tmpdir(), 'sovara-logs')
  }
  const out: Record<string, string[]> = {}
  if (kind === 'all' || kind === 'detection') out.detection = tail(path.join(dir, 'detection.log'), 30)
  if (kind === 'all' || kind === 'runtime') out.runtime = tail(path.join(dir, 'runtime.log'), 30)
  if (kind === 'all' || kind === 'app') out.app = tail(path.join(dir, 'app.log'), 30)
  if (kind === 'all' || kind === 'chat') out.chat = tail(path.join(dir, 'chat.log'), 50)
  return out
}
