/**
 * Instance service — server-side boundary for loaded-model monitoring.
 * Unload releases runtime resources (never deletes model files).
 * Same surface as the `instances:*` IPC handlers.
 */

import 'server-only'
import { zInstanceId } from '@shared/ipc/schemas'
import { getBackend } from './backend'

export async function listInstances() {
  return (await getBackend()).ports.models.listInstances()
}

export async function unloadInstance(raw: unknown) {
  const data = zInstanceId.parse(raw)
  await (await getBackend()).ports.models.unload(
    data.instanceId as import('@shared/types/branded').InstanceId
  )
  return { ok: true }
}

export async function getInstanceMetrics(raw: unknown) {
  const data = zInstanceId.parse(raw)
  return (await getBackend()).ports.models.health(
    data.instanceId as import('@shared/types/branded').InstanceId
  )
}
