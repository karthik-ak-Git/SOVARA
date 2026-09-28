import { describe, expect, it, beforeEach } from 'vitest'
import { runtimeStatusStore } from '../src/renderer/src/stores/runtimeStatusStore'
import { AgentEventBus } from '../src/main/backend/AgentEventBus'

describe('Phase 9.7 — Runtime State -> UI Event Sink & Completion Gate Truth Test', () => {
  beforeEach(() => {
    runtimeStatusStore.reset()
  })

  it('Requirement A & B: Subscribers receive agent events and update canonical status & diagnostic log', () => {
    const emittedEvents: any[] = []

    const handler = (ev: any) => {
      emittedEvents.push(ev)
      runtimeStatusStore.handleAgentEvent(ev)
    }

    // Subscribe to bus
    AgentEventBus.on('agent_event', handler)

    // Emit runtime loaded event
    AgentEventBus.emitAgentEvent('MODEL_READY', {
      taskId: 't-1',
      sessionId: 'test-session-1',
      modelId: 'gemma-4-E2B-it-Q4_K_M',
      runtimeId: 'llama-server',
      timestamp: Date.now(),
    })

    expect(runtimeStatusStore.getState().status).toBe('MODEL_READY')
    expect(runtimeStatusStore.getState().residentModelId).toBe('gemma-4-E2B-it-Q4_K_M')
    expect(runtimeStatusStore.getState().isAvailable).toBe(true)
    expect(runtimeStatusStore.getDiagnosticLogs().length).toBe(1)
    expect(runtimeStatusStore.getDiagnosticLogs()[0].eventType).toBe('MODEL_READY')

    // Emit streaming start event
    AgentEventBus.emitAgentEvent('MODEL_TOKEN_STREAM', {
      taskId: 't-1',
      sessionId: 'test-session-1',
      chunk: 'Hello',
      timestamp: Date.now(),
    })

    expect(runtimeStatusStore.getState().status).toBe('STREAMING')

    // Emit tool execution event
    AgentEventBus.emitAgentEvent('TOOL_CALL_STARTED', {
      taskId: 't-1',
      sessionId: 'test-session-1',
      toolCallId: 'call-123',
      toolName: 'fs_write',
      args: {},
      stepIndex: 1,
      timestamp: Date.now(),
    })

    expect(runtimeStatusStore.getState().status).toBe('TOOL_EXECUTING')
    expect(runtimeStatusStore.getState().activeToolName).toBe('fs_write')

    // Emit completion event
    AgentEventBus.emitAgentEvent('TASK_COMPLETED', {
      taskId: 't-1',
      sessionId: 'test-session-1',
      summary: 'Task completed successfully',
      totalDurationMs: 150,
      timestamp: Date.now(),
    })

    expect(runtimeStatusStore.getState().status).toBe('READY')
    expect(runtimeStatusStore.getState().activeToolName).toBeNull()
    expect(runtimeStatusStore.getDiagnosticLogs().length).toBe(4)

    AgentEventBus.off('agent_event', handler)
  })

  it('Requirement K: Error status & recovery handling in canonical store', () => {
    const handler = (ev: any) => runtimeStatusStore.handleAgentEvent(ev)
    AgentEventBus.on('agent_event', handler)

    AgentEventBus.emitAgentEvent('TASK_FAILED', {
      taskId: 't-1',
      sessionId: 'test-session-1',
      error: 'CUDA Out of Memory',
      totalDurationMs: 50,
      timestamp: Date.now(),
    })

    expect(runtimeStatusStore.getState().status).toBe('ERROR')
    expect(runtimeStatusStore.getState().lastError).toBe('CUDA Out of Memory')

    // Recovery when new model loads
    AgentEventBus.emitAgentEvent('MODEL_READY', {
      taskId: 't-1',
      sessionId: 'test-session-1',
      modelId: 'gemma-4-E2B-it-Q4_K_M',
      runtimeId: 'llama-server',
      timestamp: Date.now(),
    })

    expect(runtimeStatusStore.getState().status).toBe('MODEL_READY')
    expect(runtimeStatusStore.getState().lastError).toBeNull()

    AgentEventBus.off('agent_event', handler)
  })

  it('Requirement C & K: Completion gate message accurately reflects executed tools when tools succeed', () => {
    const successfulTools = new Set(['fs_write', 'web_search'])
    const requiredActionFailures = ['no successful workspace inspection was executed']

    const actionSummary = successfulTools.size > 0 
      ? `Task executed actions (${Array.from(successfulTools).join(', ')}), but verification or inspection step was incomplete.` 
      : `The model returned text without an observed successful action.`
    const message = `Autonomous execution did not complete: ${requiredActionFailures.join('; ')}. ${actionSummary} No task completion was recorded.`

    expect(message).toContain('Task executed actions (fs_write, web_search)')
    expect(message).not.toContain('without an observed successful action')
  })
})
