import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { ModelProfile, ResourceEstimate, HardwareProfileFull } from '@shared/types/validation'
import type { ExploreModel } from '@shared/types/explore'
import { estimateKvCacheGB } from './hardwareCheck'

function detectFormat(filePath: string): ModelProfile['format'] {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.gguf')) return 'GGUF'
  if (lower.endsWith('.safetensors')) return 'safetensors'
  if (lower.includes('.mlx') || lower.endsWith('.mlx')) return 'MLX'
  return 'unknown'
}

function hashFileHeader(filePath: string): string | undefined {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(4096)
    const n = fs.readSync(fd, buf, 0, 4096, 0)
    fs.closeSync(fd)
    return crypto.createHash('sha256').update(buf.subarray(0, n)).digest('hex').slice(0, 16)
  } catch { return undefined }
}

export function analyzeLocalModel(modelId: string, libraryPath: string, extra?: Partial<ExploreModel>): ModelProfile {
  let fileSizeMB = 0
  let format: ModelProfile['format'] = 'unknown'
  let fileHash: string | undefined
  try {
    const st = fs.statSync(libraryPath)
    fileSizeMB = Math.round(st.size / (1024 * 1024))
    format = detectFormat(libraryPath)
    fileHash = hashFileHeader(libraryPath)
  } catch { /* file may not exist yet */ }
  const params = extra?.parameters ?? 'Unknown'
  const paramsCount = (() => {
    const m = params.match(/([\d.]+)B/i)
    return m ? Math.round(parseFloat(m[1]) * 1_000_000_000) : undefined
  })()
  return {
    modelId,
    libraryPath,
    architecture: extra?.architecture ?? 'unknown',
    format,
    parameters: params,
    paramsCount,
    fileSizeMB,
    contextLength: 4096,
    runtime: 'llama.cpp',
    quantization: extra?.files?.[0]?.quantization,
    supportedBackends: format === 'GGUF' ? ['CPU', 'CUDA', 'Vulkan'] : ['CPU'],
  }
}

export function analyzeExploreModel(m: ExploreModel, contextLength = 4096): ModelProfile {
  const file = m.files[0]
  const sizeMB = file ? Math.round(((file.sizeBytes ?? file.sizeGB * 1024 ** 3) / (1024 * 1024))) : Math.round((m.repoSizeBytes ?? 0) / (1024 * 1024))
  return {
    modelId: m.id,
    architecture: m.architecture,
    format: (file?.format?.toLowerCase() as ModelProfile['format']) ?? 'unknown',
    parameters: m.parameters,
    paramsCount: (() => { const mm = m.parameters.match(/([\d.]+)B/i); return mm ? Math.round(parseFloat(mm[1]) * 1e9) : undefined })(),
    fileSizeMB: sizeMB,
    contextLength,
    runtime: 'llama.cpp',
    quantization: file?.quantization,
    supportedBackends: file?.format === 'GGUF' ? ['CPU', 'CUDA'] : ['CPU'],
  }
}

/**
 * Isolated-pool estimation: file size + runtime overhead + KV cache.
 * Does NOT sum VRAM+RAM — caller compares requiredMB separately to each pool.
 */
export function estimateResources(profile: ModelProfile, hw?: HardwareProfileFull): ResourceEstimate {
  const fileSizeMB = profile.fileSizeMB
  // Runtime overhead: ~12% for GGUF, 8% for MLX per hardwareCheck
  const overheadMul = profile.format === 'MLX' ? 1.08 : 1.12
  const runtimeOverheadMB = Math.round(fileSizeMB * (overheadMul - 1))
  const kvMB = Math.round(estimateKvCacheGB(profile.contextLength, { parameters: profile.parameters ?? '7B' } as ExploreModel) * 1024)
  const totalMB = fileSizeMB + runtimeOverheadMB + kvMB
  // Safety margin: 1GB VRAM / 0.5GB RAM headroom per docs section 8
  const safetyMB = hw?.gpu.vram_total_mb ? 1024 : 512
  const requiredMB = totalMB + safetyMB
  return { fileSizeMB, runtimeOverheadMB, kvCacheMB: kvMB, totalEstimatedMB: totalMB, safetyMarginMB: safetyMB, requiredMB }
}

export interface PrecheckResult {
  passed: boolean
  reason?: string
  code?: string
}

export function precheck(profile: ModelProfile, estimate: ResourceEstimate, hw: HardwareProfileFull): PrecheckResult {
  // Format supported?
  if (profile.format === 'unknown') return { passed: false, reason: 'Model format not recognized', code: 'INVALID_MODEL' }
  // Backend available?
  if (profile.format === 'GGUF' && profile.supportedBackends?.includes('CUDA') && hw.backend.name === 'CPU' && hw.gpu.vram_total_mb) {
    // CUDA not available but CPU fallback exists — still pass as ESTIMATED_COMPATIBLE with limitation
  }
  // Isolated pool checks — docs 6: don't launch if obviously impossible
  const requiredGB = estimate.requiredMB / 1024
  const totalRamGB = hw.memory.ram_total_mb / 1024
  const totalVramGB = hw.gpu.vram_total_mb ? hw.gpu.vram_total_mb / 1024 : undefined
  const availRamGB = hw.memory.ram_available_mb / 1024

  // If model needs more than total RAM and more than total VRAM (when GPU exists) → impossible
  const fitsRam = requiredGB <= totalRamGB
  const fitsVram = totalVramGB !== undefined ? requiredGB <= totalVramGB : false
  const fitsEither = fitsRam || fitsVram

  if (!fitsEither) {
    return { passed: false, reason: `Estimated ${requiredGB.toFixed(1)}GB exceeds RAM ${totalRamGB.toFixed(0)}GB${totalVramGB ? ` and VRAM ${totalVramGB.toFixed(1)}GB` : ''}`, code: 'OUT_OF_MEMORY' }
  }
  // Also reject if available RAM is far below required (available * 0.9 guard)
  if (requiredGB > availRamGB * 0.95 && !fitsVram) {
    return { passed: false, reason: `Needs ~${requiredGB.toFixed(1)}GB but only ${availRamGB.toFixed(1)}GB RAM free. Close apps or choose smaller quant.`, code: 'OUT_OF_MEMORY' }
  }
  // Architecture / runtime checks stub — assume supported
  return { passed: true }
}
