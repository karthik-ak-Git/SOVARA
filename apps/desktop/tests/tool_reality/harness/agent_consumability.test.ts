import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { dispatchFs } from '../../../src/main/capabilities/fs/index'
import { createTestWorkspace, type TestWorkspaceFixture } from '../fixtures/setup'
import fs from 'node:fs'
import path from 'node:path'

export interface ToolObservationContract {
  tool: string
  operation: string
  input: Record<string, unknown>
  success: boolean
  actualState: string
  returnedObservation: string
  agentCanContinue: boolean
  truthful: boolean
  sufficient: boolean
}

describe('SOVARA Tool Reality Lab — Agent Consumability & Observation Evidence Test Harness', () => {
  let fixture: TestWorkspaceFixture
  const evidenceRecords: ToolObservationContract[] = []

  beforeEach(() => {
    fixture = createTestWorkspace()
    evidenceRecords.length = 0
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('Simulated AI Multi-Step Sequence: Can an AI complete a calculation & report task purely from tool observations?', async () => {
    // ── STEP 1: Ask fs_read for production_notes.txt ──
    const step1Raw = await dispatchFs('fs_read', { path: 'production_notes.txt' }, fixture.workspaceRoot)
    const step1Data = JSON.parse(step1Raw)

    const step1Evidence: ToolObservationContract = {
      tool: 'fs_read',
      operation: 'read_source_file',
      input: { path: 'production_notes.txt' },
      success: typeof step1Data.content === 'string',
      actualState: fs.readFileSync(path.join(fixture.workspaceRoot, 'production_notes.txt'), 'utf-8'),
      returnedObservation: step1Raw,
      agentCanContinue: typeof step1Data.content === 'string' && step1Data.content.includes('Machine A'),
      truthful: step1Data.content === fs.readFileSync(path.join(fixture.workspaceRoot, 'production_notes.txt'), 'utf-8'),
      sufficient: step1Data.content?.includes('120 units/hour') && step1Data.content?.includes('150 units/hour') && step1Data.content?.includes('90 units/hour'),
    }
    evidenceRecords.push(step1Evidence)

    // Verify AI can extract information from Step 1 observation
    expect(step1Evidence.success).toBe(true)
    expect(step1Evidence.sufficient).toBe(true)
    expect(step1Evidence.agentCanContinue).toBe(true)

    // ── STEP 2: Simulated AI reasoning/calculation from observation ──
    // Machine A: 120 * 5 = 600
    // Machine B: 150 * 4 = 600
    // Machine C: 90 * 6 = 540
    // Total = 1740
    const calculatedTotal = 120 * 5 + 150 * 4 + 90 * 6
    expect(calculatedTotal).toBe(1740)

    const reportContent = `# Factory Production Summary\n- Machine A: 600 units\n- Machine B: 600 units\n- Machine C: 540 units\n\n**Total Production: ${calculatedTotal} units**`

    // ── STEP 3: Ask fs_write to create production_summary.md ──
    const step3Raw = await dispatchFs('fs_write', { path: 'production_summary.md', content: reportContent }, fixture.workspaceRoot)
    const step3Data = JSON.parse(step3Raw)

    const diskFileExists = fs.existsSync(path.join(fixture.workspaceRoot, 'production_summary.md'))
    const step3Evidence: ToolObservationContract = {
      tool: 'fs_write',
      operation: 'write_summary_report',
      input: { path: 'production_summary.md', content: reportContent },
      success: step3Data.ok === true && step3Data.verified === true,
      actualState: diskFileExists ? fs.readFileSync(path.join(fixture.workspaceRoot, 'production_summary.md'), 'utf-8') : 'MISSING',
      returnedObservation: step3Raw,
      agentCanContinue: step3Data.ok === true,
      truthful: diskFileExists && fs.readFileSync(path.join(fixture.workspaceRoot, 'production_summary.md'), 'utf-8') === reportContent,
      sufficient: step3Data.bytes === Buffer.byteLength(reportContent, 'utf-8'),
    }
    evidenceRecords.push(step3Evidence)

    expect(step3Evidence.success).toBe(true)
    expect(step3Evidence.truthful).toBe(true)

    // ── STEP 4: Ask fs_read to verify written report ──
    const step4Raw = await dispatchFs('fs_read', { path: 'production_summary.md' }, fixture.workspaceRoot)
    const step4Data = JSON.parse(step4Raw)

    const step4Evidence: ToolObservationContract = {
      tool: 'fs_read',
      operation: 'verify_read_back',
      input: { path: 'production_summary.md' },
      success: typeof step4Data.content === 'string',
      actualState: fs.readFileSync(path.join(fixture.workspaceRoot, 'production_summary.md'), 'utf-8'),
      returnedObservation: step4Raw,
      agentCanContinue: step4Data.content?.includes('Total Production: 1740 units'),
      truthful: step4Data.content === reportContent,
      sufficient: step4Data.content?.includes('1740 units'),
    }
    evidenceRecords.push(step4Evidence)

    expect(step4Evidence.success).toBe(true)
    expect(step4Evidence.truthful).toBe(true)

    // All evidence steps in sequence must be valid for agent continuity
    expect(evidenceRecords.every((e) => e.agentCanContinue && e.truthful)).toBe(true)
  })
})
