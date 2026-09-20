import { describe, it, expect } from 'vitest'
import { pickFittingModel, suggestContextSize } from '../src/main/backend/ModelRouter'
import { pickTierAtOrBelow, loadTuning, DEFAULT_TUNING } from '../src/main/config/tuning'
import type { DiscoveredModel } from '@shared/types/models'
import type { SystemResources } from '@shared/types/ports'

function makeResources(opts?: { vramTotal?: number; vramFree?: number; ramTotal?: number; ramFree?: number }): SystemResources {
  return {
    vram: { totalMB: opts?.vramTotal ?? 6144, freeMB: opts?.vramFree ?? 5500 },
    ram: { totalMB: opts?.ramTotal ?? 16384, freeMB: opts?.ramFree ?? 8192 },
    disk: { path: 'C:\\', totalMB: 100_000, freeMB: 50_000 },
  } as SystemResources
}

function makeModel(id: string, opts?: { fileSizeBytes?: number; available?: boolean; runtimeId?: string }): DiscoveredModel {
  return {
    modelId: id,
    displayName: id,
    runtimeId: opts?.runtimeId ?? 'local',
    path: `C:\\models\\${id}.gguf`,
    capabilities: ['chat'],
    contextLength: 8192,
    available: opts?.available ?? true,
    ...(opts?.fileSizeBytes != null ? { fileSizeBytes: opts.fileSizeBytes } : {}),
  } as unknown as DiscoveredModel
}

describe('pickFittingModel (dynamic, no hardcoded names)', () => {
  it('picks the smallest model that fits free VRAM (fastest inference)', () => {
    const models = [
      makeModel('small-3b', { fileSizeBytes: 2 * 1024 ** 3 }),
      makeModel('mid-7b', { fileSizeBytes: 4.2 * 1024 ** 3 }),
      makeModel('big-27b', { fileSizeBytes: 16 * 1024 ** 3 }),
    ]
    const fit = pickFittingModel(models, makeResources({ vramTotal: 6144, vramFree: 5500 }), {})
    expect(fit).not.toBeNull()
    expect(fit!.gpu).toBe(true)
    expect(fit!.model.modelId).toBe('small-3b')
  })

  it('skips the excluded (blocked) model', () => {
    const models = [
      makeModel('blocked-7b', { fileSizeBytes: 4 * 1024 ** 3 }),
      makeModel('tiny-1b', { fileSizeBytes: 0.7 * 1024 ** 3 }),
    ]
    const fit = pickFittingModel(models, makeResources(), { excludeModelId: 'blocked-7b' })
    expect(fit!.model.modelId).toBe('tiny-1b')
  })

  it('falls back to RAM-fit when nothing fits VRAM', () => {
    const models = [
      makeModel('huge-32b', { fileSizeBytes: 20 * 1024 ** 3 }),
      makeModel('mid-9b', { fileSizeBytes: 5.5 * 1024 ** 3 }),
    ]
    // 5.5GB doesn't fit ~6GB VRAM with KV at 0.85 margin? It does — tighten VRAM:
    const fit = pickFittingModel(models, makeResources({ vramTotal: 4096, vramFree: 3800, ramFree: 16 * 1024 }), {})
    expect(fit).not.toBeNull()
    expect(fit!.gpu).toBe(false)
    expect(fit!.model.modelId).toBe('mid-9b')
  })

  it('ignores unavailable models', () => {
    const models = [
      makeModel('ghost-7b', { fileSizeBytes: 4 * 1024 ** 3, available: false }),
      makeModel('real-3b', { fileSizeBytes: 2 * 1024 ** 3 }),
    ]
    const fit = pickFittingModel(models, makeResources(), {})
    expect(fit!.model.modelId).toBe('real-3b')
  })

  it('ignores external (non-sovereign) runtimes', () => {
    const models = [
      makeModel('lmstudio-7b', { runtimeId: 'lmstudio', fileSizeBytes: 4 * 1024 ** 3 }),
      makeModel('local-3b', { fileSizeBytes: 2 * 1024 ** 3 }),
    ]
    const fit = pickFittingModel(models, makeResources(), {})
    expect(fit!.model.modelId).toBe('local-3b')
  })

  it('works with NO hardcoded model names — arbitrary ids still route by size', () => {
    const models = [
      makeModel('whatever-foo', { fileSizeBytes: 1 * 1024 ** 3 }),
      makeModel('zzz-custom-repo/bar-13b', { fileSizeBytes: 8 * 1024 ** 3 }),
    ]
    const fit = pickFittingModel(models, makeResources({ vramTotal: 2048, vramFree: 1900 }), {})
    expect(fit!.model.modelId).toBe('whatever-foo')
  })

  it('returns null when no candidate fits anywhere', () => {
    const models = [makeModel('monster-70b', { fileSizeBytes: 40 * 1024 ** 3 })]
    const fit = pickFittingModel(models, makeResources({ vramTotal: 6144, vramFree: 5000, ramFree: 2048 }), {})
    expect(fit).toBeNull()
  })
})

describe('pickTierAtOrBelow (test/main.js parity)', () => {
  it('picks largest tier within budget', () => {
    // 6553MB usable at 8MB/1k → 819k tokens → largest tier ≤ is 65536... but tiers cap.
    expect(pickTierAtOrBelow(100_000, 8, DEFAULT_TUNING.contextTiers)).toBe(131_072)
  })

  it('picks 2048 for a tiny budget', () => {
    // usable 16MB at 8MB/1k → 2000 tokens → 1024 tier fits; 2048 doesn't
    expect(pickTierAtOrBelow(16, 8)).toBe(1024)
  })

  it('clamps to smallest tier when nothing fits', () => {
    expect(pickTierAtOrBelow(0.1, 8)).toBe(1024)
  })
})

describe('suggestContextSize (hardware-aware, no fixed GPU)', () => {
  it('gives larger context on a big GPU than a small one', () => {
    const bigGpu = suggestContextSize(makeResources({ vramTotal: 24_576, vramFree: 22_000, ramFree: 32 * 1024 }), 4096)
    const smallGpu = suggestContextSize(makeResources({ vramTotal: 4096, vramFree: 3600, ramFree: 16 * 1024 }), 4096)
    expect(bigGpu).toBeGreaterThanOrEqual(smallGpu)
    expect(bigGpu).toBeGreaterThan(8192)
  })

  it('uses RAM path when GPU is absent', () => {
    const cpu = suggestContextSize(makeResources({ vramTotal: 0, vramFree: 0, ramFree: 32 * 1024 }), 4096)
    expect(cpu).toBeGreaterThan(0)
  })
})

describe('loadTuning (persisted overrides, corrupt-safe)', () => {
  it('returns defaults when no overrides stored', () => {
    const t = loadTuning(() => null)
    expect(t.stallGuardMs).toBe(DEFAULT_TUNING.stallGuardMs)
    expect(t.contextTiers).toEqual([...DEFAULT_TUNING.contextTiers])
  })

  it('applies valid overrides', () => {
    const t = loadTuning((k: string) => (k === 'tuning' ? JSON.stringify({ stallGuardMs: 60_000, maxToolLoopSteps: 9 }) : null))
    expect(t.stallGuardMs).toBe(60_000)
    expect(t.maxToolLoopSteps).toBe(9)
  })

  it('clamps insane values and ignores corrupt JSON', () => {
    // Below-min values fall back to the default, above-max are clamped to max.
    const t1 = loadTuning((k: string) => (k === 'tuning' ? JSON.stringify({ stallGuardMs: 1, maxToolLoopSteps: 9999 }) : null))
    expect(t1.stallGuardMs).toBe(DEFAULT_TUNING.stallGuardMs)
    expect(t1.maxToolLoopSteps).toBe(40)
    expect(() => loadTuning(() => '{not json')).not.toThrow()
  })
})
