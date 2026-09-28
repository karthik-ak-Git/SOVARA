import { describe, expect, it } from 'vitest'
import { evaluateMultimodalGate } from '../src/main/backend/MultimodalGate'
import { checkSkillReadGate } from '../src/main/backend/AgentOrchestrator'
import { detectSkillNeeds } from '../src/main/backend/TaskClassifier'

describe('CAPABILITY-AWARE MULTIMODAL SYSTEM GATE SUITE', () => {
  it('CASE 1: Vision model available, OCR executable unavailable -> routes to vision model, no read_skill("ocr") mandate', () => {
    const result = evaluateMultimodalGate({
      hasImageInput: true,
      modelSupportsModality: true,
      capabilityAvailable: false,
      skillAvailable: true,
    })

    expect(result.decision).toBe('vision_model')
    expect(result.canProcessImage).toBe(true)
    expect(result.modelSupportsModality).toBe(true)

    // Verify checkSkillReadGate does not demand read_skill("ocr")
    const gate = checkSkillReadGate(
      { kind: 'chat', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'test', skillsNeeded: ['ocr', 'vision'] },
      [],
      new Set()
    )
    expect(gate.passed).toBe(true)
  })

  it('CASE 2: Vision model unavailable, OCR executable available -> routes to OCR capability', () => {
    const result = evaluateMultimodalGate({
      hasImageInput: true,
      modelSupportsModality: false,
      capabilityAvailable: true,
      skillAvailable: true,
    })

    expect(result.decision).toBe('ocr_capability')
    expect(result.canProcessImage).toBe(true)
    expect(result.capabilityAvailable).toBe(true)
  })

  it('CASE 3: Neither vision model nor OCR executable available -> clear capability-unavailable result, no fake OCR', () => {
    const result = evaluateMultimodalGate({
      hasImageInput: true,
      modelSupportsModality: false,
      capabilityAvailable: false,
      skillAvailable: false,
    })

    expect(result.decision).toBe('unavailable')
    expect(result.canProcessImage).toBe(false)
    expect(result.message).toContain('Image processing unavailable')
  })

  it('CASE 4: OCR skill exists but no OCR executable exists -> skillAvailable != capabilityAvailable', () => {
    const result = evaluateMultimodalGate({
      hasImageInput: true,
      modelSupportsModality: false,
      capabilityAvailable: false,
      skillAvailable: true, // e.g. azure-ai-vision-imageanalysis-py SKILL.md exists
    })

    // SKILL.md is documentation only — not an executable capability!
    expect(result.skillAvailable).toBe(true)
    expect(result.capabilityAvailable).toBe(false)
    expect(result.decision).toBe('unavailable')
    expect(result.canProcessImage).toBe(false)
    expect(result.message).toContain('Reading skill documentation does not execute OCR')
  })

  it('CASE 5: Vision model exists but no OCR skill exists -> image can still be processed by vision model', () => {
    const result = evaluateMultimodalGate({
      hasImageInput: true,
      modelSupportsModality: true,
      capabilityAvailable: false,
      skillAvailable: false,
    })

    expect(result.decision).toBe('vision_model')
    expect(result.canProcessImage).toBe(true)
    expect(result.skillAvailable).toBe(false)
  })

  it('VERIFICATION: detectSkillNeeds does not inject ocr into skillsNeeded on image attachments', () => {
    const skills = detectSkillNeeds('Please inspect this attached diagram', [{ mimeType: 'image/png' }])
    expect(skills).not.toContain('ocr')
    expect(skills).not.toContain('vision')
  })
})
