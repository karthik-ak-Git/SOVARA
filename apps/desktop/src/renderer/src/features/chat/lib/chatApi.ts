/**
 * ChatApi — thin typed wrapper over the secure IPC boundary.
 * Renderer never touches window.sovara directly; components call this layer.
 * Keeps ChatStore and hooks independent of IPC channel names/validation.
 */
import {
  listSessions,
  createSession,
  getSessionEvents,
  sendChatMessage,
  cancelChatMessage,
  regenerateChatMessage,
  editAndResendChatMessage,
  renameSession,
  deleteSession,
  getActiveModel,
  type SessionHeaderView,
  type SessionEventView,
} from '../../../lib/ipc'
import type { ActiveModelState } from '@shared/types/models'

export type { SessionHeaderView, SessionEventView }

export async function fetchSessions(): Promise<SessionHeaderView[]> {
  return listSessions()
}

export async function fetchSessionEvents(sessionId: string): Promise<SessionEventView[]> {
  return getSessionEvents(sessionId)
}

export async function createChatSession(
  title: string,
  projectId?: string | null
): Promise<SessionHeaderView> {
  return createSession(title, projectId ?? null)
}

export async function sendMessage(
  sessionId: string,
  content: string,
  opts?: { webSearch?: boolean }
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  const text = content.trim()
  if (!text) throw new Error('message empty: cannot send empty message')
  if (text.length > 32_000) throw new Error('message too long: exceeds 32000 characters')
  return sendChatMessage(sessionId, text, opts)
}

export async function cancelGeneration(sessionId: string): Promise<{ cancelled: boolean }> {
  return cancelChatMessage(sessionId)
}

export async function regenerateResponse(sessionId: string): Promise<{ ok: boolean; assistantSeq: number }> {
  if (!sessionId) throw new Error('session required for regenerate')
  return regenerateChatMessage(sessionId)
}

export async function editAndResend(
  sessionId: string,
  content: string,
  opts?: { webSearch?: boolean }
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  const text = content.trim()
  if (!text) throw new Error('message empty: cannot resend empty message')
  return editAndResendChatMessage(sessionId, text, opts)
}

export async function fetchActiveModel(): Promise<ActiveModelState> {
  return getActiveModel()
}

export { renameSession, deleteSession }
