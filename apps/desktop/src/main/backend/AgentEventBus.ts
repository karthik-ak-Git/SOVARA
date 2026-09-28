/**
 * AgentEventBus & Task State Machine for SOVARA Agentic Harness
 * Broadcasts structured runtime execution events across backend and IPC,
 * manages task state transitions, and persists visible execution state.
 */

import EventEmitter from 'node:events'
import type { AgentEvent, AgentEventType, AgentEventPayloads } from '@shared/types/agentEvents'
import type { TaskClassification } from '@shared/types/task'
import type { LogicalRoleName } from './AgentRoles'

export type TaskState =
  | 'idle'
  | 'planning'
  | 'running'
  | 'waiting_for_tool'
  | 'waiting_for_model'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface SharedContext {
  taskId: string
  sessionId: string
  userPrompt: string
  taskClassification: TaskClassification
  currentRole: LogicalRoleName
  currentState: TaskState
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string }>
  relevantFiles: Map<string, string>
  toolResultsHistory: Array<{ tool: string; args: Record<string, unknown>; result: string; timestamp: number }>
  skillsRead: Set<string>
  memoryNotes: Array<{ title: string; body: string }>
  activeArtifacts: Array<{ path: string; kind: string; bytes: number }>
  modelMetadata?: { modelId: string; runtimeId: string; contextBudget: number }
  createdAt: number
  updatedAt: number
}

class AgentEventBusInstance extends EventEmitter {
  private activeTaskStates: Map<string, TaskState> = new Map()
  private activeContexts: Map<string, SharedContext> = new Map()

  /**
   * Emit a typed AgentEvent to subscribers and update state
   */
  public emitAgentEvent<T extends AgentEventType>(type: T, payload: AgentEventPayloads[T]): void {
    const event: AgentEvent<T> = { type, payload }
    
    // Update task state tracking
    const taskId = (payload as { taskId?: string }).taskId
    if (taskId) {
      if (type === 'TASK_CREATED' || type === 'TASK_STARTED') {
        this.activeTaskStates.set(taskId, 'running')
      } else if (type === 'TASK_PLANNED' || type === 'PLAN_CREATED') {
        this.activeTaskStates.set(taskId, 'planning')
      } else if (type === 'MODEL_REQUEST_STARTED' || type === 'MODEL_LOADING') {
        this.activeTaskStates.set(taskId, 'waiting_for_model')
      } else if (type === 'TOOL_CALL_STARTED') {
        this.activeTaskStates.set(taskId, 'waiting_for_tool')
      } else if (type === 'VERIFICATION_STARTED') {
        this.activeTaskStates.set(taskId, 'reviewing')
      } else if (type === 'TASK_COMPLETED') {
        this.activeTaskStates.set(taskId, 'completed')
      } else if (type === 'TASK_FAILED') {
        this.activeTaskStates.set(taskId, 'failed')
      } else if (type === 'TASK_CANCELLED') {
        this.activeTaskStates.set(taskId, 'cancelled')
      }
    }

    this.emit('agent_event', event)
    this.emit(`event:${type}`, payload)
  }

  public getTaskState(taskId: string): TaskState {
    return this.activeTaskStates.get(taskId) ?? 'idle'
  }

  public registerContext(ctx: SharedContext): void {
    this.activeContexts.set(ctx.taskId, ctx)
  }

  public getContext(taskId: string): SharedContext | undefined {
    return this.activeContexts.get(taskId)
  }

  public updateContext(taskId: string, updater: (ctx: SharedContext) => void): void {
    const ctx = this.activeContexts.get(taskId)
    if (ctx) {
      updater(ctx)
      ctx.updatedAt = Date.now()
      this.emitAgentEvent('CONTEXT_UPDATED', {
        taskId,
        sessionId: ctx.sessionId,
        tokensEst: ctx.messages.reduce((n, m) => n + Math.ceil((m.content || '').length / 4), 0),
        compacted: false,
        timestamp: Date.now(),
      })
    }
  }

  public clearTask(taskId: string): void {
    this.activeTaskStates.delete(taskId)
    this.activeContexts.delete(taskId)
  }
}

export const AgentEventBus = new AgentEventBusInstance()
