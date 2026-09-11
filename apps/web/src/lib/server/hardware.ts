/**
 * Hardware service — server-side source for system resources and profiles.
 * All values come from real local detection (never hardcoded); dynamic
 * readings (GPU util, VRAM) are fetched live per request, never cached.
 */

import 'server-only'
import { getBackend } from './backend'

export async function getSystemResources() {
  return (await getBackend()).ports.resources.getSnapshot()
}

export async function getFullHardwareProfile() {
  return (await getBackend()).getFullHardwareProfile()
}

/** 30s-cached explorer profile (warms once per listing burst — IPC parity). */
export async function getCachedExplorerProfile() {
  const { getCachedHardwareProfile } = await import('@sovara-main/services/explorerCatalog')
  return getCachedHardwareProfile()
}

export async function getAppSystem() {
  return (await getBackend()).getSystem()
}
