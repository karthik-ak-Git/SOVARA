// @sovara/capability-shell — local shell seam, like harness shell/local + subprocess
// Executes in the Sovara workspace, gated by execPermissions (ask/allow).

import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

export const name = 'capability-shell'

export function getShellToolDefinitions() {
  return [
    {
      name: 'shell_exec',
      toolset: 'shell' as const,
      description: 'Run a Windows (PowerShell 5.1) or Linux (wsl) shell command in the workspace. Input: { command: string, workdir?: string }. Use for git/npm/docker/dir/ls. Paths with spaces must be quoted. For linux commands prefix with "wsl ".',
      parameters: {
        type: 'object' as const,
        properties: {
          command: { type: 'string' as const, description: 'Shell command to run, e.g. "dir" or "wsl ls -la"' },
          workdir: { type: 'string' as const, description: 'Relative workdir inside workspace, default "."' },
          timeoutMs: { type: 'number' as const, description: 'Timeout ms, default 15000' },
        },
        required: ['command'] as const,
      },
    },
  ]
}

export function dispatchShell(
  args: Record<string, unknown>,
  workspaceRoot: string
): Promise<string> {
  const command = args['command'] as string
  if (!command || typeof command !== 'string' || command.trim().length === 0) return Promise.resolve(JSON.stringify({ error: 'shell_exec requires { command: string }' }))
  const workdirRel = typeof args['workdir'] === 'string' ? (args['workdir'] as string) : '.'
  const workdir = path.resolve(workspaceRoot, workdirRel)
  // Ensure workdir is inside workspace or workspace itself
  const rel = path.relative(path.resolve(workspaceRoot), workdir)
  if (rel.startsWith('..')) return Promise.resolve(JSON.stringify({ error: `workdir escapes workspace: ${workdirRel}` }))
  if (!fs.existsSync(workdir)) return Promise.resolve(JSON.stringify({ error: `workdir not found: ${workdirRel}` }))

  const timeoutMs = typeof args['timeoutMs'] === 'number' ? Math.min(60000, Math.max(2000, args['timeoutMs'] as number)) : 15000
  // Windows: use powershell.exe -NoProfile -Command <command>  (handles both win and wsl prefix)
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: workdir, timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => {
      const out = String(stdout ?? '').slice(0, 8000)
      const errStr = String(stderr ?? '').slice(0, 2000)
      if (err && (err as NodeJS.ErrnoException).killed) {
        resolve(JSON.stringify({ error: `timeout after ${timeoutMs}ms`, command, workdir: workdirRel, stdout: out, stderr: errStr }))
        return
      }
      const code = (err as { code?: number })?.code ?? 0
      resolve(JSON.stringify({ command, workdir: workdirRel, exitCode: code, stdout: out, stderr: errStr, truncated: out.length >= 8000 }, null, 2))
    })
  })
}
