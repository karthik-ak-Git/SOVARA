/**
 * Explorer fit engine — fresh LM Studio-parity estimation.
 *
 * LM Studio sources (no git history):
 * - `lms load --estimate-only <id> --context-length 4096 --gpu max`
 *   → Estimated GPU Memory / Estimated Total Memory / confidence / passesGuardrails
 * - Download UI badges: Full GPU offload possible (green) / Partial GPU offload
 *   possible (yellow) / Likely fit CPU (green) / Likely too large (red)
 * - Rule of thumb: file size ≈ VRAM needed + 1–2 GB context overhead;
 *   target 1.2–1.4× on-disk size in available VRAM; Q4 ≈ 0.5 GB per B params
 *   + 20–30% KV cache. Context length, flash attention, KV offload and the
 *   vision projector (~0.9 GB) move the estimate.
 */
import type { CompatibilityResult, ExploreModel, ExploreModelFile, HardwareInfo } from '@shared/types/explore'

export type ExplorerFit = 'fullGPUOffload' | 'partialGPUOffload' | 'fitWithoutGPU' | 'willNotFit'

export interface ExplorerFitOptions {
  contextLength?: number // default 4096 like LM Studio loader
  flashAttention?: boolean
  kvOffloadToGpu?: boolean
}

export interface ExplorerFitResult {
  fit: ExplorerFit
  needGB: number
  fileGB: number
  kvGB: number
  confidence: 'high' | 'low'
  passesGuardrails: boolean
  message: string
}

export interface ExplorerFileFit extends ExplorerFitResult {
  index: number
  isRecommended: boolean
}

const DEFAULT_CTX = 4096
const OS_RAM_RESERVE_GB = 2
const GPU_RESERVE_GB = 0.5
const VISION_PROJECTOR_GB = 0.9

function paramsBillion(model: ExploreModel): number {
  const m = model.parameters.match(/([\d.]+)\s*B/i)
  return m ? Math.max(0.5, parseFloat(m[1])) : 7
}

function fileGBOf(file: ExploreModelFile, model: ExploreModel): number {
  const bytes = file.sizeBytes ?? file.sizeGB * 1024 ** 3
  let gb = bytes > 0 ? bytes / 1024 ** 3 : file.sizeGB
  if (gb > 0.1) return gb
  if (model.repoSizeBytes && model.repoSizeBytes > 0) {
    const total = model.repoSizeBytes / 1024 ** 3
    const per = total / Math.max(1, Math.min(model.files.length || 1, 4))
    if (per > 0.5) return per
    return total
  }
  const pb = paramsBillion(model)
  return pb * (file.format === 'GGUF' ? 0.62 : 2.2)
}

/** KV cache: ~0.42 GB / 1k tokens @7B, scaled by params, reduced by flash-attn / KV quant. */
export function estimateExplorerKvGB(model: ExploreModel, contextLength = DEFAULT_CTX, opts: ExplorerFitOptions = {}): number {
  if (!contextLength || contextLength <= 0) return 0
  const scale = Math.min(2.4, Math.max(0.6, paramsBillion(model) / 7))
  let per1k = 0.42 * scale
  if (opts.flashAttention) per1k *= 0.75
  // KV kept on CPU costs RAM all the same; GPU offload=false does not shrink total, only placement
  const kv = (contextLength / 1024) * per1k
  const vision = model.capabilities.some((c) => c.toLowerCase().includes('vision')) ? VISION_PROJECTOR_GB : 0
  return kv + vision
}

function needGBOf(file: ExploreModelFile, model: ExploreModel, ctx: number, opts: ExplorerFitOptions): { need: number; fileGB: number; kv: number } {
  const fileGB = fileGBOf(file, model)
  if (fileGB <= 0) return { need: 0, fileGB: 0, kv: 0 }
  const mult = file.format === 'MLX' ? 1.08 : 1.12 // llama.cpp runtime overhead
  const kv = estimateExplorerKvGB(model, ctx, opts)
  return { need: fileGB * mult + kv, fileGB, kv }
}

/** LM Studio guardrail threshold: usable = total − OS/GPU reserve. */
function usableCapacity(hw: HardwareInfo): { ramGB: number; vramGB?: number; freeVramGB?: number; freeRamGB: number } {
  const totalRamGB = hw.totalRamMB / 1024
  const freeRamGB = hw.freeRamMB / 1024
  const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
  const freeVramGB = hw.freeVramMB ? hw.freeVramMB / 1024 : undefined
  return {
    ramGB: Math.max(1, totalRamGB - OS_RAM_RESERVE_GB),
    vramGB: totalVramGB !== undefined ? Math.max(1, totalVramGB - GPU_RESERVE_GB) : undefined,
    freeVramGB,
    freeRamGB,
  }
}

export function estimateExplorerFit(
  file: ExploreModelFile,
  model: ExploreModel,
  hw: HardwareInfo,
  opts: ExplorerFitOptions = {},
): ExplorerFitResult {
  const ctx = opts.contextLength ?? DEFAULT_CTX
  const { need, fileGB, kv } = needGBOf(file, model, ctx, opts)
  if (need <= 0) {
    return { fit: 'willNotFit', needGB: 0, fileGB, kvGB: kv, confidence: 'low', passesGuardrails: false, message: 'No downloadable file size — cannot estimate.' }
  }
  const cap = usableCapacity(hw)
  const need1 = need.toFixed(1)

  if (hw.gpuAvailable && cap.vramGB !== undefined) {
    const vram = cap.vramGB
    const freeV = cap.freeVramGB
    // Full offload: fits VRAM with headroom (1.2× rule → need ≤ 88% of usable when free unknown)
    const fitsTotal = need <= vram
    const fitsFree = freeV === undefined ? need <= vram * 0.88 : need <= freeV * 0.95
    if (fitsTotal && fitsFree) {
      return {
        fit: 'fullGPUOffload', needGB: need, fileGB, kvGB: kv, confidence: freeV === undefined ? 'low' : 'high',
        passesGuardrails: true,
        message: `Full GPU offload possible — ~${need1} GB fits your ${vram.toFixed(1)} GB GPU.`,
      }
    }
    // Partial: exceeds VRAM but fits RAM → layers split GPU/CPU (slower)
    if (need <= cap.ramGB) {
      return {
        fit: 'partialGPUOffload', needGB: need, fileGB, kvGB: kv, confidence: 'high',
        passesGuardrails: true,
        message: `Partial GPU offload possible — ~${need1} GB exceeds ${vram.toFixed(1)} GB VRAM but fits RAM.`,
      }
    }
    return {
      fit: 'willNotFit', needGB: need, fileGB, kvGB: kv, confidence: 'high',
      passesGuardrails: false,
      message: `Likely too large — ~${need1} GB exceeds GPU and system memory.`,
    }
  }

  // CPU-only / unified-memory path
  if (need <= cap.ramGB) {
    return {
      fit: 'fitWithoutGPU', needGB: need, fileGB, kvGB: kv, confidence: 'high',
      passesGuardrails: true,
      message: `Likely fits on CPU — ~${need1} GB fits system memory.`,
    }
  }
  return {
    fit: 'willNotFit', needGB: need, fileGB, kvGB: kv, confidence: 'high',
    passesGuardrails: false,
    message: `Likely too large — ~${need1} GB exceeds system memory.`,
  }
}

function quantScore(q?: string, format?: string): number {
  if (!q) {
    // Native MXFP4 / QAT quants (screenshot) rank near Q4_K_M
    if (format && /mxfp4|qat/i.test(format)) return 92
    return 10
  }
  const t: Record<string, number> = {
    Q4_K_M: 100, Q4_K_S: 95, Q5_K_M: 90, Q5_K_S: 88, Q6_K: 85, Q8_0: 80,
    Q5_0: 78, Q4_0: 75, Q3_K_M: 60, Q3_K_S: 58, Q2_K: 40,
  }
  const up = q.toUpperCase()
  if (t[up] !== undefined) return t[up]
  if (/MXFP4|QAT/i.test(up)) return 92
  return 20
}

/**
 * Per-file fits + LM Studio recommended pick:
 * 👍 Safe & Balanced = best quant that fully fits; 🚀 max-perf = largest full fit.
 * When nothing fully fits, the best quant is still flagged recommended (screenshot:
 * Q4_K_M Recommended even with a red badge) so the user sees the ideal choice.
 */
export function fitExplorerFiles(model: ExploreModel, hw: HardwareInfo, opts: ExplorerFitOptions = {}): ExplorerFileFit[] {
  if (!model.files.length) return []
  const rows = model.files.map((file, index) => {
    const r = estimateExplorerFit(file, model, hw, opts)
    return { ...r, index, isRecommended: false as boolean, score: quantScore(file.quantization, file.quantization ?? file.format) }
  })
  // Recommended = highest quant score among full fits; else highest quant overall
  const fullFits = rows.filter((r) => r.fit === 'fullGPUOffload' || r.fit === 'fitWithoutGPU')
  const pool = fullFits.length > 0 ? fullFits : rows
  let best = pool[0]
  for (const r of pool) {
    if (r.score > (best?.score ?? -1)) best = r
    else if (r.score === best?.score && r.needGB > (best?.needGB ?? 0) && fullFits.length > 0) best = r
  }
  if (best) best.isRecommended = true
  // Display order: recommended first, then full → partial/cpu → too-large, then smaller need
  const order: Record<ExplorerFit, number> = { fullGPUOffload: 0, fitWithoutGPU: 0, partialGPUOffload: 1, willNotFit: 2 }
  return [...rows]
    .sort((a, b) => {
      if ((b.isRecommended ? 1 : 0) !== (a.isRecommended ? 1 : 0)) return (b.isRecommended ? 1 : 0) - (a.isRecommended ? 1 : 0)
      if (order[a.fit] !== order[b.fit]) return order[a.fit] - order[b.fit]
      return a.needGB - b.needGB
    })
    .map(({ score: _s, ...rest }) => rest)
}

/** Back-compat bridge for existing explore:getCompatibility IPC (good/tight/too-large). */
export function toCompatibility(fit: ExplorerFitResult): CompatibilityResult {
  if (fit.fit === 'fullGPUOffload' || fit.fit === 'fitWithoutGPU') {
    return { fitsInMemory: true, estimatedRamUsageGB: fit.needGB, estimatedVramUsageGB: fit.needGB, message: fit.message, severity: 'good' }
  }
  if (fit.fit === 'partialGPUOffload') {
    return { fitsInMemory: true, estimatedRamUsageGB: fit.needGB, estimatedVramUsageGB: fit.needGB, message: fit.message, severity: 'tight' }
  }
  return { fitsInMemory: false, estimatedRamUsageGB: fit.needGB, estimatedVramUsageGB: fit.needGB, message: fit.message, severity: 'too-large' }
}
