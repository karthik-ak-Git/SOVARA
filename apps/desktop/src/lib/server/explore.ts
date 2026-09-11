/**
 * Explore service — server-side boundary for the Hugging Face catalog.
 * Listing/detail/compatibility/recommendations run here (single cached
 * hardware read + single registry read per listing — N+1-free, IPC parity).
 */

import 'server-only'
import {
  zExploreGetCompatibility,
  zExploreGetModel,
  zExploreGetRecommendations,
  zExploreListModels,
} from '@shared/ipc/schemas'
import type { HardwareInfo } from '@shared/types/explore'
import { getBackend } from './backend'

export async function listModelsPage(raw: unknown) {
  const data = zExploreListModels.parse(raw ?? {})
  const { listExplorerModelsPage } = await import('@sovara-main/services/explorerCatalog')
  const { getCachedHardwareProfile } = await import('@sovara-main/services/explorerCatalog')
  const backend = await getBackend()
  const scopeQuery = [data.query ?? '', (data as { pipelineTag?: string }).pipelineTag ?? '', (data as { tag?: string }).tag ?? '']
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
  const hw = getCachedHardwareProfile()
  return listExplorerModelsPage(
    {
      sortBy: data.sortBy ?? 'Recommended',
      query: scopeQuery,
      limit: data.limit ?? 30,
      format: data.format ?? 'all',
      quants: data.quants ?? [],
      params: data.params ?? 'all',
      licenses: data.licenses ?? [],
      capabilities: data.capabilities ?? [],
      gated: data.gated ?? 'all',
      downloaded: data.downloaded ?? 'all',
      compat: data.compat ?? 'all',
      cursor: data.cursor,
    },
    undefined,
    { hw, installedByRepo: backend.listInstalledWeightKeys() }
  )
}

export async function getModel(modelId: string) {
  const data = zExploreGetModel.parse({ modelId })
  const { getExplorerModel } = await import('@sovara-main/services/explorerCatalog')
  return getExplorerModel(data.modelId)
}

export async function getCompatibility(raw: unknown) {
  const data = zExploreGetCompatibility.parse(raw)
  const { getExplorerModel, getCachedHardwareProfile } = await import(
    '@sovara-main/services/explorerCatalog'
  )
  const { fitExplorerFiles, toCompatibility } = await import('@sovara-main/services/explorerFit')
  const model = await getExplorerModel(data.modelId)
  const hw: HardwareInfo = getCachedHardwareProfile()
  const fits = fitExplorerFiles(model, hw)
  const top = fits.find((f) => f.isRecommended) ?? fits[0]
  if (!top) {
    return { fitsInMemory: false, estimatedRamUsageGB: 0, message: 'No downloadable files.', severity: 'too-large' as const }
  }
  return toCompatibility(top)
}

export async function getRecommendations(raw: unknown) {
  const data = zExploreGetRecommendations.parse(raw)
  const { getExplorerModel, getCachedHardwareProfile } = await import(
    '@sovara-main/services/explorerCatalog'
  )
  const { fitExplorerFiles } = await import('@sovara-main/services/explorerFit')
  const model = await getExplorerModel(data.modelId)
  const hw: HardwareInfo = getCachedHardwareProfile()
  return fitExplorerFiles(model, hw).map((r, rank) => ({
    file: model.files[r.index],
    index: r.index,
    estimatedRamGB: r.needGB,
    severity: (r.fit === 'willNotFit' ? 'too-large' : r.fit === 'partialGPUOffload' ? 'tight' : 'good') as 'good' | 'tight' | 'too-large',
    rank,
    reason: r.message,
  }))
}
