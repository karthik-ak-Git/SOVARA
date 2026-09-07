/**
 * Voice transcription via local faster-whisper server (no API keys, no network).
 * Communicates with a Python faster-whisper server running on localhost.
 * Server is auto-started on first transcription and cached for the session.
 */
import { app, net } from 'electron'
import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import net_node from 'node:net'
import path from 'node:path'
import fs from 'node:fs'

export interface TranscribeResult {
  text: string
  language?: string
  duration?: number
}

export interface TranscribeOptions {
  /** Language code (default: 'en'). Use 'auto' for auto-detect. */
  language?: string
  /** Whisper model size (default: 'base' — ZukuriFlow parity). */
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3'
}

// Server state
let serverProcess: ChildProcess | null = null
let serverReady = false
let serverStarting = false
let serverPort = 0
let serverStartPromise: Promise<void> | null = null

/** Find a free TCP port on localhost. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net_node.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

function getPythonScriptPath(): string {
  const appPath = app.getAppPath()
  // In dev: apps/desktop/python/whisper_server.py (appPath = apps/desktop/src/main/index.ts → getAppPath = apps/desktop)
  // In prod: resources/python/whisper_server.py
  const candidates = [
    path.join(appPath, 'python', 'whisper_server.py'),
    path.join(appPath, '..', '..', 'python', 'whisper_server.py'),
    path.join(process.resourcesPath ?? appPath, 'python', 'whisper_server.py'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return path.resolve(p)
  }
  return candidates[0]
}

function findPython(): string {
  const candidates = [
    'python',
    'python3',
    'py',
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Python311', 'python.exe'),
    'C:\\Python313\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
  ]
  for (const cmd of candidates) {
    try {
      execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 })
      return cmd
    } catch {
      // try next
    }
  }
  return 'python'
}

async function ensureServer(): Promise<void> {
  if (serverReady) return
  if (serverStartPromise) return serverStartPromise

  serverStarting = true
  serverStartPromise = (async () => {
    const scriptPath = getPythonScriptPath()
    const pythonCmd = findPython()

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`whisper_server.py not found at: ${scriptPath}`)
    }

    // Find a truly free port
    serverPort = await findFreePort()
    console.log(`[whisper-server] starting on port ${serverPort}...`)

    serverProcess = spawn(pythonCmd, [scriptPath, String(serverPort)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })

    let output = ''

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      output += text
      if (text.includes('Running on')) {
        serverReady = true
        serverStarting = false
        console.log(`[whisper-server] ready on http://127.0.0.1:${serverPort}`)
      }
    })

    serverProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString()
      output += text
      // Flask prints "Running on http://127.0.0.1:PORT" to stderr
      if (text.includes('Running on')) {
        serverReady = true
        serverStarting = false
        console.log(`[whisper-server] ready on http://127.0.0.1:${serverPort}`)
      }
      // Log model download progress
      if (text.includes('Downloading') || text.includes('loading')) {
        console.log(`[whisper-server] ${text.trim()}`)
      }
    })

    serverProcess.on('exit', (code) => {
      const wasReady = serverReady
      serverReady = false
      serverStarting = false
      serverProcess = null
      serverStartPromise = null
      if (wasReady) {
        console.log(`[whisper-server] stopped (exit code ${code})`)
      } else if (code && code !== 0) {
        console.error(`[whisper-server] failed to start (exit code ${code})`)
        console.error(`[whisper-server] output:\n${output}`)
      }
    })

    serverProcess.on('error', (err) => {
      serverReady = false
      serverStarting = false
      serverProcess = null
      serverStartPromise = null
      console.error(`[whisper-server] spawn error: ${err.message}`)
    })

    // Poll /health until ready
    const maxWait = 60_000 // 60s — first run downloads model
    const startTime = Date.now()
    while (Date.now() - startTime < maxWait) {
      // If process died, bail early
      if (!serverProcess) {
        throw new Error('whisper-server process exited before becoming ready')
      }
      try {
        const resp = await net.fetch(`http://127.0.0.1:${serverPort}/health`)
        if (resp.ok) {
          serverReady = true
          serverStarting = false
          return
        }
      } catch {
        // not ready yet — keep polling
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    // Timeout
    const msg = `whisper-server failed to become ready within ${maxWait / 1000}s`
    console.error(`[whisper-server] ${msg}`)
    console.error(`[whisper-server] captured output:\n${output}`)
    throw new Error(msg)
  })()

  try {
    await serverStartPromise
  } catch (err) {
    // Reset so next call retries
    serverStartPromise = null
    throw err
  } finally {
    serverStarting = false
  }
}

async function postJSON(url: string, body: unknown): Promise<unknown> {
  const resp = await net.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json()
}

export class VoiceTranscriber {
  get isReady(): boolean {
    return serverReady
  }

  /**
   * Transcribe raw PCM audio data via faster-whisper.
   * @param audioFloat32 - base64-encoded Float32Array of raw PCM samples
   * @param sampleRate - sample rate of the audio (default 16000)
   * @param options - transcription options
   */
  async transcribeFromPCM(
    audioFloat32: string,
    sampleRate: number = 16000,
    options?: TranscribeOptions
  ): Promise<TranscribeResult> {
    await ensureServer()

    const result = await postJSON(`http://127.0.0.1:${serverPort}/transcribe`, {
      pcm: audioFloat32,
      sampleRate,
      language: options?.language ?? 'en',
      model: options?.model ?? 'base',
    })

    const data = result as Record<string, unknown>
    if (data.error) throw new Error(String(data.error))

    return {
      text: String(data.text ?? '').trim(),
      language: data.language ? String(data.language) : undefined,
      duration: data.duration ? Number(data.duration) : undefined,
    }
  }

  /** Pre-load the model (call on app start). Non-blocking — logs errors. */
  async preload(): Promise<void> {
    try {
      await ensureServer()
    } catch (err) {
      console.warn('[whisper-server] preload failed, will retry on first transcription:', err)
    }
  }

  /** Stop the whisper server (call on app quit). */
  stop(): void {
    if (serverProcess) {
      serverProcess.kill()
      serverProcess = null
      serverReady = false
      serverStartPromise = null
    }
  }
}
