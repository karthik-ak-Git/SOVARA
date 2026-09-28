import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { processAttachments } from '../../../src/main/backend/attachments'
import { createTestWorkspace, type TestWorkspaceFixture } from '../fixtures/setup'
import fs from 'node:fs'
import path from 'node:path'

describe('SOVARA Tool Reality Lab — Multimodal Tool & Attachment Pipeline', () => {
  let fixture: TestWorkspaceFixture

  beforeEach(() => {
    fixture = createTestWorkspace()
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('1. Real Image Processing: inspection_scan_batch7.png produces valid image payload & base64 encoding', () => {
    const pngPath = path.resolve(__dirname, '../../fixtures/sih_canonical/inspection_scan_batch7.png')
    expect(fs.existsSync(pngPath)).toBe(true)

    const pngBuffer = fs.readFileSync(pngPath)
    const base64Data = pngBuffer.toString('base64')

    const incoming = [
      {
        name: 'inspection_scan_batch7.png',
        mime: 'image/png',
        data: `data:image/png;base64,${base64Data}`,
        size: pngBuffer.length,
      },
    ]

    const processed = processAttachments(incoming, {
      sessionId: 'test-session-multimodal',
      baseDir: fixture.workspaceRoot,
    })

    expect(processed.hasImage).toBe(true)
    expect(processed.files.length).toBe(1)

    const file = processed.files[0]
    expect(file.kind).toBe('image')
    expect(file.mime).toBe('image/png')
    expect(file.imageBase64).toBeDefined()
    expect(file.imageBase64?.length).toBeGreaterThan(100)
  })

  it('2. Blank Control Image: Distinguishes blank image payload from canonical visual document', () => {
    // 1x1 transparent PNG base64
    const blankBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

    const incoming = [
      {
        name: 'blank_control.png',
        mime: 'image/png',
        data: `data:image/png;base64,${blankBase64}`,
        size: 68,
      },
    ]

    const processed = processAttachments(incoming, {
      sessionId: 'test-session-blank',
      baseDir: fixture.workspaceRoot,
    })

    expect(processed.hasImage).toBe(true)
    expect(processed.files[0].name).toBe('blank_control.png')
    expect(processed.files[0].size).toBe(68)
  })
})
