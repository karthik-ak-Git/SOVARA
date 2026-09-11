/**
 * Library service — server-side boundary for the local model library.
 * Filesystem scans, download orchestration, and reconciliation stay here;
 * the browser only receives metadata + progress (via SSE `events:download`).
 * Same surface as the `library:*` IPC handlers.
 */

import 'server-only'
import {
  zLibraryCancel,
  zLibraryDelete,
  zLibraryDownload,
  zLibraryFileRef,
  zLibraryIsDownloaded,
  zLibrarySetDirectory,
} from '@shared/ipc/schemas'
import { getBackend, downloadEmit } from './backend'

export async function listLibrary() {
  return (await getBackend()).scanLibrary()
}

export async function getLibraryDirectory() {
  return { path: (await getBackend()).getLibraryDir() }
}

export async function detectLocations() {
  return (await getBackend()).detectModelLocations()
}

export async function setLibraryDirectory(raw: unknown) {
  const data = zLibrarySetDirectory.parse(raw ?? {})
  const explicit = data.path.trim()
  // Web has no native folder dialog: an explicit absolute path wins.
  // Empty path without a dialog resolves to the current directory (IPC parity
  // for the cancel path returns ok:false + current path).
  if (explicit) return { ok: true, path: (await getBackend()).setLibraryDir(explicit) }
  return { ok: false as const, path: (await getBackend()).getLibraryDir() }
}

export async function startDownload(raw: unknown) {
  const data = zLibraryDownload.parse(raw)
  return (await getBackend()).startModelDownload(
    data.modelId,
    data.rfilename,
    data.downloadUrl,
    downloadEmit,
    {
      parts: data.parts,
      companion: data.companion,
      revision: data.revision,
      format: data.format,
      quantization: data.quantization,
      license: data.license,
      gated: data.gated,
    }
  )
}

export async function cancelDownload(raw: unknown) {
  const data = zLibraryCancel.parse(raw)
  return { cancelled: (await getBackend()).cancelModelDownload(data.modelId, data.rfilename) }
}

export async function pauseDownload(raw: unknown) {
  const data = zLibraryCancel.parse(raw)
  return { paused: (await getBackend()).pauseModelDownload(data.modelId, data.rfilename) }
}

export async function resumeDownload(raw: unknown) {
  const data = zLibraryDownload.parse(raw)
  return {
    resumed: (await getBackend()).resumeModelDownload(
      data.modelId,
      data.rfilename,
      data.downloadUrl,
      downloadEmit,
      data.revision
    ),
  }
}

export async function getActiveDownloads() {
  return (await getBackend()).getActiveDownloads()
}

export async function isDownloaded(raw: unknown) {
  const data = zLibraryIsDownloaded.parse(raw)
  return { downloaded: (await getBackend()).isDownloaded(data.modelId, data.rfilename) }
}

export async function getFileStatus(raw: unknown) {
  const data = zLibraryFileRef.parse(raw)
  return (await getBackend()).getFileStatus(data.modelId, data.rfilename, data.revision)
}

export async function reconcile() {
  return (await getBackend()).reconcileLibrary()
}

export async function deleteEntry(raw: unknown) {
  const data = zLibraryDelete.parse(raw)
  ;(await getBackend()).deleteLibraryEntry(data.path)
  return { ok: true }
}

/**
 * Trusted folder resolution confined to the library (same guard as IPC).
 * The web server cannot open a native file explorer, so it returns the
 * resolved path for display instead of shell.openPath.
 */
export async function getModelFolder(raw: unknown) {
  const data = zLibraryFileRef.parse(raw)
  const dir = (await getBackend()).getModelFolder(data.modelId, data.rfilename, data.revision)
  return { ok: true, path: dir }
}
