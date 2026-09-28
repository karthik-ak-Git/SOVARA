/**
 * SOVARA Specialist Agency Agents Integration & AUTO Routing Test Matrix.
 *
 * Implements Phase 9, Phase 10, and Phase 11 test suites.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import {
  SpecialistAgentRegistry,
  getGlobalSpecialistRegistry,
} from '../src/main/backend/agents/SpecialistAgentRegistry'
import {
  selectSpecialistRole,
  routeSpecialistTask,
  buildSpecialistSystemPrompt,
} from '../src/main/backend/agents/SpecialistRouter'
import type { TaskClassification } from '@shared/types/task'
import type { DiscoveredModel } from '@shared/types/models'
import type { SystemResources } from '@shared/types/ports'

describe('SOVARA Agency Agents Registry & Import Audit (Phase 1, 2, 3)', () => {
  let registry: SpecialistAgentRegistry

  beforeEach(() => {
    // Point to agency-agents repository
    const candidates = [
      path.resolve(process.cwd(), 'test/agency-agents'),
      path.resolve(process.cwd(), '../../test/agency-agents'),
      'D:/SOVARA/test/agency-agents',
    ]
    const repoPath = candidates.find((p) => fs.existsSync(p)) || candidates[0]
    registry = new SpecialistAgentRegistry(repoPath)
  })

  it('imports and indexes all specialist agents with normalized schema', () => {
    expect(registry.count()).toBeGreaterThan(200)

    const frontendDev = registry.getSpecialist('engineering-engineering-frontend-developer')
    expect(frontendDev).toBeDefined()
    if (frontendDev) {
      expect(frontendDev.name).toBe('Frontend Developer')
      expect(frontendDev.category).toBe('engineering')
      expect(frontendDev.source).toBe('msitarzewski/agency-agents')
      expect(frontendDev.license).toBe('MIT')
      expect(frontendDev.attribution).toContain('AgentLand Contributors')
      expect(frontendDev.capabilities).toContain('coding')
      expect(frontendDev.requiredTools).toContain('fs_write')
    }
  })

  it('preserves traceable metadata, category, and source paths for synchronization', () => {
    const specialists = registry.getAllSpecialists()
    for (const spec of specialists.slice(0, 10)) {
      expect(spec.id).toBeTruthy()
      expect(spec.name).toBeTruthy()
      expect(spec.category).toBeTruthy()
      expect(spec.instructions).toBeTruthy()
      expect(spec.sourcePath).toMatch(/\.md$/)
      expect(spec.license).toBe('MIT')
    }
  })
})

describe('SOVARA AUTO Router — 2D Specialist & Capability Matrix (Phase 4, 5, 7, 8)', () => {
  const dummyResources: SystemResources = {
    cpu: { logicalCores: 8, loadAvg1: 0.5 },
    ram: { totalMB: 16384, freeMB: 8192, usedByAppMB: 500 },
    vram: { totalMB: 8192, freeMB: 6000 },
  }

  const dummyModels: DiscoveredModel[] = [
    {
      modelId: 'qwen2.5-coder-7b-instruct',
      displayName: 'Qwen 2.5 Coder 7B',
      runtimeId: 'local',
      available: true,
      capabilities: ['coding', 'reasoning'],
      contextLength: 16384,
      source: 'local',
    },
    {
      modelId: 'llava-1.5-7b-vision',
      displayName: 'LLaVA 1.5 7B Vision',
      runtimeId: 'local',
      available: true,
      capabilities: ['vision', 'chat'],
      contextLength: 8192,
      source: 'local',
    },
  ]

  it('TEST 1: Coding Task — Selects Coder Specialist & Coding Model', () => {
    const prompt = 'Write a Python function to compute Fibonacci numbers and save to fib.py'
    const task: TaskClassification = {
      kind: 'coding',
      confidence: 0.9,
      requiredCapabilities: ['coding'],
      contextLengthNeeded: 4096,
      reasoningRequired: false,
    }

    const route = routeSpecialistTask(prompt, task, dummyModels, {
      resources: dummyResources,
    })

    expect(route.specialist).toBeDefined()
    expect(route.specialist.capabilities).toContain('coding')
    expect(route.selectedRoute).toBe('text_model')
    expect(route.selectedModelId).toBe('qwen2.5-coder-7b-instruct')
  })

  it('TEST 2: Debugging Task — Selects Debugging Specialist Role', () => {
    const prompt = 'Diagnose why this array index throws an OutOfBounds error and fix it'
    const task: TaskClassification = {
      kind: 'coding',
      confidence: 0.85,
      requiredCapabilities: ['coding'],
      contextLengthNeeded: 4096,
      reasoningRequired: true,
    }

    const route = routeSpecialistTask(prompt, task, dummyModels, {
      resources: dummyResources,
    })

    expect(route.specialist).toBeDefined()
    expect(route.specialist.name.toLowerCase()).toMatch(/debug|developer|engineer|tester|checker/i)
  })

  it('TEST 3: Testing Task — Selects Testing Specialist Role', () => {
    const prompt = 'Write automated unit tests for our authentication API using Vitest'
    const task: TaskClassification = {
      kind: 'coding',
      confidence: 0.88,
      requiredCapabilities: ['coding', 'testing'],
      contextLengthNeeded: 4096,
      reasoningRequired: false,
    }

    const route = routeSpecialistTask(prompt, task, dummyModels, {
      resources: dummyResources,
    })

    expect(route.specialist.capabilities).toContain('testing')
  })

  it('TEST 4: Planning Task — Selects Master Plan Architect Specialist', () => {
    const prompt = 'Create a multi-step architecture plan for building a scalable microservices platform'
    const task: TaskClassification = {
      kind: 'agent',
      confidence: 0.92,
      requiredCapabilities: ['reasoning', 'tool-use'],
      contextLengthNeeded: 8192,
      reasoningRequired: true,
    }

    const route = routeSpecialistTask(prompt, task, dummyModels, {
      resources: dummyResources,
    })

    expect(route.specialist.capabilities).toContain('planning')
  })
})

describe('SOVARA Phase 10 — Image Code Extraction Dual-Route Test', () => {
  const dummyResources: SystemResources = {
    cpu: { logicalCores: 8, loadAvg1: 0.5 },
    ram: { totalMB: 16384, freeMB: 8192, usedByAppMB: 500 },
    vram: { totalMB: 8192, freeMB: 6000 },
  }

  const prompt = 'Read this image containing Python code and create a Python file code.py'
  const task: TaskClassification = {
    kind: 'coding',
    confidence: 0.9,
    requiredCapabilities: ['coding', 'vision'],
    contextLengthNeeded: 4096,
    reasoningRequired: false,
    requiresVision: true,
  }

  it('TEST A: Vision-capable model available → AUTO selects vision_model route', () => {
    const visionModels: DiscoveredModel[] = [
      {
        modelId: 'qwen2-vl-7b-instruct',
        displayName: 'Qwen 2 VL Vision',
        runtimeId: 'local',
        available: true,
        capabilities: ['vision', 'coding'],
        contextLength: 8192,
        source: 'local',
      },
      {
        modelId: 'qwen2.5-coder-7b-instruct',
        displayName: 'Qwen 2.5 Coder',
        runtimeId: 'local',
        available: true,
        capabilities: ['coding'],
        contextLength: 16384,
        source: 'local',
      },
    ]

    const route = routeSpecialistTask(prompt, task, visionModels, {
      hasImage: true,
      ocrCapabilityAvailable: true,
      resources: dummyResources,
    })

    expect(route.specialist).toBeDefined()
    expect(route.selectedRoute).toBe('vision_model')
    expect(route.selectedModelId).toBe('qwen2-vl-7b-instruct')
    expect(route.routingTrace.reason).toContain('Vision model available')
  })

  it('TEST B: Vision-capable model unavailable, OCR available → AUTO selects ocr_capability fallback', () => {
    const textOnlyModels: DiscoveredModel[] = [
      {
        modelId: 'qwen2.5-coder-7b-instruct',
        displayName: 'Qwen 2.5 Coder',
        runtimeId: 'local',
        available: true,
        capabilities: ['coding'],
        contextLength: 16384,
        source: 'local',
      },
    ]

    const route = routeSpecialistTask(prompt, task, textOnlyModels, {
      hasImage: true,
      ocrCapabilityAvailable: true,
      resources: dummyResources,
    })

    expect(route.specialist).toBeDefined()
    expect(route.selectedRoute).toBe('ocr_capability')
    expect(route.selectedModelId).toBe('qwen2.5-coder-7b-instruct')
    expect(route.routingTrace.selectedCapability).toBe('ocr_tool')
    expect(route.routingTrace.reason).toContain('OCR capability fallback')
  })

  it('TEST C: Neither Vision model nor OCR capability available → AUTO selects unavailable', () => {
    const textOnlyModels: DiscoveredModel[] = [
      {
        modelId: 'qwen2.5-coder-7b-instruct',
        displayName: 'Qwen 2.5 Coder',
        runtimeId: 'local',
        available: true,
        capabilities: ['coding'],
        contextLength: 16384,
        source: 'local',
      },
    ]

    const route = routeSpecialistTask(prompt, task, textOnlyModels, {
      hasImage: true,
      ocrCapabilityAvailable: false,
      resources: dummyResources,
    })

    expect(route.selectedRoute).toBe('unavailable')
    expect(route.selectedModelId).toBeNull()
    expect(route.routingTrace.reason).toContain('capability-unavailable')
  })
})

describe('SOVARA Phase 11 — Verification & System Prompt Safety Integrity', () => {
  it('injects specialist prompt into SOVARA system prompt without breaking textual tool fences', () => {
    const registry = getGlobalSpecialistRegistry()
    const specialist = registry.getAllSpecialists()[0]
    expect(specialist).toBeDefined()

    const basePrompt = 'BASE SOVARA SYSTEM PROMPT WITH FENCE TOOLS PROTOCOL'
    const fullPrompt = buildSpecialistSystemPrompt(specialist, basePrompt)

    expect(fullPrompt).toContain(specialist.name.toUpperCase())
    expect(fullPrompt).toContain(specialist.attribution)
    expect(fullPrompt).toContain('SOVARA EXECUTION CONSTRAINTS')
    expect(fullPrompt).toContain(basePrompt)
  })
})
