import type { HardwareInfo, CompatibilityResult, ExploreModel } from '@shared/types/explore'

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
