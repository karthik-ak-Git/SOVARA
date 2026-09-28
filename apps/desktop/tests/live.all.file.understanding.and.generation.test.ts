import { describe, it, expect } from 'vitest'
import { understandFile, categorizeFile, getCapabilityReport } from '../src/main/backend/FileUnderstandingRegistry'
import { verifyArtifact, verifyCodeArtifact, generateVerificationReport } from '../src/main/backend/ArtifactVerifier'
import { executeCodeFile } from '../src/main/backend/OutputExecutor'
import { generateExecutionPlan, planToPromptDirective } from '../src/main/backend/ExecutionPlanner'
import path from 'node:path'
import fs from 'node:fs/promises'
import { execSync } from 'node:child_process'

describe('Live Full System Capabilities Test (Real Data & Real Files)', () => {
  const rootDir = path.resolve(__dirname, '../../../')

  const toolDispatch = async (name: string, args: Record<string, unknown>): Promise<string> => {
    if (name === 'fs_read') {
      const p = String(args['path'])
      const absPath = path.isAbsolute(p) ? p : path.resolve(rootDir, p)
      return await fs.readFile(absPath, 'utf-8')
    }
    if (name === 'shell_exec') {
      const cmd = String(args['command'])
      try {
        const stdout = execSync(cmd, { encoding: 'utf-8', cwd: rootDir })
        return stdout
      } catch (e: any) {
        return e.stdout || String(e)
      }
    }
    return ''
  }

  // 1. UNDERSTANDING TESTS WITH REAL DATA
  describe('File Understanding with Real Data Files', () => {
    it('understands real Word (.docx) documents', async () => {
      const filePath = path.join(rootDir, 'real_doc.docx')
      const u = await understandFile(filePath, toolDispatch)
      expect(u.category).toBe('office-word')
      expect(u.extractedContent).toContain('SOVARA Enterprise System Report')
      expect(u.confidence).toBeGreaterThan(0.8)
    })

    it('understands real Excel (.xlsx) spreadsheets', async () => {
      const filePath = path.join(rootDir, 'real_sheet.xlsx')
      const u = await understandFile(filePath, toolDispatch)
      expect(u.category).toBe('office-excel')
      expect(u.extractedContent).toContain('Quarterly Results')
      expect(u.extractedContent).toContain('Quarter')
      expect(u.confidence).toBeGreaterThan(0.8)
    })

    it('understands real PowerPoint (.pptx) presentations', async () => {
      const filePath = path.join(rootDir, 'real_deck.pptx')
      const u = await understandFile(filePath, toolDispatch)
      expect(u.category).toBe('office-ppt')
      expect(u.extractedContent).toContain('SOVARA Architecture Overview')
      expect(u.confidence).toBeGreaterThan(0.8)
    })

    it('understands real PDF (.pdf) documents', async () => {
      const filePath = path.join(rootDir, 'real_doc.pdf')
      const u = await understandFile(filePath, toolDispatch)
      expect(u.category).toBe('pdf')
      expect(u.extractedContent).toContain('SOVARA Enterprise PDF Verification File')
      expect(u.confidence).toBeGreaterThan(0.8)
    })

    it('understands real SQLite (.sqlite) databases', async () => {
      const filePath = path.join(rootDir, 'real_database.sqlite')
      const u = await understandFile(filePath, toolDispatch)
      expect(u.category).toBe('database')
      expect(u.extractedContent).toContain('users')
      expect(u.confidence).toBeGreaterThan(0.8)
    })

    it('understands real ZIP (.zip) archives', async () => {
      const filePath = path.join(rootDir, 'real_archive.zip')
      const u = await understandFile(filePath, toolDispatch)
      expect(u.category).toBe('archive')
      expect(u.extractedContent).toContain('ode_solver.py')
      expect(u.confidence).toBeGreaterThan(0.5)
    })

    it('understands real Markdown (.md) documents', async () => {
      const filePath = path.join(rootDir, 'real_markdown.md')
      const u = await understandFile(filePath, toolDispatch)
      expect(u.category).toBe('text')
      expect(u.extractedContent).toContain('SOVARA Real Markdown Test Document')
    })
  })

  // 2. GENERATION & VERIFICATION TESTS WITH REAL DATA
  describe('Artifact Generation & Live Verification with Real Data', () => {
    it('generates, verifies, and executes Python ODE solver script with real user inputs', async () => {
      const pyPath = path.join(rootDir, 'ode_solver.py')
      const spec = {
        fileName: 'ode_solver.py',
        type: 'py' as const,
        minSizeBytes: 100,
        requiredMarkers: ['import sympy as sp', 'sp.dsolve'],
        sampleInput: 'diff(y(x),x,2)-y(x)\n0',
      }

      const v = await verifyCodeArtifact(pyPath, spec, toolDispatch)
      expect(v.exists).toBe(true)
      expect(v.contentValid).toBe(true)
      expect(v.structureValid).toBe(true)
      expect(v.executionResult?.exitCode).toBe(0)
      expect(v.executionResult?.stdout).toContain('The order of the given ODE is: 2')
    })

    it('generates and verifies HTML presentation (PPTX alternative) deliverable', async () => {
      const htmlPath = path.join(rootDir, 'live_test_presentation.html')
      const htmlContent = `<!DOCTYPE html>
<html>
<head><title>SOVARA Live Demo</title></head>
<body>
  <section><h1>Slide 1: Architecture</h1></section>
  <section><h1>Slide 2: Live Verification</h1></section>
</body>
</html>`

      await fs.writeFile(htmlPath, htmlContent, 'utf-8')

      const spec = {
        fileName: 'live_test_presentation.html',
        type: 'html' as const,
        minSizeBytes: 50,
        requiredMarkers: ['</html>', '<section>'],
      }

      const v = await verifyArtifact(htmlPath, spec, toolDispatch)
      expect(v.exists).toBe(true)
      expect(v.structureValid).toBe(true)
      expect(v.truncated).toBe(false)

      const report = generateVerificationReport(v)
      expect(report).toContain('PASSED')

      // Clean up temp test artifact
      await fs.unlink(htmlPath).catch(() => {})
    })
  })
})
