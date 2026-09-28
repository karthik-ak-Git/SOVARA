/**
 * SOVARA Canonical Runtime Status Store
 * 
 * Single source of truth for UI runtime availability & lifecycle events.
 * Listens directly to AgentEventBus (`agent:event`) & session stream (`events:session`).
 */

import { onAgentEvents, onSessionEvents, getActiveModel } from '../lib/client/api'
import type {
  CanonicalRuntimeState,
  CanonicalRuntimeStatus,
  DiagnosticEventLogEntry,
  AgentEvent,
} from '@shared/types/agentEvents'

let currentState: CanonicalRuntimeState = {
  status: 'READY',
  residentModelId: null,
  residentEndpoint: null,
  activeToolName: null,
  lastError: null,
  isAvailable: true,
  updatedAt: Date.now(),
}

const diagnosticLogs: DiagnosticEventLogEntry[] = []
const listeners = new Set<(state: CanonicalRuntimeState) => void>()
let eventSeq = 0

export function getCanonicalRuntimeState(): CanonicalRuntimeState {
  return currentState
}

export function getDiagnosticLogs(): DiagnosticEventLogEntry[] {
  return [...diagnosticLogs]
}

export function subscribeRuntimeStatus(listener: (state: CanonicalRuntimeState) => void): () => void {
  listeners.add(listener)
  listener(currentState)
  return () => {
    listeners.delete(listener)
  }
}

function updateState(patch: Partial<CanonicalRuntimeState>): void {
  currentState = {
    ...currentState,
    ...patch,
    updatedAt: Date.now(),
  }
  for (const fn of listeners) {
    try {
      fn(currentState)
    } catch (e) {
      console.error('[RuntimeStatusStore] listener error:', e)
    }
  }
}

function logDiagnosticEvent(evt: {
  sessionId?: string
  taskId?: string
  eventType: string
  detail?: string
}): void {
  eventSeq++
  const entry: DiagnosticEventLogEntry = {
    eventId: `evt-${Date.now()}-${eventSeq}`,
    sequence: eventSeq,
    sessionId: evt.sessionId || 'session-global',
    taskId: evt.taskId || 'task-global',
    eventType: evt.eventType,
    timestamp: Date.now(),
    detail: evt.detail,
  }
  diagnosticLogs.push(entry)
  if (diagnosticLogs.length > 300) {
    diagnosticLogs.shift()
  }
}

// ── Initialize IPC Subscriptions ─────────────────────────────────────────────
let isInitialized = false

export function initRuntimeStatusStore(): void {
  if (isInitialized) return
  isInitialized = true

  // Initial fetch of active model
  void getActiveModel()
    .then((m) => {
      if (m?.selection?.modelId) {
        updateState({
          residentModelId: m.displayName || m.selection.modelId,
          residentEndpoint: '127.0.0.1:57039',
          isAvailable: m.available !== false,
          status: m.available !== false ? 'MODEL_READY' : 'READY',
        })
      }
    })
    .catch(() => {})

  // Listen to AgentEventBus (`agent:event`)
  onAgentEvents((rawEvent: unknown) => {
    const evt = rawEvent as AgentEvent
    if (!evt || !evt.type) return

    logDiagnosticEvent({
      sessionId: (evt.payload as any)?.sessionId,
      taskId: (evt.payload as any)?.taskId,
      eventType: evt.type,
      detail: (evt.payload as any)?.detail || (evt.payload as any)?.error || (evt.payload as any)?.modelId,
    })

    switch (evt.type) {
      case 'MODEL_LOADING': {
        const p = evt.payload as any
        updateState({
          status: 'MODEL_LOADING',
          residentModelId: p.modelId,
          residentEndpoint: '127.0.0.1:57039',
          isAvailable: true,
          lastError: null,
        })
        break
      }
      case 'MODEL_READY': {
        const p = evt.payload as any
        updateState({
          status: 'MODEL_READY',
          residentModelId: p.modelId,
          residentEndpoint: '127.0.0.1:57039',
          isAvailable: true,
          lastError: null,
        })
        break
      }
      case 'MODEL_TOKEN_STREAM': {
        updateState({
          status: 'STREAMING',
          isAvailable: true,
          lastError: null,
        })
        break
      }
      case 'TOOL_CALL_STARTED': {
        const p = evt.payload as any
        updateState({
          status: 'TOOL_EXECUTING',
          activeToolName: p.toolName,
          isAvailable: true,
        })
        break
      }
      case 'TOOL_CALL_COMPLETED': {
        updateState({
          status: 'STREAMING',
          activeToolName: null,
          isAvailable: true,
        })
        break
      }
      case 'TOOL_CALL_FAILED': {
        const p = evt.payload as any
        logDiagnosticEvent({
          sessionId: p.sessionId,
          taskId: p.taskId,
          eventType: 'TOOL_CALL_FAILED',
          detail: `${p.toolName} failed: ${p.error}`,
        })
        updateState({
          status: 'STREAMING',
          activeToolName: null,
        })
        break
      }
      case 'TASK_COMPLETED': {
        updateState({
          status: 'MODEL_READY',
          activeToolName: null,
          isAvailable: true,
          lastError: null,
        })
        break
      }
      case 'TASK_FAILED': {
        const p = evt.payload as any
        updateState({
          status: 'ERROR',
          lastError: p.error,
          isAvailable: false,
        })
        break
      }
      case 'TASK_CANCELLED': {
        updateState({
          status: 'MODEL_READY',
          activeToolName: null,
          isAvailable: true,
        })
        break
      }
    }
  })

  // Listen to Session events (`events:session`)
  onSessionEvents((ev) => {
    logDiagnosticEvent({
      sessionId: ev.sessionId,
      eventType: ev.kind,
      detail: ev.detail || (ev as any).error,
    })

    if (ev.kind === 'model:loading') {
      updateState({
        status: 'MODEL_LOADING',
        residentModelId: ev.modelId || currentState.residentModelId,
        isAvailable: true,
        lastError: null,
      })
    } else if (ev.kind === 'model:ready') {
      updateState({
        status: 'MODEL_READY',
        residentModelId: ev.modelId || currentState.residentModelId,
        residentEndpoint: '127.0.0.1:57039',
        isAvailable: true,
        lastError: null,
      })
    } else if (ev.kind === 'assistant-delta' || ev.kind === 'reasoning-delta') {
      updateState({
        status: 'STREAMING',
        isAvailable: true,
        lastError: null,
      })
    } else if (ev.kind === 'tool:start') {
      updateState({
        status: 'TOOL_EXECUTING',
        activeToolName: ev.toolName || 'tool',
        isAvailable: true,
      })
    } else if (ev.kind === 'tool:end') {
      updateState({
        status: 'STREAMING',
        activeToolName: null,
        isAvailable: true,
      })
    } else if (ev.kind === 'assistant-done' || ev.kind === 'task:complete') {
      updateState({
        status: 'MODEL_READY',
        activeToolName: null,
        isAvailable: true,
        lastError: null,
      })
    } else if (ev.kind === 'task:error' || ev.kind === 'model:failed') {
      const err = (ev as any).error || ev.detail || 'Runtime error'
      updateState({
        status: 'ERROR',
        lastError: err,
        isAvailable: false,
      })
    }
  })
}

export const runtimeStatusStore = {
  getState: getCanonicalRuntimeState,
  getDiagnosticLogs,
  subscribe: subscribeRuntimeStatus,
  handleAgentEvent(evt: AgentEvent) {
    logDiagnosticEvent({
      sessionId: (evt.payload as any)?.sessionId,
      taskId: (evt.payload as any)?.taskId,
      eventType: evt.type,
      detail: (evt.payload as any)?.detail || (evt.payload as any)?.error || (evt.payload as any)?.modelId,
    })
    switch (evt.type) {
      case 'MODEL_LOADING':
      case 'MODEL_READY': {
        const p = evt.payload as any
        updateState({
          status: 'MODEL_READY',
          residentModelId: p.modelId,
          residentEndpoint: '127.0.0.1:57039',
          isAvailable: true,
          lastError: null,
        })
        break
      }
      case 'MODEL_TOKEN_STREAM': {
        updateState({
          status: 'STREAMING',
          isAvailable: true,
          lastError: null,
        })
        break
      }
      case 'TOOL_CALL_STARTED': {
        const p = evt.payload as any
        updateState({
          status: 'TOOL_EXECUTING',
          activeToolName: p.toolName,
          isAvailable: true,
        })
        break
      }
      case 'TOOL_CALL_COMPLETED': {
        updateState({
          status: 'STREAMING',
          activeToolName: null,
          isAvailable: true,
        })
        break
      }
      case 'TASK_COMPLETED': {
        updateState({
          status: 'READY',
          activeToolName: null,
          isAvailable: true,
          lastError: null,
        })
        break
      }
      case 'TASK_FAILED': {
        const p = evt.payload as any
        updateState({
          status: 'ERROR',
          lastError: p.error,
          isAvailable: false,
        })
        break
      }
    }
  },
  reset() {
    currentState = {
      status: 'READY',
      residentModelId: null,
      residentEndpoint: null,
      activeToolName: null,
      lastError: null,
      isAvailable: true,
      updatedAt: Date.now(),
    }
    diagnosticLogs.length = 0
    eventSeq = 0
  },
}
