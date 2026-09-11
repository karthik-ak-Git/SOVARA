/**
 * Commit 7 — main→renderer chat stream pushes on the existing
 * `events:session` push channel. Deltas are transient (never persisted);
 * only the final assistant message becomes a durable session event.
 */

/**
 * Extended stream taxonomy — every intermediate state from the
 * Agent Orchestration loop must be a real backend event.
 * Renderer subscribes on `events:session` (typed, no new channel).
 * Existing `assistant-*` kinds remain for streaming; new `task:*` /
 * `model:*` / `step:*` / `tool:*` kinds make the loop observable without
 * inventing fake "thinking..." spinners.
 */
export type ChatStreamKind =
  | 'assistant-delta'
  | 'reasoning-delta'
  | 'assistant-done'
  | 'assistant-error'
  | 'assistant-cancelled'
  // Agent orchestration — honest, backend-driven
  | 'task:start'
  | 'task:planning'
  | 'model:selecting'
  | 'model:loading'
  | 'model:ready'
  | 'model:failed'
  | 'step:start'
  | 'step:end'
  | 'tool:start'
  | 'tool:delta'
  | 'tool:end'
  | 'model:unloading'
  | 'task:complete'
  | 'task:error'
  | 'task:cancelled'

export interface ChatStreamEvent {
  sessionId: string
  kind: ChatStreamKind
  /** Incremental text for deltas. Never logged server-side. */
  text?: string
  /** Classified, user-safe message for error pushes. */
  error?: string
  /** Durable seq of the persisted assistant/cancelled event on done. */
  seq?: number
  /** Agent orchestration payload (present only for task/model/step/tool events) */
  taskKind?: import('./task').TaskKind
  modelId?: string
  runtimeId?: string
  stepIndex?: number
  /** Tool name for tool:start/delta/end */
  toolName?: string
  /** Resource snapshot for model:loading (VRAM etc.) — real, never faked */
  vramUsedMB?: number
  vramTotalMB?: number
  /** Step/tool/error detail string */
  detail?: string
}
