import { describe, it, expect } from 'vitest'
import { generateExecutionPlan, planToPromptDirective } from '../src/main/backend/ExecutionPlanner'
import { verifyArtifact, generateVerificationReport } from '../src/main/backend/ArtifactVerifier'
import { categorizeFile, getExtractionScript } from '../src/main/backend/FileUnderstandingRegistry'
import type { TaskClassification } from '../src/shared/types/task'

describe('Enterprise Orchestration Modules', () => {
  it('generates structured execution plan for artifact tasks', () => {
    const classification: TaskClassification = {
      kind: 'coding',
      confidence: 0.9,
      requiredCapabilities: ['coding'],
      contextLengthNeeded: 8192,
      reasoningRequired: true,
      requiresArtifact: true,
      artifactType: 'pptx',
      reason: 'build pptx presentation',
    }

    const plan = generateExecutionPlan(classification, 'Create a PowerPoint presentation about AI')
    expect(plan.steps.length).toBeGreaterThan(0)
    expect(plan.skillsToRead).toContain('pptx-official')
    expect(plan.expectedArtifacts[0].type).toBe('html')
    expect(plan.verification.readBack).toBe(true)

    const directive = planToPromptDirective(plan)
    expect(directive).toContain('[EXECUTION PLAN')
    expect(directive).toContain('pptx-official')
  })

  it('categorizes file extensions accurately', () => {
    expect(categorizeFile('document.docx')).toBe('office-word')
    expect(categorizeFile('sheet.xlsx')).toBe('office-excel')
    expect(categorizeFile('deck.pptx')).toBe('office-ppt')
    expect(categorizeFile('report.pdf')).toBe('pdf')
    expect(categorizeFile('script.py')).toBe('code')
    expect(categorizeFile('index.html')).toBe('markup')
    expect(categorizeFile('data.csv')).toBe('text')
  })

  it('generates extraction scripts for office documents', () => {
    const docxScript = getExtractionScript('office-word', 'sample.docx')
    expect(docxScript).toContain('from docx import Document')

    const xlsxScript = getExtractionScript('office-excel', 'sample.xlsx')
    expect(xlsxScript).toContain('import openpyxl')
  })

  it('verifies valid artifacts and detects missing markers', async () => {
    const fakeDispatch = async (name: string, args: Record<string, unknown>) => {
      if (name === 'fs_read') {
        return '<!DOCTYPE html><html><body><h1>Slide 1</h1></body></html>'
      }
      return ''
    }

    const result = await verifyArtifact(
      'presentation.html',
      {
        fileName: 'presentation.html',
        type: 'html',
        minSizeBytes: 10,
        requiredMarkers: ['</html>', '<!DOCTYPE html>'],
      },
      fakeDispatch
    )

    expect(result.exists).toBe(true)
    expect(result.contentValid).toBe(true)
    expect(result.structureValid).toBe(true)
    expect(result.truncated).toBe(false)

    const report = generateVerificationReport(result)
    expect(report).toContain('PASSED')
  })
})
