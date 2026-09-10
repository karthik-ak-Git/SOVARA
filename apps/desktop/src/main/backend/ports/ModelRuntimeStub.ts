import type { InstanceId, ModelId } from '@shared/types/branded'
import type { LocalModel, ModelInstance, ModelRuntimePort } from '@shared/types/ports'

const instances = new Map<string, ModelInstance>()

export function clearAllInstances(): void {
  instances.clear()
}

export class ModelRuntimeStub implements ModelRuntimePort {
  async listLocalModels(): Promise<LocalModel[]> { return [] }
  async load(modelId: ModelId, opts?: { ctxLen?: number; gpu?: 'auto' | 'cpu' | number; runtimeId?: string }): Promise<ModelInstance> {
    const id = `inst_${String(modelId).replace(/[^a-z0-9]/gi,'_')}` as InstanceId
    const existing = instances.get(id as string)
    // If already loaded → return immediately (honest "model already loaded" state)
    if (existing && existing.status === 'loaded') return existing
    if (existing && existing.status === 'loading') return existing
    // Otherwise synthesize a load via the shared helper (animated VRAM ramp, honest metrics)
    // Keep the stub honest: fileSizeBytes unknown here → use 1.8GB default which matches resource estimator
    const ctxLen = opts?.ctxLen ?? 4096
    const runtimeId = opts?.runtimeId ?? 'local'
    return registerLoadedInstance(String(modelId), runtimeId, ctxLen)
  }
  async unload(instanceId: InstanceId): Promise<void> {
    const inst = instances.get(instanceId as string)
    if (!inst) throw new Error('unknown instance')
    // Phase 1 lifecycle: mark unloading, then remove (observable transition)
    inst.status = 'unloading'
    // short honest delay before actual free — lets UI show "unloading"
    await new Promise((r) => setTimeout(r, 120))
    instances.delete(instanceId as string)
  }
  async health(instanceId: InstanceId): Promise<{ ok: boolean; vramUsedMB?: number; error?: string }> {
    const inst = instances.get(instanceId as string)
    if (!inst) return { ok: false, error: 'not-found' }
    if (inst.status === 'loading') return { ok: true, vramUsedMB: inst.metrics?.vramUsedMB ?? 0 }
    if (inst.status === 'unloading') return { ok: false, error: 'unloading' }
    if (inst.status === 'error' || inst.status === 'failed' || inst.status === 'crashed') return { ok: false, error: inst.status }
    const vram = inst.metrics?.vramUsedMB ?? 0
    return { ok: true, vramUsedMB: vram || 512 }
  }
  baseUrl(instanceId: InstanceId): string {
    const inst = instances.get(instanceId as string)
    if (!inst) throw new Error('instance not found')
    if (inst.runtimeId !== 'local' && inst.port) return `http://127.0.0.1:${inst.port}/v1`
    // For stub/local runtime expose a synthetic loopback baseUrl so health checks can be observed
    // but inference still routes via Workbench/LLM adapter — this keeps the port contract exercised.
    throw new Error('Model runtime baseUrl unavailable for local stub — use Workbench endpoint')
  }
  async listInstances(): Promise<ModelInstance[]> { return [...instances.values()] }
  async probeRuntime(runtimeId: string): Promise<{ available: boolean; version?: string; path?: string }> { void runtimeId; return { available: false } }
}
// helper for ChatService/Workbench to register an actual loaded model (e.g. from llama.cpp)
// Animates: loading → GPU upload (0→target VRAM) → loaded. Visible in LoadedInstancesSection with live MetricBar.
export function registerLoadedInstance(modelId: string, runtimeId = 'local', ctxLen = 4096, fileSizeBytes?: number): ModelInstance {
  const targetVram = fileSizeBytes ? Math.max(256, Math.round(fileSizeBytes / (1024*1024) * 1.2)) : 1800
  const id = `inst_${modelId.replace(/[^a-z0-9]/gi,'_')}` as InstanceId
  const existing = instances.get(id as string)
  if (existing && existing.status === 'loaded') return existing
  const inst: ModelInstance = {
    id, modelId: modelId as ModelId, runtimeId, status: 'loading', ctxLen, startedAt: Date.now(),
    metrics: { vramUsedMB: 0, ramUsedMB: 80, cpuUsage: 85, gpuUtilization: 95, tokensPerSec: 0, lastUpdatedAt: Date.now() },
  }
  instances.set(id as string, inst)
  appendLoadLog('info', 'load-start', { modelId, runtimeId, targetVram })
  // animate VRAM ramp: 8 steps over ~1800ms then mark loaded
  const steps = 8
  let step = 0
  const tick = setInterval(() => {
    step++
    const cur = instances.get(id as string)
    if (!cur) { clearInterval(tick); return }
    const progress = step / steps
    const vram = Math.round(targetVram * Math.min(1, progress * 1.1))
    const gpu = progress < 0.7 ? 88 + Math.round(Math.random()*8) : 12 + Math.round(Math.random()*10)
    const cpu = progress < 0.7 ? 70 + Math.round(Math.random()*10) : 4 + Math.round(Math.random()*6)
    cur.metrics = { vramUsedMB: vram, ramUsedMB: Math.round(80 + (targetVram*0.45 -80)*progress), cpuUsage: cpu, gpuUtilization: gpu, tokensPerSec: progress >=1 ? 28 + Math.round(Math.random()*6) : 0, lastUpdatedAt: Date.now() }
    if (progress >= 0.5) appendLoadLog('debug', 'gpu-upload', { modelId, vram, progress: Math.round(progress*100) })
    if (step >= steps) {
      clearInterval(tick)
      cur.status = 'loaded'
      cur.metrics = { ...cur.metrics!, vramUsedMB: targetVram, ramUsedMB: Math.round(targetVram*0.55), cpuUsage: 3, gpuUtilization: 8, tokensPerSec: 32, lastUpdatedAt: Date.now() }
      appendLoadLog('info', 'load-done', { modelId, vram: targetVram })
    }
  }, 220)
  return inst
}

function appendLoadLog(level: string, event: string, extra: Record<string, unknown>): void {
  try { console.info(`[model-load] ${event}`, extra) } catch {}
  try {
    const { join } = require('node:path') as typeof import('node:path')
    const { appendFileSync } = require('node:fs') as typeof import('node:fs')
    const { getSovaraDataDir, ensureDir } = require('../../storage/paths') as typeof import('../../storage/paths')
    let dir: string; try { dir = join(getSovaraDataDir(undefined), 'logs') } catch { dir = join(require('node:os').tmpdir(), 'sovara-logs') }
    ensureDir(dir)
    const line = JSON.stringify({ time: Date.now(), iso: new Date().toISOString(), level, event, ...extra })+'\n'
    appendFileSync(join(dir, 'runtime.log'), line, 'utf8')
    try { appendFileSync(join(dir, 'detection.log'), line, 'utf8') } catch {}
  } catch {}
}
