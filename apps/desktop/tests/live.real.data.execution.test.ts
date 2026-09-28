import { describe, it, expect } from 'vitest'
import { executeCodeFile } from '../src/main/backend/OutputExecutor'
import { verifyCodeArtifact, generateVerificationReport } from '../src/main/backend/ArtifactVerifier'
import path from 'node:path'

describe('Live Code Execution Verification with Actual Inputs', () => {
  it('executes ode_solver.py with real differential equation inputs and captures stdout', async () => {
    const filePath = path.resolve(__dirname, '../../ode_solver.py')

    const fakeDispatch = async (name: string, args: Record<string, unknown>): Promise<string> => {
      if (name === 'fs_read') {
        const fs = await import('node:fs/promises')
        return await fs.readFile(filePath, 'utf-8')
      }
      if (name === 'shell_exec') {
        const cmd = String(args['command'] || '')
        const { execSync } = await import('node:child_process')
        try {
          const stdout = execSync(cmd, { encoding: 'utf-8', cwd: path.dirname(filePath) })
          return stdout
        } catch (e: any) {
          return e.stdout || String(e)
        }
      }
      return ''
    }

    // Run 1: Real input set 1: diff(y(x),x,2)-y(x) = 0
    const outcome1 = await executeCodeFile(filePath, fakeDispatch, {
      sampleInputs: ['diff(y(x),x,2)-y(x)', '0'],
    })

    expect(outcome1.success).toBe(true)
    expect(outcome1.exitCode).toBe(0)
    expect(outcome1.stdout).toContain('The General Solution of given DE is:')
    expect(outcome1.stdout).toContain('The order of the given ODE is: 2')

    // Run 2: Real input set 2: diff(y(x),x) - 2*y(x) = 0
    const outcome2 = await executeCodeFile(filePath, fakeDispatch, {
      sampleInputs: ['diff(y(x),x) - 2*y(x)', '0'],
    })

    expect(outcome2.success).toBe(true)
    expect(outcome2.exitCode).toBe(0)
    expect(outcome2.stdout).toContain('The order of the given ODE is: 1')

    // Run 3: Full artifact verification report with live execution
    const spec = {
      fileName: 'ode_solver.py',
      type: 'py' as const,
      minSizeBytes: 50,
      requiredMarkers: ['import sympy as sp', 'sp.dsolve'],
      sampleInput: 'diff(y(x),x,2)-y(x)\n0',
    }

    const verificationResult = await verifyCodeArtifact(filePath, spec, fakeDispatch)
    expect(verificationResult.exists).toBe(true)
    expect(verificationResult.contentValid).toBe(true)
    expect(verificationResult.structureValid).toBe(true)
    expect(verificationResult.truncated).toBe(false)
    expect(verificationResult.executionResult?.exitCode).toBe(0)

    const report = generateVerificationReport(verificationResult)
    expect(report).toContain('PASSED')
    expect(report).toContain('The order of the given ODE is: 2')
  })
})
