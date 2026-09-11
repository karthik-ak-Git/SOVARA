/**
 * Chat/inference service — server-side boundary for the real Sovora
 * inference pipeline (AgentOrchestrator → ModelRouter → runtime → LLM).
 *
 * Mirrors the `chat:*` IPC handlers exactly, including the orchestrator-code
 * → user-facing error mapping the UI already handles. Deltas stream to SSE
 * subscribers via the emit wired in `backend.ts`; these functions resolve
 * when the durable assistant event is persisted (same contract as IPC).
 */

import 'server-only'
import { brand } from '@shared/types/branded'
import type { SessionId } from '@shared/types/branded'
import { zChatCancel, zChatEditResend, zChatRegenerate, zChatSend } from '@shared/ipc/schemas'
import { getBackend } from './backend'
import { mapChatError } from './http'

interface OrchestratorLike {
  execute: (sid: SessionId, content: string, opts?: unknown) => Promise<{ userSeq: number; assistantSeq: number }>
  regenerate: (sid: SessionId, opts?: unknown) => Promise<{ assistantSeq: number }>
  editAndResend: (sid: SessionId, content: string, opts?: unknown) => Promise<{ userSeq: number; assistantSeq: number }>
  cancel: (sid: SessionId) => { cancelled: boolean }
}

type ChatFallback = {
  send: (s: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }>
  regenerate: (s: SessionId, o?: unknown) => Promise<{ assistantSeq: number }>
  editAndResend: (s: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }>
  cancel: (s: SessionId) => { cancelled: boolean }
}

async function target(): Promise<OrchestratorLike | ChatFallback> {
  const backend = await getBackend()
  const orch = (backend as unknown as { orchestrator?: OrchestratorLike }).orchestrator
  return orch ?? (backend.chat as unknown as ChatFallback)
}

export async function sendChat(raw: unknown) {
  const data = zChatSend.parse(raw)
  const sid = brand<'SessionId'>(data.sessionId)
  try {
    const t = await target()
    if ('execute' in t) {
      return await t.execute(sid, data.content, { webSearch: data.webSearch, reasoning: data.reasoning })
    }
    return await t.send(sid, data.content, { webSearch: data.webSearch, reasoning: data.reasoning })
  } catch (e) {
    throw new Error(mapChatError(e, 'chat failed'))
  }
}

export async function cancelChat(raw: unknown) {
  // No session ref = legacy probe call; treat as a no-op success (IPC parity).
  if (raw === undefined) return { ok: true, cancelled: false }
  const data = zChatCancel.parse(raw)
  const sid = brand<'SessionId'>(data.sessionId)
  const backend = await getBackend()
  const legacy = backend.chat.cancel(sid)
  const orch = (backend as unknown as { orchestrator?: OrchestratorLike }).orchestrator
  const viaOrch = orch ? orch.cancel(sid) : { cancelled: false }
  return { cancelled: legacy.cancelled || viaOrch.cancelled }
}

export async function regenerateChat(raw: unknown) {
  const data = zChatRegenerate.parse(raw)
  const sid = brand<'SessionId'>(data.sessionId)
  try {
    const t = await target()
    return await t.regenerate(sid, { reasoning: data.reasoning })
  } catch (e) {
    throw new Error(mapChatError(e, 'regenerate failed'))
  }
}

export async function editResendChat(raw: unknown) {
  const data = zChatEditResend.parse(raw)
  const sid = brand<'SessionId'>(data.sessionId)
  try {
    // Both the orchestrator and the legacy ChatService expose editAndResend.
    const t = await target()
    return await t.editAndResend(sid, data.content, { webSearch: data.webSearch, reasoning: data.reasoning })
  } catch (e) {
    throw new Error(mapChatError(e, 'editResend failed'))
  }
}
