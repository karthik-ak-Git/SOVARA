/**
 * Model service — server-side boundary for model lifecycle operations.
 *
 * Covers the workbench facet (registry/probe/select), the owned llama.cpp
 * runtime (probe/install), and the legacy runtime-agnostic trio — the same
 * surface as the `models:*` IPC handlers. Model load/unload runs here on the
 * server; the browser only receives status.
 */

import 'server-only'
import {
  zModelsAddRuntime,
  zModelsEnsureRuntime,
  zModelsListModels,
  zModelsLoad,
  zModelsProbe,
  zModelsRegistryList,
  zModelsRegistryPath,
  zModelsRegistryRef,
  zModelsRegistryUpdate,
  zModelsRuntimeRef,
  zModelsSelect,
} from '@shared/ipc/schemas'
import { getBackend, downloadEmit } from './backend'

export async function listLocalModels() {
  return (await getBackend()).ports.models.listLocalModels()
}

export async function probeOwnedRuntime(runtimeId: string) {
  const id = zModelsProbe.parse(runtimeId)
  return (await getBackend()).ports.models.probeRuntime(id)
}

export async function loadModel(raw: unknown) {
  const data = zModelsLoad.parse(raw)
  return (await getBackend()).ports.models.load(
    data.modelId as import('@shared/types/branded').ModelId,
    data.fit ? { gpu: 'fit' } : {}
  )
}

/** One-time owned-runtime install; progress streams to SSE `events:download`. */
export async function ensureLocalRuntime(raw: unknown) {
  zModelsEnsureRuntime.parse(raw ?? {})
  return (await getBackend()).ensureLocalRuntime((p) => {
    downloadEmit({
      modelId: '__sovara_runtime__',
      rfilename: 'llama-server (CUDA)',
      state: p.phase === 'ready' ? 'done' : p.phase === 'downloading' ? 'progress' : 'started',
      receivedBytes: p.receivedBytes,
      totalBytes: p.totalBytes,
    })
  })
}

export async function listRuntimes() {
  return (await getBackend()).workbench.listRuntimes()
}

export async function addRuntime(raw: unknown) {
  const data = zModelsAddRuntime.parse(raw)
  return (await getBackend()).workbench.addRuntime(data)
}

export async function removeRuntime(raw: unknown) {
  const data = zModelsRuntimeRef.parse(raw)
  const removed = (await getBackend()).workbench.removeRuntime(data.runtimeId)
  if (!removed) throw new Error('unknown runtime')
  return { ok: true }
}

export async function testConnection(raw: unknown) {
  const data = zModelsRuntimeRef.parse(raw)
  return (await getBackend()).workbench.probeRuntime(data.runtimeId)
}

export async function listModels(raw: unknown) {
  const data = zModelsListModels.parse(raw ?? {})
  return (await getBackend()).workbench.listModels(data.runtimeId)
}

export async function selectModel(raw: unknown) {
  const data = zModelsSelect.parse(raw)
  return (await getBackend()).workbench.selectModel(data.runtimeId, data.modelId, { fit: data.fit })
}

export async function getActiveModel() {
  return (await getBackend()).workbench.getActiveModel()
}

export async function listRegistry(raw: unknown) {
  const data = zModelsRegistryList.parse(raw ?? {})
  return (await getBackend()).workbench.listRegistryRows(data.runtimeId)
}

export async function updateRegistry(raw: unknown) {
  const data = zModelsRegistryUpdate.parse(raw)
  ;(await getBackend()).workbench.updateRegistryRow(data.id, data.patch)
  return { ok: true }
}

export async function removeRegistry(raw: unknown) {
  const data = zModelsRegistryRef.parse(raw)
  ;(await getBackend()).workbench.removeRegistryRow(data.id)
  return { ok: true }
}

export async function removeRegistryByPath(raw: unknown) {
  const data = zModelsRegistryPath.parse(raw)
  ;(await getBackend()).workbench.removeRegistryRowsByPath(data.localPath)
  return { ok: true }
}
