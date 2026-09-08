import { z } from 'zod'
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
      if (res.success) out.push(res.data)
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
  const updated = { ...list[idx], enabled } as McpServer
  list[idx] = updated
  saveServers(store, list)
  return updated
}
