/**
 * Commit 7 — main→renderer chat stream pushes on the existing
 * `events:session` push channel. Deltas are transient (never persisted);
 * only the final assistant message becomes a durable session event.
 */

export type ChatStreamKind = 'assistant-delta' | 'assistant-done' | 'assistant-error' | 'assistant-cancelled' | 'model-loading'

export interface ChatStreamEvent {
  sessionId: string
  kind: ChatStreamKind
  /** Incremental text for deltas. Never logged server-side. */
  text?: string
  /** Classified, user-safe message for error pushes. */
  error?: string
  /** Durable seq of the persisted assistant/cancelled event on done. */
  seq?: number
  /** Loading progress (0-100) for model-loading events */
  progress?: number
  /** Stage label for loading: 'mmap'|'gpu-offload'|'context'|'prompt'|'streaming' */
  stage?: string
  /** Human detail for progress bar */
  detail?: string
}
