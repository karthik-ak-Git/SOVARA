import { describe, expect, it } from 'vitest'
import { routeModel, type RouterContext } from '../src/main/backend/ModelRouter'
import type { DiscoveredModel } from '@shared/types/models'
import type { SystemResources } from '@shared/types/ports'

const mockResources: SystemResources = {
  cpu: { user: 0, system: 0 },
  ram: { totalMB: 32000, freeMB: 16000, usedMB: 16000 },
  vram: { totalMB: 8000, freeMB: 6000, usedMB: 2000 },
}

const textModelA: DiscoveredModel = {
  modelId: 'gemma-4-E2B-it-Q4_K_M',
  runtimeId: 'local',
  available: true,
  capabilities: ['chat', 'coding'],
  contextLength: 8192,
}

const visionModelB: DiscoveredModel = {
  modelId: 'qwen2-vl-7b-instruct',
  runtimeId: 'local',
  available: true,
  capabilities: ['chat', 'coding', 'vision'],
  contextLength: 8192,
}

describe('PART 10 — MODEL ROUTER AUTO MULTIMODAL REGRESSION SUITE', () => {
  it('TEST 1: Image + vision model available -> vision route selected', async () => {
    const ctx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attached', requiresVision: true } as any,
      models: [textModelA, visionModelB],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const decision = await routeModel(ctx)
    expect(decision.selectedRoute).toBe('vision_model')
    expect(decision.modelId).toBe('qwen2-vl-7b-instruct')
    expect(decision.routingTrace?.selectedRoute).toBe('vision_model')
  })

  it('TEST 2: Image + no vision model + OCR capability available -> OCR route selected', async () => {
    const ctx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attached', requiresVision: true } as any,
      models: [textModelA], // Text model only
      resources: mockResources,
      ocrCapabilityAvailable: true, // Executable OCR capability available
    }

    const decision = await routeModel(ctx)
    expect(decision.selectedRoute).toBe('ocr_capability')
    expect(decision.modelId).toBe('gemma-4-E2B-it-Q4_K_M')
    expect(decision.routingTrace?.selectedRoute).toBe('ocr_capability')
  })

  it('TEST 3: Image + no vision model + no OCR capability -> capability unavailable', async () => {
    const ctx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attached', requiresVision: true } as any,
      models: [textModelA],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const decision = await routeModel(ctx)
    expect(decision.selectedRoute).toBe('unavailable')
    expect(decision.modelId).toBeNull()
    expect(decision.reason).toContain('image-processing-unavailable')
  })

  it('TEST 4: Text-only input -> vision/OCR routing is not unnecessarily triggered', async () => {
    const ctx: RouterContext = {
      task: { kind: 'chat', confidence: 1, requiredCapabilities: ['chat'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'plain text', requiresVision: false } as any,
      models: [textModelA, visionModelB],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const decision = await routeModel(ctx)
    expect(decision.selectedRoute).toBeUndefined()
    expect(decision.modelId).toBeDefined()
  })

  it('TEST 5: OCR skill exists but no OCR executable exists -> skill existence does NOT count as OCR capability', async () => {
    const ctx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attached', requiresVision: true } as any,
      models: [textModelA],
      resources: mockResources,
      ocrCapabilityAvailable: false, // SKILL.md exists in registry, but ocrCapabilityAvailable = false
    }

    const decision = await routeModel(ctx)
    expect(decision.selectedRoute).toBe('unavailable')
    expect(decision.modelId).toBeNull()
  })

  it('TEST 6: Vision model exists but no OCR skill exists -> vision route still works', async () => {
    const ctx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attached', requiresVision: true } as any,
      models: [textModelA, visionModelB],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const decision = await routeModel(ctx)
    expect(decision.selectedRoute).toBe('vision_model')
    expect(decision.modelId).toBe('qwen2-vl-7b-instruct')
  })

  it('TEST 7: AUTO does not permanently select a specific model', async () => {
    const ctxVision: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attached', requiresVision: true } as any,
      models: [visionModelB],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const ctxCoding: RouterContext = {
      task: { kind: 'coding', confidence: 1, requiredCapabilities: ['coding'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'code scaffold', requiresVision: false } as any,
      models: [textModelA, visionModelB],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const decision1 = await routeModel(ctxVision)
    const decision2 = await routeModel(ctxCoding)

    expect(decision1.modelId).toBe('qwen2-vl-7b-instruct')
    expect(decision2.modelId).toBe('gemma-4-E2B-it-Q4_K_M')
  })

  it('TEST 8: Model availability changes between runs -> AUTO changes route accordingly', async () => {
    const modelBUnavailable: DiscoveredModel = { ...visionModelB, available: false }

    const ctx1: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attached', requiresVision: true } as any,
      models: [textModelA, visionModelB],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const ctx2: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attached', requiresVision: true } as any,
      models: [textModelA, modelBUnavailable],
      resources: mockResources,
      ocrCapabilityAvailable: true,
    }

    const decision1 = await routeModel(ctx1)
    const decision2 = await routeModel(ctx2)

    expect(decision1.selectedRoute).toBe('vision_model')
    expect(decision1.modelId).toBe('qwen2-vl-7b-instruct')

    expect(decision2.selectedRoute).toBe('ocr_capability')
    expect(decision2.modelId).toBe('gemma-4-E2B-it-Q4_K_M')
  })
})
