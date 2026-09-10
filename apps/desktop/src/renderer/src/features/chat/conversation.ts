/**
 * Commit 5 — conversation view model derived from append-only session events.
 * Commit 7 — `assistant/cancelled` markers project as honest timeline rows.
 * The rendered conversation is ALWAYS derived from session events; there is
 * no separate messages table. Only `user/message`, `assistant/message`, and
 * `assistant/cancelled` events project into the timeline. Unknown/corrupt
 * rows are ignored so a single bad event can never break reconstruction.
 */

export interface SessionEventLike {
  seq: number
  time: number
  type: string
  data: unknown
}

export interface ChatMessage {
  seq: number
  time: number
  role: 'user' | 'assistant'
  content: string
  /** True for `assistant/cancelled` rows — a stopped generation, not a reply. */
  cancelled?: boolean
  /** Reasoning content for assistant (when reasoning enabled) */
  reasoning?: string
}

function extractContent(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (data !== null && typeof data === 'object') {
    const c = (data as Record<string, unknown>)['content']
    if (typeof c === 'string') return c
  }
  return null
}

export function deriveMessages(events: SessionEventLike[]): ChatMessage[] {
  const out: ChatMessage[] = []
  // Keep track of pending reasoning to attach to next assistant message
  let pendingReasoning: { seq: number; time: number; content: string } | null = null
  for (const e of events) {
    if (!e || typeof e !== 'object') continue
    if (e.type !== 'user/message' && e.type !== 'assistant/message' && e.type !== 'assistant/cancelled' && e.type !== 'assistant/reasoning') continue
    if (!Number.isInteger(e.seq) || e.seq < 0) continue
    if (typeof e.time !== 'number' || !Number.isFinite(e.time)) continue
    if (e.type === 'assistant/cancelled') {
      out.push({ seq: e.seq, time: e.time, role: 'assistant', content: 'Generation cancelled.', cancelled: true })
      pendingReasoning = null
      continue
    }
    if (e.type === 'assistant/reasoning') {
      const content = extractContent(e.data)
      if (content === null) continue
      // Store as pending to attach to next assistant message, or as standalone if no following message
      pendingReasoning = { seq: e.seq, time: e.time, content }
      continue
    }
    const content = extractContent(e.data)
    if (content === null) continue
    const msg: ChatMessage = {
      seq: e.seq,
      time: e.time,
      role: e.type === 'user/message' ? 'user' : 'assistant',
      content,
    }
    if (e.type === 'assistant/message' && pendingReasoning) {
      msg.reasoning = pendingReasoning.content
      // Use reasoning's seq for ordering if needed, but keep message seq
      pendingReasoning = null
    }
    out.push(msg)
  }
  // If there's a leftover reasoning without a following assistant message, emit it as a standalone thinking bubble
  if (pendingReasoning) {
    out.push({ seq: pendingReasoning.seq, time: pendingReasoning.time, role: 'assistant', content: '', reasoning: pendingReasoning.content })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

export function isEmptyConversation(events: SessionEventLike[]): boolean {
  return deriveMessages(events).length === 0
}
