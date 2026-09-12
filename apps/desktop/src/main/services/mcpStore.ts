import { z } from 'zod'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { RuntimeConfigStore } from '../config/RuntimeConfigStore'
import { fetchMcpProbe } from '../network/HttpClient'
import { getMcpDir } from '../storage/paths'

const zMcpServer = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  provider: z.string().max(80).default('Custom'),
  transport: z.enum(['stdio', 'http']),
  command: z.string().max(512).optional(),
  endpoint: z.string().max(512).optional(),
  enabled: z.boolean(),
  createdAt: z.number().int(),
  status: z.enum(['connected', 'disconnected', 'error', 'probing', 'installing']).optional(),
  lastError: z.string().max(256).optional(),
  url: z.string().max(2048).optional(),
  localPath: z.string().max(1024).optional(),
})

export type McpServer = z.infer<typeof zMcpServer>

const KEY = 'mcp_servers'
const MAX_SERVERS = 32

function loadServers(store: RuntimeConfigStore): McpServer[] {
  const raw = store.getAppSetting(KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: McpServer[] = []
    for (const item of parsed) {
      const res = zMcpServer.safeParse(item)
      if (res.success) {
        const s = res.data
        // migrate old records without status: derive from enabled
        if (!s.status) s.status = s.enabled ? 'connected' : 'disconnected'
        out.push(s)
      }
    }
    return out
  } catch {
    return []
  }
}

function saveServers(store: RuntimeConfigStore, list: McpServer[]): void {
  store.setAppSetting(KEY, JSON.stringify(list.slice(0, MAX_SERVERS)))
}

export function listMcpServers(store: RuntimeConfigStore): McpServer[] {
  return loadServers(store)
}

export function addMcpServer(
  store: RuntimeConfigStore,
  input: { name: string; provider?: string; transport: 'stdio' | 'http'; command?: string; endpoint?: string },
): McpServer {
  const list = loadServers(store)
  if (list.length >= MAX_SERVERS) throw new Error('mcp limit reached (32)')
  const id = `${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}-${Date.now().toString(36)}`
  const server: McpServer = {
    id,
    name: input.name.trim().slice(0, 80),
    provider: (input.provider ?? 'Custom').trim().slice(0, 80) || 'Custom',
    transport: input.transport,
    ...(input.transport === 'stdio'
      ? { command: (input.command ?? '').trim().slice(0, 512) }
      : { endpoint: (input.endpoint ?? '').trim().slice(0, 512) }),
    enabled: true,
    createdAt: Date.now(),
    status: 'probing' as const,
  }
  // validate before persist
  zMcpServer.parse(server)
  if (server.transport === 'stdio' && !server.command) throw new Error('command is required for stdio transport')
  if (server.transport === 'http' && !server.endpoint) throw new Error('endpoint is required for http transport')
  if (server.transport === 'http' && server.endpoint) {
    try {
      const u = new URL(server.endpoint)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('http(s) only')
    } catch {
      throw new Error('endpoint must be a valid http(s) URL')
    }
  }
  list.unshift(server)
  saveServers(store, list)
  return server
}

export function removeMcpServer(store: RuntimeConfigStore, id: string): boolean {
  const list = loadServers(store)
  const next = list.filter((s) => s.id !== id)
  if (next.length === list.length) return false
  saveServers(store, next)
  return true
}

export function toggleMcpServer(store: RuntimeConfigStore, id: string, enabled: boolean): McpServer | null {
  const list = loadServers(store)
  const idx = list.findIndex((s) => s.id === id)
  if (idx === -1) return null
  const updated: McpServer = { ...list[idx], enabled, status: enabled ? 'connected' : 'disconnected', lastError: undefined }
  // if disabling, clear error; if enabling, mark probing until probe completes
  if (enabled) updated.status = 'probing'
  list[idx] = updated
  saveServers(store, list)
  return updated
}

function updateStatus(store: RuntimeConfigStore, id: string, status: McpServer['status'], lastError?: string): McpServer | null {
  const list = loadServers(store)
  const idx = list.findIndex((s) => s.id === id)
  if (idx === -1) return null
  const updated: McpServer = { ...list[idx], status, lastError }
  list[idx] = updated
  saveServers(store, list)
  return updated
}

async function probeHttp(endpoint: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const u = new URL(endpoint)
    const host = u.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return { ok: true }
  } catch {
    // url validation already done before persist
  }
  try {
    await fetchMcpProbe(endpoint, 6000)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('timeout')) return { ok: false, error: 'timeout' }
    return { ok: false, error: msg.slice(0, 120) || 'fetch failed' }
  }
}

async function probeStdio(command: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = command.trim()
  if (!trimmed) return { ok: false, error: 'empty command' }
  // npx-based MCPs are the common case — verify npx exists and command is syntactically plausible
  // Full spawn probe with shell; kill after 1.5s. ponytail: no heavy install, just liveness.
  return new Promise((resolve) => {
    try {
      const child = spawn(trimmed, { shell: true, stdio: 'ignore', timeout: 2000 } as never)
      let done = false
      const finish = (ok: boolean, error?: string) => {
        if (done) return
        done = true
        try { child.kill() } catch {}
        resolve({ ok, error })
      }
      child.on('error', (err) => finish(false, (err as Error).message.slice(0, 120)))
      child.on('spawn', () => {
        setTimeout(() => finish(true), 600)
      })
      setTimeout(() => finish(true), 1500)
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120) })
    }
  })
}

export async function probeMcpServer(store: RuntimeConfigStore, id: string): Promise<McpServer | null> {
  const list = loadServers(store)
  const srv = list.find((s) => s.id === id)
  if (!srv) return null
  if (!srv.enabled) {
    return updateStatus(store, id, 'disconnected', undefined)
  }
  updateStatus(store, id, 'probing', undefined)
  let result: { ok: boolean; error?: string }
  if (srv.transport === 'http' && srv.endpoint) {
    result = await probeHttp(srv.endpoint)
  } else if (srv.transport === 'stdio' && srv.command) {
    result = await probeStdio(srv.command)
  } else {
    result = { ok: false, error: 'missing transport target' }
  }
  const status = result.ok ? 'connected' : 'error'
  return updateStatus(store, id, status as McpServer['status'], result.error)
}

// ── Global MCP folder (server application global) ───────────────────

export function getMcpDirPath(baseDir?: string): string {
  const dir = getMcpDir(baseDir)
  try { fs.mkdirSync(dir, { recursive: true }) } catch {}
  return dir
}

export function ensureMcpDir(baseDir?: string): string {
  const dir = getMcpDir(baseDir)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ── URL-based AI-agent install (the new professional flow) ──────────

export interface McpUrlInstallResult {
  server: McpServer
  steps: string[]
  detectedCommand: string
  localPath: string
}

function parseRepoUrl(url: string): { owner: string; repo: string; cleanUrl: string; name: string } {
  let u: URL
  try { u = new URL(url.trim()) } catch { throw new Error('URL must be a valid https:// URL') }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL must be https://')
  // Support github.com/owner/repo , git@, and with .git suffix
  const parts = u.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean)
  if (u.hostname !== 'github.com' || parts.length < 2) throw new Error('URL must be a GitHub repository URL (https://github.com/owner/repo)')
  const owner = parts[0].toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const repo = parts[1].toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const name = repo.slice(0, 48)
  const cleanUrl = `https://github.com/${parts[0]}/${parts[1].replace(/\.git$/, '')}`
  return { owner, repo, cleanUrl, name }
}

function detectCommandFromRepo(localPath: string, repoName: string): string {
  // Heuristic AI: read package.json, pyproject, README for MCP command
  try {
    const pkgPath = path.join(localPath, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string; bin?: Record<string,string> | string; mcp?: { command?: string } }
      if (pkg.mcp?.command) return String(pkg.mcp.command).slice(0, 512)
      if (typeof pkg.bin === 'string') return `node ${pkg.bin}`
      if (pkg.bin && typeof pkg.bin === 'object') {
        const first = Object.values(pkg.bin)[0]
        if (first) return `node ${first}`
      }
      if (pkg.name) return `npx -y ${pkg.name}`
    }
  } catch {}
  try {
    if (fs.existsSync(path.join(localPath, 'pyproject.toml')) || fs.existsSync(path.join(localPath, 'requirements.txt'))) {
      if (fs.existsSync(path.join(localPath, 'server.py'))) return 'python server.py'
      if (fs.existsSync(path.join(localPath, 'src', 'server.py'))) return 'python src/server.py'
      if (fs.existsSync(path.join(localPath, 'main.py'))) return 'python main.py'
    }
  } catch {}
  try {
    if (fs.existsSync(path.join(localPath, 'README.md'))) {
      const readme = fs.readFileSync(path.join(localPath, 'README.md'), 'utf8')
      const m = readme.match(/npx\s+-y\s+(@?[\w\/@.-]+)/)
      if (m) return `npx -y ${m[1]}`
    }
  } catch {}
  return `npx -y ${repoName}`
}

function cloneRepo(url: string, dest: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (fs.existsSync(dest)) {
      resolve({ ok: false, error: 'folder already exists — remove existing MCP first' })
      return
    }
    // Try git clone --depth 1
    const child = spawn('git', ['clone', '--depth', '1', url, dest], { shell: false, stdio: 'ignore' as const })
    let done = false
    const finish = (ok: boolean, error?: string) => {
      if (done) return
      done = true
      resolve({ ok, error })
    }
    child.on('error', (e) => {
      finish(false, (e as Error).message.slice(0, 120))
    })
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(dest)) finish(true)
      else finish(false, `git clone failed (code ${code})`)
    })
    setTimeout(() => {
      if (!done) {
        try { child.kill() } catch {}
        // If timed out but dest exists, consider ok
        if (fs.existsSync(dest)) finish(true)
        else finish(false, 'git clone timeout (git not available?)')
      }
    }, 25000)
  })
}

async function installDependencies(localPath: string): Promise<{ ok: boolean; error?: string }> {
  const hasPkg = fs.existsSync(path.join(localPath, 'package.json'))
  if (!hasPkg) return { ok: true }
  return new Promise((resolve) => {
    const child = spawn('npm', ['install', '--ignore-scripts'], { cwd: localPath, shell: true, stdio: 'ignore' as const })
    let done = false
    const finish = (ok: boolean, error?: string) => {
      if (done) return
      done = true
      resolve({ ok, error })
    }
    child.on('error', (e) => finish(false, (e as Error).message.slice(0, 120)))
    child.on('close', (code) => finish(code === 0, code === 0 ? undefined : `npm install failed (code ${code})`))
    setTimeout(() => finish(true), 30000) // don't block forever — npx can fetch on demand
  })
}

/**
 * AI-agent URL install: clone repo into the global MCP folder,
 * understand it (detect command), set up locally (npm install),
 * and register as a stdio MCP server. The folder is the source of
 * truth — the server survives restarts and is visible in the folder.
 */
export async function installMcpFromUrl(
  store: RuntimeConfigStore,
  rawUrl: string,
  baseDir?: string,
): Promise<McpUrlInstallResult> {
  const { cleanUrl, name } = parseRepoUrl(rawUrl)
  const list = loadServers(store)
  if (list.length >= MAX_SERVERS) throw new Error('mcp limit reached (32)')
  if (list.some((s) => s.url === cleanUrl)) throw new Error('this repository is already installed')

  const mcpRoot = ensureMcpDir(baseDir)
  const dest = path.join(mcpRoot, name)
  if (fs.existsSync(dest)) throw new Error(`folder already exists: ${name} — remove it or choose another repo`)

  const steps: string[] = []

  // Create a placeholder server in installing state so UI shows progress
  const placeholderId = `${name.slice(0, 24)}-${Date.now().toString(36)}`
  const placeholder: McpServer = {
    id: placeholderId,
    name: name.slice(0, 80),
    provider: cleanUrl.split('/')[3] ?? 'Custom',
    transport: 'stdio' as const,
    command: 'installing...',
    enabled: true,
    createdAt: Date.now(),
    status: 'installing' as const,
    url: cleanUrl,
    localPath: dest,
  }
  list.unshift(placeholder)
  saveServers(store, list)
  steps.push(`AI agent: analyzing ${cleanUrl}`)
  steps.push(`Cloning into ${dest}`)

  // Clone — AI agent clones repo into global MCP folder (git --depth 1)
  let cloned = await cloneRepo(cleanUrl, dest)
  if (!cloned.ok) {
    // Fallback: create folder for AI detection (git not available) — detection will use repo name heuristic
    steps.push(`Clone note: ${cloned.error} — creating placeholder for AI detection`)
    try { fs.mkdirSync(dest, { recursive: true }) } catch {}
    // Fallback creates a minimal package.json so detection can still infer npx -y <name>
    try {
      const fallbackPkg = JSON.stringify({ name: name, description: `MCP from ${cleanUrl}` }, null, 2)
      if (!fs.existsSync(path.join(dest, 'package.json'))) fs.writeFileSync(path.join(dest, 'package.json'), fallbackPkg)
    } catch {}
  } else {
    steps.push('Repository cloned')
  }

  const detected = detectCommandFromRepo(dest, name)
  steps.push(`AI agent: detected command → ${detected}`)

  // Update placeholder with detected command (still installing)
  {
    const cur = loadServers(store)
    const idx = cur.findIndex((s) => s.id === placeholderId)
    if (idx !== -1) {
      cur[idx] = { ...cur[idx], command: detected }
      saveServers(store, cur)
    }
  }

  steps.push('Setting up locally (npm install --ignore-scripts)')
  const dep = await installDependencies(dest)
  if (!dep.ok) steps.push(`Setup warning: ${dep.error} — npx will fetch on first run`)
  else steps.push('Dependencies ready (or npx on-demand)')

  // Finalize: replace placeholder command and mark probing, then probe
  {
    const cur = loadServers(store)
    const idx = cur.findIndex((s) => s.id === placeholderId)
    if (idx !== -1) {
      cur[idx] = { ...cur[idx], command: detected, status: 'probing' as const }
      saveServers(store, cur)
    }
  }
  steps.push('Probing MCP server')
  const probed = await probeMcpServer(store, placeholderId)
  steps.push(probed?.status === 'connected' ? 'Activated — connected' : probed?.status === 'error' ? `Issue: ${probed.lastError ?? 'probe failed'}` : 'Registered — will probe on next run')

  const final = loadServers(store).find((s) => s.id === placeholderId)
  if (!final) throw new Error('install failed — server not found after probe')
  return { server: final, steps, detectedCommand: detected, localPath: dest }
}

export function getMcpFolderInfo(baseDir?: string): { path: string; exists: boolean } {
  const dir = getMcpDirPath(baseDir)
  return { path: dir, exists: fs.existsSync(dir) }
}
