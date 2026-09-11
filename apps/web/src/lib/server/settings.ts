/**
 * Settings service — server-side boundary for preferences, exec modes,
 * tools, usage stats, updates, and version. Same surface as the
 * `settings:*` / `exec:*` / `tools:*` / `usage:*` / `updates:*` /
 * `app:getVersion` IPC handlers.
 */

import 'server-only'
import { zExecMode, zSettingsSet, zToolDispatch, zUsageGetRecent } from '@shared/ipc/schemas'
import { getBackend } from './backend'

export async function getSettings() {
  const backend = await getBackend()
  return { ...backend.getAppSettings(), version: backend.getAppVersion() }
}

export async function setSettings(raw: unknown) {
  const data = zSettingsSet.parse(raw ?? {})
  const backend = await getBackend()
  return { ...backend.setAppSettings(data), version: backend.getAppVersion() }
}

export async function getVersion() {
  return { version: (await getBackend()).getAppVersion() }
}

export async function checkUpdates() {
  const backend = await getBackend()
  const settings = backend.getAppSettings()
  const { checkForUpdates } = await import('@sovara-main/services/updateFeed')
  const result = await checkForUpdates(settings.updateFeedUrl, backend.getAppVersion())
  backend.recordUpdateCheck(result.status)
  return result
}

export async function getExecMode() {
  return { mode: (await getBackend()).getExecMode() }
}

export async function setExecMode(raw: unknown) {
  const mode = zExecMode.parse(raw)
  return { mode: (await getBackend()).setExecMode(mode) }
}

export async function listTools() {
  return (await getBackend()).ports.tools.list()
}

export async function dispatchTool(raw: unknown) {
  const data = zToolDispatch.parse(raw)
  const backend = await getBackend()
  const { gateDispatch } = await import('@sovara-main/services/execPermissions')
  const verdict = gateDispatch(backend.getExecMode(), data.name)
  if (!verdict.allowed) {
    return { ok: false, blocked: true, reason: verdict.reason, message: verdict.message }
  }
  const result = await backend.ports.tools.dispatch(data.name, data.args as Record<string, unknown>)
  return { ok: true, autoApproved: verdict.autoApproved, result }
}

export async function getTotalUsage() {
  return (await getBackend()).ports.persistence.getTotalUsage()
}

export async function getUsageByModel() {
  return (await getBackend()).ports.persistence.getUsageByModel()
}

export async function getRecentUsage(raw: unknown) {
  const data = zUsageGetRecent.parse(raw ?? {})
  const limit = data.limit ?? 20
  return (await getBackend()).ports.persistence.getRecentUsage?.(limit) ?? []
}
