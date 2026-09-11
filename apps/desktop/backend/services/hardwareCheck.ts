import type { HardwareInfo, CompatibilityResult, ExploreModel, ExploreModelFile } from '@shared/types/explore'

export interface FileRecommendation {
  file: ExploreModelFile
  index: number
  estimatedRamGB: number
  severity: CompatibilityResult['severity']
  rank: number // 0 = best recommendation
  reason: string
}

export interface CompatibilityOptions {
  /** Context length in tokens — affects KV cache estimate. Defaults to 4096. */
  nCtx?: number
}

const DEFAULT_N_CTX = 4096

/**
 * KV cache estimate: ~0.42GB per 1k tokens for 7B, scales with params.
 * 2048 → 0.8GB (7B) / 1.8GB (20B), 4096 → 1.7GB / 3.6GB
 */
export function estimateKvCacheGB(nCtx: number, model?: ExploreModel): number {
  if (!nCtx || nCtx <= 0) return 0
  const m = model?.parameters.match(/([\d.]+)B/i)
  const paramsB = m ? parseFloat(m[1]) : 7
  const scale = Math.min(2.2, Math.max(0.7, paramsB / 7))
  const per1k = 0.42 * scale
  return (nCtx / 1024) * per1k
}

function estimateNeedGB(file: ExploreModelFile, model: ExploreModel, nCtx: number): number {
  const sizeGB = estimateFileGB(file, model)
  if (sizeGB <= 0) return 0
  const multiplier = file.format === 'MLX' ? 1.08 : 1.12
  const kv = estimateKvCacheGB(nCtx, model)
  return sizeGB * multiplier + kv
}

/**
 * Isolated-pool estimator — NEVER sums VRAM + RAM.
 * VRAM and RAM are separate pools: model needs `need` GB wherever it runs.
 * GPU path checks need against VRAM only; CPU/RAM path checks need against RAM only.
 * If need > VRAM but need <= RAM => partial/CPU fallback (tight, not too-large).
 */
export function estimateCompatibility(
  model: ExploreModel,
  hw: HardwareInfo,
  nCtxOrOpts?: number | CompatibilityOptions
): CompatibilityResult {
  const nCtx = typeof nCtxOrOpts === 'number' ? nCtxOrOpts : (nCtxOrOpts?.nCtx ?? DEFAULT_N_CTX)

  if (!model.files || model.files.length === 0) {
    const fallbackGB = (() => {
      if (model.repoSizeBytes) return model.repoSizeBytes / (1024 ** 3)
      const m = model.parameters.match(/([\d.]+)B/i)
      if (m) return parseFloat(m[1]) * 2.2
      return 0
    })()
    if (fallbackGB > 0) {
      const kv = estimateKvCacheGB(nCtx, model)
      const need = fallbackGB * 1.12 + kv
      const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
      const freeVramGB = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined
      const totalRamGB = hw.totalRamMB / 1024
      if (hw.gpuAvailable && totalVramGB) {
        if (need > totalVramGB) {
          // Isolated: check RAM separately — no summing
          if (need <= totalRamGB) {
            return { fitsInMemory: true, estimatedRamUsageGB: need, estimatedVramUsageGB: need, message: `Too large for VRAM: ~${need.toFixed(1)} GB > ${totalVramGB.toFixed(1)} GB GPU. Fits in RAM (~${totalRamGB.toFixed(0)} GB) — will run on CPU or partial offload (slower).`, severity: 'tight' }
          }
          return { fitsInMemory: false, estimatedRamUsageGB: need, estimatedVramUsageGB: need, message: `Requires ~${need.toFixed(1)} GB (weights ~${fallbackGB.toFixed(1)} GB + ${kv.toFixed(1)} GB KV @${nCtx}) — too large for GPU (${totalVramGB.toFixed(1)} GB) and RAM (${totalRamGB.toFixed(0)} GB).`, severity: 'too-large' }
        }
        if (freeVramGB !== undefined && need > freeVramGB * 0.92) {
          return { fitsInMemory: true, estimatedRamUsageGB: need, estimatedVramUsageGB: need, message: `Fits VRAM but tight: ~${need.toFixed(1)} GB / ${totalVramGB.toFixed(1)} GB free ${freeVramGB.toFixed(1)} GB. Close other GPU apps.`, severity: 'tight' }
        }
        if (freeVramGB === undefined && need > totalVramGB * 0.88) {
          return { fitsInMemory: true, estimatedRamUsageGB: need, estimatedVramUsageGB: need, message: `✓ Requires ~${need.toFixed(1)} GB VRAM (total ${totalVramGB.toFixed(1)} GB — free VRAM unavailable, close GPU apps to be safe).`, severity: 'tight' }
        }
        return { fitsInMemory: true, estimatedRamUsageGB: need, estimatedVramUsageGB: need, message: `✓ Requires ~${need.toFixed(1)} GB VRAM — fits your ${totalVramGB.toFixed(1)} GB GPU.`, severity: 'good' }
      }
      // No GPU — RAM only
      if (need > totalRamGB) {
        return { fitsInMemory: false, estimatedRamUsageGB: need, message: `Requires ~${need.toFixed(1)} GB but system has ${totalRamGB.toFixed(0)} GB RAM. No dedicated GPU.`, severity: 'too-large' }
      }
    }
    return { fitsInMemory: false, estimatedRamUsageGB: 0, message: 'No downloadable files found for this model.', severity: 'too-large' }
  }

  let smallestFile = model.files[0]
  let smallestEst = estimateFileGB(smallestFile, model)
  for (const f of model.files) {
    const est = estimateFileGB(f, model)
    if (est > 0.1 && est < smallestEst) { smallestEst = est; smallestFile = f }
  }
  const estimatedNeedGB = estimateNeedGB(smallestFile, model, nCtx)

  const totalRamGB = hw.totalRamMB / 1024
  const freeRamGB = hw.freeRamMB / 1024
  const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
  const freeVramGB = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined

  // GPU path — isolated VRAM check, no RAM summing
  if (hw.gpuAvailable && totalVramGB) {
    if (estimatedNeedGB > totalVramGB) {
      // Too large for VRAM — can it still run on RAM (CPU/partial offload)?
      if (estimatedNeedGB <= totalRamGB) {
        return {
          fitsInMemory: true,
          estimatedRamUsageGB: estimatedNeedGB,
          estimatedVramUsageGB: estimatedNeedGB,
          message: `Partial GPU Offload Possible — requires ~${estimatedNeedGB.toFixed(1)} GB, GPU has ${totalVramGB.toFixed(1)} GB VRAM. Fits in RAM (${totalRamGB.toFixed(0)} GB) — remaining layers offload to RAM/CPU (slower but runnable).`,
          severity: 'tight',
        }
      }
      return {
        fitsInMemory: false,
        estimatedRamUsageGB: estimatedNeedGB,
        estimatedVramUsageGB: estimatedNeedGB,
        message: `Requires ~${estimatedNeedGB.toFixed(1)} GB but GPU has ${totalVramGB.toFixed(1)} GB VRAM and system has ${totalRamGB.toFixed(0)} GB RAM. Too large even for CPU.`,
        severity: 'too-large',
      }
    }
    // Fits in VRAM total — check free tightness, but never sum RAM
    if (freeVramGB !== undefined) {
      if (estimatedNeedGB > freeVramGB * 0.92) {
        return {
          fitsInMemory: true,
          estimatedRamUsageGB: estimatedNeedGB,
          estimatedVramUsageGB: estimatedNeedGB,
          message: `Fits VRAM but tight: ~${estimatedNeedGB.toFixed(1)} GB / ${totalVramGB.toFixed(1)} GB free ${freeVramGB.toFixed(1)} GB. Close other GPU apps.`,
          severity: 'tight',
        }
      }
    } else if (estimatedNeedGB > totalVramGB * 0.88) {
      return {
        fitsInMemory: true,
        estimatedRamUsageGB: estimatedNeedGB,
        estimatedVramUsageGB: estimatedNeedGB,
        message: `Fits VRAM (total ${totalVramGB.toFixed(1)} GB) but free VRAM unknown — estimate may be optimistic. Close other GPU apps. Requires ~${estimatedNeedGB.toFixed(1)} GB.`,
        severity: 'tight',
      }
    }
    return {
      fitsInMemory: true,
      estimatedRamUsageGB: estimatedNeedGB,
      estimatedVramUsageGB: estimatedNeedGB,
      message: `✓ Fits in VRAM: ~${estimatedNeedGB.toFixed(1)} GB / ${totalVramGB.toFixed(1)} GB (${hw.gpuName ?? 'GPU'}) — optimal for fast inference.`,
      severity: 'good',
    }
  }

  // CPU-only — RAM isolated check
  if (estimatedNeedGB > totalRamGB) {
    return {
      fitsInMemory: false,
      estimatedRamUsageGB: estimatedNeedGB,
      message: `Likely too large for CPU. Needs ~${estimatedNeedGB.toFixed(1)} GB but system has ${totalRamGB.toFixed(0)} GB RAM. No dedicated GPU detected.`,
      severity: 'too-large',
    }
  }
  if (estimatedNeedGB > freeRamGB * 0.9) {
    return {
      fitsInMemory: false,
      estimatedRamUsageGB: estimatedNeedGB,
      message: `Might be tight on CPU: needs ~${estimatedNeedGB.toFixed(1)} GB, only ${freeRamGB.toFixed(1)} GB free. Close apps or pick smaller quant.`,
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
  if (model.repoSizeBytes && model.repoSizeBytes > 0) {
    const totalGB = model.repoSizeBytes / (1024 ** 3)
    const perFile = totalGB / Math.max(1, Math.min(model.files.length || 1, 4))
    if (perFile > 0.5) return perFile
    return totalGB
  }
  if (model.parameters && model.parameters !== 'Unknown') {
    const m = model.parameters.match(/([\d.]+)B/i)
    if (m) {
      const b = parseFloat(m[1])
      const bytesPerB = file.format === 'GGUF' ? 0.62 : 2.2
      return b * bytesPerB
    }
  }
  return 0
}

function severityForFile(
  file: ExploreModelFile,
  model: ExploreModel,
  hw: HardwareInfo,
  nCtx: number = DEFAULT_N_CTX
): { severity: CompatibilityResult['severity']; estimatedRamGB: number; fits: boolean } {
  const need = estimateNeedGB(file, model, nCtx)
  if (need === 0) return { severity: 'good', estimatedRamGB: 0, fits: true }
  const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
  const freeVramGB = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined
  const totalRamGB = hw.totalRamMB / 1024
  const freeRamGB = hw.freeRamMB / 1024
  if (hw.gpuAvailable && totalVramGB) {
    if (need > totalVramGB) {
      // Isolated: does it at least fit in RAM? then tight (partial), else too-large
      if (need <= totalRamGB) return { severity: 'tight', estimatedRamGB: need, fits: true }
      return { severity: 'too-large', estimatedRamGB: need, fits: false }
    }
    if (freeVramGB !== undefined) {
      if (need > freeVramGB * 0.92) return { severity: 'tight', estimatedRamGB: need, fits: true }
    } else if (need > totalVramGB * 0.88) {
      return { severity: 'tight', estimatedRamGB: need, fits: true }
    }
    return { severity: 'good', estimatedRamGB: need, fits: true }
  }
  if (need > totalRamGB) return { severity: 'too-large', estimatedRamGB: need, fits: false }
  if (need > freeRamGB * 0.9) return { severity: 'tight', estimatedRamGB: need, fits: false }
  return { severity: 'good', estimatedRamGB: need, fits: true }
}

function quantRank(q?: string): number {
  if (!q) return 0
  const order: Record<string, number> = {
    Q8_0: 80, Q6_K: 60, Q5_K_M: 50, Q5_K_S: 48, Q5_0: 45,
    Q4_K_M: 40, Q4_K_S: 38, Q4_0: 35, Q3_K_M: 30, Q3_K_S: 28, Q2_K: 20,
  }
  return order[q] ?? 10
}

export function recommendFiles(
  model: ExploreModel,
  hw: HardwareInfo,
  nCtx: number = DEFAULT_N_CTX
): FileRecommendation[] {
  if (model.files.length === 0) {
    const fallbackGB = (() => {
      if (model.repoSizeBytes) return model.repoSizeBytes / (1024 ** 3)
      const m = model.parameters.match(/([\d.]+)B/i)
      if (m) return parseFloat(m[1]) * 2.2
      return 0
    })()
    if (fallbackGB > 0.5) {
      const kv = estimateKvCacheGB(nCtx, model)
      const need = fallbackGB * 1.12 + kv
      const sev: CompatibilityResult['severity'] = (() => {
        const vram = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
        const freeV = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined
        const totalRamGB = hw.totalRamMB / 1024
        if (hw.gpuAvailable && vram) {
          if (need > vram) return need <= totalRamGB ? 'tight' : 'too-large'
          if (freeV !== undefined && need > freeV * 0.92) return 'tight'
          if (freeV === undefined && need > vram * 0.88) return 'tight'
        }
        return 'good'
      })()
      const dummy: ExploreModelFile = { format: 'safetensors', sizeGB: fallbackGB, downloadUrl: `https://huggingface.co/${model.id}/resolve/main/model.safetensors`, rfilename: 'model.safetensors', sizeBytes: fallbackGB * 1024 ** 3 }
      return [{ file: dummy, index: 0, estimatedRamGB: need, severity: sev, rank: 0, reason: sev === 'too-large' ? `Requires ~${need.toFixed(1)} GB — too large for your GPU & RAM` : `Requires ~${need.toFixed(1)} GB — fits` }]
    }
    return []
  }
  const evaluated = model.files.map((file, index) => {
    const { severity, estimatedRamGB } = severityForFile(file, model, hw, nCtx)
    const qRank = quantRank(file.quantization)
    const sizeScore = estimatedRamGB
    return { file, index, estimatedRamGB, severity, qRank, sizeScore }
  })
  const sorted = [...evaluated].sort((a, b) => {
    const sevOrder = { good: 0, tight: 1, 'too-large': 2 } as const
    if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity]
    if (a.severity === 'good' && b.severity === 'good') {
      if (b.sizeScore !== a.sizeScore) return b.sizeScore - a.sizeScore
      return b.qRank - a.qRank
    }
    if (a.sizeScore !== b.sizeScore) return a.sizeScore - b.sizeScore
    return b.qRank - a.qRank
  })
  return sorted.map((e, rank) => {
    const vramLabel = 'VRAM'
    let reason = ''
    if (e.severity === 'good') reason = `Requires ~${e.estimatedRamGB.toFixed(1)} GB ${vramLabel} · fits`
    else if (e.severity === 'tight') reason = `Requires ~${e.estimatedRamGB.toFixed(1)} GB ${vramLabel} · tight`
    else reason = `Requires ~${e.estimatedRamGB.toFixed(1)} GB ${vramLabel} · too large`
    if (rank === 0 && e.severity === 'good') reason = `★ Recommended — ${reason} · best quant for your GPU`
    else if (rank === 0) reason = `★ Best fit — ${reason}`
    return { file: e.file, index: e.index, estimatedRamGB: e.estimatedRamGB, severity: e.severity, rank, reason }
  })
}

export function getRecommendedFileIndex(model: ExploreModel, hw: HardwareInfo, nCtx: number = DEFAULT_N_CTX): number | null {
  const recs = recommendFiles(model, hw, nCtx)
  if (recs.length === 0) return null
  return recs[0].index
}
