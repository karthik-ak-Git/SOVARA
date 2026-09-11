import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * Internal web server lifecycle for the Electron shell.
 *
 * The window no longer serves the legacy Vite renderer bundle. Instead the
 * shell ensures the Next.js internal server (UI + /api) is reachable on
 * loopback and loads it. Resolution order:
 *   1. `SOVARA_WEB_URL` env (explicit override, e.g. remote dev server).
 *   2. Healthy server already listening on the loopback port (reuse —
 *      covers `pnpm dev:web` running alongside).
 *   3. Spawn from the packaged staged runtime
 *      (`resources/web-runtime`, see scripts/stage-web-runtime.ps1).
 *   4. Dev fallback: `next dev` from `apps/web` (repo checkout).
 *   5. Dev fallback: `next start` from `apps/web/.next` (built, not staged).
 */

const LOOPBACK_HOST = '127.0.0.1'

export function webPort(): number {
  const raw = process.env['SOVARA_WEB_PORT']
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? (parsed as number) : 51840
}

export function webBaseUrl(): string {
  const override = process.env['SOVARA_WEB_URL']
  if (override) return override.replace(/\/+$/, '')
  return `http://${LOOPBACK_HOST}:${webPort()}`
}

async function isHealthy(baseUrl: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetch(`${baseUrl}/api/app/info`, { signal: ctl.signal })
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

function repoWebDir(): string {
  // Dev: app path is apps/desktop (electron-vite) — web is the sibling dir.
  return path.resolve(app.getAppPath(), '..', 'web')
}

function stagedRuntimeDir(): string | null {
  // Packaged: extraResources/web-runtime (unpacked, outside asar).
  const packaged = path.join(process.resourcesPath, 'web-runtime')
  if (fs.existsSync(path.join(packaged, 'package.json'))) return packaged
  // Repo runs (electron-vite dev/preview): apps/desktop/web-runtime.
  const repo = path.join(app.getAppPath(), 'web-runtime')
  if (fs.existsSync(path.join(repo, 'package.json'))) return repo
  return null
}

function nextCli(runtimeDir: string): string | null {
  const cli = path.join(runtimeDir, 'node_modules', 'next', 'dist', 'bin', 'next')
  return fs.existsSync(cli) ? cli : null
}

let child: ChildProcess | null = null

function spawnNext(args: string[], cwd: string): ChildProcess {
  const proc = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      PORT: String(webPort()),
      HOSTNAME: LOOPBACK_HOST,
      // Keep server output out of the user's terminal; main logs lifecycle.
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  proc.stdout?.on('data', (d: Buffer) => console.log(`[web-server] ${String(d).trimEnd()}`))
  proc.stderr?.on('data', (d: Buffer) => console.error(`[web-server] ${String(d).trimEnd()}`))
  proc.on('exit', (code, signal) => {
    console.error(`[web-server] exited code=${code} signal=${signal}`)
    if (child === proc) child = null
  })
  return proc
}

async function waitHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await isHealthy(baseUrl)) return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, 500))
  }
}

/**
 * Ensure the internal web server is reachable. Returns its base URL.
 * Throws when no server can be provided — the window shows the error
 * instead of a blank page (caller decides).
 */
export async function ensureWebServer(): Promise<string> {
  const baseUrl = webBaseUrl()
  if (process.env['SOVARA_WEB_URL']) {
    if (await isHealthy(baseUrl, 5000)) return baseUrl
    throw new Error(`SOVARA_WEB_URL is set but unhealthy: ${baseUrl}`)
  }
  // Reuse an already-running server (e.g. `pnpm dev:web` alongside).
  if (await isHealthy(baseUrl)) {
    console.log(`[web-server] reusing healthy server at ${baseUrl}`)
    return baseUrl
  }

  const staged = stagedRuntimeDir()
  if (staged) {
    const cli = nextCli(staged)
    if (!cli) throw new Error(`staged web runtime is missing next CLI: ${staged}`)
    console.log(`[web-server] spawning staged runtime: ${staged}`)
    child = spawnNext([cli, 'start', '-p', String(webPort()), '-H', LOOPBACK_HOST], staged)
    if (await waitHealthy(baseUrl, 60_000)) return baseUrl
    throw new Error(`staged web runtime failed to become healthy at ${baseUrl}`)
  }

  // Repo dev fallbacks (no staged runtime present).
  const webDir = repoWebDir()
  const devCli = nextCli(webDir)
  if (devCli && fs.existsSync(path.join(webDir, 'package.json'))) {
    console.log(`[web-server] spawning next dev from ${webDir}`)
    child = spawnNext([devCli, 'dev', '-p', String(webPort()), '-H', LOOPBACK_HOST], webDir)
    if (await waitHealthy(baseUrl, 180_000)) return baseUrl
    throw new Error(`next dev failed to become healthy at ${baseUrl}`)
  }
  throw new Error(
    'no web runtime available: build it with scripts/stage-web-runtime.ps1 ' +
      'or run `pnpm dev:web` alongside the Electron shell'
  )
}

export function stopWebServer(): void {
  if (child && !child.killed) {
    try {
      child.kill()
    } catch {
      // already gone
    }
  }
  child = null
}
