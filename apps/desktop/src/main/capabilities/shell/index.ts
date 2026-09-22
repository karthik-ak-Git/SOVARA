// @sovara/capability-shell — local shell seam, like harness shell/local + subprocess
// Executes in the Sovara workspace, gated by execPermissions (ask/allow).

import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

export const name = 'capability-shell'

export interface DetectedServerInfo {
  port: number | null
  url: string | null
  allUrls: string[]
}

export function extractServerInfo(text: string): DetectedServerInfo {
  const urlRegex = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?(?:\/[^\s"']*)?/gi
  const matches = Array.from(text.matchAll(urlRegex))
  const allUrls: string[] = []
  let detectedPort: number | null = null
  let detectedUrl: string | null = null

  for (const match of matches) {
    const raw = match[0].replace(/[)\]>.,;'"]+$/, '').replace(/\/+$/, '')
    const normalized = raw.replace('0.0.0.0', 'localhost')
    if (!allUrls.includes(normalized)) allUrls.push(normalized)
    if (!detectedUrl) detectedUrl = normalized
    if (match[1] && !detectedPort) {
      detectedPort = parseInt(match[1], 10)
    }
  }

  if (!detectedPort) {
    const portMatch = text.match(/\b(?:port|Port|PORT|listening on)[:\s=]+(\d{3,5})\b/)
    if (portMatch) {
      detectedPort = parseInt(portMatch[1], 10)
      if (!detectedUrl) detectedUrl = `http://localhost:${detectedPort}`
      if (!allUrls.includes(detectedUrl)) allUrls.push(detectedUrl)
    }
  }

  return { port: detectedPort, url: detectedUrl, allUrls }
}

export interface ActiveServerRecord {
  pid: number | undefined
  command: string
  port: number
  url: string
  workdir: string
  startedAt: number
  process: ChildProcess
}

const activeDevServers = new Map<number, ActiveServerRecord>()

export function getActiveDevServers(): Array<{ port: number; url: string; command: string; workdir: string; uptimeSec: number }> {
  const now = Date.now()
  return Array.from(activeDevServers.values()).map((s) => ({
    port: s.port,
    url: s.url,
    command: s.command,
    workdir: s.workdir,
    uptimeSec: Math.round((now - s.startedAt) / 1000),
  }))
}

export function stopDevServer(port: number): boolean {
  const rec = activeDevServers.get(port)
  if (rec) {
    try {
      if (process.platform === 'win32' && rec.pid) {
        import('node:child_process').then(({ exec }) => exec(`taskkill /pid ${rec.pid} /T /F`))
      } else {
        rec.process.kill('SIGTERM')
      }
    } catch {
      // ignore
    }
    activeDevServers.delete(port)
    return true
  }
  return false
}

export function isServerCommand(command: string): boolean {
  return /\b(npm\s+(?:run\s+)?(?:dev|start|serve)|pnpm\s+(?:run\s+)?(?:dev|start|serve)|yarn\s+(?:dev|start|serve)|bun\s+(?:run\s+)?(?:dev|start|serve)|npx\s+(?:vite|next|serve|http-server)|vite|next\s+dev|python\b.*?\bhttp\.server)\b/i.test(
    command
  )
}

export function getShellToolDefinitions() {
  return [
    {
      name: 'shell_exec',
      toolset: 'shell' as const,
      description:
        'Run a shell command in the workspace (PowerShell/wsl). Automatically detects running dev servers, active ports, and URLs (e.g. http://localhost:5173). Long-running dev servers stay active in the background. Input: { command: string, workdir?: string, background?: boolean, timeoutMs?: number }',
      parameters: {
        type: 'object' as const,
        properties: {
          command: { type: 'string' as const, description: 'Shell command to run, e.g. "npm run dev", "npm install", "dir"' },
          workdir: { type: 'string' as const, description: 'Relative workdir inside workspace, default "."' },
          background: { type: 'boolean' as const, description: 'Set true to run a long-running service/dev server in background' },
          timeoutMs: { type: 'number' as const, description: 'Timeout ms, default 15000 (extended for server detection)' },
        },
        required: ['command'] as const,
      },
    },
    {
      name: 'list_dev_servers',
      toolset: 'shell' as const,
      description: 'List actively running background dev servers, their ports, URLs, and commands.',
      parameters: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'stop_dev_server',
      toolset: 'shell' as const,
      description: 'Stop a running background dev server by its port number.',
      parameters: {
        type: 'object' as const,
        properties: {
          port: { type: 'number' as const, description: 'Port number to stop' },
        },
        required: ['port'] as const,
      },
    },
  ]
}

export function dispatchShell(
  args: Record<string, unknown>,
  workspaceRoot: string
): Promise<string> {
  const command = args['command'] as string
  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    return Promise.resolve(JSON.stringify({ error: 'shell_exec requires { command: string }' }))
  }
  const workdirRel = typeof args['workdir'] === 'string' ? (args['workdir'] as string) : '.'
  const workdir = path.resolve(workspaceRoot, workdirRel)
  const rel = path.relative(path.resolve(workspaceRoot), workdir)
  if (rel.startsWith('..')) {
    return Promise.resolve(JSON.stringify({ error: `workdir escapes workspace: ${workdirRel}` }))
  }
  if (!fs.existsSync(workdir)) {
    return Promise.resolve(JSON.stringify({ error: `workdir not found: ${workdirRel}` }))
  }

  const isServer = isServerCommand(command) || args['background'] === true || args['daemon'] === true
  const timeoutMs = typeof args['timeoutMs'] === 'number'
    ? Math.min(120000, Math.max(2000, args['timeoutMs'] as number))
    : isServer ? 10000 : 20000

  return new Promise((resolve) => {
    let resolved = false
    let stdoutAcc = ''
    let stderrAcc = ''

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: workdir,
      windowsHide: true,
    })

    const finish = (result: Record<string, unknown>): void => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      resolve(JSON.stringify(result, null, 2))
    }

    const checkServerReady = (): boolean => {
      if (!isServer) return false
      const sInfo = extractServerInfo(stdoutAcc + '\n' + stderrAcc)
      if (sInfo.url && sInfo.port) {
        activeDevServers.set(sInfo.port, {
          pid: child.pid,
          command,
          port: sInfo.port,
          url: sInfo.url,
          workdir: workdirRel,
          startedAt: Date.now(),
          process: child,
        })
        finish({
          command,
          workdir: workdirRel,
          status: 'running',
          port: sInfo.port,
          url: sInfo.url,
          allUrls: sInfo.allUrls,
          exitCode: null,
          stdout: stdoutAcc.slice(0, 8000),
          stderr: stderrAcc.slice(0, 2000),
          message: `Dev server started and running at ${sInfo.url} (port ${sInfo.port})`,
        })
        return true
      }
      return false
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutAcc += chunk.toString('utf8')
      if (stdoutAcc.length > 64000) stdoutAcc = stdoutAcc.slice(-64000)
      checkServerReady()
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrAcc += chunk.toString('utf8')
      if (stderrAcc.length > 32000) stderrAcc = stderrAcc.slice(-32000)
      checkServerReady()
    })

    child.on('error', (err) => {
      finish({
        error: err.message,
        command,
        workdir: workdirRel,
        stdout: stdoutAcc.slice(0, 8000),
        stderr: stderrAcc.slice(0, 2000),
      })
    })

    child.on('close', (code) => {
      const sInfo = extractServerInfo(stdoutAcc + '\n' + stderrAcc)
      finish({
        command,
        workdir: workdirRel,
        exitCode: code ?? 0,
        stdout: stdoutAcc.slice(0, 8000),
        stderr: stderrAcc.slice(0, 2000),
        port: sInfo.port,
        url: sInfo.url,
        allUrls: sInfo.allUrls,
        truncated: stdoutAcc.length >= 8000,
      })
    })

    const timer = setTimeout(() => {
      if (resolved) return
      if (isServer) {
        const sInfo = extractServerInfo(stdoutAcc + '\n' + stderrAcc)
        const detectedPort = sInfo.port || 5173
        const detectedUrl = sInfo.url || `http://localhost:${detectedPort}`
        activeDevServers.set(detectedPort, {
          pid: child.pid,
          command,
          port: detectedPort,
          url: detectedUrl,
          workdir: workdirRel,
          startedAt: Date.now(),
          process: child,
        })
        finish({
          command,
          workdir: workdirRel,
          status: 'running',
          port: detectedPort,
          url: detectedUrl,
          allUrls: sInfo.allUrls.length > 0 ? sInfo.allUrls : [detectedUrl],
          stdout: stdoutAcc.slice(0, 8000),
          stderr: stderrAcc.slice(0, 2000),
          message: `Dev server process running in background at ${detectedUrl}`,
        })
      } else {
        try {
          if (process.platform === 'win32' && child.pid) {
            import('node:child_process').then(({ exec }) => exec(`taskkill /pid ${child.pid} /T /F`))
          } else {
            child.kill('SIGTERM')
          }
        } catch {}
        finish({
          error: `timeout after ${timeoutMs}ms`,
          command,
          workdir: workdirRel,
          stdout: stdoutAcc.slice(0, 8000),
          stderr: stderrAcc.slice(0, 2000),
        })
      }
    }, timeoutMs)
  })
}

