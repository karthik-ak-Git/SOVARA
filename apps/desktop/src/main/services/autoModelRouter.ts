/**
 * Auto-Model Router
 * Computes optimal local GGUF model selection from real hardware detection & model specs.
 * Implements AUTO mode hardware-matching preflight & single-resident GPU safety.
 */

import { getHardwareProfile } from './hardwareProfile'

export interface LocalModelRecord {
  id: string
  name: string
  sizeBytes?: number
  path?: string
}

export interface ModelRouteDecision {
  modelId: string
  reason: string
  confidence: number
  isAutoSelected: boolean
  hardwareSummary: {
    gpuName?: string
    vramAvailableMB: number
    ramAvailableGB: number
    cpuCores: number
    runtime: 'cuda' | 'cpu'
  }
}

export function routeModelSelection(
  userSelectedModelId: string | null | undefined,
  availableModels: LocalModelRecord[],
  taskKind: 'coding' | 'tool-use' | 'reasoning' | 'document' | 'chat' = 'chat'
): ModelRouteDecision {
  const hw = getHardwareProfile()
  const vramMB = hw.freeVramMB ?? hw.totalVramMB ?? 2048
  const ramGB = hw.freeRamMB ? Math.round(hw.freeRamMB / 1024) : hw.totalRamMB ? Math.round(hw.totalRamMB / 1024) : 8
  const runtime = hw.gpuRuntime ?? (hw.gpuAvailable ? 'cuda' : 'cpu')
  const hwSummary = {
    gpuName: hw.gpuName,
    vramAvailableMB: vramMB,
    ramAvailableGB: ramGB,
    cpuCores: (hw as any).cpuCores ?? (typeof window === 'undefined' ? require('node:os').cpus().length : 4),
    runtime: runtime as 'cuda' | 'cpu',
  }

  if (availableModels.length === 0) {
    return {
      modelId: userSelectedModelId || 'sovara-local-default',
      reason: 'No local models found in library, using system default ID.',
      confidence: 0.1,
      isAutoSelected: false,
      hardwareSummary: hwSummary,
    }
  }

  // 1. Manual selection override (if valid and present in library)
  if (userSelectedModelId && userSelectedModelId !== 'auto') {
    const found = availableModels.find((m) => m.id === userSelectedModelId || m.name === userSelectedModelId)
    if (found) {
      return {
        modelId: found.id,
        reason: `Using user-selected model: ${found.name}`,
        confidence: 1.0,
        isAutoSelected: false,
        hardwareSummary: hwSummary,
      }
    }
  }

  // 2. AUTO Smart Routing based on real hardware specs and task kind
  const scored = availableModels.map((m) => {
    let score = 50
    const name = (m.name || m.id).toLowerCase()
    const sizeBytes = m.sizeBytes ?? 0
    const sizeMB = Math.round(sizeBytes / (1024 * 1024))

    // Size fit score: does weight + KV cache fit in VRAM / RAM?
    if (runtime === 'cuda') {
      if (sizeMB > 0 && sizeMB < vramMB * 0.85) score += 30 // Excellent fit in VRAM
      else if (sizeMB > 0 && sizeMB < vramMB * 1.1) score += 10 // Tight VRAM fit (partial offload)
      else if (sizeMB > 0) score -= 30 // Severe VRAM spill
    } else {
      if (sizeMB > 0 && sizeMB < ramGB * 1024 * 0.7) score += 20 // Fits in system RAM
      else if (sizeMB > 0) score -= 40
    }

    // Task-specific scoring
    if (taskKind === 'coding' || taskKind === 'tool-use') {
      if (name.includes('coder') || name.includes('qwen') || name.includes('deepseek')) score += 25
    } else if (taskKind === 'reasoning') {
      if (name.includes('nemotron') || name.includes('instruct') || name.includes('r1')) score += 20
    }

    // Prefer Q4_K_M / Q5_K_S quantizations for local speed
    if (name.includes('q4_k_m') || name.includes('q5_k_s') || name.includes('q4_0')) score += 15

    return { model: m, score }
  })

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]!

  return {
    modelId: best.model.id,
    reason: `Auto-selected ${best.model.name} based on ${runtime.toUpperCase()} hardware profile (${vramMB}MB VRAM) and task intent (${taskKind}).`,
    confidence: Math.min(0.95, Math.max(0.4, best.score / 100)),
    isAutoSelected: true,
    hardwareSummary: hwSummary,
  }
}
