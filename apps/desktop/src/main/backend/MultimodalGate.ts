/**
 * MultimodalGate — Capability-aware routing for image and multimodal inputs.
 *
 * Architecture distinction:
 * 1. SKILL: Instruction/documentation (SKILL.md). Reading a skill loads markdown into context;
 *    it is NOT an executable capability and cannot process images.
 * 2. CAPABILITY: An actual executable local OCR tool/engine that takes image bytes/path and outputs text.
 * 3. MODEL: A local LLM runtime model that directly consumes image pixels (vision-capable model).
 *
 * Routing Decision:
 *  - IF modelSupportsModality: route image to vision model (no read_skill("ocr") mandate).
 *  - ELSE IF capabilityAvailable: route image to executable OCR tool.
 *  - ELSE: report image processing unavailable (no fake OCR, no fake artifacts, no read_skill loop).
 */

export interface MultimodalGateParams {
  hasImageInput: boolean
  modelSupportsModality: boolean
  capabilityAvailable: boolean
  skillAvailable: boolean
}

export interface MultimodalGateResult {
  needsMultimodal: boolean
  hasImageInput: boolean
  modelSupportsModality: boolean
  capabilityAvailable: boolean
  skillAvailable: boolean
  decision: 'vision_model' | 'ocr_capability' | 'unavailable'
  canProcessImage: boolean
  message: string
}

export function evaluateMultimodalGate(params: MultimodalGateParams): MultimodalGateResult {
  const { hasImageInput, modelSupportsModality, capabilityAvailable, skillAvailable } = params

  if (!hasImageInput) {
    return {
      needsMultimodal: false,
      hasImageInput: false,
      modelSupportsModality,
      capabilityAvailable,
      skillAvailable,
      decision: 'vision_model',
      canProcessImage: false,
      message: 'No image attachment present.',
    }
  }

  // Case 1 & Case 5: Vision-capable model available
  if (modelSupportsModality) {
    return {
      needsMultimodal: true,
      hasImageInput: true,
      modelSupportsModality: true,
      capabilityAvailable,
      skillAvailable,
      decision: 'vision_model',
      canProcessImage: true,
      message: 'Vision-capable model available — routing image directly to vision model. (read_skill is NOT required for vision processing).',
    }
  }

  // Case 2: Executable OCR capability available
  if (capabilityAvailable) {
    return {
      needsMultimodal: true,
      hasImageInput: true,
      modelSupportsModality: false,
      capabilityAvailable: true,
      skillAvailable,
      decision: 'ocr_capability',
      canProcessImage: true,
      message: 'Executable OCR capability available — routing image to local OCR tool.',
    }
  }

  // Case 3 & Case 4: Neither vision model nor executable OCR capability available
  return {
    needsMultimodal: true,
    hasImageInput: true,
    modelSupportsModality: false,
    capabilityAvailable: false,
    skillAvailable,
    decision: 'unavailable',
    canProcessImage: false,
    message: skillAvailable
      ? 'Image processing unavailable: An OCR skill/documentation exists, but no executable OCR engine is installed and the current model lacks vision support. Reading skill documentation does not execute OCR.'
      : 'Image processing unavailable: The selected model lacks vision support and no local OCR executable engine is installed.',
  }
}
