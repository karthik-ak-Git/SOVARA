/**
 * Task taxonomy for Sovara's agent execution surface.
 * Classification is deterministic, heuristic-first, replaceable.
 * Renderer and backend share these types via IPC — no runtime logic here.
 */

export type TaskKind =
  | 'chat'
  | 'reasoning'
  | 'coding'
  | 'analysis'
  | 'summarization'
  | 'tool-use'
  | 'agent'

export interface TaskClassification {
  kind: TaskKind
  /** 0-1 confidence */
  confidence: number
  /** Required model capabilities (must come from registry, never inferred from name alone). */
  requiredCapabilities: string[]
  /** Estimated context length needed (chars → tokens heuristic). */
  contextLengthNeeded: number
  /** Whether reasoning/thinking mode is required or beneficial. */
  reasoningRequired: boolean
  /** True when image attachments are present — router strongly prefers vision-capable models. */
  requiresVision?: boolean
  /** Human-readable reason for debugging / audit. */
  reason: string
}

export interface TaskRequest {
  sessionId: string
  content: string
  /** Explicit user toggles (reasoning switch, webSearch globe). */
  hints?: {
    reasoning?: boolean
    webSearch?: boolean
  }
}

export interface ModelRoutingDecision {
  /** Chosen model qualified id e.g. "rt-1:phi-4" or registry id */
  modelId: string | null
  runtimeId: string | null
  /** Why this model was chosen */
  reason: string
  /** Task that drove the decision */
  task: TaskClassification
  /** Alternate candidates considered (for audit) */
  candidatesConsidered: number
  /** Whether selection differs from current active */
  switched: boolean
}

export interface AgentExecutionStep {
  index: number
  kind: 'llm' | 'tool'
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
  modelId?: string
  toolName?: string
  startedAt?: number
  endedAt?: number
  error?: string
}

export interface AgentExecutionTrace {
  task: TaskClassification
  routing: ModelRoutingDecision
  model: {
    id: string
    runtimeId: string
    displayName?: string
    status: 'selected' | 'loading' | 'ready' | 'failed' | 'unavailable'
    loadError?: string
  } | null
  resource: {
    level: 'ok' | 'warn' | 'critical'
    blocking: boolean
    reason?: string
    snapshot?: import('@shared/types/ports').SystemResources
  }
  steps: AgentExecutionStep[]
  toolCalls: Array<{ name: string; args: unknown; result?: string; error?: string }>
  durationMs?: number
  outcome: 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled' | 'blocked'
  error?: string
}
