import os from 'node:os'
import fs from 'node:fs'
import type { LocalModel, ModelInstance, ResourcePressure, SystemResourceManagerPort, SystemResources } from '@shared/types/ports'
import { getHardwareProfile } from '../../services/hardwareProfile'
import { estimateVramMB, planPartialFit, readGgufModelInfo } from '../../services/llamaRuntime'

/**
 * System resources — REAL readings, no simulated GPU.
 *
 * - CPU/RAM from Node `os`; GPU/VRAM from `nvidia-smi` via
 *   `getHardwareProfile()` (unknown stays unknown, never 0 or 8192).
 * - `usedByModelsMB` aggregates the live ModelRuntimePort instances
 *   (injected supplier so this port never imports a concrete adapter).
 * - `checkBeforeLoad` is switch-aware: loading model B while model A is
 *   resident is NOT blocked by maxConcurrentModels — the runtime evicts A
 *   first. Only genuine OOM (needs more than total, or more than total
 *   minus other residents) blocks.
 */
export class SystemResourceStub implements SystemResourceManagerPort {
  private limits: SystemResources['limits'] = { maxConcurrentModels: 1 }
  private readonly listInstances: () => Promise<ModelInstance[]>

  constructor(listInstances?: () => Promise<ModelInstance[]>) {
    this.listInstances = listInstances ?? (async () => [])
  }

  async getSnapshot(): Promise<SystemResources> {
    const totalMB = Math.round(os.totalmem() / (1024 * 1024))
    const freeMB = Math.round(os.freemem() / (1024 * 1024))
    const hw = (() => {
      try {
        return getHardwareProfile()
      } catch {
        return null
      }
    })()
    let instances: ModelInstance[] = []
    try {
      instances = await this.listInstances()
    } catch { /* instances advisory — snapshot must not fail */ }
    const totalVramUsed = instances.reduce((sum, i) => sum + (i.metrics?.vramUsedMB ?? 0), 0)
    const gpuAvailable = Boolean(hw?.gpuAvailable) || instances.length > 0
    return {
      cpu: { logicalCores: os.cpus().length, loadAvg1: os.loadavg()[0] ?? 0 },
      ram: { totalMB, freeMB, usedByAppMB: Math.round(process.memoryUsage().rss / (1024 * 1024)) },
      gpu: { available: gpuAvailable, name: hw?.gpuName ?? (instances.length > 0 ? 'Local GPU (in use)' : undefined) },
      vram: {
        totalMB: hw?.totalVramMB,
        freeMB: hw?.freeVramMB,
        usedByModelsMB: instances.length > 0 ? totalVramUsed : undefined,
      },
      disk: { path: 'unknown', totalMB: 0, freeMB: 0 },
      models: { instances, totalVramUsedMB: instances.length > 0 ? totalVramUsed : undefined },
      limits: { ...this.limits },
    }
  }

  async checkBeforeLoad(model: LocalModel, opts?: { ctxLen?: number }): Promise<ResourcePressure> {
    let instances: ModelInstance[] = []
    try {
      instances = await this.listInstances()
    } catch { /* fail open — loader re-verifies */ }
    // Same model already resident → nothing to do.
    if (instances.some((i) => i.modelId === model.id && (i.status === 'loaded' || i.status === 'loading'))) {
      return { level: 'ok' }
    }
    const needMB = this.estimateNeedMB(model, opts?.ctxLen ?? 4096)
    let hw: ReturnType<typeof getHardwareProfile> | null = null
    try {
      hw = getHardwareProfile()
    } catch { /* unknown hardware → fail open, loader gates for real */ }
    const total = hw?.totalVramMB
    if (total && total > 0) {
      const usedByOthers = instances
        .filter((i) => i.modelId !== model.id)
        .reduce((sum, i) => sum + (i.metrics?.vramUsedMB ?? 0), 0)
      // Ollama-style: don't hard-block when partial offload or CPU still fits.
      const canFitPartial = (() => {
        try {
          if (!model.path || !fs.existsSync(model.path)) return false
          const size = fs.statSync(model.path).size
          if (size <= 0) return false
          const fit = planPartialFit({ modelPath: model.path, fileSizeBytes: size, ctxLen: opts?.ctxLen ?? 4096, totalMB: total, nParallel: 1, overheadMB: 256 })
          return fit !== null
        } catch { return false }
      })()
      const canFitCpu = (() => {
        const totalRam = Math.round(os.totalmem() / (1024 * 1024))
        return needMB <= totalRam * 0.88
      })()
      const effectiveFreeAfterEvict = total - usedByOthers
      if (needMB > total) {
        if (canFitPartial) {
          return { level: 'warn', blocking: false, reason: `full weights need ~${needMB}MB > ${total}MB VRAM — will auto-offload partial layers to fit (Ollama-style, slower)` }
        }
        if (canFitCpu) {
          return { level: 'warn', blocking: false, reason: `needs ~${needMB}MB > ${total}MB VRAM — will run on CPU/RAM (~${Math.round(os.totalmem()/(1024*1024))}MB RAM, slower)` }
        }
        return {
          level: 'critical',
          blocking: true,
          reason: `insufficient VRAM: "${model.displayName}" needs ~${needMB}MB but the GPU has ${total}MB total (even partial offload does not fit)`,
        }
      }
      if (needMB > effectiveFreeAfterEvict) {
        if (canFitPartial || canFitCpu) {
          return { level: 'warn', blocking: false, reason: `need ~${needMB}MB but only ~${effectiveFreeAfterEvict}MB free after evict — will auto-fit partial/CPU` }
        }
        return {
          level: 'critical',
          blocking: true,
          reason: `insufficient VRAM: need ~${needMB}MB, have ${Math.max(0, effectiveFreeAfterEvict)}MB free even after unloading the current model`,
        }
      }
      if (instances.length >= this.limits.maxConcurrentModels && instances.length > 0) {
        return {
          level: 'warn',
          blocking: false,
          reason: `switching models: "${instances[0]?.modelId ?? 'current'}" will be unloaded from VRAM to load "${model.displayName}"`,
        }
      }
      return { level: 'ok' }
    }
    // VRAM unknown (no nvidia-smi): never fabricate a block. The loader
    // re-checks with real numbers and refuses honestly if OOM is certain.
    if (instances.length >= this.limits.maxConcurrentModels && instances.length > 0) {
      return {
        level: 'warn',
        blocking: false,
        reason: `switching models: "${instances[0]?.modelId ?? 'current'}" will be unloaded to load "${model.displayName}" (VRAM size unknown — no dedicated GPU detected)`,
      }
    }
    return { level: 'ok' }
  }

  async getLimits(): Promise<SystemResources['limits']> {
    return { ...this.limits }
  }

  async setLimits(partial: Partial<SystemResources['limits']>): Promise<void> {
    this.limits = { ...this.limits, ...partial }
  }

  private estimateNeedMB(model: LocalModel, ctxLen: number): number {
    try {
      if (model.path && fs.existsSync(model.path)) {
        const size = fs.statSync(model.path).size
        if (size > 0) return estimateVramMB(size, ctxLen, model.path)
      }
    } catch { /* fall through to default */ }
    return 1800
  }
}
