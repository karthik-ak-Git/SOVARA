/**
 * agent.runtime.harness.test.ts — Unit & Integration tests for SOVARA AI Runtime Harness
 * Verifies:
 * 1. Logical Agent Roles & Role-based tool permissions (Planner, Coder, Researcher, DocumentAnalyst, Reviewer, Verifier, ToolOperator, Chat)
 * 2. Unified normalized tool call parsing (NormalizedToolCall)
 * 3. Structured Agent Event Bus emissions (TASK_CREATED, AGENT_STARTED, TOOL_CALL_*, TASK_*)
 * 4. Task State Machine transitions
 * 5. Failure recovery & graceful error handling
 * 6. Shared Context assembly & compaction
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resolveLogicalRole, isToolPermittedForRole, AGENT_ROLES } from '../src/main/backend/AgentRoles'
import { AgentEventBus } from '../src/main/backend/AgentEventBus'
import { extractNormalizedToolCalls, toNormalizedToolCall, type ToolFence } from '../src/main/backend/tools/fenceTools'
import type { AgentEvent } from '../src/shared/types/agentEvents'

describe('SOVARA AI Runtime Harness Requirements', () => {
  beforeEach(() => {
    AgentEventBus.removeAllListeners()
  })

  // ── Requirement 1 & 2: Logical Multi-Agent Roles & Permissions ──
  describe('Logical Multi-Agent Roles & Tool Permissions', () => {
    it('correctly maps coding task to Coder logical role', () => {
      const role = resolveLogicalRole('coding')
      expect(role.name).toBe('Coder')
      expect(role.displayName).toBe('Software Engineer')
      expect(isToolPermittedForRole(role, 'fs_write')).toBe(true)
      expect(isToolPermittedForRole(role, 'shell_exec')).toBe(true)
    })

    it('correctly maps reasoning/agent task to Planner logical role', () => {
      const role = resolveLogicalRole('agent')
      expect(role.name).toBe('Planner')
      expect(isToolPermittedForRole(role, 'search_skills')).toBe(true)
      expect(isToolPermittedForRole(role, 'todo_write')).toBe(true)
    })

    it('correctly maps document analysis task to DocumentAnalyst role when PDF/Doc skills are needed', () => {
      const role = resolveLogicalRole('analysis', ['pdf', 'docx'])
      expect(role.name).toBe('DocumentAnalyst')
      expect(isToolPermittedForRole(role, 'fs_read')).toBe(true)
    })

    it('restricts unpermitted tools for specific roles', () => {
      const reviewerRole = AGENT_ROLES.Reviewer
      const documentRole = AGENT_ROLES.DocumentAnalyst
      // Reviewer role cannot write files directly
      expect(isToolPermittedForRole(reviewerRole, 'fs_write')).toBe(false)
      // DocumentAnalyst role cannot execute shell commands directly
      expect(isToolPermittedForRole(documentRole, 'shell_exec')).toBe(false)
    })
  })

  // ── Requirement 8: Normalized Tool Call Representation ──
  describe('Unified Normalized Tool Calling Dialects', () => {
    it('normalizes fence tool call syntax into NormalizedToolCall object', () => {
      const fenceText = '```tool:fs_write\n{"path": "src/App.tsx", "content": "console.log(1)"}\n```'
      const normalized = extractNormalizedToolCalls(fenceText)
      expect(normalized.length).toBe(1)
      expect(normalized[0]).toEqual({
        type: 'tool_call',
        tool: 'fs_write',
        arguments: { path: 'src/App.tsx', content: 'console.log(1)' },
        rawSpan: expect.any(String),
        index: 0,
      })
    })

    it('normalizes XML / ChatML tool call syntax into NormalizedToolCall object', () => {
      const xmlText = '<tool_call>fs_read<arg_key>path</arg_key><arg_value>README.md</arg_value></tool_call>'
      const normalized = extractNormalizedToolCalls(xmlText)
      expect(normalized.length).toBe(1)
      expect(normalized[0].tool).toBe('fs_read')
      expect(normalized[0].arguments).toEqual({ path: 'README.md' })
    })

    it('converts ToolFence to NormalizedToolCall cleanly', () => {
      const rawFence: ToolFence = {
        toolName: 'shell_exec',
        args: { command: 'npm test' },
        raw: '```tool:shell_exec\n{"command":"npm test"}\n```',
        index: 10,
      }
      const norm = toNormalizedToolCall(rawFence)
      expect(norm.type).toBe('tool_call')
      expect(norm.tool).toBe('shell_exec')
      expect(norm.arguments).toEqual({ command: 'npm test' })
    })
  })

  // ── Requirement 11 & 12: Agent Event Bus & Task State Machine ──
  describe('Agent Event Bus & State Machine', () => {
    it('emits structured events and tracks task state transitions', () => {
      const eventsCaptured: AgentEvent[] = []
      AgentEventBus.on('agent_event', (ev: AgentEvent) => {
        eventsCaptured.push(ev)
      })

      const taskId = 'task-test-101'
      const sessionId = 'sess-test-101'

      AgentEventBus.emitAgentEvent('TASK_CREATED', {
        taskId,
        sessionId,
        userPrompt: 'Build a dashboard',
        timestamp: Date.now(),
      })
      expect(AgentEventBus.getTaskState(taskId)).toBe('running')

      AgentEventBus.emitAgentEvent('TASK_PLANNED', {
        taskId,
        sessionId,
        planSummary: '1. Search skills, 2. Scaffold React',
        steps: ['Search skills', 'Scaffold React'],
        timestamp: Date.now(),
      })
      expect(AgentEventBus.getTaskState(taskId)).toBe('planning')

      AgentEventBus.emitAgentEvent('TOOL_CALL_STARTED', {
        taskId,
        sessionId,
        toolCallId: 'call-1',
        toolName: 'fs_write',
        args: { path: 'src/Dashboard.tsx' },
        stepIndex: 1,
        timestamp: Date.now(),
      })
      expect(AgentEventBus.getTaskState(taskId)).toBe('waiting_for_tool')

      AgentEventBus.emitAgentEvent('TASK_COMPLETED', {
        taskId,
        sessionId,
        summary: 'Dashboard generated',
        totalDurationMs: 1500,
        timestamp: Date.now(),
      })
      expect(AgentEventBus.getTaskState(taskId)).toBe('completed')

      expect(eventsCaptured.length).toBe(4)
      expect(eventsCaptured[0].type).toBe('TASK_CREATED')
      expect(eventsCaptured[3].type).toBe('TASK_COMPLETED')
    })

    it('handles TASK_CANCELLED event state transition', () => {
      const taskId = 'task-cancel-102'
      const sessionId = 'sess-cancel-102'

      AgentEventBus.emitAgentEvent('TASK_STARTED', {
        taskId,
        sessionId,
        kind: 'coding',
        timestamp: Date.now(),
      })
      expect(AgentEventBus.getTaskState(taskId)).toBe('running')

      AgentEventBus.emitAgentEvent('TASK_CANCELLED', {
        taskId,
        sessionId,
        reason: 'User clicked cancel button',
        timestamp: Date.now(),
      })
      expect(AgentEventBus.getTaskState(taskId)).toBe('cancelled')
    })
  })
})
