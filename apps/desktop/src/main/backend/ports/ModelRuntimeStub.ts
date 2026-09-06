import type { InstanceId, ModelId } from '@shared/types/branded'
import type { LocalModel, ModelInstance, ModelRuntimePort } from '@shared/types/ports'

export class ModelRuntimeStub implements ModelRuntimePort {
  async listLocalModels(): Promise<LocalModel[]> {
    return []
  }
  async load(_modelId: ModelId, _opts?: { ctxLen?: number; gpu?: 'auto' | 'cpu' | number; runtimeId?: string }): Promise<ModelInstance> {
    void _opts
    throw new Error('Model runtime unavailable in Phase 1 — no runtime adapter mounted')
  }
  async unload(_instanceId: InstanceId): Promise<void> {
    throw new Error('Model runtime unavailable in Phase 1')
  }
  async health(_instanceId: InstanceId): Promise<{ ok: boolean; vramUsedMB?: number; error?: string }> {
    return { ok: false, error: 'unavailable-in-Phase1' }
  }
  baseUrl(_instanceId: InstanceId): string {
    throw new Error('Model runtime unavailable in Phase 1')
  }
  async listInstances(): Promise<ModelInstance[]> {
    return []
  }
  async probeRuntime(runtimeId: string): Promise<{ available: boolean; version?: string; path?: string }> {
    void runtimeId
    return { available: false }
  }
}
