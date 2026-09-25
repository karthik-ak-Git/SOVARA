/**
 * Explorer fit engine — fresh LM Studio-parity estimation.
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

function hasOwnedGpuRuntime(hw: HardwareInfo): boolean {
  return hw.gpuAvailable && (hw.gpuRuntime === 'cuda' || (hw.gpuRuntime === undefined && (hw.gpuVendor === undefined || hw.gpuVendor === 'NVIDIA')))
}

function paramsBillion(model: ExploreModel, fileGB?: number): number {
  const m = model.parameters.match(/([\d.]+)\s*B\b/i)
  if (m) {
    const val = parseFloat(m[1])
    // Clamping safeguard: if file size is known and small (<1GB), a 70B parameter label is impossible
    if (fileGB && fileGB > 0 && fileGB < 1.0 && val > 3) {
      return Math.max(0.05, fileGB / 0.6)
    }
    return Math.max(0.05, val)
  }
  const mM = model.parameters.match(/([\d.]+)\s*M\b/i)
  if (mM) {
    return Math.max(0.05, parseFloat(mM[1]) / 1000)
  }
  if (fileGB && fileGB > 0) {
    return Math.max(0.05, Math.min(70, fileGB / 0.6))
  }
  return 7
}

function fileGBOf(file: ExploreModelFile, model: ExploreModel): number {
  const bytes = file.sizeBytes ?? file.sizeGB * 1024 ** 3
  let gb = bytes > 0 ? bytes / 1024 ** 3 : file.sizeGB
  if (gb > 0.05) return gb
  if (model.repoSizeBytes && model.repoSizeBytes > 0) {
    const total = model.repoSizeBytes / 1024 ** 3
    const per = total / Math.max(1, Math.min(model.files.length || 1, 4))
    if (per > 0.05) return per
    return total
  }
  const pb = paramsBillion(model)
  return pb * (file.format === 'GGUF' ? 0.62 : 2.2)
}

export async function probeGgufNeedBytes(repoId: string, rfilename: string): Promise<number | null> {
  try {
    const url = `https://huggingface.co/${repoId}/resolve/main/${rfilename}`
    const res = await fetch(url, { headers: { Range: 'bytes=0-8191' } } as RequestInit)
    if (!res.ok && res.status !== 206) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length < 4 || buf[0] !== 0x47 || buf[1] !== 0x47) return null // GGUF magic
    return buf.length > 0 ? 0 : null
  } catch { return null }
}

export function estimateExplorerKvGB(model: ExploreModel, contextLength = DEFAULT_CTX, opts: ExplorerFitOptions = {}, fileGB?: number): number {
  if (!contextLength || contextLength <= 0) return 0
  const pb = paramsBillion(model, fileGB)
  const scale = Math.min(2.4, Math.max(0.05, pb / 7))
  let per1k = 0.06 * scale
  if (!opts.flashAttention) per1k /= 0.75
  const kv = (contextLength / 1024) * per1k
  const vision = model.capabilities.some((c) => c.toLowerCase().includes('vision')) ? VISION_PROJECTOR_GB : 0
  return kv + vision
}

function needGBOf(file: ExploreModelFile, model: ExploreModel, ctx: number, opts: ExplorerFitOptions): { need: number; fileGB: number; kv: number } {
  const fileGB = fileGBOf(file, model)
  if (fileGB <= 0) return { need: 0, fileGB: 0, kv: 0 }
  const kv = estimateExplorerKvGB(model, ctx, opts, fileGB)
  const graphGB = fileGB * 0.08 + 0.02
  const batchSurchargeGB = 0.06
  const mult = file.format === 'MLX' ? 1.02 : 1.00
  return { need: fileGB * mult + kv + graphGB + batchSurchargeGB, fileGB, kv: kv + graphGB + batchSurchargeGB }
}

function usableCapacity(hw: HardwareInfo): { ramGB: number; vramGB?: number; freeVramGB?: number; freeRamGB: number } {
  const totalRamGB = hw.totalRamMB / 1024
  const freeRamGB = hw.freeRamMB / 1024
  const totalVramGB = hw.totalVramMB ? hw.totalVramMB / 1024 : undefined
  const freeVramGB = hw.freeVramMB !== undefined ? hw.freeVramMB / 1024 : undefined
  return {
    ramGB: Math.max(1, totalRamGB - OS_RAM_RESERVE_GB),
    vramGB: totalVramGB !== undefined ? Math.max(1, totalVramGB - GPU_RESERVE_GB) : undefined,
    freeVramGB: freeVramGB !== undefined ? Math.max(0, freeVramGB - 0.2) : undefined,
    freeRamGB,
  }
}

export function estimateExplorerFit(
  file: ExploreModelFile,
  model: ExploreModel,
  hw: HardwareInfo,
  opts: ExplorerFitOptions = {},
): ExplorerFitResult {
  if (file.runnable === false) {
    const bytes = file.sizeBytes ?? 0
    const gb = bytes > 0 ? bytes / 1024 ** 3 : file.sizeGB
    return { fit: 'willNotFit', needGB: 0, fileGB: gb, kvGB: 0, confidence: 'high', passesGuardrails: false, message: 'Not a runnable model weight — informational file only.' }
  }

  const hasKnownSize = (file.sizeBytes ?? 0) > 0 || (file.sizeGB ?? 0) > 0 || (model.repoSizeBytes ?? 0) > 0
  if (!hasKnownSize) {
    return {
      fit: 'willNotFit', needGB: 0, fileGB: 0, kvGB: 0, confidence: 'low', passesGuardrails: false,
      message: 'Size unknown — fetch file size to verify fit.',
    }
  }

  const ctx = opts.contextLength ?? DEFAULT_CTX
  const { need, fileGB, kv } = needGBOf(file, model, ctx, opts)
  if (need <= 0) {
    return { fit: 'willNotFit', needGB: 0, fileGB, kvGB: kv, confidence: 'low', passesGuardrails: false, message: 'No downloadable file size — cannot estimate.' }
  }

  const cap = usableCapacity(hw)
  const need1 = need.toFixed(1)
  const confidenceLevel = (file.sizeBytes ?? 0) > 0 ? ('high' as const) : ('low' as const)

  if (hasOwnedGpuRuntime(hw) && cap.vramGB !== undefined) {
    const vram = cap.vramGB
    const freeV = cap.freeVramGB
    const fitsTotal = need <= vram
    const fitsFree = freeV === undefined ? true : need <= freeV
    if (fitsTotal && fitsFree) {
      return {
        fit: 'fullGPUOffload', needGB: need, fileGB, kvGB: kv, confidence: freeV === undefined ? 'low' : confidenceLevel,
        passesGuardrails: true,
        message: `Full GPU offload possible — ~${need1} GB fits your ${vram.toFixed(1)} GB GPU.`,
      }
    }
    if (need <= cap.ramGB) {
      const tightRam = need > cap.freeRamGB * 0.92
      return {
        fit: 'partialGPUOffload', needGB: need, fileGB, kvGB: kv, confidence: tightRam ? 'low' : confidenceLevel,
        passesGuardrails: true,
        message: tightRam
          ? `Partial GPU offload possible — ~${need1} GB exceeds ${vram.toFixed(1)} GB VRAM and RAM is tight (${cap.freeRamGB.toFixed(1)} GB free). Close apps first.`
          : `Partial GPU offload possible — ~${need1} GB exceeds ${vram.toFixed(1)} GB VRAM but fits RAM.`,
      }
    }
    return {
      fit: 'willNotFit', needGB: need, fileGB, kvGB: kv, confidence: 'high',
      passesGuardrails: false,
      message: `Likely too large — ~${need1} GB exceeds GPU and system memory.`,
    }
  }

  if (need <= cap.ramGB) {
    const tightRam = need > cap.freeRamGB * 0.92
    return {
      fit: 'fitWithoutGPU', needGB: need, fileGB, kvGB: kv, confidence: tightRam ? 'low' : confidenceLevel,
      passesGuardrails: true,
      message: tightRam
        ? `Likely fits on CPU — ~${need1} GB fits but RAM is tight (${cap.freeRamGB.toFixed(1)} GB free). Close apps first.`
        : `Likely fits on CPU — ~${need1} GB fits system memory.`,
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
    if (format && /mxfp4|qat/i.test(format)) return 92
    return 10
  }
  const t: Record<string, number> = {
    Q4_K_M: 100, Q4_K_S: 95, Q4_K: 95,
    Q5_K_M: 90, Q5_K_S: 88, Q5_K: 88,
    Q6_K: 85, Q8_0: 80, Q8_1: 80, Q8_K: 80,
    Q5_0: 78, Q5_1: 78, Q4_0: 75, Q4_1: 75,
    IQ4_NL: 74, IQ4_XS: 72, F16: 70, BF16: 70,
    Q3_K_L: 65, Q3_K_M: 60, Q3_K_S: 58,
    IQ3_M: 55, IQ3_S: 52, IQ3_XS: 50, IQ3_XXS: 48, F32: 50,
    Q2_K: 40, IQ2_M: 38, IQ2_S: 35, IQ2_XS: 32, IQ2_XXS: 30,
    IQ1_M: 25, IQ1_S: 22,
  }
  const up = q.toUpperCase()
  if (t[up] !== undefined) return t[up]
  if (/MXFP4|QAT/i.test(up)) return 92
  return 20
}

export function fitExplorerFiles(model: ExploreModel, hw: HardwareInfo, opts: ExplorerFitOptions = {}): ExplorerFileFit[] {
  const files = model.files
  if (!files || files.length === 0) return []
  const evaluated = files.map((file, index) => ({
    ...estimateExplorerFit(file, model, hw, opts),
    index,
    isRecommended: false,
  }))

  const candidates = evaluated.filter((f) => files[f.index].runnable !== false && f.passesGuardrails)
  candidates.sort((a, b) => {
    const pA = a.fit === 'fullGPUOffload' ? 2 : a.fit === 'partialGPUOffload' || a.fit === 'fitWithoutGPU' ? 1 : 0
    const pB = b.fit === 'fullGPUOffload' ? 2 : b.fit === 'partialGPUOffload' || b.fit === 'fitWithoutGPU' ? 1 : 0
    if (pA !== pB) return pB - pA
    const qA = quantScore(files[a.index].quantization, files[a.index].format)
    const qB = quantScore(files[b.index].quantization, files[b.index].format)
    return qB - qA
  })
  if (candidates.length > 0) {
    candidates[0].isRecommended = true
  }

  const candidateIndices = new Set(candidates.map((c) => c.index))
  const nonCandidates = evaluated.filter((f) => !candidateIndices.has(f.index))
  nonCandidates.sort((a, b) => {
    const runA = files[a.index].runnable !== false ? 0 : 1
    const runB = files[b.index].runnable !== false ? 0 : 1
    if (runA !== runB) return runA - runB
    return a.index - b.index
  })

  return [...candidates, ...nonCandidates]
}

export function toCompatibility(fit: ExplorerFitResult): CompatibilityResult {
  const severity: CompatibilityResult['severity'] =
    fit.fit === 'fullGPUOffload' ? 'good' : fit.fit === 'partialGPUOffload' || fit.fit === 'fitWithoutGPU' ? 'tight' : 'too-large'
  return {
    fitsInMemory: fit.passesGuardrails,
    estimatedRamUsageGB: Math.round(fit.needGB * 10) / 10,
    message: fit.message,
    severity,
  }
}

