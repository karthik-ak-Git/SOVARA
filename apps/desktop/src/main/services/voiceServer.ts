/**
 * Voice transcription server manager.
 * Spawns a local Python faster-whisper server on port 51820.
 * All HTTP through HttpClient (sovereignty: loopback only).
 */

import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { postLoopback, getLoopbackJson } from '../network/HttpClient'

let server: ChildProcess | null = null
let ready = false
let starting = false
let startPromise: Promise<void> | null = null

const PORT = 51820
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`
const TRANSCRIBE_URL = `http://127.0.0.1:${PORT}/transcribe`

function getPythonDir(): string {
  const devPath = join(__dirname, '..', '..', '..', 'python')
  const prodPath = join(process.resourcesPath ?? '', 'python')
  return existsSync(devPath) ? devPath : prodPath
}

function getPythonCommand(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const result = await getLoopbackJson(HEALTH_URL, { timeoutMs: 2_000 })
      if (result.json && (result.json as { ready?: boolean }).ready) {
        ready = true
        console.log('[voice] Server ready')
        return
      }
    } catch {
      // Server not up yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('Voice server failed to start within timeout')
}

export async function startVoiceServer(): Promise<void> {
  if (ready) return
  if (startPromise) return startPromise

  starting = true
  startPromise = (async () => {
    try {
      const pythonDir = getPythonDir()
      const serverPath = join(pythonDir, 'whisper_server.py')

      if (!existsSync(serverPath)) {
        console.warn(`[voice] Server not found at ${serverPath}`)
        return
      }

      console.log(`[voice] Starting server: ${serverPath}`)
      server = spawn(getPythonCommand(), [serverPath, 'base'], {
        cwd: pythonDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })

      server.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) console.log(`[voice:py] ${msg}`)
      })

      server.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) console.error(`[voice:py] ${msg}`)
      })

      server.on('exit', (code) => {
        console.log(`[voice] Server exited with code ${code}`)
        server = null
        ready = false
      })

      server.on('error', (err) => {
        console.error('[voice] Server spawn error:', err.message)
        server = null
        ready = false
      })

      await waitForServer()
    } catch (err) {
      console.error('[voice] Failed to start server:', err)
    } finally {
      starting = false
    }
  })()

  return startPromise
}

export function isVoiceReady(): boolean {
  return ready
}

export async function stopVoiceServer(): Promise<void> {
  if (server) {
    server.kill()
    server = null
  }
  ready = false
  startPromise = null
}

export async function transcribeAudio(
  audioBuffer: Buffer,
  _filename: string
): Promise<{
  text: string
  raw: string
  language: string
  duration: number
  transcribeTime: number
}> {
  if (!ready) {
    await startVoiceServer()
    if (!ready) throw new Error('Voice server not available')
  }

  // Always send as JSON with base64 (postLoopback sends JSON)
  const base64 = audioBuffer.toString('base64')
  const { res } = await postLoopback(TRANSCRIBE_URL, { wav_base64: base64 }, { timeoutMs: 60_000 })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Transcription failed (${res.status}): ${err}`)
  }

  return await res.json() as Promise<{
    text: string
    raw: string
    language: string
    duration: number
    transcribeTime: number
  }>
}

/** Lazy start on import — non-blocking */
initVoiceServer()

export function initVoiceServer(): void {
  startVoiceServer().catch(() => {
    // Swallow — server may not be available yet
  })
}
