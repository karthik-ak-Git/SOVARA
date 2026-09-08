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
  if (!model.files || model.files.length === 0) {
    return { fitsInMemory: false, estimatedRamUsageGB: 0, message: 'No downloadable files found for this model.', severity: 'too-large' }
  }
  // Pick the smallest available file as the baseline for overall model check
  const smallestFile = model.files.reduce((min, f) => (f.sizeGB < min.sizeGB ? f : min), model.files[0])
  const fileSizeGB = smallestFile.sizeGB
  const multiplier = smallestFile.format === 'MLX' ? 1.1 : 1.22
  const estimatedNeedGB = fileSizeGB * multiplier

  const totalRamGB = hw.totalRamMB / 1024
  const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
  const freeVramGB = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined

  // VRAM-aware primary path: models load in VRAM, not just RAM
  if (hw.gpuAvailable && totalVramGB) {
    const vram = totalVramGB
    const freeV = freeVramGB ?? vram * 0.85
    if (estimatedNeedGB > vram) {
      return {
        fitsInMemory: false,
        estimatedRamUsageGB: estimatedNeedGB,
        estimatedVramUsageGB: estimatedNeedGB,
        message: `Needs ~${estimatedNeedGB.toFixed(1)} GB VRAM but GPU has ${vram.toFixed(1)} GB. Try a smaller quant (Q4_K_M) or CPU offload.`,
        severity: 'too-large',
      }
    }
    if (estimatedNeedGB > freeV * 0.92) {
      return {
        fitsInMemory: true,
        estimatedRamUsageGB: estimatedNeedGB,
        estimatedVramUsageGB: estimatedNeedGB,
        message: `Fits VRAM but tight: ~${estimatedNeedGB.toFixed(1)} GB / ${vram.toFixed(1)} GB free ${freeV.toFixed(1)} GB. Close other GPU apps.`,
        severity: 'tight',
      }
    }
    return {
      fitsInMemory: true,
      estimatedRamUsageGB: estimatedNeedGB,
      estimatedVramUsageGB: estimatedNeedGB,
      message: `✓ Fits in VRAM: ~${estimatedNeedGB.toFixed(1)} GB / ${vram.toFixed(1)} GB (${hw.gpuName ?? 'GPU'}) — optimal for fast inference.`,
      severity: 'good',
    }
  }

  // CPU-only fallback: check RAM
  const availableRamGB = hw.freeRamMB / 1024
  if (estimatedNeedGB > totalRamGB) {
    return {
      fitsInMemory: false,
      estimatedRamUsageGB: estimatedNeedGB,
      message: `Likely too large for CPU. Needs ~${estimatedNeedGB.toFixed(1)} GB but system has ${totalRamGB.toFixed(0)} GB RAM. No dedicated GPU detected.`,
      severity: 'too-large',
    }
  }
  if (estimatedNeedGB > availableRamGB * 0.9) {
    return {
      fitsInMemory: false,
      estimatedRamUsageGB: estimatedNeedGB,
      message: `Might be tight on CPU: needs ~${estimatedNeedGB.toFixed(1)} GB, only ${availableRamGB.toFixed(1)} GB free. Close apps or pick smaller quant.`,
      severity: 'tight',
    }
  }
  return {
    fitsInMemory: true,
    estimatedRamUsageGB: estimatedNeedGB,
    message: `Will run on CPU (no VRAM): ~${estimatedNeedGB.toFixed(1)} GB / ${totalRamGB.toFixed(0)} GB RAM. GPU acceleration not available — expect slower inference.`,
    severity: 'good',
  }
}

function severityForFile(file: ExploreModelFile, hw: HardwareInfo): { severity: CompatibilityResult['severity']; estimatedRamGB: number; fits: boolean } {
  const bytes = file.sizeBytes ?? file.sizeGB * 1024 ** 3
  const sizeGB = bytes > 0 ? bytes / (1024 ** 3) : file.sizeGB
  const multiplier = file.format === 'MLX' ? 1.1 : 1.22
  const estimatedNeedGB = (sizeGB || 0) * multiplier
  if (estimatedNeedGB === 0) return { severity: 'good', estimatedRamGB: 0, fits: true }
  const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
  const freeVramGB = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined
  // VRAM primary
  if (hw.gpuAvailable && totalVramGB) {
    const vram = totalVramGB
    const freeV = freeVramGB ?? vram * 0.85
    if (estimatedNeedGB > vram) return { severity: 'too-large', estimatedRamGB: estimatedNeedGB, fits: false }
    if (estimatedNeedGB > freeV * 0.92) return { severity: 'tight', estimatedRamGB: estimatedNeedGB, fits: true }
    return { severity: 'good', estimatedRamGB: estimatedNeedGB, fits: true }
  }
  const totalRamGB = hw.totalRamMB / 1024
  const availableRamGB = hw.freeRamMB / 1024
  if (estimatedNeedGB > totalRamGB) return { severity: 'too-large', estimatedRamGB: estimatedNeedGB, fits: false }
  if (estimatedNeedGB > availableRamGB * 0.9) return { severity: 'tight', estimatedRamGB: estimatedNeedGB, fits: false }
  return { severity: 'good', estimatedRamGB: estimatedNeedGB, fits: true }
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
