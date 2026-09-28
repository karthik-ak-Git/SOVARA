import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { dispatchFs } from '../../../src/main/capabilities/fs/index'
import { createTestWorkspace, type TestWorkspaceFixture } from '../fixtures/setup'
import fs from 'node:fs'
import path from 'node:path'

describe('SOVARA Tool Reality Lab — FS Tools (fs_read, fs_write, fs_patch, fs_list, fs_search)', () => {
  let fixture: TestWorkspaceFixture

  beforeEach(() => {
    fixture = createTestWorkspace()
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('1. fs_read: Existing file returns truthful, sufficient, and complete content for AI reasoning', async () => {
    const rawResult = await dispatchFs('fs_read', { path: 'production_notes.txt' }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    // A. Assert success structure
    expect(result.error).toBeUndefined()
    expect(result.content).toBeDefined()
    expect(result.path).toBe('production_notes.txt')
    expect(result.size).toBeGreaterThan(0)

    // B. Assert AI-sufficient observations (Must contain data needed to calculate/reason)
    expect(result.content).toContain('Machine A')
    expect(result.content).toContain('120 units/hour')
    expect(result.content).toContain('30 minutes')
    expect(result.content).toContain('Machine B')
    expect(result.content).toContain('150 units/hour')
    expect(result.content).toContain('45 minutes')
    expect(result.content).toContain('Machine C')
    expect(result.content).toContain('90 units/hour')
    expect(result.content).toContain('20 minutes')
  })

  it('2. fs_read: Nonexistent file returns explicit, truthful error with no fake data', async () => {
    const rawResult = await dispatchFs('fs_read', { path: 'nonexistent_file.txt' }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    expect(result.content).toBeUndefined()
    expect(result.error).toContain('file not found: nonexistent_file.txt')
    expect(result.requestedPath).toBe('nonexistent_file.txt')
    expect(result.hint).toBeDefined()
  })

  it('3. fs_read: Wrong filename provides directory hints for AI recovery (.txt.txt duplicate)', async () => {
    // Attempt to read production_summary.txt (which doesn't exist, but production_notes.txt exists)
    const rawResult = await dispatchFs('fs_read', { path: 'production_notes_wrong.txt' }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    expect(result.error).toContain('file not found')
    expect(result.hint).toContain('Files existing in directory')
    expect(result.hint).toContain('production_notes.txt')
  })

  it('4. fs_read: Nested file resolves workspace-relatively and returns correct content', async () => {
    const rawResult = await dispatchFs('fs_read', { path: 'nested/report.md' }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    expect(result.error).toBeUndefined()
    expect(result.content).toContain('Nested Production Audit Report')
    expect(result.content).toContain('Efficiency: 94.2%')
  })

  it('5. fs_read: Traversal attack (../../secret.txt) is safely blocked by workspace boundary', async () => {
    const rawResult = await dispatchFs('fs_read', { path: '../../secret.txt' }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    expect(result.content).toBeUndefined()
    expect(result.error).toContain('path escapes workspace')
  })

  it('6. fs_write: Creates file and returns verified size; independent disk check agrees', async () => {
    const targetPath = 'output_summary.md'
    const testContent = '# Production Loss Report\nTotal units: 1740'

    const rawResult = await dispatchFs('fs_write', { path: targetPath, content: testContent }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    // A. Assert tool response contracts
    expect(result.ok).toBe(true)
    expect(result.verified).toBe(true)
    expect(result.path).toBe(targetPath)
    expect(result.bytes).toBe(Buffer.byteLength(testContent, 'utf-8'))

    // B. Independent Filesystem State Comparison
    const diskPath = path.join(fixture.workspaceRoot, targetPath)
    expect(fs.existsSync(diskPath)).toBe(true)
    const diskContent = fs.readFileSync(diskPath, 'utf-8')
    expect(diskContent).toBe(testContent)
  })

  it('7. fs_write -> fs_read ROUND TRIP: Written content equals read content exactly', async () => {
    const targetPath = 'roundtrip_test.json'
    const originalContent = JSON.stringify({ status: 'COMPLETED', calculatedValue: 1740 }, null, 2)

    // 1. Write
    const writeRaw = await dispatchFs('fs_write', { path: targetPath, content: originalContent }, fixture.workspaceRoot)
    const writeResult = JSON.parse(writeRaw)
    expect(writeResult.ok).toBe(true)

    // 2. Read back
    const readRaw = await dispatchFs('fs_read', { path: targetPath }, fixture.workspaceRoot)
    const readResult = JSON.parse(readRaw)

    // 3. Compare roundtrip identity
    expect(readResult.content).toBe(originalContent)
  })

  it('8. fs_list: Directory tool lists entries deterministically without exposing external paths', async () => {
    const rawResult = await dispatchFs('fs_list', { path: '.' }, fixture.workspaceRoot)
    const result = JSON.parse(rawResult)

    expect(result.error).toBeUndefined()
    expect(result.entries).toBeDefined()
    expect(Array.isArray(result.entries)).toBe(true)
    expect(result.count).toBeGreaterThan(0)

    const entryNames = result.entries.map((e: { name: string }) => e.name)
    expect(entryNames).toContain('production_notes.txt')
    expect(entryNames).toContain('machine_config.json')
    expect(entryNames).toContain('nested')
  })

  it('9. fs_patch: Surgical replace updates file on disk; search mismatch reports failure cleanly', async () => {
    const filePath = 'patch_target.txt'
    fs.writeFileSync(path.join(fixture.workspaceRoot, filePath), 'Line 1: Machine A = 100\nLine 2: Machine B = 150', 'utf-8')

    // 1. Successful Patch
    const patchRaw = await dispatchFs(
      'fs_patch',
      { path: filePath, search: 'Machine A = 100', replace: 'Machine A = 120' },
      fixture.workspaceRoot
    )
    const patchResult = JSON.parse(patchRaw)
    expect(patchResult.ok).toBe(true)

    const diskContent = fs.readFileSync(path.join(fixture.workspaceRoot, filePath), 'utf-8')
    expect(diskContent).toContain('Machine A = 120')

    // 2. Failed Patch (search string mismatch)
    const failedPatchRaw = await dispatchFs(
      'fs_patch',
      { path: filePath, search: 'Nonexistent String', replace: 'Replacement' },
      fixture.workspaceRoot
    )
    const failedResult = JSON.parse(failedPatchRaw)
    expect(failedResult.ok).toBeUndefined()
    expect(failedResult.error).toContain('search string not found in patch_target.txt')
  })
})
