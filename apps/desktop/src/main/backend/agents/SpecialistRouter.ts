/**
 * SpecialistRouter — SOVARA AUTO Router Extension for Imported Specialist Agents.
 *
 * Implements the 2-dimensional AUTO routing architecture:
 * Dimension A: SPECIALIST ROLE (HOW to approach the task)
 * Dimension B: EXECUTION CAPABILITY (WHAT can actually execute it)
 *
 * Phase 4, 5, 7, 10 implementation.
 */

import type { TaskClassification, TaskKind } from '@shared/types/task'
import type { DiscoveredModel } from '@shared/types/models'
import type { SystemResources } from '@shared/types/ports'
import { resolveCapabilities } from '@shared/types/modelCapabilities'
import {
  getGlobalSpecialistRegistry,
  SpecialistAgentDefinition,
  SpecialistAgentRegistry,
} from './SpecialistAgentRegistry'

export interface SpecialistRoutingResult {
  /** Selected specialist agent definition */
  specialist: SpecialistAgentDefinition
  /** Dimension A: Role rationale */
  roleReason: string
  /** Dimension B: Selected execution model ID */
  selectedModelId: string | null
  /** Dimension B: Selected execution runtime ID */
  selectedRuntimeId: string | null
  /** Selected capability route */
  selectedRoute: 'vision_model' | 'ocr_capability' | 'text_model' | 'unavailable'
  /** Full trace metadata for audit */
  routingTrace: {
    inputModality: 'text' | 'image' | 'code' | 'document'
    taskKind: TaskKind
    specialistRole: string
    specialistCategory: string
    requiredCapabilities: string[]
    availableModels: Array<{ id: string; visionCapable: boolean }>
    selectedRoute: 'vision_model' | 'ocr_capability' | 'text_model' | 'unavailable'
    selectedModelId: string | null
    selectedCapability?: string
    reason: string
  }
}

/**
 * Dimension A: Select Specialist Role Definition based on task content and intent.
 */
export function selectSpecialistRole(
  userPrompt: string,
  taskKind: TaskKind,
  opts?: { hasImage?: boolean; categoryHint?: string; registry?: SpecialistAgentRegistry }
): { specialist: SpecialistAgentDefinition; reason: string } {
  const registry = opts?.registry ?? getGlobalSpecialistRegistry()

  // 1. If query contains image / vision intent or attachment
  if (opts?.hasImage || /\b(image|picture|photo|scan|ocr|extract code from image|read image)\b/i.test(userPrompt)) {
    const visionMatch = registry.findBestMatch(userPrompt, { requiresVision: true, categoryHint: 'specialized' })
    if (visionMatch) {
      return { specialist: visionMatch.specialist, reason: `Matched vision/image specialist: ${visionMatch.specialist.name} (${visionMatch.matchedReason})` }
    }
  }

  // 2. Query registry for best match based on task intent
  const bestMatch = registry.findBestMatch(userPrompt, { categoryHint: opts?.categoryHint })
  if (bestMatch && bestMatch.score > 15) {
    return { specialist: bestMatch.specialist, reason: `Matched specialist: ${bestMatch.specialist.name} (${bestMatch.matchedReason})` }
  }

  // 3. Fallback to domain default specialists based on TaskKind
  let fallbackId = 'engineering-software-engineer'
  if (taskKind === 'coding') fallbackId = 'engineering-software-engineer'
  else if (taskKind === 'agent' || taskKind === 'reasoning') fallbackId = 'specialized-master-plan-architect'
  else if (taskKind === 'analysis') fallbackId = 'testing-reality-checker'

  const fallback = registry.getSpecialist(fallbackId) || registry.getAllSpecialists()[0]
  if (fallback) {
    return { specialist: fallback, reason: `Category fallback for taskKind '${taskKind}': ${fallback.name}` }
  }

  // Default synthetic fallback
  const defaultSynthetic: SpecialistAgentDefinition = {
    id: 'default-general-specialist',
    name: 'General Assistant Specialist',
    category: 'general',
    description: 'Default general assistant specialist',
    instructions: 'You are a general AI assistant specialist.',
    capabilities: ['chat', 'coding'],
    preferredModalities: ['text'],
    requiredTools: ['fs_read', 'fs_write', 'shell_exec'],
    requiredSkills: [],
    taskPatterns: ['general'],
    modelRequirements: { minContextLength: 4096 },
    source: 'sovara-builtin',
    sourcePath: 'builtin/default.md',
    license: 'MIT',
    attribution: 'SOVARA Builtin',
  }
  return { specialist: defaultSynthetic, reason: 'Default synthetic specialist fallback' }
}

/**
 * Dimension B & Combined AUTO Router: Resolves Specialist Role + Model/Capability Execution Route.
 */
export function routeSpecialistTask(
  userPrompt: string,
  task: TaskClassification,
  models: DiscoveredModel[],
  opts: {
    hasImage?: boolean
    ocrCapabilityAvailable?: boolean
    resources: SystemResources
    registry?: SpecialistAgentRegistry
  }
): SpecialistRoutingResult {
  // Dimension A: Select Specialist Role
  const { specialist, reason: roleReason } = selectSpecialistRole(userPrompt, task.kind, {
    hasImage: opts.hasImage,
    registry: opts.registry,
  })

  const sovereign = models.filter((m) => m.runtimeId === 'local')
  const available = (sovereign.length > 0 ? sovereign : models).filter((m) => m.available)

  const candidateModelsInfo = available.map((m) => {
    const { capabilities } = resolveCapabilities(m.modelId, m.capabilities, m.contextLength)
    return {
      id: m.modelId,
      visionCapable: capabilities.includes('vision') || Boolean((m as any).visionCapable),
    }
  })

  const isImageTask = Boolean(opts.hasImage || task.requiresVision || (task as any).needsVision || (task as any).needsMultimodal)

  // Dimension B Routing logic for Image Tasks
  if (isImageTask) {
    const visionModels = available.filter((m) => {
      const { capabilities } = resolveCapabilities(m.modelId, m.capabilities, m.contextLength)
      return capabilities.includes('vision') || Boolean((m as any).visionCapable)
    })

    if (visionModels.length > 0) {
      // Vision Route: Pick first/best available vision-capable model
      const selectedVisionModel = visionModels[0]!
      return {
        specialist,
        roleReason,
        selectedModelId: selectedVisionModel.modelId,
        selectedRuntimeId: selectedVisionModel.runtimeId,
        selectedRoute: 'vision_model',
        routingTrace: {
          inputModality: 'image',
          taskKind: task.kind,
          specialistRole: specialist.name,
          specialistCategory: specialist.category,
          requiredCapabilities: ['vision', 'image_understanding', 'code_extraction'],
          availableModels: candidateModelsInfo,
          selectedRoute: 'vision_model',
          selectedModelId: selectedVisionModel.modelId,
          reason: `Vision model available (${selectedVisionModel.modelId}) — routing image task directly to vision model`,
        },
      }
    }

    // Check executable OCR capability fallback
    if (opts.ocrCapabilityAvailable && available.length > 0) {
      const textModel = available[0]!
      return {
        specialist,
        roleReason,
        selectedModelId: textModel.modelId,
        selectedRuntimeId: textModel.runtimeId,
        selectedRoute: 'ocr_capability',
        routingTrace: {
          inputModality: 'image',
          taskKind: task.kind,
          specialistRole: specialist.name,
          specialistCategory: specialist.category,
          requiredCapabilities: ['ocr_tool', 'code_extraction', 'filesystem'],
          availableModels: candidateModelsInfo,
          selectedRoute: 'ocr_capability',
          selectedModelId: textModel.modelId,
          selectedCapability: 'ocr_tool',
          reason: 'No vision model available — using executable OCR capability fallback to extract content',
        },
      }
    }

    // Neither vision model nor OCR capability available
    return {
      specialist,
      roleReason,
      selectedModelId: null,
      selectedRuntimeId: null,
      selectedRoute: 'unavailable',
      routingTrace: {
        inputModality: 'image',
        taskKind: task.kind,
        specialistRole: specialist.name,
        specialistCategory: specialist.category,
        requiredCapabilities: ['vision'],
        availableModels: candidateModelsInfo,
        selectedRoute: 'unavailable',
        selectedModelId: null,
        reason: 'capability-unavailable: No vision model available and no executable OCR tool capability installed',
      },
    }
  }

  // Standard Text/Code Routing
  const selectedModel = available[0] || null
  return {
    specialist,
    roleReason,
    selectedModelId: selectedModel ? selectedModel.modelId : null,
    selectedRuntimeId: selectedModel ? selectedModel.runtimeId : null,
    selectedRoute: 'text_model',
    routingTrace: {
      inputModality: 'text',
      taskKind: task.kind,
      specialistRole: specialist.name,
      specialistCategory: specialist.category,
      requiredCapabilities: specialist.capabilities,
      availableModels: candidateModelsInfo,
      selectedRoute: 'text_model',
      selectedModelId: selectedModel ? selectedModel.modelId : null,
      reason: selectedModel ? `Selected text model ${selectedModel.modelId}` : 'No local model available',
    },
  }
}

/**
 * Inject imported Specialist Agent instructions into SOVARA execution system prompt.
 * Retains SOVARA safety rules, textual tool protocol, and logical role bounds.
 */
export function buildSpecialistSystemPrompt(
  specialist: SpecialistAgentDefinition,
  baseSystemPrompt: string
): string {
  const specialistBlock = `
==================================================
ACTIVE SPECIALIST AGENT PROFILE: ${specialist.name.toUpperCase()}
CATEGORY: ${specialist.category.toUpperCase()}
SOURCE: ${specialist.source} (${specialist.sourcePath})
ATTRIBUTION: ${specialist.attribution}
==================================================

${specialist.instructions}

==================================================
SOVARA EXECUTION CONSTRAINTS & TOOL PROTOCOL
==================================================
You are executing inside SOVARA runtime. Use SOVARA textual tool fences (e.g. \`\`\`tool:fs_write ...) to interact with the environment.
Verify all code files created or modified before reporting completion.
`

  return `${specialistBlock}\n\n${baseSystemPrompt}`
}
