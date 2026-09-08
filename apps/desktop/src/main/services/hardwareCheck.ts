import type { HardwareInfo, CompatibilityResult, ExploreModel, ExploreModelFile } from '@shared/types/explore'

export interface FileRecommendation {
  file: ExploreModelFile
  index: number
  estimatedRamGB: number
  severity: CompatibilityResult['severity']
  rank: number // 0 = best recommendation
  reason: string
}

/**
 * Estimates whether a model can run on the user's system.
 * Uses a simple heuristic: ~1.2x the file size as RAM/VRAM estimate
 * (accounts for runtime overhead beyond the raw weights).
 */
export function estimateCompatibility(model: ExploreModel, hw: HardwareInfo): CompatibilityResult {
  // Pick the smallest available file as the baseline
  const smallestFile = model.files.reduce((min, f) => (f.sizeGB < min.sizeGB ? f : min), model.files[0])
  const fileSizeGB = smallestFile.sizeGB

  // Runtime overhead multiplier: GGUF needs ~1.2x, MLX ~1.1x
  const multiplier = smallestFile.format === 'MLX' ? 1.1 : 1.2
  const estimatedRamGB = fileSizeGB * multiplier

  // Check available memory
  const availableGB = Math.max(hw.freeRamMB / 1024, (hw.freeVramMB ?? 0) / 1024)
  const totalSystemGB = hw.totalRamMB / 1024

  if (estimatedRamGB > totalSystemGB) {
    return {
      fitsInMemory: false,
      estimatedRamUsageGB: estimatedRamGB,
      message: `Likely too large. Needs ~${estimatedRamGB.toFixed(1)} GB but system has ${totalSystemGB.toFixed(0)} GB total.`,
      severity: 'too-large',
    }
  }

  if (estimatedRamGB > availableGB * 0.9) {
    return {
      fitsInMemory: false,
      estimatedRamUsageGB: estimatedRamGB,
      message: `Might be tight. Needs ~${estimatedRamGB.toFixed(1)} GB but only ${availableGB.toFixed(1)} GB free.`,
      severity: 'tight',
    }
  }

  if (hw.gpuAvailable && hw.totalVramMB) {
    const vramGB = hw.totalVramMB / 1024
    if (estimatedRamGB > vramGB) {
      return {
        fitsInMemory: true,
        estimatedRamUsageGB: estimatedRamGB,
        estimatedVramUsageGB: estimatedRamGB,
        message: `Will fit in system RAM (${totalSystemGB.toFixed(0)} GB) but may exceed GPU VRAM (${vramGB.toFixed(0)} GB). CPU inference likely.`,
        severity: 'tight',
      }
    }
    return {
      fitsInMemory: true,
      estimatedRamUsageGB: estimatedRamGB,
      estimatedVramUsageGB: estimatedRamGB,
      message: `Should run on GPU. Needs ~${estimatedRamGB.toFixed(1)} GB, GPU has ${vramGB.toFixed(0)} GB VRAM.`,
      severity: 'good',
    }
  }

  return {
    fitsInMemory: true,
    estimatedRamUsageGB: estimatedRamGB,
    message: `Should run on CPU. Needs ~${estimatedRamGB.toFixed(1)} GB, system has ${totalSystemGB.toFixed(0)} GB RAM.`,
    severity: 'good',
  }
}

function severityForFile(file: ExploreModelFile, hw: HardwareInfo): { severity: CompatibilityResult['severity']; estimatedRamGB: number; fits: boolean } {
  const bytes = file.sizeBytes ?? file.sizeGB * 1024 ** 3
  const sizeGB = bytes > 0 ? bytes / (1024 ** 3) : file.sizeGB
  const multiplier = file.format === 'MLX' ? 1.1 : 1.2
  const estimatedRamGB = (sizeGB || 0) * multiplier
  if (estimatedRamGB === 0) return { severity: 'good', estimatedRamGB: 0, fits: true }
  const totalSystemGB = hw.totalRamMB / 1024
  const availableGB = Math.max(hw.freeRamMB / 1024, (hw.freeVramMB ?? 0) / 1024)
  if (estimatedRamGB > totalSystemGB) return { severity: 'too-large', estimatedRamGB, fits: false }
  if (estimatedRamGB > availableGB * 0.9) return { severity: 'tight', estimatedRamGB, fits: false }
  if (hw.gpuAvailable && hw.totalVramMB) {
    const vramGB = hw.totalVramMB / 1024
    if (estimatedRamGB > vramGB) return { severity: 'tight', estimatedRamGB, fits: true }
  }
  return { severity: 'good', estimatedRamGB, fits: true }
}

function quantRank(q?: string): number {
  if (!q) return 0
  // Higher quality quant → higher rank: Q8_0 > Q6_K > Q5_K_M > Q4_K_M > Q4_0 …
  const order: Record<string, number> = {
    Q8_0: 80, Q6_K: 60, Q5_K_M: 50, Q5_K_S: 48, Q5_0: 45,
    Q4_K_M: 40, Q4_K_S: 38, Q4_0: 35, Q3_K_M: 30, Q3_K_S: 28, Q2_K: 20,
  }
  return order[q] ?? 10
}

/**
 * Intelligent system-aware ranking: for each file decide fit, then rank.
 * Preference: largest `good` file (best quality that fits), else smallest `tight`, else smallest overall.
 */
export function recommendFiles(model: ExploreModel, hw: HardwareInfo): FileRecommendation[] {
  if (model.files.length === 0) return []
  const evaluated = model.files.map((file, index) => {
    const { severity, estimatedRamGB } = severityForFile(file, hw)
    const qRank = quantRank(file.quantization)
    const sizeScore = estimatedRamGB
    return { file, index, estimatedRamGB, severity, qRank, sizeScore }
  })

  // Sort for ranking: good > tight > too-large, then larger size / higher quant preferred within good
  const sorted = [...evaluated].sort((a, b) => {
    const sevOrder = { good: 0, tight: 1, 'too-large': 2 } as const
    if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity]
    if (a.severity === 'good' && b.severity === 'good') {
      // Prefer larger + higher quant when it still fits (better quality)
      if (b.sizeScore !== a.sizeScore) return b.sizeScore - a.sizeScore
      return b.qRank - a.qRank
    }
    // For tight/too-large prefer smaller
    if (a.sizeScore !== b.sizeScore) return a.sizeScore - b.sizeScore
    return b.qRank - a.qRank
  })

  return sorted.map((e, rank) => {
    let reason = ''
    if (e.severity === 'good') reason = `Fits your system · ~${e.estimatedRamGB.toFixed(1)} GB · best quality`
    else if (e.severity === 'tight') reason = `Might be tight · ~${e.estimatedRamGB.toFixed(1)} GB`
    else reason = `Likely too large · ~${e.estimatedRamGB.toFixed(1)} GB`
    if (rank === 0 && e.severity === 'good') reason = `★ Recommended for your system — ${reason}`
    return {
      file: e.file,
      index: e.index,
      estimatedRamGB: e.estimatedRamGB,
      severity: e.severity,
      rank,
      reason,
    }
  })
}

export function getRecommendedFileIndex(model: ExploreModel, hw: HardwareInfo): number | null {
  const recs = recommendFiles(model, hw)
  if (recs.length === 0) return null
  // Return original index of best good, else best tight, else smallest
  return recs[0].index
}
