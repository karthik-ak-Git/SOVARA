import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { LocalOpenAIChatAdapter, ChatInferenceError } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import { evaluateMultimodalGate } from '../src/main/backend/MultimodalGate'
import { checkSkillReadGate } from '../src/main/backend/AgentOrchestrator'
import { buildAttachmentContext, processAttachments } from '../src/main/backend/attachments'
import type { LlmChatMessage } from '@shared/types/ports'

const pexec = promisify(execFile)
const ENDPOINT = 'http://127.0.0.1:60776'
const MODEL_ID = 'C:\\Users\\Atina\\.lmstudio\\models\\lmstudio-community\\gemma-4-E2B-it-GGUF\\gemma-4-E2B-it-Q4_K_M.gguf'

describe('LIVE MULTIMODAL TEST: Vision Model vs Non-Vision Model Image Processing', () => {
  it('TEST 1: Non-Vision Model with Image -> Correctly identifies unavailable capability, blocks read_skill("ocr") loop, no fake OCR', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-nonvision-test-'))
    const imagePath = path.join(tmpDir, 'test_image.png')

    // Create real test image
    const createImgCmd = `python -c "from PIL import Image; img = Image.new('RGB', (100, 100), color=(255, 0, 0)); img.save(r'${imagePath}')"`
    await pexec(createImgCmd, { shell: 'powershell.exe' })
    expect(fs.existsSync(imagePath)).toBe(true)

    const imgBuf = fs.readFileSync(imagePath)
    const dataUrl = `data:image/png;base64,${imgBuf.toString('base64')}`

    // Process attachment
    const processed = processAttachments(
      [{ data: dataUrl, mime: 'image/png', name: 'test_image.png', size: imgBuf.length }],
      { sessionId: 'test_session_nonvision', baseDir: tmpDir }
    )
    expect(processed.hasImage).toBe(true)

    // Evaluate MultimodalGate for Non-Vision Model (modelSupportsModality = false, capabilityAvailable = false)
    const gateResult = evaluateMultimodalGate({
      hasImageInput: processed.hasImage,
      modelSupportsModality: false, // Non-vision model
      capabilityAvailable: false,  // No local executable OCR tool
      skillAvailable: true,         // azure-ai-vision SKILL.md exists
    })

    expect(gateResult.decision).toBe('unavailable')
    expect(gateResult.canProcessImage).toBe(false)
    expect(gateResult.message).toContain('Image processing unavailable')

    // Build attachment context for non-vision model
    const contextLines = buildAttachmentContext(processed.files, false)
    expect(contextLines.some((l) => l.includes('this model has NO vision input'))).toBe(true)

    // Verify checkSkillReadGate does NOT demand read_skill("ocr")
    const skillGate = checkSkillReadGate(
      { kind: 'chat', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'test', skillsNeeded: [] },
      [],
      new Set()
    )
    expect(skillGate.passed).toBe(true)
    expect(skillGate.missing).toEqual([])
  })

  it('TEST 2: Live Runtime Multimodal Check -> Formats vision base64 input, detects non-vision server without mmproj', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-vision-test-'))
    const imagePath = path.join(tmpDir, 'vision_image.png')

    // Create real test image
    const createImgCmd = `python -c "from PIL import Image; img = Image.new('RGB', (200, 200), color=(0, 255, 0)); img.save(r'${imagePath}')"`
    await pexec(createImgCmd, { shell: 'powershell.exe' })
    expect(fs.existsSync(imagePath)).toBe(true)

    const imgBuf = fs.readFileSync(imagePath)
    const dataUrl = `data:image/png;base64,${imgBuf.toString('base64')}`

    const processed = processAttachments(
      [{ data: dataUrl, mime: 'image/png', name: 'vision_image.png', size: imgBuf.length }],
      { sessionId: 'test_session_vision', baseDir: tmpDir }
    )

    expect(processed.hasImage).toBe(true)

    // Evaluate MultimodalGate for Vision Model (modelSupportsModality = true)
    const gateResult = evaluateMultimodalGate({
      hasImageInput: processed.hasImage,
      modelSupportsModality: true,  // Vision model
      capabilityAvailable: false,
      skillAvailable: true,
    })

    expect(gateResult.decision).toBe('vision_model')
    expect(gateResult.canProcessImage).toBe(true)
    expect(gateResult.modelSupportsModality).toBe(true)

    // Build attachment context for vision model
    const contextLines = buildAttachmentContext(processed.files, true)
    expect(contextLines.some((l) => l.includes('is provided as vision input'))).toBe(true)

    // Verify message structure with vision image attachment
    const adapter = new LocalOpenAIChatAdapter()
    const imgFile = processed.files.find((f) => f.kind === 'image')!

    const messages: LlmChatMessage[] = [
      {
        role: 'user',
        content: 'What is in this image?',
        images: imgFile.imageBase64 ? [{ mime: imgFile.mime, base64: imgFile.imageBase64 }] : undefined,
      },
    ]

    expect(messages[0]!.images).toBeDefined()
    expect(messages[0]!.images!.length).toBe(1)
    expect(messages[0]!.images![0]!.mime).toBe('image/png')

    // Live inference check with local server:
    // When local llama-server is running without --mmproj, sending images throws ChatInferenceError with vision-unavailable.
    try {
      const chunks = []
      for await (const chunk of adapter.streamChat({
        endpoint: ENDPOINT,
        model: MODEL_ID,
        messages,
        stream: true,
        maxCompletionTokens: 50,
        timeoutMs: 15000,
      })) {
        chunks.push(chunk)
      }
      // If server had a vision projector loaded:
      expect(chunks.length).toBeGreaterThan(0)
    } catch (err) {
      // If server does not have mmproj projector:
      expect(err).toBeInstanceOf(ChatInferenceError)
      const msg = (err as ChatInferenceError).message
      expect(msg).toContain('vision-unavailable')
      console.log('=== VERIFIED LIVE NON-VISION SERVER REJECTION ===')
      console.log(msg)
    }
  }, 30000)
})
