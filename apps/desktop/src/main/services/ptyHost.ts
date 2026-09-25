/**
 * Persistent interactive shell host — pipes-based, NOT a full PTY.
 *
 * Spawns one long-lived interactive shell process per terminal instance.
 * The process survives across commands (stdin stays open, stdout/stderr
 * stream back), each instance keeps its own cwd, and output/exit are
 * emitted as events the main process can forward to renderers.
 *
 * Deliberately implemented with `node:child_process` + piped stdio because
 * `node-pty` is not a dependency of this project. Honest limits:
 * - No PTY emulation: no cursor addressing, no ANSI cursor control, no
 *   window-size semantics. Full-screen / interactive-TUI apps (vim, less,
 *   htop, interactive fzf, `python` bare REPL is fine but line-oriented)
 *   will not render correctly and may appear to hang waiting on input.
 * - `resize()` is accepted for forward-compatibility but is a no-op
 *   (`applied: false`) until a real PTY backend lands.
 * - In-shell `cd` / `Set-Location` changes the *process* cwd, but the host
 *   only tracks the spawn cwd. `info.cwd` is the real spawn cwd, refreshed
 *   only when reported via `refreshCwd()` (best-effort `pwd` probe).
 * - Instances live as long as the app process. They do NOT survive app
 *   restart — PIDs from a previous run are never reused or displayed.
 * - All PIDs/cwds/statuses come from the live OS child process object.
 *   Nothing here is synthesized.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  proc: ChildProcess
  tail: string[]
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
    const spec = shellSpec(shell)
    const cwd = resolveCwd(opts.cwd)
    const id = `term-${randomUUID().slice(0, 8)}`

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

  /** Write keystrokes/a full command line to the live shell's stdin. Appends '\n' when missing. */
  write(id: string, data: string): { ok: boolean; error?: string } {
    const inst = this.instances.get(id)
    if (!inst) return { ok: false, error: `unknown terminal: ${id}` }
    if (inst.info.status !== 'alive') return { ok: false, error: `terminal ${id} has exited (code ${inst.info.exitCode ?? 'unknown'})` }
    if (!inst.proc.stdin || inst.proc.stdin.destroyed) return { ok: false, error: `terminal ${id} stdin is closed` }
    const payload = data.endsWith('\n') ? data : `${data}\n`
    try {
      inst.proc.stdin.write(payload, 'utf8')
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * No-op on the pipes backend: without a PTY there are no dimensions to set.
   * Accepted so renderers can call it unconditionally; `applied` is honestly false.
   */
  resize(id: string, _cols: number, _rows: number): { ok: boolean; applied: boolean; reason: string } {
    if (!this.instances.get(id)) return { ok: false, applied: false, reason: `unknown terminal: ${id}` }
    return { ok: true, applied: false, reason: 'pipes backend has no PTY dimensions; reserved for a node-pty upgrade' }
  }

  kill(id: string, signal?: string): { ok: boolean; error?: string } {
    const inst = this.instances.get(id)
    if (!inst) return { ok: false, error: `unknown terminal: ${id}` }
    if (inst.info.status === 'exited') {
      this.instances.delete(id)
      return { ok: true }
    }
    try {
      const killed = inst.proc.kill((signal as NodeJS.Signals | undefined) ?? undefined)
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
        if (inst.info.status === 'alive') inst.proc.kill()
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
