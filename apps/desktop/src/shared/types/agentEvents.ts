/**
 * SOVARA Agent Event Protocol
 * Single source of truth for structured runtime execution events.
 * Driven by the Agent Runtime and consumed by Renderer UI / IPC.
 */

export type AgentEventType =
  | 'TASK_CREATED'
  | 'TASK_STARTED'
  | 'TASK_PLANNED'
  | 'PLAN_CREATED'
  | 'AGENT_STARTED'
  | 'MODEL_LOADING'
  | 'MODEL_READY'
  | 'MODEL_REQUEST_STARTED'
  | 'MODEL_TOKEN_STREAM'
  | 'TOOL_CALL_STARTED'
  | 'TOOL_CALL_PROGRESS'
  | 'TOOL_CALL_COMPLETED'
  | 'TOOL_CALL_FAILED'
  | 'MODEL_REQUEST_COMPLETED'
  | 'CONTEXT_UPDATED'
  | 'ARTIFACT_CREATED'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_COMPLETED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_CANCELLED'

export interface PlanStep {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
}

export interface AgentEventPayloads {
  TASK_CREATED: {
    taskId: string
    sessionId: string
    userPrompt: string
    timestamp: number
  }
  TASK_STARTED: {
    taskId: string
    sessionId: string
    kind: string
    timestamp: number
  }
  TASK_PLANNED: {
    taskId: string
    sessionId: string
    planSummary: string
    steps: string[]
    timestamp: number
  }
  MODEL_LOADING: {
    taskId: string
    sessionId: string
    modelId: string
    runtimeId: string
    timestamp: number
  }
  MODEL_READY: {
    taskId: string
    sessionId: string
    modelId: string
    runtimeId: string
    timestamp: number
  }
  AGENT_STARTED: {
    taskId: string
    sessionId: string
    role: string
    userPrompt: string
    modelId: string
    timestamp: number
  }
  PLAN_CREATED: {
    taskId: string
    sessionId: string
    todos: PlanStep[]
    timestamp: number
  }
  MODEL_REQUEST_STARTED: {
    taskId: string
    sessionId: string
    role: string
    modelId: string
    stepIndex: number
    timestamp: number
  }
  MODEL_TOKEN_STREAM: {
    taskId: string
    sessionId: string
    chunk: string
    reasoningChunk?: string
    timestamp: number
  }
  TOOL_CALL_STARTED: {
    taskId: string
    sessionId: string
    toolCallId: string
    toolName: string
    args: Record<string, unknown>
    stepIndex: number
    timestamp: number
  }
  TOOL_CALL_PROGRESS: {
    taskId: string
    sessionId: string
    toolCallId: string
    toolName: string
    detail: string
    timestamp: number
  }
  TOOL_CALL_COMPLETED: {
    taskId: string
    sessionId: string
    toolCallId: string
    toolName: string
    result: unknown
    durationMs: number
    timestamp: number
  }
  TOOL_CALL_FAILED: {
    taskId: string
    sessionId: string
    toolCallId: string
    toolName: string
    error: string
    durationMs: number
    timestamp: number
  }
  MODEL_REQUEST_COMPLETED: {
    taskId: string
    sessionId: string
    promptTokens: number
    completionTokens: number
    durationMs: number
    timestamp: number
  }
  CONTEXT_UPDATED: {
    taskId: string
    sessionId: string
    tokensEst: number
    compacted: boolean
    timestamp: number
  }
  ARTIFACT_CREATED: {
    taskId: string
    sessionId: string
    kind: string
    fileName: string
    path: string
    bytes: number
    timestamp: number
  }
  VERIFICATION_STARTED: {
    taskId: string
    sessionId: string
    verificationTarget: string
    timestamp: number
  }
  VERIFICATION_COMPLETED: {
    taskId: string
    sessionId: string
    passed: boolean
    summary: string
    timestamp: number
  }
  TASK_COMPLETED: {
    taskId: string
    sessionId: string
    summary: string
    totalDurationMs: number
    timestamp: number
  }
  TASK_FAILED: {
    taskId: string
    sessionId: string
    error: string
    totalDurationMs: number
    timestamp: number
  }
  TASK_CANCELLED: {
    taskId: string
    sessionId: string
    reason: string
    timestamp: number
  }
}

export interface AgentEvent<T extends AgentEventType = AgentEventType> {
  type: T
  payload: AgentEventPayloads[T]
}

export type CanonicalRuntimeStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'READY'
  | 'MODEL_LOADING'
  | 'MODEL_READY'
  | 'STREAMING'
  | 'TOOL_EXECUTING'
  | 'ERROR'

export interface CanonicalRuntimeState {
  status: CanonicalRuntimeStatus
  residentModelId: string | null
  residentEndpoint: string | null
  activeToolName: string | null
  lastError: string | null
  isAvailable: boolean
  updatedAt: number
}

export interface DiagnosticEventLogEntry {
  eventId: string
  sequence: number
  sessionId: string
  taskId: string
  eventType: string
  timestamp: number
  detail?: string
}

