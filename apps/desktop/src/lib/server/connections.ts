/**
 * Connections (MCP) service — server-side boundary for MCP server lifecycle.
 * Same surface as the `mcp:*` IPC handlers. The web server cannot open a
 * native file explorer, so `openFolder` returns the ensured path for display.
 */

import 'server-only'
import { zMcpAdd, zMcpId, zMcpInstallFromUrl, zMcpToggle } from '@shared/ipc/schemas'
import { getBackend } from './backend'

export async function listServers() {
  return (await getBackend()).listMcpServers()
}

export async function addServer(raw: unknown) {
  const data = zMcpAdd.parse(raw)
  return (await getBackend()).addMcpServer(data)
}

export async function installFromUrl(raw: unknown) {
  const data = zMcpInstallFromUrl.parse(raw)
  return (await getBackend()).installMcpFromUrl(data.url)
}

export async function getDir() {
  const backend = await getBackend()
  return { path: backend.getMcpDir(), exists: true }
}

export async function openFolder() {
  const backend = await getBackend()
  const dir = backend.ensureMcpDir()
  return { ok: true, path: dir }
}

export async function removeServer(raw: unknown) {
  const data = zMcpId.parse(raw)
  const ok = (await getBackend()).removeMcpServer(data.id)
  if (!ok) throw new Error('unknown mcp server')
  return { ok: true }
}

export async function toggleServer(raw: unknown) {
  const data = zMcpToggle.parse(raw)
  const server = (await getBackend()).toggleMcpServer(data.id, data.enabled)
  if (!server) throw new Error('unknown mcp server')
  return server
}

export async function probeServer(raw: unknown) {
  const data = zMcpId.parse(raw)
  const server = (await getBackend()).probeMcpServer(data.id)
  if (!server) throw new Error('unknown mcp server')
  return server
}
