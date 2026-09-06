/**
 * Commit 5 — typed IPC wrapper for the renderer.
 * Renderer must never touch the filesystem, subprocesses, Electron APIs,
 * databases, or the network directly. Every call below goes through the
 * preload whitelist (`window.sovara.invoke`) and is validated in Main with Zod.
 */

export interface SessionHeaderView {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export interface SessionEventView {
  seq: number
  time: number
  type: string
  data: unknown
}

function sovara(): Window['sovara'] {
  if (!window.sovara) throw new Error('sovara bridge unavailable')
  return window.sovara
}

export async function listSessions(): Promise<SessionHeaderView[]> {
  return (await sovara().invoke('sessions:list')) as SessionHeaderView[]
}

export async function createSession(title: string): Promise<SessionHeaderView> {
  return (await sovara().invoke('sessions:create', { title })) as SessionHeaderView
}

export async function getSessionEvents(sessionId: string): Promise<SessionEventView[]> {
  return (await sovara().invoke('sessions:getEvents', sessionId)) as SessionEventView[]
}

export async function sendChatMessage(
  sessionId: string,
  content: string
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  return (await sovara().invoke('chat:send', { sessionId, content })) as {
    ok: boolean
    userSeq: number
    assistantSeq: number
  }
}
