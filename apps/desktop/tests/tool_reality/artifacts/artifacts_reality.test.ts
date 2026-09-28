import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { generateArtifactFile, detectOutputFormat } from '../../../src/main/backend/artifacts'
import { dispatchFs } from '../../../src/main/capabilities/fs/index'
import { createTestWorkspace, type TestWorkspaceFixture } from '../fixtures/setup'
import fs from 'node:fs'
import path from 'node:path'

describe('SOVARA Tool Reality Lab — Artifact Tools & Format Detection', () => {
  let fixture: TestWorkspaceFixture

  beforeEach(() => {
    fixture = createTestWorkspace()
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('1. detectOutputFormat: Correctly detects artifact requirements from user prompts', () => {
    const htmlPrompt = 'Create an interactive HTML dashboard as dashboard.html'
    const htmlDetected = detectOutputFormat(htmlPrompt)
    expect(htmlDetected).not.toBeNull()
    expect(htmlDetected?.kind).toBe('code')
    expect(htmlDetected?.fileName).toBe('dashboard.html')

    const pptxPrompt = 'Create a PowerPoint presentation slide deck on factory downtime'
    const pptxDetected = detectOutputFormat(pptxPrompt)
    expect(pptxDetected).not.toBeNull()
    expect(pptxDetected?.kind).toBe('pptx')

    const mathPrompt = 'Calculate 120 * 5 + 150 * 4 + 90 * 6'
    const mathDetected = detectOutputFormat(mathPrompt)
    expect(mathDetected).toBeNull()
  })

  it('2. generateArtifactFile: Materializes artifact files on disk with valid byte sizes', () => {
    const targetFile = path.join(fixture.workspaceRoot, 'dashboard.html')
    const assistantContent = '```html\n<!DOCTYPE html><html><body><h1>Factory Dashboard</h1></body></html>\n```'

    const artifact = generateArtifactFile('code', targetFile, assistantContent, 'Build dashboard')

    expect(artifact).not.toBeNull()
    expect(artifact?.bytes).toBeGreaterThan(0)
    expect(fs.existsSync(targetFile)).toBe(true)

    const diskContent = fs.readFileSync(targetFile, 'utf-8')
    expect(diskContent).toContain('Factory Dashboard')
  })

  it('3. Artifact Life Cycle: write -> inspect -> patch -> verify read back', async () => {
    const relPath = 'artifacts/report.md'
    const initialContent = '# Initial Audit Report\nStatus: PENDING'

    // 1. Write
    const writeRaw = await dispatchFs('fs_write', { path: relPath, content: initialContent }, fixture.workspaceRoot)
    expect(JSON.parse(writeRaw).ok).toBe(true)

    // 2. Inspect (fs_read)
    const readRaw1 = await dispatchFs('fs_read', { path: relPath }, fixture.workspaceRoot)
    expect(JSON.parse(readRaw1).content).toContain('Status: PENDING')

    // 3. Patch
    const patchRaw = await dispatchFs('fs_patch', { path: relPath, search: 'PENDING', replace: 'APPROVED' }, fixture.workspaceRoot)
    expect(JSON.parse(patchRaw).ok).toBe(true)

    // 4. Read back & verify final state
    const readRaw2 = await dispatchFs('fs_read', { path: relPath }, fixture.workspaceRoot)
    expect(JSON.parse(readRaw2).content).toContain('Status: APPROVED')
  })
})
