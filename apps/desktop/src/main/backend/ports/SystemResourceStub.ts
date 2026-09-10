import os from 'node:os'
import type { LocalModel, ResourcePressure, SystemResourceManagerPort, SystemResources } from '@shared/types/ports'
import { ModelRuntimeStub } from './ModelRuntimeStub'

export class SystemResourceStub implements SystemResourceManagerPort {
  private limits: SystemResources['limits'] = { maxConcurrentModels: 1 }

  async getSnapshot(): Promise<SystemResources> {
    const totalMB = Math.round(os.totalmem() / (1024 * 1024))
    const freeMB = Math.round(os.freemem() / (1024 * 1024))
    // Aggregate real VRAM from loaded instances (shared global map in ModelRuntimeStub)
    let instances: import('@shared/types/ports').ModelInstance[] = []
    let totalVramUsed = 0
    try {
      const tmp = new ModelRuntimeStub()
      instances = await tmp.listInstances()
      totalVramUsed = instances.reduce((sum, i) => sum + (i.metrics?.vramUsedMB ?? 0), 0)
    } catch {}
    const hasGpu = instances.length > 0
    // If no instances, still report GPU as available if system has one (check via app.getGPUInfo is async, so we approximate)
    // Use a sensible default VRAM total 8GB when GPU is considered available
    const vramTotal = hasGpu ? 8192 : undefined
    const vramFree = hasGpu && vramTotal !== undefined ? Math.max(0, vramTotal - totalVramUsed) : undefined
    return {
      cpu: { logicalCores: os.cpus().length, loadAvg1: os.loadavg()[0] ?? 0 },
      ram: { totalMB, freeMB, usedByAppMB: Math.round(process.memoryUsage().rss / (1024 * 1024)) },
      gpu: { available: hasGpu, name: hasGpu ? 'Simulated GPU (Sovara Local)' : undefined },
      vram: { totalMB: vramTotal, freeMB: vramFree, usedByModelsMB: hasGpu ? totalVramUsed : undefined },
      disk: { path: 'unknown', totalMB: 0, freeMB: 0 },
      models: { instances, totalVramUsedMB: hasGpu ? totalVramUsed : undefined },
      limits: { ...this.limits }
    }
  }

  async checkBeforeLoad(_model: LocalModel): Promise<ResourcePressure> {
    try {
      const tmp = new ModelRuntimeStub()
      const instances = await tmp.listInstances()
      if (instances.length >= this.limits.maxConcurrentModels) {
        return {
          level: 'critical',
          blocking: true,
          reason: `max concurrent models reached (${this.limits.maxConcurrentModels}) — unload "${instances[0]?.modelId ?? 'current'}" to load another`,
        }
      }
      const totalVramUsed = instances.reduce((sum, i) => sum + (i.metrics?.vramUsedMB ?? 0), 0)
      const estimatedNeed = 1800 // default per-model VRAM estimate (matches registerLoadedInstance)
      const vramTotal = 8192
      if (totalVramUsed + estimatedNeed > vramTotal) {
        return { level: 'critical', blocking: true, reason: `insufficient VRAM: need ~${estimatedNeed}MB, have ${vramTotal - totalVramUsed}MB free` }
      }
    } catch {}
    return { level: 'ok' }
  }

  async getLimits(): Promise<SystemResources['limits']> {
    return { ...this.limits }
  }

  async setLimits(partial: Partial<SystemResources['limits']>): Promise<void> {
    this.limits = { ...this.limits, ...partial }
  }
}
