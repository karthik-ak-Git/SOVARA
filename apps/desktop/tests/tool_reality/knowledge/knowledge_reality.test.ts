import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { ToolStubAdapter } from '../../../src/main/backend/ports/ToolStubAdapter'
import { createTestWorkspace, type TestWorkspaceFixture } from '../fixtures/setup'
import fs from 'node:fs'
import path from 'node:path'

describe('SOVARA Tool Reality Lab — Knowledge & Memory Store Tools (memory)', () => {
  let fixture: TestWorkspaceFixture
  let toolAdapter: ToolStubAdapter

  beforeEach(() => {
    fixture = createTestWorkspace()
    toolAdapter = new ToolStubAdapter()
    ;(toolAdapter as unknown as { getWorkspace: () => string }).getWorkspace = () => fixture.workspaceRoot
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('1. memory store: Stores knowledge entry in wiki/ with frontmatter metadata', async () => {
    const rawResult = await toolAdapter.dispatch('memory', {
      action: 'store',
      title: 'Industrial Safety Rules',
      type: 'concept',
      body: '1. Always wear protective gear near Machine A and B.\n2. Emergency stop switches must be inspected daily.',
      tags: ['safety', 'industrial'],
      links: ['Plant Alpha'],
    })
    const result = JSON.parse(rawResult)

    expect(result.ok).toBe(true)
    expect(result.path).toContain('wiki/')

    // Verify file created on disk under wiki/
    const diskPath = path.join(fixture.workspaceRoot, result.path)
    expect(fs.existsSync(diskPath)).toBe(true)
    const diskContent = fs.readFileSync(diskPath, 'utf-8')
    expect(diskContent).toContain('title: "Industrial Safety Rules"')
    expect(diskContent).toContain('protective gear')
  })

  it('2. memory recall: Recalls knowledge entry and returns matching content and line context', async () => {
    // 1. Store first
    await toolAdapter.dispatch('memory', {
      action: 'store',
      title: 'Emergency Shutdown',
      type: 'concept',
      body: 'In case of thermal overload, press the red emergency button.',
      tags: ['safety'],
    })

    // 2. Recall via query
    const recallRaw = await toolAdapter.dispatch('memory', {
      action: 'recall',
      query: 'thermal overload',
    })
    const result = JSON.parse(recallRaw)

    expect(result.error).toBeUndefined()
    expect(result.results).toBeDefined()
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0].text).toContain('thermal overload')
  })
})
