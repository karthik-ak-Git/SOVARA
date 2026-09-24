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
      let delimiter = '\n\n'
      if (pendingReasoning) {
        const prev = pendingReasoning.content.trimEnd()
        const isSentenceEnd = /[.!?:]$/.test(prev)
        if (!isSentenceEnd && content.length <= 50 && !content.includes('\n')) {
          // Token fragment continuation — avoid inserting double newlines between words/subwords
          delimiter = ''
        }
      }
      pendingReasoning = pendingReasoning
        ? { seq: pendingReasoning.seq, time: pendingReasoning.time, content: `${pendingReasoning.content}${delimiter}${content}` }
        : { seq: e.seq, time: e.time, content }
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
    // De-dupe internal repetition inside a single message (Qwen 9B at 7/32 layers repeats its own paragraph
    // when KV is strained at 8192: "SOVARA doesn't have... SOVARA doesn't have..." — show once).
    if (e.type === 'assistant/message' && content.length > 600) {
      const firstPara = content.slice(0, 400)
      const restIdx = content.indexOf(firstPara, 200)
      if (restIdx > 200) {
        // Find second occurrence of the opening sentence
        const second = content.indexOf(firstPara.slice(0, 80), 400)
        if (second > 400) {
          // Truncate to first occurrence + tail after duplicate header
          const beforeDup = content.slice(0, second).trimEnd()
          // If rest after second is essentially the same as first 500 chars, drop it
          if (content.slice(second, second + 500) === firstPara.slice(0, 500)) {
            msg.content = beforeDup
          } else if (content.length > 1200) {
            // Fallback: if content is just two near-identical halves, keep the first half
            const half = Math.floor(content.length / 2)
            if (content.slice(0, 400) === content.slice(half, half + 400)) {
              msg.content = content.slice(0, half).trim()
            }
          }
        }
      }
      // Strip any lingering promotion note suffix (should no longer be emitted, but handle old events)
      msg.content = msg.content.replace(/\n\n\[Note: model returned only reasoning[^\]]*\]$/, '').trim()
    }
    if (e.type === 'assistant/message' && pendingReasoning) {
      // Dedupe: Orchestrator promotes reasoning→text when model returns only <think> (text empty)
      // That creates identical reasoning + message content → would render Thought + duplicate body.
      const r = pendingReasoning.content.trim()
      const c = (msg.content ?? content).trim()
      const isDuplicate =
        r.length > 0 &&
        (c === r ||
          c.startsWith(r.slice(0, Math.min(200, r.length))) ||
          c.includes(r.slice(0, 120)))
      const cWithoutNote = c.replace(/\n\n\[Note: model returned only reasoning[^\]]*\]$/, '').trim()
      const isPromotedDuplicate = r.length > 0 && (cWithoutNote === r || cWithoutNote.startsWith(r.slice(0, 120)))
      if (!isDuplicate && !isPromotedDuplicate) {
        msg.reasoning = pendingReasoning.content
      } else if (isPromotedDuplicate) {
        // Keep only the note-free content, hide the duplicate Thought block
        msg.content = cWithoutNote
      }
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
