import os from 'node:os'
import type { LocalModel, ResourcePressure, SystemResourceManagerPort, SystemResources } from '@shared/types/ports'

export class SystemResourceStub implements SystemResourceManagerPort {
  private limits: SystemResources['limits'] = { maxConcurrentModels: 1 }

  async getSnapshot(): Promise<SystemResources> {
    const totalMB = Math.round(os.totalmem() / (1024 * 1024))
    const freeMB = Math.round(os.freemem() / (1024 * 1024))
    return {
      cpu: { logicalCores: os.cpus().length, loadAvg1: os.loadavg()[0] ?? 0 },
      ram: { totalMB, freeMB, usedByAppMB: Math.round(process.memoryUsage().rss / (1024 * 1024)) },
      gpu: { available: false },
      vram: { totalMB: undefined, freeMB: undefined, usedByModelsMB: undefined },
      disk: { path: 'unknown', totalMB: 0, freeMB: 0 },
      models: { instances: [], totalVramUsedMB: undefined },
      limits: { ...this.limits }
    }
  }

  async checkBeforeLoad(_model: LocalModel): Promise<ResourcePressure> {
    return { level: 'ok' }
  }

  async getLimits(): Promise<SystemResources['limits']> {
    return { ...this.limits }
  }

  async setLimits(partial: Partial<SystemResources['limits']>): Promise<void> {
    this.limits = { ...this.limits, ...partial }
  }
}
