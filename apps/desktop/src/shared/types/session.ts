import type { SessionId, ToolCallId } from './branded'

/**
 * Minimal SessionEvent vocabulary — compatible shape with DSH's SessionEvent
 * without importing Cordis. Only `user/message` in Phase 1; others reserved.
 */
export type SessionEventType = 'user/message' | 'assistant/message' | 'tool/result' | 'system/resource-blocked'

export type SurfaceOp = 'append' | { op: 'replace'; start: number; end: number }

export interface SessionEvent<T extends SessionEventType = SessionEventType> {
  seq: number
  time: number
  type: T
  data: unknown
  surfaceOp?: SurfaceOp
  sourceEventSeqs?: number[]
  ignorable?: true
}

export interface UserMessageData {
  role: 'user'
  content: string
  source?: string
}

export interface AssistantMessageData {
  role: 'assistant'
  content: string
  provider?: string
  model?: string
}

export interface ToolResultData {
  role: 'tool'
  toolCallId: ToolCallId
  content: string
  isError?: boolean
}

export type SessionIdString = SessionId
