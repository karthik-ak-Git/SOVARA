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
  for (const e of events) {
    if (!e || typeof e !== 'object') continue
    if (e.type !== 'user/message' && e.type !== 'assistant/message' && e.type !== 'assistant/cancelled') continue
    if (!Number.isInteger(e.seq) || e.seq < 0) continue
    if (typeof e.time !== 'number' || !Number.isFinite(e.time)) continue
    if (e.type === 'assistant/cancelled') {
      out.push({ seq: e.seq, time: e.time, role: 'assistant', content: 'Generation cancelled.', cancelled: true })
      continue
    }
    const content = extractContent(e.data)
    if (content === null) continue
    out.push({
      seq: e.seq,
      time: e.time,
      role: e.type === 'user/message' ? 'user' : 'assistant',
      content,
    })
  }
  out.sort((a, b) => a.seq - b.seq)
  return out
}

export function isEmptyConversation(events: SessionEventLike[]): boolean {
  return deriveMessages(events).length === 0
}
