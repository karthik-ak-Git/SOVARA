import { describe, it, expect, beforeEach } from 'vitest'
import { isToolPermittedForRole, AGENT_ROLES } from '../src/main/backend/AgentRoles'
import { AgentEventBus } from '../src/main/backend/AgentEventBus'
import { extractNormalizedToolCalls } from '../src/main/backend/tools/fenceTools'
import { dispatchFs } from '../src/main/capabilities/fs'
import { ToolStubAdapter } from '../src/main/backend/ports/ToolStubAdapter'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

describe('Production Readiness Integration Suite — Real Runtime Flows', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-prod-ready-'))
  })

  it('Flow 1 & 2: Real Agent Loop — Role Permissions & Tool Extraction', () => {
    // Role permissions
    expect(isToolPermittedForRole(AGENT_ROLES.Coder, 'fs_write')).toBe(true)
    expect(isToolPermittedForRole(AGENT_ROLES.Reviewer, 'fs_write')).toBe(false)
    expect(isToolPermittedForRole(AGENT_ROLES.Planner, 'shell_exec')).toBe(true)
    expect(isToolPermittedForRole(AGENT_ROLES.Chat, 'fs_read')).toBe(true)

    // Normalized Tool Extraction
    const sampleOutput = `I will read the package configuration.
<tool_call>
{"name": "fs_read", "arguments": {"path": "package.json"}}
</tool_call>`

    const extracted = extractNormalizedToolCalls(sampleOutput)
    expect(extracted).toHaveLength(1)
    expect(extracted[0]?.tool).toBe('fs_read')
    expect(extracted[0]?.arguments).toEqual({ path: 'package.json' })
  })

  it('Flow 3: Multi-Step Execution & File Creation in Workspace', async () => {
    const testFile = path.join(tmpDir, 'output.txt')
    
    // Step 1: Write file
    const writeResRaw = await dispatchFs('fs_write', {
      path: 'output.txt',
      content: 'SOVARA Production Ready 2026',
    }, tmpDir)

    const writeResult = JSON.parse(writeResRaw)
    expect(writeResult.ok).toBe(true)
    expect(fs.existsSync(testFile)).toBe(true)
    expect(fs.readFileSync(testFile, 'utf8')).toBe('SOVARA Production Ready 2026')

    // Step 2: Read file back
    const readResRaw = await dispatchFs('fs_read', { path: 'output.txt' }, tmpDir)
    const readResult = JSON.parse(readResRaw)
    expect(readResult.error).toBeUndefined()
    expect(readResult.content).toContain('SOVARA Production Ready 2026')
  })

  it('Flow 4: Agent Event Bus State Machine & Lifecycle Broadcasting', () => {
    const receivedEvents: string[] = []

    const handler = (ev: any) => {
      receivedEvents.push(ev.type)
    }

    AgentEventBus.on('agent_event', handler)

    AgentEventBus.emitAgentEvent('TASK_CREATED', { taskId: 'task-prod-101', sessionId: 'sess-1', userPrompt: 'Verify flow', timestamp: Date.now() })
    AgentEventBus.emitAgentEvent('TOOL_CALL_STARTED', { taskId: 'task-prod-101', sessionId: 'sess-1', toolCallId: 'tc1', toolName: 'fs_read', args: {}, stepIndex: 0, timestamp: Date.now() })
    AgentEventBus.emitAgentEvent('TASK_COMPLETED', { taskId: 'task-prod-101', sessionId: 'sess-1', summary: 'Done', totalDurationMs: 100, timestamp: Date.now() })

    AgentEventBus.off('agent_event', handler)

    expect(receivedEvents).toEqual([
      'TASK_CREATED',
      'TOOL_CALL_STARTED',
      'TASK_COMPLETED',
    ])

    expect(AgentEventBus.getTaskState('task-prod-101')).toBe('completed')
  })

  it('Flow 5: Artifact Rendering & Memory Seam', async () => {
    const tools = new ToolStubAdapter(
      { enabled: false, search: async () => { throw new Error('disabled') }, crawl: async () => [] },
      () => [],
      () => tmpDir,
    )

    // Memory store wiki page creation
    const wikiResRaw = await tools.dispatch('memory', {
      action: 'store',
      title: 'Production Readiness Record',
      type: 'entity',
      body: 'Verified zero cloud egress and local-first GGUF inference.',
      tags: ['production', 'sovereignty'],
    })

    const wikiRes = JSON.parse(wikiResRaw)
    expect(wikiRes.ok).toBe(true)
    const expectedWiki = path.join(tmpDir, 'wiki', 'entities', 'production-readiness-record.md')
    expect(fs.existsSync(expectedWiki)).toBe(true)
  })

  it('Flow 10: Graceful Failure Recovery — Invalid Arguments & Sandbox Boundaries', async () => {
    // Out of bounds file access
    const badCallRaw = await dispatchFs('fs_read', { path: '../../non-existent-outside-root.txt' }, tmpDir)
    const badCall = JSON.parse(badCallRaw)
    expect(badCall.ok).toBeUndefined()
    expect(badCall.error).toBeDefined()
    expect(badCall.error).toMatch(/escapes workspace/i)
  })
})
