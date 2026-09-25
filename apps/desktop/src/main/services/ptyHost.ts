/**
 * Persistent interactive shell host — ConPTY-backed via node-pty when
 * available, pipes fallback otherwise.
 *
 * Primary path (Windows): node-pty drives the real console (ConPTY), so
 * powershell/cmd run FULLY interactive — prompts, repeat commands,
 * line editing, colors. Verified multi-command under Electron 35.
 * The Electron-ABI binaries are vendored at resources/pty/node-pty
 * (node-pty publishes no Electron prebuilds and stock Build Tools lack
 * the Spectre libs its stock build demands).
 *
 * Fallback path: `node:child_process` + piped stdio. Powershell/cmd in
 * this mode consume stdin as ONE script (`-Command -`), so only the
 * FIRST command executes — the pane reports `pty: false` honestly and
 * the UI labels it one-shot. python/node REPLs still work on pipes.
 *
 * Nothing here is synthesized: pid/cwd/status come from the live
 * process object. Instances live as long as the app process.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  zTerminalCreate,
  zTerminalWrite,
  zTerminalResize,
  zTerminalKill,
  zTerminalTail,
} from '@shared/ipc/schemas'

export type TerminalShell = 'powershell' | 'cmd' | 'bash' | 'python' | 'node'
export type TerminalStatus = 'alive' | 'exited'

export const TERMINAL_SHELLS: TerminalShell[] = ['powershell', 'cmd', 'bash', 'python', 'node']

export interface TerminalInfo {
  id: string
  shell: TerminalShell
  /** Real executable name, e.g. "powershell.exe". */
  name: string
  /** Real OS pid, null only if the process already exited before we read it. */
  pid: number | null
  /** Real spawn cwd (absolute, resolved). See module doc on in-shell cd. */
  cwd: string
  status: TerminalStatus
  exitCode: number | null
  /** True when backed by a real ConPTY (node-pty); false = pipes fallback. */
  pty: boolean
}

export interface TerminalCreateOptions {
  shell?: string
  cwd?: string
}

export interface TerminalOutputEvent {
  id: string
  data: string
  stream: 'stdout' | 'stderr'
}

export interface TerminalExitEvent {
  id: string
  exitCode: number | null
  signal: string | null
}

interface ShellSpec {
  exe: string
  args: string[]
  name: string
}

/** Minimal node-pty surface (no @types/node-pty dependency). */
interface PtyInstance {
  readonly pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
}

interface PtyModule {
  spawn(
    file: string,
    args: string[],
    opts: { name?: string; cols?: number; rows?: number; cwd?: string; env?: NodeJS.ProcessEnv }
  ): PtyInstance
}

let cachedPty: PtyModule | null | undefined
/** Resolve node-pty (dev node_modules, then packaged resources). Null = pipes fallback. */
function loadNodePty(): PtyModule | null {
  if (cachedPty !== undefined) return cachedPty
  cachedPty = null
  try {
    const mainRequire = createRequire(__filename)
    const mod = mainRequire('node-pty') as PtyModule
    if (mod && typeof mod.spawn === 'function') cachedPty = mod
  } catch {
    // ignore — try packaged resources next
  }
  if (!cachedPty) {
    try {
      const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath
      if (resourcesPath) {
        const mainRequire = createRequire(__filename)
        const mod = mainRequire(path.join(resourcesPath, 'pty', 'node-pty')) as PtyModule
        if (mod && typeof mod.spawn === 'function') cachedPty = mod
      }
    } catch {
      // ignore — pipes fallback
    }
  }
  return cachedPty
}

/** Interactive args for a real console (ConPTY). No `-Command -`: stdin is a REPL. */
function ptyShellSpec(shell: TerminalShell): ShellSpec {
  const win = process.platform === 'win32'
  switch (shell) {
    case 'powershell':
      return win
        ? { exe: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NoExit'], name: 'powershell.exe' }
        : { exe: 'pwsh', args: ['-NoLogo', '-NoProfile', '-NoExit'], name: 'pwsh' }
    case 'cmd':
      return { exe: 'cmd.exe', args: [], name: 'cmd.exe' }
    case 'bash':
      return { exe: 'bash', args: ['--noprofile', '--norc'], name: 'bash' }
    case 'python':
      return { exe: win ? 'python' : 'python3', args: ['-i', '-u'], name: win ? 'python.exe' : 'python3' }
    case 'node':
      return { exe: 'node', args: ['-i'], name: 'node.exe' }
  }
}

function shellSpec(shell: TerminalShell): ShellSpec {
  const win = process.platform === 'win32'
  switch (shell) {
    case 'powershell':
      return win
        ? { exe: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', '-'], name: 'powershell.exe' }
        : { exe: 'pwsh', args: ['-NoLogo', '-NoProfile', '-Command', '-'], name: 'pwsh' }
    case 'cmd':
      return { exe: 'cmd.exe', args: [], name: 'cmd.exe' }
    case 'bash':
      return { exe: 'bash', args: ['--noprofile', '--norc'], name: 'bash' }
    case 'python':
      return { exe: win ? 'python' : 'python3', args: ['-i', '-u'], name: win ? 'python.exe' : 'python3' }
    case 'node':
      return { exe: 'node', args: ['-i'], name: 'node.exe' }
  }
}

function defaultShell(): TerminalShell {
  return process.platform === 'win32' ? 'powershell' : 'bash'
}

/** Resolve a real, existing cwd. Never invents a path: falls back to home, then process cwd. */
function resolveCwd(preferred?: string): string {
  const candidates: string[] = []
  if (preferred && typeof preferred === 'string' && preferred.trim()) candidates.push(preferred.trim())
  try {
    if (os.homedir()) candidates.push(os.homedir())
  } catch { /* ignore */ }
  candidates.push(process.cwd())
  for (const c of candidates) {
    try {
      const resolved = path.resolve(c)
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved
    } catch { /* try next */ }
  }
  return process.cwd()
}

/** Cap retained scrollback per instance so long sessions can't grow memory unboundedly. */
const MAX_TAIL_LINES = 1000

interface LiveInstance {
  info: TerminalInfo
  tail: string[]
  pty?: PtyInstance
  proc?: ChildProcess
}

export class PersistentTerminalHost extends EventEmitter {
  private instances = new Map<string, LiveInstance>()

  onOutput(listener: (ev: TerminalOutputEvent) => void): () => void {
    this.on('output', listener)
    return () => this.off('output', listener)
  }

  onExit(listener: (ev: TerminalExitEvent) => void): () => void {
    this.on('exit', listener)
    return () => this.off('exit', listener)
  }

  list(): TerminalInfo[] {
    return Array.from(this.instances.values()).map((i) => ({ ...i.info }))
  }

  get(id: string): TerminalInfo | null {
    const inst = this.instances.get(id)
    return inst ? { ...inst.info } : null
  }

  /** Last N lines of captured output — lets a renderer catch up after (re)subscribing. */
  getTail(id: string, limit = 200): string[] | null {
    const inst = this.instances.get(id)
    if (!inst) return null
    return inst.tail.slice(Math.max(0, inst.tail.length - Math.max(1, limit)))
  }

  create(opts: TerminalCreateOptions = {}): TerminalInfo {
    const shell: TerminalShell = TERMINAL_SHELLS.includes(opts.shell as TerminalShell)
      ? (opts.shell as TerminalShell)
      : defaultShell()
    const cwd = resolveCwd(opts.cwd)
    const id = `term-${randomUUID().slice(0, 8)}`
    const ptyMod = loadNodePty()

    // ── Primary: real ConPTY ──
    if (ptyMod) {
      try {
        const spec = ptyShellSpec(shell)
        const inst: LiveInstance = {
          info: { id, shell, name: spec.name, pid: -1, cwd, status: 'alive', exitCode: null, pty: true },
          tail: [],
        }
        const p = ptyMod.spawn(spec.exe, spec.args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd,
          env: { ...process.env } as NodeJS.ProcessEnv,
        })
        inst.pty = p
        inst.info.pid = typeof p.pid === 'number' ? p.pid : null
        this.instances.set(id, inst)
        p.onData((data: string) => {
          const live = this.instances.get(id)
          if (!live || !data) return
          for (const line of data.split('\n')) live.tail.push(line)
          if (live.tail.length > MAX_TAIL_LINES) live.tail.splice(0, live.tail.length - MAX_TAIL_LINES)
          this.emit('output', { id, data, stream: 'stdout' } satisfies TerminalOutputEvent)
        })
        p.onExit(({ exitCode, signal }) => {
          this.markExited(id, typeof exitCode === 'number' ? exitCode : null, typeof signal === 'number' ? String(signal) : null)
        })
        return { ...inst.info }
      } catch {
        // fall through to pipes
      }
    }

    // ── Fallback: piped stdio (see module doc for limits) ──
    const spec = shellSpec(shell)

    const proc = spawn(spec.exe, spec.args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env },
    })

    const info: TerminalInfo = {
      id,
      shell,
      name: spec.name,
      pid: typeof proc.pid === 'number' ? proc.pid : null,
      cwd,
      status: 'alive',
      exitCode: null,
      pty: false,
    }
    const inst: LiveInstance = { info, proc, tail: [] }
    this.instances.set(id, inst)

    const pushStream = (stream: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      const live = this.instances.get(id)
      if (!live) return
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (!text) return
      for (const line of text.split('\n')) live.tail.push(line)
      if (live.tail.length > MAX_TAIL_LINES) live.tail.splice(0, live.tail.length - MAX_TAIL_LINES)
      this.emit('output', { id, data: text, stream } satisfies TerminalOutputEvent)
    }

    proc.stdout?.on('data', (c: Buffer) => pushStream('stdout', c))
    proc.stderr?.on('data', (c: Buffer) => pushStream('stderr', c))

    const markExit = (code: number | null, signal: string | null): void => {
      const live = this.instances.get(id)
      if (!live || live.info.status === 'exited') return
      live.info.status = 'exited'
      live.info.exitCode = code
      this.emit('exit', { id, exitCode: code, signal } satisfies TerminalExitEvent)
    }
    proc.on('exit', (code, signal) => markExit(code, signal))
    proc.on('error', (err) => {
      const live = this.instances.get(id)
      if (live) {
        const msg = `failed to spawn ${spec.exe}: ${err instanceof Error ? err.message : String(err)}`
        live.tail.push(msg)
        this.emit('output', { id, data: msg, stream: 'stderr' } satisfies TerminalOutputEvent)
      }
      markExit(null, null)
    })

    return { ...info }
  }

  /** Shared exit bookkeeping for both backends. */
  private markExited(id: string, code: number | null, signal: string | null): void {
    const live = this.instances.get(id)
    if (!live || live.info.status === 'exited') return
    live.info.status = 'exited'
    live.info.exitCode = code
    this.emit('exit', { id, exitCode: code, signal } satisfies TerminalExitEvent)
  }

  /** Write keystrokes/a full command line to the live shell. Appends newline when missing. */
  write(id: string, data: string): { ok: boolean; error?: string } {
    const inst = this.instances.get(id)
    if (!inst) return { ok: false, error: `unknown terminal: ${id}` }
    if (inst.info.status !== 'alive') return { ok: false, error: `terminal ${id} has exited (code ${inst.info.exitCode ?? 'unknown'})` }
    // ── ConPTY: Enter key is CR ──
    if (inst.pty) {
      const payload = data.replace(/\r?\n$/, '\r')
      try {
        inst.pty.write(payload.endsWith('\r') ? payload : `${payload}\r`)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    // ── Pipes fallback ──
    if (!inst.proc?.stdin || inst.proc.stdin.destroyed) return { ok: false, error: `terminal ${id} stdin is closed` }
    const payload = data.endsWith('\n') ? data : `${data}\n`
    try {
      inst.proc.stdin.write(payload, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Resize the console. Real on ConPTY (`applied: true`); accepted no-op on
   * the pipes backend (`applied: false`).
   */
  resize(id: string, _cols: number, _rows: number): { ok: boolean; applied: boolean; reason: string } {
    const inst = this.instances.get(id)
    if (!inst) return { ok: false, applied: false, reason: `unknown terminal: ${id}` }
    if (inst.pty) {
      try {
        inst.pty.resize(_cols, _rows)
        return { ok: true, applied: true, reason: '' }
      } catch (err) {
        return { ok: false, applied: false, reason: err instanceof Error ? err.message : String(err) }
      }
    }
    return { ok: true, applied: false, reason: 'pipes backend has no PTY dimensions; reserved for a node-pty upgrade' }
  }

  kill(id: string, signal?: string): { ok: boolean; error?: string } {
    const inst = this.instances.get(id)
    if (!inst) return { ok: false, error: `unknown terminal: ${id}` }
    if (inst.info.status === 'exited') {
      this.instances.delete(id)
      return { ok: true }
    }
    if (inst.pty) {
      try {
        inst.pty.kill(signal)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    try {
      const killed = inst.proc?.kill((signal as NodeJS.Signals | undefined) ?? undefined) ?? false
      if (!killed) return { ok: false, error: `OS refused to signal pid ${inst.info.pid ?? 'unknown'}` }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Drop bookkeeping for an exited instance. Refuses while the process is still alive. */
  forget(id: string): { ok: boolean; error?: string } {
    const inst = this.instances.get(id)
    if (!inst) return { ok: false, error: `unknown terminal: ${id}` }
    if (inst.info.status !== 'exited') return { ok: false, error: `terminal ${id} is still alive; kill it first` }
    this.instances.delete(id)
    return { ok: true }
  }

  dispose(): void {
    for (const [, inst] of this.instances) {
      try {
        if (inst.info.status === 'alive') {
          if (inst.pty) inst.pty.kill()
          else inst.proc?.kill()
        }
      } catch { /* best effort */ }
    }
    this.instances.clear()
  }
}

/** Shared singleton for the main process. */
export const ptyHost = new PersistentTerminalHost()

/**
 * Wires the terminal IPC surface. NOT called automatically — the integrator
 * calls this once from the main IPC setup (one line) after adding the
 * `terminal:*` channels to the shared channel registry + preload allowlist.
 *
 * Channels (see IPC NEEDS in the implementation report for exact shapes):
 *   terminal:create (invoke)  terminal:write (invoke)  terminal:resize (invoke)
 *   terminal:kill (invoke)    terminal:list (invoke)    terminal:tail (invoke)
 *   terminal:output (event)   terminal:exit (event)
 */
export function registerTerminalIpc(
  ipcMain: { handle: (channel: string, listener: (event: unknown, payload: unknown) => unknown) => void },
  broadcast: (channel: 'terminal:output' | 'terminal:exit', payload: TerminalOutputEvent | TerminalExitEvent) => void,
  host: PersistentTerminalHost = ptyHost,
): void {
  ipcMain.handle('terminal:create', (_event, payload) => {
    const parsed = zTerminalCreate.safeParse(payload ?? {})
    if (!parsed.success) return { ok: false, error: `terminal:create requires { shell?, cwd? }: ${parsed.error.message}` }
    return host.create({ shell: parsed.data.shell, cwd: parsed.data.cwd })
  })
  ipcMain.handle('terminal:write', (_event, payload) => {
    const parsed = zTerminalWrite.safeParse(payload ?? {})
    if (!parsed.success) return { ok: false, error: `terminal:write requires { id: string, data: string }: ${parsed.error.message}` }
    return host.write(parsed.data.id, parsed.data.data)
  })
  ipcMain.handle('terminal:resize', (_event, payload) => {
    const parsed = zTerminalResize.safeParse(payload ?? {})
    if (!parsed.success) return { ok: false, applied: false, reason: `terminal:resize requires { id: string, cols: number, rows: number }: ${parsed.error.message}` }
    return host.resize(parsed.data.id, parsed.data.cols, parsed.data.rows)
  })
  ipcMain.handle('terminal:kill', (_event, payload) => {
    const parsed = zTerminalKill.safeParse(payload ?? {})
    if (!parsed.success) return { ok: false, error: `terminal:kill requires { id: string }: ${parsed.error.message}` }
    return host.kill(parsed.data.id, parsed.data.signal)
  })
  ipcMain.handle('terminal:list', () => host.list())
  ipcMain.handle('terminal:tail', (_event, payload) => {
    const parsed = zTerminalTail.safeParse(payload ?? {})
    if (!parsed.success) return { ok: false, error: `terminal:tail requires { id: string }: ${parsed.error.message}` }
    const tail = host.getTail(parsed.data.id, parsed.data.limit ?? 200)
    if (!tail) return { ok: false, error: `unknown terminal: ${parsed.data.id}` }
    return { ok: true, id: parsed.data.id, lines: tail }
  })
  host.onOutput((ev) => broadcast('terminal:output', ev))
  host.onExit((ev) => broadcast('terminal:exit', ev))
}
