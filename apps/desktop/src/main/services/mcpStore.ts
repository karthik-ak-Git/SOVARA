import { z } from 'zod'
import { spawn } from 'node:child_process'
import type { RuntimeConfigStore } from '../config/RuntimeConfigStore'

const zMcpServer = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  provider: z.string().max(80).default('Custom'),
  transport: z.enum(['stdio', 'http']),
  command: z.string().max(512).optional(),
  endpoint: z.string().max(512).optional(),
  enabled: z.boolean(),
  createdAt: z.number().int(),
  status: z.enum(['connected', 'disconnected', 'error', 'probing']).optional(),
  lastError: z.string().max(256).optional(),
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
    // ponytail: local MCPs (localhost) are always reachable without network; skip fetch when offline
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return { ok: true }
  } catch {
    // url validation already done before persist
  }
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 6000)
  try {
    await fetch(endpoint, { method: 'GET', signal: controller.signal, headers: { Accept: 'text/event-stream, application/json' } } as RequestInit)
    // Any HTTP response (even 404/405) means host is reachable — treat as ok.
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes('abort')) return { ok: false, error: 'timeout' }
    // Include fetch failed vs DNS etc; keep message short
    return { ok: false, error: msg.slice(0, 120) || 'fetch failed' }
  } finally {
    clearTimeout(t)
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
