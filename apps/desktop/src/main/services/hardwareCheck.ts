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
    // Fallback to repo size / params even when no files listed
    const fallbackGB = (() => {
      if (model.repoSizeBytes) return model.repoSizeBytes / (1024 ** 3)
      const m = model.parameters.match(/([\d.]+)B/i)
      if (m) return parseFloat(m[1]) * 2.2
      return 0
    })()
    if (fallbackGB > 0) {
      const need = fallbackGB * 1.12
      const hw2 = hw
      const totalVramGB2 = hw2.totalVramMB ? hw2.totalVramMB / 1024 : undefined
      if (hw2.gpuAvailable && totalVramGB2) {
        if (need > totalVramGB2) return { fitsInMemory: false, estimatedRamUsageGB: need, estimatedVramUsageGB: need, message: `Requires ~${need.toFixed(1)} GB VRAM (from ${fallbackGB.toFixed(1)} GB weights) but GPU has ${totalVramGB2.toFixed(1)} GB.`, severity: 'too-large' }
        return { fitsInMemory: true, estimatedRamUsageGB: need, estimatedVramUsageGB: need, message: `✓ Requires ~${need.toFixed(1)} GB VRAM — fits your ${(totalVramGB2).toFixed(1)} GB GPU.`, severity: 'good' }
      }
    }
    return { fitsInMemory: false, estimatedRamUsageGB: 0, message: 'No downloadable files found for this model.', severity: 'too-large' }
  }
  // Pick the smallest estimated file as baseline (VRAM-aware)
  let smallestFile = model.files[0]
  let smallestEst = estimateFileGB(smallestFile, model)
  for (const f of model.files) {
    const est = estimateFileGB(f, model)
    if (est > 0.1 && est < smallestEst) { smallestEst = est; smallestFile = f }
  }
  const fileSizeGB = smallestEst
  const multiplier = smallestFile.format === 'MLX' ? 1.08 : 1.12
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

function estimateFileGB(file: ExploreModelFile, model: ExploreModel): number {
  const bytes = file.sizeBytes ?? file.sizeGB * 1024 ** 3
  let sizeGB = bytes > 0 ? bytes / (1024 ** 3) : file.sizeGB
  if (sizeGB > 0.1) return sizeGB
  // Fallback for HF safetensors / no HEAD yet: use repo size or params
  if (model.repoSizeBytes && model.repoSizeBytes > 0) {
    const totalGB = model.repoSizeBytes / (1024 ** 3)
    // If multiple files, split; else whole repo
    const perFile = totalGB / Math.max(1, Math.min(model.files.length || 1, 4))
    if (perFile > 0.5) return perFile
    return totalGB
  }
  if (model.parameters && model.parameters !== 'Unknown') {
    const m = model.parameters.match(/([\d.]+)B/i)
    if (m) {
      const b = parseFloat(m[1])
      const bytesPerB = file.format === 'GGUF' ? 0.62 : 2.2 // GGUF Q4 ~0.6GB/B, safetensors FP16 ~2.2GB/B with overhead
      return b * bytesPerB
    }
  }
  return 0
}

function severityForFile(file: ExploreModelFile, model: ExploreModel, hw: HardwareInfo): { severity: CompatibilityResult['severity']; estimatedRamGB: number; fits: boolean } {
  const sizeGB = estimateFileGB(file, model)
  const multiplier = file.format === 'MLX' ? 1.08 : 1.12 // VRAM overhead much smaller now (weights + KV cache)
  const estimatedNeedGB = (sizeGB || 0) * multiplier
  if (estimatedNeedGB === 0) return { severity: 'good', estimatedRamGB: 0, fits: true }
  const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
  const freeVramGB = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined
  // VRAM primary — models load in VRAM
  if (hw.gpuAvailable && totalVramGB) {
    const vram = totalVramGB
    const freeV = freeVramGB ?? vram * 0.82
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
  if (model.files.length === 0) {
    // Create a synthetic entry from repo/params so UI still shows required VRAM
    const fallbackGB = (() => {
      if (model.repoSizeBytes) return model.repoSizeBytes / (1024 ** 3)
      const m = model.parameters.match(/([\d.]+)B/i)
      if (m) return parseFloat(m[1]) * 2.2
      return 0
    })()
    if (fallbackGB > 0.5) {
      const need = fallbackGB * 1.12
      const sev: CompatibilityResult['severity'] = (() => {
        const vram = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
        if (hw.gpuAvailable && vram) {
          if (need > vram) return 'too-large'
          if (need > (hw.freeVramMB ? hw.freeVramMB / 1024 : vram * 0.82) * 0.92) return 'tight'
        }
        return 'good'
      })()
      const dummy: ExploreModelFile = { format: 'safetensors', sizeGB: fallbackGB, downloadUrl: `https://huggingface.co/${model.id}/resolve/main/model.safetensors`, rfilename: 'model.safetensors', sizeBytes: fallbackGB * 1024 ** 3 }
      return [{ file: dummy, index: 0, estimatedRamGB: need, severity: sev, rank: 0, reason: sev === 'too-large' ? `Requires ~${need.toFixed(1)} GB VRAM — too large for your GPU` : `Requires ~${need.toFixed(1)} GB VRAM — fits` }]
    }
    return []
  }
  const evaluated = model.files.map((file, index) => {
    const { severity, estimatedRamGB } = severityForFile(file, model, hw)
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
    const vramLabel = e.file.format === 'GGUF' ? 'VRAM' : 'VRAM'
    let reason = ''
    if (e.severity === 'good') reason = `Requires ~${e.estimatedRamGB.toFixed(1)} GB ${vramLabel} · fits`
    else if (e.severity === 'tight') reason = `Requires ~${e.estimatedRamGB.toFixed(1)} GB ${vramLabel} · tight`
    else reason = `Requires ~${e.estimatedRamGB.toFixed(1)} GB ${vramLabel} · too large`
    if (rank === 0 && e.severity === 'good') reason = `★ Recommended — ${reason} · best quant for your GPU`
    else if (rank === 0) reason = `★ Best fit — ${reason}`
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
