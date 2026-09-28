import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { dispatchShell } from '../../../src/main/capabilities/shell/index'
import { createTestWorkspace, type TestWorkspaceFixture } from '../fixtures/setup'

describe('SOVARA Tool Reality Lab — Shell Execution Tools (shell_exec)', () => {
  let fixture: TestWorkspaceFixture

  beforeEach(() => {
    fixture = createTestWorkspace()
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('1. shell_exec: Executing valid script returns stdout, exitCode 0, and sufficient observation', async () => {
    const rawResult = await dispatchShell({ command: 'python valid_script.py' }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('TOTAL_PRODUCTION: 1740')
    expect(result.stdout).toContain('Machine A: 600')
    expect(result.stdout).toContain('Machine B: 600')
    expect(result.stdout).toContain('Machine C: 540')
  })

  it('2. shell_exec: Executing broken script returns nonzero exitCode, actual stderr, and honest failure', async () => {
    const rawResult = await dispatchShell({ command: 'python broken_script.py' }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    expect(result.exitCode).not.toBe(0)
    expect(result.error ?? result.stderr).toBeDefined()
    const errorText = String(result.error ?? '') + String(result.stderr ?? '')
    expect(errorText).toMatch(/SyntaxError|error|invalid/i)
  })

  it('3. shell_exec: Command waiting for input times out safely without hanging process', async () => {
    // Request a short timeout of 1000ms for interactive script
    const startTime = Date.now()
    const rawResult = await dispatchShell({ command: 'python interactive_hang.py', timeoutMs: 1500 }, fixture.workspaceRoot)
    const duration = Date.now() - startTime
    const result = JSON.parse(rawResult)

    // Verify it terminated without deadlocking forever (duration < 5000ms)
    expect(duration).toBeLessThan(5000)
    expect(result).toBeDefined()
  })
})
