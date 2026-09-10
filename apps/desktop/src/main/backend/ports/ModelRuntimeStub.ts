import type { InstanceId, ModelId } from '@shared/types/branded'
import type { LocalModel, ModelInstance, ModelRuntimePort } from '@shared/types/ports'

const instances = new Map<string, ModelInstance>()

export class ModelRuntimeStub implements ModelRuntimePort {
  async listLocalModels(): Promise<LocalModel[]> { return [] }
  async load(modelId: ModelId, opts?: { ctxLen?: number; gpu?: 'auto' | 'cpu' | number; runtimeId?: string }): Promise<ModelInstance> {
    const id = `inst_${Date.now()}` as InstanceId
    const inst: ModelInstance = {
      id, modelId, runtimeId: opts?.runtimeId ?? 'local', status: 'loaded', ctxLen: opts?.ctxLen ?? 4096,
      startedAt: Date.now(),
      metrics: { vramUsedMB: 0, ramUsedMB: 0, cpuUsage: 0, gpuUtilization: 0, tokensPerSec: 0, lastUpdatedAt: Date.now() },
    }
    instances.set(id as string, inst)
    return inst
  }
  async unload(instanceId: InstanceId): Promise<void> {
    if (!instances.has(instanceId as string)) throw new Error('unknown instance')
    instances.delete(instanceId as string)
  }
  async health(instanceId: InstanceId): Promise<{ ok: boolean; vramUsedMB?: number; error?: string }> {
    const inst = instances.get(instanceId as string)
    if (!inst) return { ok: false, error: 'not-found' }
    // synthesize VRAM from model size if zero
    const vram = inst.metrics?.vramUsedMB ?? 0
    return { ok: true, vramUsedMB: vram || 512 }
  }
  baseUrl(_instanceId: InstanceId): string { throw new Error('Model runtime unavailable in Phase 1') }
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
    const { getSovaraDataDir, ensureDir } = require('../storage/paths') as typeof import('../storage/paths')
    let dir: string; try { dir = join(getSovaraDataDir(undefined), 'logs') } catch { dir = join(require('node:os').tmpdir(), 'sovara-logs') }
    ensureDir(dir)
    const line = JSON.stringify({ time: Date.now(), iso: new Date().toISOString(), level, event, ...extra })+'\n'
    appendFileSync(join(dir, 'runtime.log'), line, 'utf8')
    try { appendFileSync(join(dir, 'detection.log'), line, 'utf8') } catch {}
  } catch {}
}
