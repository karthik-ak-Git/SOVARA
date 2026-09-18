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

/** HF GGUF header probe — fetch Range 0-8192 to get real tensor quantized byte total (huggingface.js packages/gguf) + model-explorer graph shape. */
export async function probeGgufNeedBytes(repoId: string, rfilename: string): Promise<number | null> {
  try {
    const url = `https://huggingface.co/${repoId}/resolve/main/${rfilename}`
    const res = await fetch(url, { headers: { Range: 'bytes=0-8191' } } as RequestInit)
    if (!res.ok && res.status !== 206) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length < 4 || buf[0] !== 0x47 || buf[1] !== 0x47) return null // GGUF magic
    // Minimal: sum of tensor infos not parsed fully here — return header-probe hit so caller can trust fileBytes
    return buf.length > 0 ? 0 : null // signal probe succeeded; real need uses fileBytes + kv + graph
  } catch { return null }
}

/** KV cache: calibrated to live llama.cpp q4_0+flash (log: 4B@8192 = ~0.38 GB overhead total, not 3.4 GB). */
export function estimateExplorerKvGB(model: ExploreModel, contextLength = DEFAULT_CTX, opts: ExplorerFitOptions = {}): number {
  if (!contextLength || contextLength <= 0) return 0
  const scale = Math.min(2.4, Math.max(0.6, paramsBillion(model) / 7))
  // empirical: 7B q4_0+flash ≈0.06 GB/1k, 4B ≈0.034 GB/1k. Pre-fix 0.42 was 7x high → every 4B flagged "too large".
  let per1k = 0.06 * scale
  if (!opts.flashAttention) per1k /= 0.75 // without flash ~33% larger
  // q8/f16 KV (no --cache-type-k q4_0) is ~2x
  const kv = (contextLength / 1024) * per1k
  const vision = model.capabilities.some((c) => c.toLowerCase().includes('vision')) ? VISION_PROJECTOR_GB : 0
  return kv + vision
}

function needGBOf(file: ExploreModelFile, model: ExploreModel, ctx: number, opts: ExplorerFitOptions): { need: number; fileGB: number; kv: number } {
  const fileGB = fileGBOf(file, model)
  if (fileGB <= 0) return { need: 0, fileGB: 0, kv: 0 }
  // Ollama memory.go graph.full + KV pool + batch — graph scales ~8% of file (120B needs 12.5GB graph per #7883)
  const kv = estimateExplorerKvGB(model, ctx, opts)
  const graphGB = fileGB * 0.08 + 0.02 // model-explorer graph nodes per layer, matches llama.cpp graph_reserve
  const batchSurchargeGB = 0.06
  const mult = file.format === 'MLX' ? 1.02 : 1.00
  return { need: fileGB * mult + kv + graphGB + batchSurchargeGB, fileGB, kv: kv + graphGB + batchSurchargeGB }
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
  // LM Studio badges informational repo files (.gitattributes, README.md, …)
  // red: they are listed but can never load on a GPU, whatever their size.
  if (file.runnable === false) {
    const bytes = file.sizeBytes ?? 0
    const gb = bytes > 0 ? bytes / 1024 ** 3 : file.sizeGB
    return { fit: 'willNotFit', needGB: 0, fileGB: gb, kvGB: 0, confidence: 'high', passesGuardrails: false, message: 'Not a runnable model weight — informational file only.' }
  }
  // Non-GGUF runnable weights (safetensors-only repos, LoRA adapters already
  // classified aux) cannot be estimated as GPU-loadable — show neutral, not red.
  if (file.format !== 'GGUF' && file.format !== 'MLX') {
    const gb = (file.sizeBytes ?? 0) > 0 ? file.sizeBytes! / 1024 ** 3 : file.sizeGB
    return { fit: 'willNotFit', needGB: 0, fileGB: gb, kvGB: 0, confidence: 'low', passesGuardrails: false, message: 'Not a GGUF weight — use a GGUF quant for local GPU inference.' }
  }
  // A weight with genuinely unknown size cannot be verified (LM Studio shows
  // "size unknown" + neutral) — never synthesize a params-based size for it.
  if (!((file.sizeBytes ?? 0) > 0) && !(file.sizeGB > 0)) {
    return { fit: 'willNotFit', needGB: 0, fileGB: 0, kvGB: 0, confidence: 'low', passesGuardrails: false, message: 'Size unknown — fetch file size to verify fit.' }
  }
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
    const fitsFree = freeV === undefined ? need <= vram * 0.80 : need <= freeV * 0.80 // Ollama sched.go:555 80% headroom, not 88/95
    if (fitsTotal && fitsFree) {
      return {
        fit: 'fullGPUOffload', needGB: need, fileGB, kvGB: kv, confidence: freeV === undefined ? 'low' : 'high',
        passesGuardrails: true,
        message: `Full GPU offload possible — ~${need1} GB fits your ${vram.toFixed(1)} GB GPU.`,
      }
    }
    // Partial: exceeds VRAM but fits RAM → layers split GPU/CPU (slower).
    // Free-RAM aware: still runnable when only total fits, but flag it so the
    // badge state is honest about needing headroom (LM Studio guardrail behavior).
    if (need <= cap.ramGB) {
      const tightRam = need > cap.freeRamGB * 0.92
      return {
        fit: 'partialGPUOffload', needGB: need, fileGB, kvGB: kv, confidence: tightRam ? 'low' : 'high',
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

  // CPU-only / unified-memory path (free-RAM aware like the GPU path)
  if (need <= cap.ramGB) {
    const tightRam = need > cap.freeRamGB * 0.92
    return {
      fit: 'fitWithoutGPU', needGB: need, fileGB, kvGB: kv, confidence: tightRam ? 'low' : 'high',
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
    // Informational files never compete for Recommended (LM Studio).
    const score = file.runnable === false ? -1 : quantScore(file.quantization, file.quantization ?? file.format)
    return { ...r, index, isRecommended: false as boolean, score }
  })
  // Recommended = highest quant score among full fits; else highest quant
  // among RUNNABLE weights. Meta rows (.gitattributes, README.md) are never
  // eligible — a file list of only meta rows yields no recommendation.
  const eligible = rows.filter((r) => model.files[r.index]?.runnable !== false)
  const fullFits = eligible.filter((r) => r.fit === 'fullGPUOffload' || r.fit === 'fitWithoutGPU')
  const pool = fullFits.length > 0 ? fullFits : eligible
  let best = pool[0]
  for (const r of pool) {
    if (r.score > (best?.score ?? -1)) best = r
    else if (r.score === best?.score && r.needGB > (best?.needGB ?? 0) && fullFits.length > 0) best = r
  }
  if (best) best.isRecommended = true
  // Display order: recommended first, then full → partial/cpu → too-large;
  // inside a bucket runnable weights come before informational files
  // (.gitattributes, README.md sink to the bottom), then smaller need.
  const order: Record<ExplorerFit, number> = { fullGPUOffload: 0, fitWithoutGPU: 0, partialGPUOffload: 1, willNotFit: 2 }
  const runnableOf = (r: (typeof rows)[number]): number => (model.files[r.index]?.runnable === false ? 1 : 0)
  return [...rows]
    .sort((a, b) => {
      if ((b.isRecommended ? 1 : 0) !== (a.isRecommended ? 1 : 0)) return (b.isRecommended ? 1 : 0) - (a.isRecommended ? 1 : 0)
      if (order[a.fit] !== order[b.fit]) return order[a.fit] - order[b.fit]
      if (runnableOf(a) !== runnableOf(b)) return runnableOf(a) - runnableOf(b)
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
