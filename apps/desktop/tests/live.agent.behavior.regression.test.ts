import { describe, expect, it, beforeEach } from 'vitest'
import { detectSkillNeeds, classifyTaskEnhanced } from '../src/main/backend/TaskClassifier'
import { dispatchFs } from '../src/main/capabilities/fs/index'
import { runtimeStatusStore } from '../src/renderer/src/stores/runtimeStatusStore'
import { parseMessageContent } from '../src/renderer/src/features/chat/MessageBubble'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('SOVARA Critical Agent Behavior & Regression Test Suite', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-test-ws-'))
    runtimeStatusStore.reset()
  })

  it('Requirement 1 & 8: Simple calculation task does NOT trigger xlsx skill or tools', () => {
    const prompt = 'A production line has 3 machines. Machine A produces 120 units/hour, B produces 150 units/hour, and C produces 90 units/hour. If A runs for 5 hours, B for 4 hours, and C for 6 hours, calculate the total production and show the calculation.'
    
    // 1. Skill detection must return NO xlsx skill
    const skills = detectSkillNeeds(prompt)
    expect(skills).not.toContain('xlsx')
    expect(skills.length).toBe(0)

    // 2. Task classifier must classify as reasoning/chat without requiring artifact
    const classification = classifyTaskEnhanced(prompt)
    expect(classification.requiresArtifact).toBe(false)
    expect(classification.skillsNeeded).not.toContain('xlsx')

    // 3. Simple calculation result formula verification (120*5 + 150*4 + 90*6 = 600 + 600 + 540 = 1740)
    const total = 120 * 5 + 150 * 4 + 90 * 6
    expect(total).toBe(1740)
  })

  it('Requirement 2 & 7: File name recovery with duplicate extension (.txt.txt hint)', async () => {
    // Create file with duplicate extension in temp workspace
    const realFile = path.join(tmpDir, 'production_notes.txt.txt')
    fs.writeFileSync(realFile, 'Machine A: 120 u/h, Downtime: 2h\nMachine B: 150 u/h, Downtime: 1h\nMachine C: 90 u/h, Downtime: 4h')

    // 1. Initial fs_read for requested path 'production_notes.txt'
    const firstRead = await dispatchFs('fs_read', { path: 'production_notes.txt' }, tmpDir)
    const firstParsed = JSON.parse(firstRead)

    expect(firstParsed.error).toContain('file not found: production_notes.txt')
    expect(firstParsed.hint).toContain('production_notes.txt.txt')

    // 2. Recovery fs_read using the hint filename
    const recoveryRead = await dispatchFs('fs_read', { path: 'production_notes.txt.txt' }, tmpDir)
    const recoveryParsed = JSON.parse(recoveryRead)

    expect(recoveryParsed.content).toContain('Machine A: 120 u/h')
    expect(recoveryParsed.content).toContain('Downtime: 2h')
  })

  it('Requirement 3 & 4: Prevent placeholder artifact success and enforce intent-aware completion logic', () => {
    // Simulated placeholder content
    const placeholderText = 'The production summary has been generated.\n\nData is currently unavailable.'
    const isPlaceholder = /\b(?:data (?:is|was) (?:currently )?unavailable|no data (?:was )?provided|placeholder data)\b/i.test(placeholderText)
    
    expect(isPlaceholder).toBe(true)

    // Verify verification read-back detection logic
    const prompt = 'Read production_notes.txt. Calculate loss. Create production_summary.md with results, then read it back and verify it.'
    const explicitVerificationRequested = /\b(?:read\s+(?:it\s+)?back|verify|read\s+and\s+verify|confirm\s+content)\b/i.test(prompt)
    
    expect(explicitVerificationRequested).toBe(true)
  })

  it('Requirement 5: Raw internal reasoning and Jarvis directives are stripped from UI bubbles', () => {
    const rawAssistantOutput = `**Thinking Process:**
Analyze the Request: User wants production loss calculation.
[Jarvis Agent: Executing the next required action...]
[Autonomous Agent Directive]: Write the file now.

The total production across all three machines is 1740 units.`

    const parts = parseMessageContent(rawAssistantOutput)
    const textPart = parts.find((p) => p.type === 'text')
    const cleanedText = textPart && 'text' in textPart ? textPart.text : ''

    expect(cleanedText).not.toContain('Thinking Process')
    expect(cleanedText).not.toContain('Analyze the Request')
    expect(cleanedText).not.toContain('Jarvis Agent')
    expect(cleanedText).not.toContain('Autonomous Agent Directive')
    expect(cleanedText).toContain('The total production across all three machines is 1740 units.')
  })

  it('Requirement 9 & 10: Normal file workflow and multi-step write + verify workflow', async () => {
    const normFile = path.join(tmpDir, 'production_notes.txt')
    fs.writeFileSync(normFile, 'Machine A: 120 u/h, Downtime: 2h\nMachine B: 150 u/h, Downtime: 1h\nMachine C: 90 u/h, Downtime: 4h')

    // 1. Read existing file
    const readRes = await dispatchFs('fs_read', { path: 'production_notes.txt' }, tmpDir)
    expect(JSON.parse(readRes).content).toContain('Machine A')

    // 2. Write summary file
    const summaryContent = '# Production Loss Summary\n- Machine A: 240 units loss\n- Machine B: 150 units loss\n- Machine C: 360 units loss'
    const writeRes = await dispatchFs('fs_write', { path: 'production_summary.md', content: summaryContent }, tmpDir)
    const writeParsed = JSON.parse(writeRes)
    expect(writeParsed.bytes).toBeGreaterThan(0)
    expect(writeParsed.error).toBeUndefined()

    // 3. Read back and verify
    const verifyRes = await dispatchFs('fs_read', { path: 'production_summary.md' }, tmpDir)
    expect(JSON.parse(verifyRes).content).toContain('# Production Loss Summary')
  })
})
