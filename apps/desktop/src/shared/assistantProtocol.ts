/**
 * assistantProtocol — shared assistant-output protocol (JSON-first, no XML).
 *
 * Used by the main process (streaming extraction + persistence sanitizing)
 * and the renderer (bubble text + Artifacts pane). Single source of truth so
 * chat and artifacts stay in sync.
 *
 * Wire format the model is asked to produce:
 *   1. Private reasoning (never shown as answer), as a fenced JSON block:
 *        ```json:reasoning
 *        {"thought": "...step by step..."}
 *        ```
 *      `{"thought"}` is parsed for the thinking indicator; anything else in
 *      the block is treated as raw reasoning text.
 *   2. Tool calls, as fenced blocks with a JSON body (unchanged):
 *        ```fs_list
 *        {"path": "."}
 *        ```
 *   3. Final answer as normal markdown, ending with a `## Recap` section
 *      (what was done + why + files touched).
 *
 * Backward compatibility: streams that still carry legacy `<thinking>` /
 * `<think>` ... `</thinking>` / `</think>` markers are parsed exactly like
 * before, so older sessions and in-flight streams keep working. Prompts no
 * longer request XML.
 */

/** Fence language that carries private reasoning as JSON. */
export const REASONING_FENCE_LANG = 'json:reasoning' as const
/** Legacy alias some models emit for the same block. */
export const REASONING_FENCE_LANG_LEGACY = 'reasoning' as const

/** Markers that open a reasoning block while streaming prose. */
const TEXT_OPEN_MARKERS: readonly string[] = [
  '```json:reasoning',
  '```reasoning',
  '<thinking>',
  '<think>',
]
/** Markers that close a legacy `<thinking>`-style block. */
const XML_CLOSE_MARKERS: readonly string[] = ['</thinking>', '</think>']
/** Markers that close a fenced reasoning block. */
const FENCE_CLOSE_MARKERS: readonly string[] = ['```', '</thinking>', '</think>']

export type ReasoningSplitEvent =
  | { kind: 'text'; value: string }
  | { kind: 'reasoning'; value: string }
  | { kind: 'reasoning-end' }

interface MarkerHit {
  index: number
  length: number
}

function findMarker(buf: string, markers: readonly string[]): MarkerHit | null {
  let best: MarkerHit | null = null
  for (const marker of markers) {
    const index = buf.indexOf(marker)
    if (index < 0) continue
    if (!best || index < best.index || (index === best.index && marker.length > best.length)) {
      best = { index, length: marker.length }
    }
  }
  return best
}

/**
 * Length of the longest buffer suffix that is a *proper* prefix of any
 * marker — that tail must be held back until the next chunk proves whether
 * the marker completes (split-safe) or not.
 */
function holdLength(buf: string, markers: readonly string[]): number {
  let held = 0
  for (const marker of markers) {
    const max = Math.min(buf.length, marker.length - 1)
    for (let n = max; n > held; n--) {
      if (n > 0 && buf.endsWith(marker.slice(0, n))) {
        held = n
        break
      }
    }
  }
  return held
}

/**
 * Pull the human-readable thought out of a fenced reasoning block. Accepts
 * `{"thought": "..."}` (also `reasoning`/`thinking` keys), a bare `{...}`
 * span inside prose, or plain text as a last resort. Never throws.
 */
export function extractThought(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const candidates: string[] = [trimmed]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start > 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1))
  } else if (start === 0 && end > 0 && end < trimmed.length - 1) {
    candidates.push(trimmed.slice(0, end + 1))
  }
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>
        const thought = record['thought'] ?? record['reasoning'] ?? record['thinking']
        if (typeof thought === 'string' && thought.trim()) return thought.trim()
      }
    } catch {
      // try the next candidate
    }
  }
  return trimmed
}

/**
 * Split-safe streaming extractor. Feed every `text-delta` through `push`;
 * route `text` events to the answer stream and `reasoning` events to the
 * thinking indicator; on `reasoning-end` persist the accumulated reasoning
 * buffer once and clear it. Call `flush()` when the stream ends.
 *
 * Fenced JSON reasoning blocks are buffered silently until the close fence
 * (so partial JSON never flashes in the UI) and emitted once as the parsed
 * thought. Legacy `<thinking>` blocks stream incrementally, as before.
 */
export class ReasoningSplitter {
  private buf = ''
  private inReasoning = false
  private fenceMode = false
  private fenceContent = ''

  /**
   * @param startOpen begin inside a legacy reasoning block (no open marker
   * needed) — preserves the regenerate path's "reasoning presumed" mode.
   */
  constructor(opts?: { startOpen?: boolean }) {
    if (opts?.startOpen) this.inReasoning = true
  }

  push(delta: string): ReasoningSplitEvent[] {
    this.buf += delta
    const out: ReasoningSplitEvent[] = []
    for (;;) {
      if (!this.inReasoning) {
        const hit = findMarker(this.buf, TEXT_OPEN_MARKERS)
        if (hit) {
          const before = this.buf.slice(0, hit.index)
          if (before) out.push({ kind: 'text', value: before })
          const opened = this.buf.slice(hit.index, hit.index + hit.length)
          this.buf = this.buf.slice(hit.index + hit.length)
          this.inReasoning = true
          this.fenceMode = opened.startsWith('```')
          this.fenceContent = ''
          continue
        }
        const hold = holdLength(this.buf, TEXT_OPEN_MARKERS)
        const n = this.buf.length - hold
        if (n > 0) {
          out.push({ kind: 'text', value: this.buf.slice(0, n) })
          this.buf = this.buf.slice(n)
        }
        return out
      }
      const closes = this.fenceMode ? FENCE_CLOSE_MARKERS : XML_CLOSE_MARKERS
      const hit = findMarker(this.buf, closes)
      if (hit) {
        const chunk = this.buf.slice(0, hit.index)
        this.buf = this.buf.slice(hit.index + hit.length)
        if (this.fenceMode) {
          this.fenceContent += chunk
          const thought = extractThought(this.fenceContent)
          if (thought) out.push({ kind: 'reasoning', value: thought })
          this.fenceContent = ''
        } else if (chunk) {
          out.push({ kind: 'reasoning', value: chunk })
        }
        out.push({ kind: 'reasoning-end' })
        this.inReasoning = false
        this.fenceMode = false
        continue
      }
      if (this.fenceMode) {
        // Hold partial JSON until the close fence (or flush) — never emit
        // half a JSON block into the thinking indicator.
        return out
      }
      const hold = holdLength(this.buf, closes)
      const n = this.buf.length - hold
      if (n > 0) {
        out.push({ kind: 'reasoning', value: this.buf.slice(0, n) })
        this.buf = this.buf.slice(n)
      }
      return out
    }
  }

  flush(): ReasoningSplitEvent[] {
    const out: ReasoningSplitEvent[] = []
    if (this.inReasoning) {
      if (this.fenceMode) {
        const thought = extractThought(this.fenceContent + this.buf)
        if (thought) out.push({ kind: 'reasoning', value: thought })
      } else if (this.buf) {
        out.push({ kind: 'reasoning', value: this.buf })
      }
      this.buf = ''
      this.fenceContent = ''
      out.push({ kind: 'reasoning-end' })
      this.inReasoning = false
      this.fenceMode = false
      return out
    }
    if (this.buf) {
      out.push({ kind: 'text', value: this.buf })
      this.buf = ''
    }
    return out
  }

  reset(): void {
    this.buf = ''
    this.fenceContent = ''
    this.inReasoning = false
    this.fenceMode = false
  }

  get open(): boolean {
    return this.inReasoning
  }
}

// ── Sanitizer ──────────────────────────────────────────────────────────────

/**
 * Protocol tag names that must never reach the user as literal text. Plain
 * HTML/SVG tags (div, span, svg, table, html, ...) are intentionally NOT in
 * this list — only assistant-protocol / tool / prompt-injection tags.
 */
const PROTOCOL_PAIRED_NAMES: readonly string[] = [
  'thinking',
  'think',
  'system_message',
  'context_summary',
  'user_request',
  'implementation_plan',
  'walkthrough',
  'atem:invoke',
  'tool_call',
  'invoke',
  'function_calls',
  'function',
  'parameter',
  'skills_context',
  'system_reminder',
  'system_context',
  'workspace_context',
  'mcp_context',
  'web_context',
  'project_conventions',
  'attached_files',
  'user_query',
  'reasoning_content',
  'thought',
  'analysis',
  'result',
  'response',
  'content_block',
  'instruction',
  'instructions',
  'history',
  'plan',
  'execution_plan',
]

/** Tags stripped but whose inner content is kept (answer scaffolding). */
const PROTOCOL_WRAPPER_ONLY_NAMES: readonly string[] = ['artifact', 'answer']

/** Denylist names reduced to letters, for split-tail prefix matching. */
const TAIL_DENY_LETTERS: readonly string[] = [...PROTOCOL_PAIRED_NAMES, ...PROTOCOL_WRAPPER_ONLY_NAMES].map(
  (n) => n.replace(/[^a-z]/gi, '').toLowerCase()
)

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function stripProtocolTags(prose: string): string {
  let out = prose
  for (const name of PROTOCOL_PAIRED_NAMES) {
    const n = escapeRegExp(name)
    out = out.replace(new RegExp(`<${n}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${n}\\s*>`, 'gi'), '')
  }
  for (const name of PROTOCOL_WRAPPER_ONLY_NAMES) {
    const n = escapeRegExp(name)
    out = out.replace(new RegExp(`<\\/?${n}(?:\\s[^>]*)?\\s*\\/?>`, 'gi'), '')
  }
  // Legacy thinking blocks incl. unclosed-to-end, then stray fragments.
  out = out.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, '')
  out = out.replace(/<thinking>[\s\S]*$/gi, '')
  out = out.replace(/<think>[\s\S]*$/gi, '')
  out = out.replace(/<\/?(?:thinking|think)>/gi, '')
  // Bare protocol tags (with or without attributes / self-close).
  for (const name of [...PROTOCOL_PAIRED_NAMES, ...PROTOCOL_WRAPPER_ONLY_NAMES]) {
    const n = escapeRegExp(name)
    out = out.replace(new RegExp(`<\\/?${n}(?:\\s[^>]*)?\\s*\\/?>`, 'gi'), '')
  }
  // Split-tag tail: a partial protocol tag is the last thing in the string
  // (stream cut mid-tag). The fragment's leading letters must extend a
  // denylist name (min 3 letters), so prose like `a < b` or `<three` stays.
  out = out.replace(/<\/?[a-z][a-z0-9_:.\-]*[^<>]*$/i, (frag) => {
    const inner = (frag.replace(/^<\/?/, '').match(/^[a-z]+/i)?.[0] ?? '').toLowerCase()
    if (inner.length >= 3) {
      const hit = TAIL_DENY_LETTERS.some((name) => name.startsWith(inner) || inner.startsWith(name))
      if (hit) return ''
    }
    return frag
  })
  return out
}

/**
 * Remove every protocol leak from persisted/rendered assistant text while
 * leaving real code fences and HTML/SVG content untouched.
 */
export function sanitizeAssistantText(raw: string): string {
  if (!raw) return ''
  let out = raw
  // 1) Fenced JSON reasoning blocks — closed, then unclosed-to-end.
  out = out.replace(/```(?:json:)?reasoning[^\n]*\n[\s\S]*?```/gi, '')
  out = out.replace(/```(?:json:)?reasoning[\s\S]*$/gi, '')
  // 2) Internal continuation marker (needed by history/compact, not by UI).
  out = out.replace(/<!--\s*TRUNCATED[\s\S]*?-->/gi, '')
  // 3) Protocol tags, but never inside code fences.
  const fenceRe = /```[^\n]*\n[\s\S]*?(?:```|$)/g
  let last = 0
  let result = ''
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(out)) !== null) {
    if (m.index > last) result += stripProtocolTags(out.slice(last, m.index))
    result += m[0]
    last = m.index + m[0].length
  }
  if (last < out.length) result += stripProtocolTags(out.slice(last))
  out = result
  // 4) Normalize whitespace left behind.
  out = out.replace(/\n{3,}/g, '\n\n')
  return out.trim()
}

// ── Recap ──────────────────────────────────────────────────────────────────

export interface RecapTrace {
  tools: Array<{ name: string; args?: Record<string, unknown> }>
  files?: string[]
  model?: string
}

/**
 * Guarantee every persisted answer ends with a `## Recap` section: what was
 * done (real tool calls), files touched, model. The model is separately
 * instructed to write its own richer what/why recap; this fallback only adds
 * facts observed by the runtime — it never invents a "why".
 */
export function ensureRecap(text: string, trace: RecapTrace): string {
  if (/^##\s*recap\b/im.test(text)) return text
  const toolNames = [...new Set(trace.tools.map((t) => t.name).filter(Boolean))].slice(0, 12)
  const files = [...new Set(trace.files ?? [])].filter(Boolean).slice(0, 12)
  const lines = ['## Recap']
  lines.push(`- Did: ${toolNames.length > 0 ? toolNames.join(', ') : 'answered directly (no tools used)'}`)
  lines.push(`- Files: ${files.length > 0 ? files.join(', ') : 'none'}`)
  if (trace.model) lines.push(`- Model: ${trace.model}`)
  return `${text.trimEnd()}\n\n${lines.join('\n')}`
}
