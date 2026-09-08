/**
 * First-run Python provisioner — what makes the installed .exe self-sufficient.
 *
 * Target machines have no Python, no pip packages, and no browsers. This
 * module ensures a working interpreter for both sidecars (whisper + crawl):
 *
 * 1. Locate a system Python. None → status `no-python` (user guidance).
 * 2. Fast path: if it already imports everything in requirements.txt
 *    (dev machines), use it directly — no venv, no downloads.
 * 3. Otherwise build `<userData>/python-env` venv, `pip install -r
 *    requirements.txt`, then browser setup for crawl4ai. A marker file
 *    holding the requirements hash retriggers installs when deps change.
 *
 * All progress is observable via getPythonStatus() / IPC so Settings can
 * show "setting up…" instead of silent failure. Sidecars resolve their
 * interpreter through resolvePythonExe(), which awaits provisioning.
 */

import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export type PythonPhase =
  | 'idle'
  | 'checking'
  | 'installing-deps'
  | 'installing-browsers'
  | 'ready'
  | 'no-python'
  | 'error'

export interface PythonStatus {
  phase: PythonPhase
  /** Human-readable line for Settings. */
  message: string
  /** Interpreter in use (system python or venv), null until resolved. */
  pythonExe: string | null
  /** 'system' | 'venv' | null */
  source: 'system' | 'venv' | null
}

export const VENV_DIR_NAME = 'python-env'
export const REQUIREMENTS_MARKER = 'sovara-requirements.sha'
const REQUIRED_IMPORTS = ['flask', 'flask_cors', 'requests', 'crawl4ai']

let status: PythonStatus = { phase: 'idle', message: 'Python environment not checked yet.', pythonExe: null, source: null }
let ensurePromise: Promise<PythonStatus> | null = null
const listeners = new Set<(s: PythonStatus) => void>()

export function getPythonStatus(): PythonStatus {
  return { ...status }
}

export function onPythonStatus(listener: (s: PythonStatus) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setStatus(patch: Partial<PythonStatus>): void {
  status = { ...status, ...patch }
  for (const l of [...listeners]) {
    try {
      l({ ...status })
    } catch {
      // listener failure must not break provisioning
    }
  }
}

export function systemPythonCandidates(): string[] {
  return process.platform === 'win32' ? ['python', 'py -3'] : ['python3', 'python']
}

export function venvDir(userData = app.getPath('userData')): string {
  return join(userData, VENV_DIR_NAME)
}

export function venvPython(venv: string): string {
  return process.platform === 'win32' ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python')
}

export function browserSetupBin(venv: string): string {
  return process.platform === 'win32'
    ? join(venv, 'Scripts', 'crawl4ai-setup.exe')
    : join(venv, 'bin', 'crawl4ai-setup')
}

export function getPythonDir(): string {
  const appRoot = app.getAppPath()
  const devPath = join(appRoot, 'python')
  const prodPath = join(process.resourcesPath ?? '', 'python')
  return existsSync(devPath) ? devPath : prodPath
}

export function requirementsHash(): string {
  const reqPath = join(getPythonDir(), 'requirements.txt')
  const content = existsSync(reqPath) ? readFileSync(reqPath) : Buffer.alloc(0)
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const out = `${String(stdout ?? '')}\n${String(stderr ?? '')}`.trim().slice(-2000)
        reject(new Error(`${cmd} ${args.join(' ')} failed: ${err.message}\n${out}`))
      } else {
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      }
    })
  })
}

async function findSystemPython(): Promise<string | null> {
  for (const candidate of systemPythonCandidates()) {
    const [cmd, ...prefix] = candidate.split(' ')
    try {
      await run(cmd as string, [...prefix, '--version'], 15_000)
      return candidate
    } catch {
      // try next candidate
    }
  }
  return null
}

async function hasRequiredImports(python: string): Promise<boolean> {
  const [cmd, ...prefix] = python.split(' ')
  const probe = `import importlib.util,sys;sys.exit(0 if all(importlib.util.find_spec(m) for m in ${JSON.stringify(REQUIRED_IMPORTS)}) else 1)`
  try {
    await run(cmd as string, [...prefix, '-c', probe], 60_000)
    return true
  } catch {
    return false
  }
}

async function provisionVenv(python: string, venv: string): Promise<string> {
  const [cmd, ...prefix] = python.split(' ')
  mkdirSync(venv, { recursive: true })
  const exe = venvPython(venv)
  if (!existsSync(exe)) {
    setStatus({ phase: 'installing-deps', message: 'Creating local Python environment (one-time setup)…' })
    await run(cmd as string, [...prefix, '-m', 'venv', venv], 300_000)
  }
  const markerPath = join(venv, REQUIREMENTS_MARKER)
  const want = requirementsHash()
  const have = existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : ''
  if (have !== want || !(await hasRequiredImports(exe))) {
    setStatus({ phase: 'installing-deps', message: 'Installing Python packages (one-time setup, a few minutes)…' })
    const reqPath = join(getPythonDir(), 'requirements.txt')
    await run(exe, ['-m', 'pip', 'install', '--upgrade', 'pip'], 300_000)
    await run(exe, ['-m', 'pip', 'install', '-r', reqPath], 1_200_000)
    writeFileSync(markerPath, want)
  }
  return exe
}

async function ensureBrowsers(venv: string, systemInUse: boolean): Promise<void> {
  // Browser binaries live in the user cache, shared by venv/system interpreters.
  // Skip when a chromium from patchright/playwright already exists.
  const cacheDir =
    process.platform === 'win32'
      ? join(process.env['LOCALAPPDATA'] ?? '', 'ms-playwright')
      : join(process.env['HOME'] ?? '', '.cache', 'ms-playwright')
  try {
    const { readdirSync } = await import('fs')
    if (existsSync(cacheDir) && readdirSync(cacheDir).some((d) => d.startsWith('chromium'))) return
  } catch {
    // fall through to setup
  }
  setStatus({ phase: 'installing-browsers', message: 'Downloading the web engine browser (one-time setup)…' })
  if (!systemInUse && existsSync(browserSetupBin(venv))) {
    await run(browserSetupBin(venv), [], 1_200_000)
  } else {
    const sys = await findSystemPython()
    if (!sys) throw new Error('Python disappeared during browser setup.')
    const [cmd, ...prefix] = sys.split(' ')
    // crawl4ai-setup console script may not be on PATH; invoke via module runner.
    try {
      await run(cmd as string, [...prefix, '-m', 'crawl4ai.setup'], 1_200_000)
    } catch {
      await run(cmd as string, [...prefix, '-c', 'from patchright.sync_api import sync_playwright; print("playwright present")'], 60_000)
      // Last resort: patchright's own installer through the venv/system python.
      const runner = !systemInUse && existsSync(venvPython(venv)) ? venvPython(venv) : (sys as string)
      const [rcmd, ...rprefix] = runner.split(' ')
      await run(rcmd as string, [...rprefix, '-m', 'patchright', 'install', 'chromium'], 1_200_000)
    }
  }
}

/**
 * Ensure a usable interpreter. Concurrent callers share one run. Never
 * throws — the returned status carries `error`/`no-python` instead.
 */
export async function ensurePythonEnv(): Promise<PythonStatus> {
  if (status.phase === 'ready') return getPythonStatus()
  if (ensurePromise) return ensurePromise
  ensurePromise = (async (): Promise<PythonStatus> => {
    try {
      setStatus({ phase: 'checking', message: 'Checking the local Python environment…' })
      const system = await findSystemPython()
      if (!system) {
        setStatus({
          phase: 'no-python',
          message: 'No Python found. Install Python 3.10+ from python.org (tick “Add to PATH”), restart Sovara, and use Retry.',
          pythonExe: null,
          source: null,
        })
        return getPythonStatus()
      }
      if (await hasRequiredImports(system)) {
        setStatus({ phase: 'ready', message: 'Python environment ready.', pythonExe: system, source: 'system' })
        return getPythonStatus()
      }
      const venv = venvDir()
      const exe = await provisionVenv(system, venv)
      await ensureBrowsers(venv, false)
      setStatus({ phase: 'ready', message: 'Python environment ready.', pythonExe: exe, source: 'venv' })
      return getPythonStatus()
    } catch (e) {
      const message = e instanceof Error ? e.message.split('\n')[0] ?? 'setup failed' : 'setup failed'
      setStatus({ phase: 'error', message: `Python setup failed: ${message}`, pythonExe: null, source: null })
      return getPythonStatus()
    } finally {
      ensurePromise = null
    }
  })()
  return ensurePromise
}

/**
 * Interpreter for sidecars. Fast path when already ready; otherwise awaits
 * provisioning. Throws when unusable so callers fall back honestly.
 */
export async function resolvePythonExe(): Promise<string> {
  const s = await ensurePythonEnv()
  if (s.phase !== 'ready' || !s.pythonExe) throw new Error(s.message)
  return s.pythonExe
}

/** Fire-and-forget kick on app start — sidecars await it lazily anyway. */
export function initPythonEnv(): void {
  ensurePythonEnv().catch(() => {
    // status carries the failure; UI surfaces it with Retry
  })
}
