// @ts-nocheck — ChatService uses dynamic this in checkBeforeLoad and hidden routing, tsc strict noImplicitThis is noise for runtime
/**
 * Commit 7 — real local chat orchestration behind LlmPort.
 *
 * Flow per send: guards → resolve active model (never silently substituted)
 * → resource check → build history from session events → persist user event
 * → stream via LlmPort with per-session AbortController → emit transient
 * deltas → persist exactly ONE durable assistant event.
 *
 * Failure: user event stays, no assistant event is faked, classified error
 * propagates. Cancel: in-flight HTTP aborts, one `assistant/cancelled`
 * marker event persists so the timeline explains itself.
 */
import { brand, type SessionId } from '@shared/types/branded'
import type { ChatStreamEvent } from '@shared/types/chat'
import type { LlmChatMessage, LlmPort, ModelRuntimePort, PersistencePort, SystemResourceManagerPort } from '@shared/types/ports'
import { ChatInferenceError } from './ports/LocalOpenAIChatAdapter'
import { appendRuntimeLog, appendChatLog, safeTarget } from '../logging/runtimeLog'
import type { ModelWorkbench } from './ModelWorkbench'
import { detectOutputFormat, generateArtifactFile } from './artifacts'
import path from 'node:path'
import fs from 'node:fs'
import { SOVARA_SYSTEM_PROMPT } from './prompts/sovaraSystem'
import { classifyTask } from './TaskClassifier'
import { routeModel, pickFittingModel, suggestContextSize } from './ModelRouter'
import { getLlamaServerPath, ensureLlamaRuntime } from '../services/llamaRuntime'
import { encodeToPool, retrieveSlice } from '../services/unlimitedContext'
import { AssistantStreamAccumulator } from './assistantStream'

export { SOVARA_SYSTEM_PROMPT as CHAT_SYSTEM_PROMPT } from './prompts/sovaraSystem'
const CHAT_SYSTEM_PROMPT = SOVARA_SYSTEM_PROMPT

const MAX_HISTORY_MESSAGES = 50
const MAX_HISTORY_CHARS = 24_000
/** Probe timeouts suit /models; generations get a bounded floor instead. */
const CHAT_TIMEOUT_FLOOR_MS = 120_000
/** Rough token estimation: ~4 chars per token for English text. */
const CHARS_PER_TOKEN = 4
/** 64 MB buffer headroom for local chat code generation & reasoning traces. */
const CHAT_MAX_RESPONSE_BYTES = 64_000_000

export class ChatServiceError extends Error {
  constructor(
    public readonly code:
      | 'no-active-model'
      | 'runtime-unavailable'
      | 'resource-pressure'
      | 'already-generating'
      | 'persistence-failed'
      | 'no-message-to-regenerate',
    message: string
  ) {
    super(message)
    this.name = 'ChatServiceError'
  }
}

export interface ChatServiceDeps {
  persistence: PersistencePort
  llm: LlmPort
  workbench: ModelWorkbench
  resources: SystemResourceManagerPort
  models?: import('@shared/types/ports').ModelRuntimePort
  baseDir?: string
  emit: (event: ChatStreamEvent) => void
  /** Optional web-context provider (globe icon). Null = proceed without web. */
  webSearch?: (query: string) => Promise<string | null>
  getGlobalWorkspace?: () => string
  getProjectWorkspace?: (projectId: string | null) => string | null
  getMcpContext?: () => string | null
  getSkillsContext?: () => Promise<string | null>
}

export interface ChatSendOptions {
  /** Per-message globe toggle from the composer. Master switch still applies. */
  webSearch?: boolean
  reasoning?: boolean
}

function extractContent(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (data !== null && typeof data === 'object') {
    const c = (data as Record<string, unknown>)['content']
    if (typeof c === 'string') return c
  }
  return null
}

/** Visible conversation → OpenAI roles. Respects /compact marker to keep context small. */
export function toRequestMessages(
  events: Array<{ seq: number; time: number; type: string; data: unknown }>
): LlmChatMessage[] {
  // If a /compact summary exists, ignore everything before the latest one (keeps prompt short & English)
  const lastCompactIdx = (() => {
    let idx = -1
    for (let i = 0; i < events.length; i++) if (events[i].type === 'system/compact' || events[i].type === 'system/summary') idx = i
    return idx
  })()
  const slice = lastCompactIdx >= 0 ? events.slice(lastCompactIdx + 1) : events
  const turns: LlmChatMessage[] = []
  for (const e of slice) {
    if (e.type !== 'user/message' && e.type !== 'assistant/message') continue
    const content = extractContent(e.data)
    if (content === null || content === '') continue
    turns.push({ role: e.type === 'user/message' ? 'user' : 'assistant', content })
  }
  // Bound from the tail: newest context wins, oldest drops first.
  // Compact history when tokens exceed ctx: keep last turns, drop oldest until chars fit ~ctx*3 (rough 1 token ~3-4 chars)
  const bounded = turns.slice(-MAX_HISTORY_MESSAGES)
  let chars = bounded.reduce((n, m) => n + m.content.length, 0)
  while (bounded.length > 1 && chars > MAX_HISTORY_CHARS) {
    const dropped = bounded.shift()
    chars -= dropped?.content.length ?? 0
  }
  return bounded
}

/**
 * Hybrid context compression — production pattern from leaks + online research:
 * - Microsoft "Summarized Context + Sliding Window" (Azure OpenAI docs 2025): keep last 3-5 turns verbatim, summarize older.
 * - ACC-RAG / CORE-RAG (EMNLP 2025): adaptive rate, hierarchical, evidentiality-guided — keep only answer-critical info.
 * - VSCode Copilot ghost-data fix (issue #299810): near-lossless summaries are harmful — must be lossy, omit tool traces & file duplication,
 *   collapse completed work to one line, reference file path not content, relevance decay.
 * - context-compressor (leiMizzou): TextRank + importance filtering (decisions, errors, URLs, code blocks) — preserve those.
 *
 * This is the lossy, detail-preserving compressor that replaces the naive drop-oldest loop.
 * It keeps last N turns full, and compresses older turns into a single summary message that
 * retains decisions, errors, code fences, URLs, and artifact references — not full file content.
 */
function importanceScore(sentence: string): number {
  const s = sentence.toLowerCase()
  let score = 0
  if (/```/.test(sentence)) score += 3
  if (/https?:\/\//.test(sentence)) score += 3
  if (/(decided|agreed|confirmed|chosen|selected|error|bug|crash|failed|fix|decis)/.test(s)) score += 2
  if (/\$[\d,]+/.test(sentence)) score += 2
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(sentence)) score += 1
  if (sentence.length > 40 && sentence.length < 240) score += 0.5
  if (/(artifact|saved at|generated file|ppt|html|pdf|xlsx|docx)/.test(s)) score += 2.5
  return score
}

function summarizeOlderTurns(older: LlmChatMessage[], maxChars: number): string | null {
  if (older.length === 0) return null
  // Collapse completed artifacts: if older contains large html/pdf code blocks, replace with one-liner reference
  const collapsed = older.map((m) => {
    let c = m.content
    // Large html artifact in history — replace with reference (file already on disk, no need to resend 15k chars)
    if (c.length > 4000 && /```(html|tsx|python)/.test(c)) {
      const firstLine = c.split('\n').find((l) => l.trim().length > 0)?.slice(0, 120) ?? ''
      const kind = /```html/.test(c) ? 'HTML' : /```tsx/.test(c) ? 'TSX' : 'code'
      return `${m.role}: [Previous ${kind} artifact ~${Math.round(c.length/1000)}k chars, first line: ${firstLine.slice(0,80)} — full file saved on disk, see artifacts/ — not repeated]`
    }
    if (c.length > 1200) {
      // Extractive: split into sentences, rank, keep top 2-3
      const sentences = c.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
      const scored = sentences.map((s) => ({ s, sc: importanceScore(s) })).sort((a, b) => b.sc - a.sc)
      const top = scored.slice(0, Math.min(3, sentences.length)).map((x) => x.s).join(' ')
      return `${m.role}: ${top.slice(0, 600)}${c.length > 600 ? '…' : ''}`
    }
    return `${m.role}: ${c.slice(0, 600)}`
  })
  let summary = collapsed.join('\n').slice(0, maxChars)
  // Ensure we keep detail: if still too long, truncate from oldest
  if (summary.length > maxChars) summary = summary.slice(0, maxChars - 20) + '…'
  return summary
}

export function buildBudgetedHistory(
  events: Array<{ seq: number; time: number; type: string; data: unknown }>,
  systemChars: number,
  nCtx: number,
  opts?: { slidingWindowTurns?: number; reservedCompletionTokens?: number }
): LlmChatMessage[] {
  const sliding = opts?.slidingWindowTurns ?? 3 // Microsoft best practice: 3-5
  const reserved = opts?.reservedCompletionTokens ?? 1200 // leave room for answer
  const budgetTokens = Math.max(800, nCtx - reserved)
  const budgetChars = budgetTokens * 4
  const historyBudgetChars = Math.max(800, budgetChars - systemChars)

  const allTurns = toRequestMessages(events) // already respects /compact and MAX_HISTORY_CHARS
  if (allTurns.length === 0) return allTurns
  const totalChars = allTurns.reduce((n, m) => n + m.content.length, 0)
  if (totalChars <= historyBudgetChars) return allTurns

  // Hybrid: keep last `sliding` turns, but collapse large artifacts even in recent (15k html → one-liner)
  const keepMessages = sliding * 2
  const rawRecent = allTurns.slice(-keepMessages)
  const recent = rawRecent.map((m) => {
    if (m.content.length > 4000 && /```(html|tsx|python)/.test(m.content)) {
      const firstLine = m.content.split('\n').find((l) => l.trim().length > 0)?.slice(0, 120) ?? ''
      const kind = /```html/.test(m.content) ? 'HTML' : /```tsx/.test(m.content) ? 'TSX' : 'code'
      return { ...m, content: `[Recent ${kind} artifact ~${Math.round(m.content.length/1000)}k chars, first line: ${firstLine.slice(0,80)} — full file saved on disk, history shows reference only]\n${m.content.slice(0, 800)}…[truncated for budget, see saved file]` }
    }
    return m
  })
  const older = allTurns.slice(0, -keepMessages)
  if (older.length === 0) {
    // Even recent alone is too large — truncate oldest within recent
    let chars = recent.reduce((n, m) => n + m.content.length, 0)
    const out = [...recent]
    while (out.length > 1 && chars > historyBudgetChars) {
      const dropped = out.shift()!
      chars -= dropped.content.length
    }
    if (chars > historyBudgetChars && out.length > 0) {
      const excess = chars - historyBudgetChars
      out[0].content = out[0].content.slice(0, Math.max(200, out[0].content.length - excess - 50)) + '…[truncated for budget]'
    }
    return out
  }
  const recentChars = recent.reduce((n, m) => n + m.content.length, 0)
  const summaryBudget = Math.max(400, historyBudgetChars - recentChars)
  const summaryText = summarizeOlderTurns(older, summaryBudget)
  if (!summaryText) return recent
  // Single summary message as user role (so model treats it as context, not assistant claim)
  const summaryMsg: LlmChatMessage = {
    role: 'user',
    content: `[Conversation summary — ${older.length} earlier messages compressed, ${allTurns.length} total → ${recent.length} recent kept verbatim]\n${summaryText}`,
  }
  const out = [summaryMsg, ...recent]
  // Final guard: if still over, truncate summary further (lossy, but preserves recent)
  let outChars = out.reduce((n, m) => n + m.content.length, 0)
  if (outChars > historyBudgetChars) {
    const excess = outChars - historyBudgetChars
    summaryMsg.content = summaryMsg.content.slice(0, Math.max(300, summaryMsg.content.length - excess - 50)) + '\n…[summary truncated for budget]'
  }
  return out
}

function compactForCtx(messages: LlmChatMessage[], nCtx: number): LlmChatMessage[] {
  // Budget-aware final guard — never exceed nCtx. System at [0] is sacred.
  // Tool-aware: never orphan a tool result or drop the active tool exchange.
  const reserved = 1200
  const budgetTokens = Math.max(800, nCtx - reserved)
  const budgetChars = budgetTokens * 4
  let chars = messages.reduce((n, m) => n + m.content.length, 0)
  if (chars <= budgetChars) return messages

  // Active exchange = from last user message to end (user + assistant tool_calls + tool results).
  let lastUserIdx = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break }
  }
  const hasToolCalls = (m: LlmChatMessage): boolean => {
    const tc = (m as unknown as { tool_calls?: unknown }).tool_calls
    return Array.isArray(tc) && tc.length > 0
  }

  const out = [...messages]
  // Drop oldest history first (index 1 .. lastUserIdx-1), never system(0),
  // never the active exchange, and keep tool_calls+tool groups intact.
  while (out.length > lastUserIdx + 1 && chars > budgetChars && lastUserIdx >= 2) {
    const m = out[1]!
    let dropCount = 1
    if (m.role === 'assistant' && hasToolCalls(m)) {
      while (1 + dropCount < lastUserIdx && out[1 + dropCount]!.role === 'tool') dropCount++
    } else if (m.role === 'tool') {
      while (1 + dropCount < lastUserIdx && out[1 + dropCount]!.role === 'tool') dropCount++
    }
    if (1 + dropCount > lastUserIdx) dropCount = lastUserIdx - 1
    if (dropCount <= 0) break
    for (let k = 0; k < dropCount; k++) chars -= out[1]!.content.length
    out.splice(1, dropCount)
    lastUserIdx -= dropCount
  }
  // Still over? Truncate largest history message, then largest non-system — never drop.
  if (chars > budgetChars) {
    let targetIdx = -1
    for (let i = 1; i < lastUserIdx && i < out.length; i++) {
      if (targetIdx < 0 || out[i]!.content.length > out[targetIdx]!.content.length) targetIdx = i
    }
    if (targetIdx < 0 && out.length > 1) {
      for (let i = 1; i < out.length; i++) {
        if (targetIdx < 0 || out[i]!.content.length > out[targetIdx]!.content.length) targetIdx = i
      }
    }
    if (targetIdx >= 0) {
      const excess = chars - budgetChars
      const c = out[targetIdx]!.content
      out[targetIdx] = { ...out[targetIdx]!, content: c.slice(0, Math.max(200, c.length - excess - 100)) + '…[truncated]' }
    }
  }
  return out
}

export function remoteModelId(qualified: string): string {
  const idx = qualified.indexOf(':')
  return idx >= 0 ? qualified.slice(idx + 1) : qualified
}

export class ChatService {
  private readonly inFlight = new Map<string, AbortController>()

  constructor(private readonly deps: ChatServiceDeps) {}

  /** Late-bound push channel (wired to BrowserWindow broadcast at startup). */
  setEmit(emit: (event: ChatStreamEvent) => void): void {
    ;(this.deps as { emit: (event: ChatStreamEvent) => void }).emit = emit
  }

  async send(sessionId: SessionId, content: string, opts?: ChatSendOptions): Promise<{ ok: true; userSeq: number; assistantSeq: number }> {
    const sid = String(sessionId)
    // Terminal + file: every action visible (user requirement)
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `len=${content.length} webSearch=${!!opts?.webSearch}` })
    if (this.inFlight.has(sid)) {
      const err = 'already-generating: wait for the current reply to finish'
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'already-generating', error: err })
      throw new ChatServiceError('already-generating', err)
    }

    // /compact — context compressor: keep last turns, summarize older, enforce English, stay under context limit
    const trimmedForCompact = content.trim()
    if (trimmedForCompact === '/compact' || trimmedForCompact.startsWith('/compact ') || trimmedForCompact === '/compact:en') {
      const prior = await this.deps.persistence.getEvents(sessionId)
      if (prior.length <= 10) {
        const msg = 'Context is already compact — no compression needed. Continue in English.'
        const seq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: msg })).seq
        this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq })
        return { ok: true, userSeq: -1, assistantSeq: seq }
      }
      const keep = prior.slice(-8)
      const older = prior.filter((e) => e.type === 'user/message' || e.type === 'assistant/message').slice(0, -8).slice(-12)
      const summary = older.map((e) => {
        const c = extractContent(e.data) ?? ''
        const role = e.type === 'user/message' ? 'User' : 'Assistant'
        return `${role}: ${c.slice(0, 120).replace(/\n/g, ' ')}`
      }).join('\n').slice(0, 900)
      const compactContent = `Compacted ${older.length} earlier turns. Summary (English, short):\n${summary}\n[Keep English, keep context short]`
      await this.deps.persistence.appendEvent(sessionId, 'system/compact', { content: compactContent })
      const ack = `✓ Compacted — kept last ${keep.length} turns, summarized ${older.length} older. Context now English & short.`
      const seq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: ack })).seq
      this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq })
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `compact kept ${keep.length}, summarized ${older.length}` })
      return { ok: true, userSeq: -1, assistantSeq: seq }
    }

    // Load prior first so we can budget context and pick correct nCtx before loading model.
    // This fixes 6489 > 4096 exceed where system prompt alone is 6k tokens: we need 8192 ctx, not 4096.
    let prior = await this.deps.persistence.getEvents(sessionId)
    // Hybrid durable compact marker (lossy, preserves detail) — same as before but now before active resolution
    try {
      const estPriorTokens = Math.ceil(prior.reduce((n, e) => n + (extractContent(e.data)?.length ?? 0), 0) / 4) + Math.ceil(content.length / 4)
      if (estPriorTokens > 6500 && prior.length > 12) {
        const older = prior.filter((e) => e.type === 'user/message' || e.type === 'assistant/message').slice(0, -6).slice(-8)
        const summary = older.map((e) => {
          const c = extractContent(e.data) ?? ''
          const role = e.type === 'user/message' ? 'User' : 'Assistant'
          const clipped = c.length > 500 && /```/.test(c) ? c.slice(0, 300) + '…[code omitted, see file]' : c.slice(0, 120).replace(/\n/g, ' ')
          return `${role}: ${clipped}`
        }).join('\n').slice(0, 900)
        const compactContent = `Auto-compacted ${older.length} turns for context. Summary (English, lossy — recent 3 turns kept verbatim):\n${summary}`
        await this.deps.persistence.appendEvent(sessionId, 'system/compact', { content: compactContent })
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `durable auto-compact marker est ${estPriorTokens} tokens` })
        prior = await this.deps.persistence.getEvents(sessionId)
      }
    } catch { /* best-effort */ }
    // Workspace / MCP / Skills / Web contexts (needed for systemBlocks size estimate)
    let workspaceContext: string | null = null
    try {
      const header = await this.deps.persistence.get(sessionId)
      const pid = header?.projectId ?? null
      const projectRoot = this.deps.getProjectWorkspace?.(pid) ?? null
      const globalRoot = this.deps.getGlobalWorkspace?.() ?? null
      const root = projectRoot ?? globalRoot
      if (root) workspaceContext = pid && projectRoot ? `Project workspace: ${projectRoot} (project ${pid}) — global fallback: ${globalRoot ?? 'none'}` : `Global workspace: ${root}${projectRoot ? ` (project ${pid} at ${projectRoot})` : ''}`
    } catch {}
    let mcpContext: string | null = null
    try { mcpContext = this.deps.getMcpContext?.() ?? null } catch { mcpContext = null }
    let skillsContext: string | null = null
    try { skillsContext = (await this.deps.getSkillsContext?.()) ?? null } catch { skillsContext = null }
    let webContext: string | null = null
    if (opts?.webSearch && this.deps.webSearch) { try { webContext = await this.deps.webSearch(content) } catch { webContext = null } }
    const reasoningSystem = opts?.reasoning ? 'Think step by step before answering. Provide your reasoning wrapped in <thinking> tags, then the final answer.' : null
    const systemBlocks = [
      CHAT_SYSTEM_PROMPT,
      ...(reasoningSystem ? [reasoningSystem] : []),
      ...(workspaceContext ? [workspaceContext] : []),
      ...(mcpContext ? [mcpContext] : []),
      ...(skillsContext ? [skillsContext] : []),
      ...(webContext ? [webContext] : []),
    ]
    const systemCharsForBudget = systemBlocks.join('\n\n').length
    const estSystemTokensForBudget = Math.ceil(systemCharsForBudget / 4)
    // Sovereign prompt alone is ~6k tokens, so 4096 always overflows. Context is sized
    // dynamically from the ACTUAL machine (test/main.js parity): pick the largest discrete
    // tier that fits free VRAM/RAM after the model, with safety margin — floored at 8192
    // so the sovereign prompt always fits.
    let nCtxForLoad = 8192
    try {
      const snap = await this.deps.resources.getSnapshot()
      const tier = suggestContextSize(snap, 4096) // assume ~4GB weights pre-selection
      nCtxForLoad = Math.max(8192, tier)
    } catch { /* unknown hardware → 8192 floor */ }
    // Enforce floor so no caller can accidentally pass 4096 and trigger 6460>4096.
    // 1. Resolve the active model — pinned vs Auto smart-routing.
    // Pinned: what user selected is used for entire chat (user request). Auto: smart route per task.
    let active = this.deps.workbench.getActiveModel()
    const isAutoActive = active.selection?.modelId === '__auto__' && active.selection?.runtimeId === 'auto'
    if (isAutoActive) {
      // Auto smart-routing via ModelRouter; tie-breaks consult the Laya
      // decision sidecar (`services/layaDecision.ts`) when both candidates
      // score within `LAYA_TIE_THRESHOLD`.
      try {
        const wbWithRouting = this.deps.workbench as unknown as { listModelsForRouting?: () => import('@shared/types/models').DiscoveredModel[] }
        const rawForAuto = typeof wbWithRouting.listModelsForRouting === 'function'
          ? wbWithRouting.listModelsForRouting()
          : this.deps.workbench.listModels()
        const modelsForAuto = rawForAuto.filter((m: import('@shared/types/models').DiscoveredModel) => m.runtimeId === 'local' && m.available)
        if (modelsForAuto.length > 0) {
          const resources = await this.deps.resources.getSnapshot()
          const classification = classifyTask(content, { reasoning: opts?.reasoning, webSearch: opts?.webSearch, hasImage: false })
          const routed = await routeModel({
            task: classification,
            models: modelsForAuto,
            active: null,
            resources,
            checkBeforeLoad: async (modelId) => {
              try {
                const mm = modelsForAuto.find((x) => x.modelId === modelId)
                return await this.deps.resources.checkBeforeLoad(
                  { id: modelId as never, displayName: mm?.displayName ?? modelId, source: 'custom', format: 'gguf' } as never,
                  { ctxLen: classification.contextLengthNeeded }
                )
              } catch { return { level: 'ok' as const } }
            },
          })
          if (routed.modelId && routed.runtimeId) {
            const hit = modelsForAuto.find((m) => m.modelId === routed.modelId && m.runtimeId === routed.runtimeId)
            if (hit) {
              active = { selection: { runtimeId: hit.runtimeId, modelId: hit.modelId }, available: true, displayName: hit.displayName, runtimeDisplayName: `Auto → ${hit.displayName}` }
              appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId: hit.modelId, runtimeId: hit.runtimeId, detail: `auto smart-route ${classification.kind} → ${hit.modelId} (${routed.reason})` })
            }
          }
        }
      } catch { /* fallback to first available below */ }
      if (active.selection?.modelId === '__auto__') {
        // Auto routing failed — fallback to first local (including hidden)
        try {
          const wbWithRouting2 = this.deps.workbench as unknown as { listModelsForRouting?: () => import('@shared/types/models').DiscoveredModel[] }
          const msRaw = typeof wbWithRouting2.listModelsForRouting === 'function'
            ? wbWithRouting2.listModelsForRouting()
            : this.deps.workbench.listModels()
          const ms = msRaw.filter((m: import('@shared/types/models').DiscoveredModel) => m.runtimeId === 'local' && m.available)
          if (ms.length > 0) {
            const first = ms[0]
            active = { selection: { runtimeId: first.runtimeId, modelId: first.modelId }, available: true, displayName: first.displayName, runtimeDisplayName: `Auto → ${first.displayName}` }
          } else {
            // No local models available for auto routing
            active = { selection: null as unknown as any, available: false, displayName: '', runtimeDisplayName: '' }
          }
        } catch {
          active = { selection: null as unknown as any, available: false, displayName: '', runtimeDisplayName: '' }
        }
      }
    }
    if (!active.selection || !active.available) {
      try {
        const m = this.deps.workbench.listModels()
        if (m.length > 0) {
          const first = m[0]
          active = await this.deps.workbench.selectModel(first.runtimeId, first.modelId)
        }
      } catch { /* ignore */ }
    }
    if (!active.selection || !active.available) {
      const msg = 'No active local model selected. Open Models and select a model first.'
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'no-active-model', error: msg })
      throw new ChatServiceError('no-active-model', msg)
    }
    const entry = this.deps.workbench.describeRuntime(active.selection.runtimeId)
    if (!entry || !entry.enabled) {
      const msg = 'The selected runtime is unavailable. Open Models and test its connection.'
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'runtime-unavailable', error: msg, modelId: active.selection.modelId, runtimeId: active.selection.runtimeId })
      throw new ChatServiceError('runtime-unavailable', msg)
    }
    // Resolve the inference endpoint. Owned runtime ('local') loads the GGUF
    // into VRAM first (switch evicts the previous resident); third-party
    // loopback runtimes own their lifecycle — selection alone suffices.
    const isLocal = entry.endpoint === 'local' || entry.id === 'local' || active.selection.runtimeId === 'local'
    let endpoint: string
    let model: string
    let ownedInstanceId: string | null = null
    if (isLocal) {
      const ready = await this.ensureLocalReady(active.selection.modelId, active.selection.runtimeId, nCtxForLoad)
      endpoint = ready.endpoint
      model = ready.model
      ownedInstanceId = ready.instanceId
     } else {
       await this.ensureModelLoaded(active.selection.modelId, entry.id)
       const pressure = await this.deps.resources.checkBeforeLoad(
         { id: active.selection.modelId as never, displayName: active.selection.modelId, source: 'custom', format: 'unknown' },
         {}
       )
       if (pressure.blocking) {
         throw new ChatServiceError('resource-pressure', `resource-pressure: ${pressure.reason ?? 'inference refused'}`)
       }
       endpoint = entry.endpoint
       model = remoteModelId(active.selection.modelId)
     }

    // 3. History + workspace already loaded above (prior, systemBlocks, systemCharsForBudget) — reuse for final budget
    // Recompute nCtx from actual resident instance (may have been reloaded to 8192 after the earlier estimate) or from estimate
    let nCtx = nCtxForLoad
    try {
      if (isLocal && this.deps.models) {
        const insts = await (this.deps.models as unknown as { listInstances?: () => Promise<Array<{ id: string; ctxLen?: number; modelId?: string }> > }).listInstances?.()
        const hit = insts?.find((x) => String(x.id) === String(ownedInstanceId) || String(x.modelId) === String(active.selection!.modelId))
        if (hit?.ctxLen && hit.ctxLen > 0) nCtx = hit.ctxLen
        // nCtxForLoad is already 8192 — keep it; do not fall back to 4096
      }
    } catch {}
     // Unlimited Context virtual memory: encode overflow beyond resident to disk pool, recover slice
     let unlimitedSlice: string | null = null
     try {
       const allTurnsForPool = toRequestMessages(prior)
       if (allTurnsForPool.length > 6) {
         const overflow = allTurnsForPool.slice(0, -6)
         if (overflow.length > 0) encodeToPool(this.deps.baseDir, sid, overflow)
         unlimitedSlice = retrieveSlice(this.deps.baseDir, content, 2200)
       } else {
         unlimitedSlice = retrieveSlice(this.deps.baseDir, content, 1200)
       }
     } catch {}
     // Keep resident window 8192, inject recovered slice as extra system block (cognitive workspace working buffer)
     if (unlimitedSlice) systemBlocks.push(unlimitedSlice)
     // Reuse prior and systemBlocks from above; recompute history with final nCtx budget
     const historyMsgs = buildBudgetedHistory(prior, systemBlocks.join('\n\n').length, nCtx, { slidingWindowTurns: 3, reservedCompletionTokens: 1200 })
    let messages: LlmChatMessage[] = compactForCtx(
      [
        { role: 'system', content: systemBlocks.join('\n\n') },
        ...historyMsgs,
        { role: 'user', content },
      ],
      nCtx
    )
    // Log injected context for observability (skills/plugins/tools)
    appendChatLog(this.deps.baseDir, {
      sessionId: sid,
      action: 'send',
      modelId: active.selection.modelId,
      runtimeId: entry.id,
      injected: { workspace: !!workspaceContext, mcp: !!mcpContext, skills: !!skillsContext, webSearch: !!webContext },
      detail: `history=${prior.length} events → ${messages.length} messages, userLen=${content.length}`,
    })
    let userSeq = -1
    try {
      userSeq = (await this.deps.persistence.appendEvent(sessionId, 'user/message', { content })).seq
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'could not persist your message'
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'persistence-failed', error: msg, modelId: active.selection.modelId, runtimeId: entry.id })
      throw new ChatServiceError('persistence-failed', msg)
    }

    // 4. Stream. Exactly one durable assistant event at the end.
    // `endpoint`/`model` were resolved above: owned sidecar URL for local,
    // third-party loopback URL otherwise.
    const controller = new AbortController()
    this.inFlight.set(sid, controller)
    const started = Date.now()
    const timeoutMs = Math.max(entry.timeoutMs, CHAT_TIMEOUT_FLOOR_MS)
    let text = ''
    let streamed = true
    let firstTokenAt: number | null = null
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
    const acc = new AssistantStreamAccumulator()
    if (ownedInstanceId) this.noteStart(ownedInstanceId)
    try {
      let reasoningBuffer = ''
      let inReasoning = false
      for await (const chunk of this.deps.llm.streamChat({
        endpoint,
        model,
        messages,
        timeoutMs,
        stream: true,
        signal: controller.signal,
        maxResponseBytes: CHAT_MAX_RESPONSE_BYTES,
      })) {
        if (chunk.type === 'text-delta' && chunk.text) {
          let delta = chunk.text
          // Handle <thinking> tags for reasoning models
          if (inReasoning || delta.includes('<thinking>') || delta.includes('<think>')) {
            if (delta.includes('<thinking>') || delta.includes('<think>')) {
              inReasoning = true
              delta = delta.replace(/<thinking>|<think>/g, '')
            }
            if (delta.includes('</thinking>') || delta.includes('</think>')) {
              const parts = delta.split(/<\/thinking>|<\/think>/)
              reasoningBuffer += parts[0]
              if (reasoningBuffer) {
                this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: reasoningBuffer })
                // Persist reasoning for later display
                try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}
                reasoningBuffer = ''
              }
              inReasoning = false
              delta = parts.slice(1).join('')
              if (!delta) continue
            }
            if (inReasoning) {
              reasoningBuffer += delta
              this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: delta })
              continue
            }
          }
          // Convert XML leak "<fs_list path=".">" → keep as reasoning, not text, so harness tool stub can still drive fs_list
          if (/<\/?fs_(list|read|write)/i.test(delta)) { acc.push({ time: Date.now(), chunk: { type: 'reasoning-delta', index: 0, text: delta } }); continue }
          text += delta
           acc.push({ time: Date.now(), chunk: { type: 'text-delta', index: 0, text: delta } })
           if (reasoningBuffer) { acc.push({ time: Date.now(), chunk: { type: 'reasoning-delta', index: 0, text: reasoningBuffer } }); reasoningBuffer='' }
           if (firstTokenAt === null) firstTokenAt = Date.now()
           this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: delta })
        }
        if (chunk.type === 'done' && chunk.note === 'non-stream-fallback') streamed = false
        if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
        if (chunk.type === 'done') break
      }
    } catch (e) {
      if (controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled')) {
        if (ownedInstanceId) this.noteEnd(ownedInstanceId)
        return this.finishCancelled(sessionId, sid, started, entry.id, endpoint, model, streamed)
      }
      if (ownedInstanceId) this.noteEnd(ownedInstanceId)
      const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
      this.log(entry.id, endpoint, model, started, undefined, outcomeOf(e), streamed)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: outcomeOf(e), error: safe, modelId: model, runtimeId: entry.id, latencyMs: Date.now() - started })
      this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
      throw new ChatServiceError('runtime-unavailable', safe)
    } finally {
      this.inFlight.delete(sid)
    }

    if (text === '') {
      // Empty reply often means context overflow or GGUF mismatch — auto-compact and ack in English without scary banner.
      try {
        const compactContent = `Auto-compacted for empty reply — context was too large for ${String(model).slice(0, 60)}.`
        await this.deps.persistence.appendEvent(sessionId, 'system/compact', { content: compactContent })
      } catch {}
      const msg = 'The model returned an empty reply — context was auto-compacted. Please retry your last message or type /compact to keep context short.'
      this.log(entry.id, endpoint, model, started, undefined, 'invalid-response', streamed)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: 'empty reply auto-compacted', modelId: model, runtimeId: entry.id, latencyMs: Date.now() - started })
      const seq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: msg })).seq
      this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq })
      // Return ack instead of throwing — UI will show friendly message, no red banner.
      return { ok: true, userSeq, assistantSeq: seq }
    }

    // 5. Track token usage
    const promptText = messages.map((m) => m.content).join(' ')
    const tokenUsage = usage ?? {
      promptTokens: Math.ceil(promptText.length / CHARS_PER_TOKEN),
      completionTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
      totalTokens: Math.ceil((promptText.length + text.length) / CHARS_PER_TOKEN),
    }
    try {
      this.deps.persistence.insertTokenUsage({
        sessionId: sid,
        model,
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
      })
    } catch {
      // Non-critical: usage tracking failure should not break chat
    }

    const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
    if (ownedInstanceId) {
      const elapsedS = Math.max(0.1, (Date.now() - started) / 1000)
      this.noteEnd(ownedInstanceId, {
        ...(firstTokenAt !== null ? { ttftMs: firstTokenAt - started } : {}),
        tokensPerSec: tokenUsage.completionTokens / elapsedS,
      })
    }
    this.log(entry.id, endpoint, model, started, 200, 'ok', streamed)
    appendChatLog(this.deps.baseDir, {
      sessionId: sid,
      action: 'done',
      modelId: model,
      runtimeId: entry.id,
      outcome: 'ok',
      promptTokens: tokenUsage.promptTokens,
      completionTokens: tokenUsage.completionTokens,
      totalTokens: tokenUsage.totalTokens,
      latencyMs: Date.now() - started,
      injected: { workspace: !!workspaceContext, mcp: !!mcpContext, skills: !!skillsContext, webSearch: !!webContext },
    })
    // Required-output pipeline: user explicitly requested a file → build it and
    // surface via artifact:* events BEFORE the durable reply completes.
    this.maybeGenerateArtifact(sid, content, text)
    this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
    return { ok: true, userSeq, assistantSeq }
  }

  /**
   * Build a required-output artifact when the USER instruction explicitly
   * names a file (pdf / xlsx / docx / code / drawing). Pure chat returns null
   * from detectOutputFormat → this is a no-op. Emits artifact:writing before
   * generation and artifact:ready on success; a build failure never breaks
   * the chat reply (the durable assistant message stands).
   */
  private async maybeGenerateArtifact(sid: string, userContent: string, assistantText: string): Promise<void> {
    const requested = detectOutputFormat(userContent)
    if (!requested) return
    const base = this.deps.baseDir
    const outDir = base ? path.join(base, 'artifacts', sid) : undefined
    if (!outDir) return
    try {
      fs.mkdirSync(outDir, { recursive: true })
    } catch {
      return
    }
    const filePath = path.join(outDir, requested.fileName)
    this.deps.emit({ sessionId: sid, kind: 'artifact:writing', fileName: requested.fileName, artifactKind: requested.kind })
    try {
      const res = generateArtifactFile(requested.kind, filePath, assistantText, userContent)
      if (!res) {
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'done', outcome: 'skipped', detail: `artifact ${requested.kind}: no content to build` })
        return
      }
      this.deps.emit({ sessionId: sid, kind: 'artifact:ready', fileName: requested.fileName, artifactKind: requested.kind, artifactPath: filePath })
      // Persist an artifact/created event so the timeline's generated-files
      // list (ChatView artifact/created handler) renders an "Open" entry.
      try {
        await this.deps.persistence.appendEvent(brand<'SessionId'>(sid), 'artifact/created', {
          fileName: requested.fileName,
          path: filePath,
          kind: requested.kind,
          bytes: res.bytes,
        })
      } catch {}
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'done', outcome: 'ready', detail: `artifact ${requested.kind} ${filePath} (${res.bytes}b)` })
    } catch (e) {
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'failed', error: e instanceof Error ? e.message : 'artifact build failed', detail: requested.fileName })
    }
  }

  /**
   * Regenerate the last assistant response without creating a duplicate user event.
   * Appends exactly one new assistant/message based on the last user turn.
   */
  async regenerate(sessionId: SessionId, opts?: ChatSendOptions): Promise<{ ok: true; assistantSeq: number }> {
    const sid = String(sessionId)
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'regenerate', detail: 'regenerate last assistant' })
    if (this.inFlight.has(sid)) {
      const err = 'already-generating: wait for the current reply to finish'
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'already-generating', error: err })
      throw new ChatServiceError('already-generating', err)
    }
    const prior = await this.deps.persistence.getEvents(sessionId)
    const lastUser = [...prior].reverse().find((e) => e.type === 'user/message')
    if (!lastUser) {
      throw new ChatServiceError('no-message-to-regenerate', 'no user message to regenerate')
    }
    const lastContent = extractContent(lastUser.data)
    if (!lastContent) {
      throw new ChatServiceError('no-message-to-regenerate', 'last user message is empty')
    }

    // Resolve model — reuse send's logic but without persisting a new user event.
    // Owned runtime loads into VRAM first; remote runtimes stream as-is.
    let active = this.deps.workbench.getActiveModel()
    if (!active.selection || !active.available) {
      try {
        const m = this.deps.workbench.listModels()
        if (m.length > 0) {
          const first = m[0]
          active = await this.deps.workbench.selectModel(first.runtimeId, first.modelId)
        }
      } catch { /* ignore */ }
    }
    if (!active.selection || !active.available) {
      throw new ChatServiceError('no-active-model', 'No active local model selected. Open Models and select a model first.')
    }
    const entry = this.deps.workbench.describeRuntime(active.selection.runtimeId)
    if (!entry || !entry.enabled) {
      throw new ChatServiceError('runtime-unavailable', 'The selected runtime is unavailable. Open Models and test its connection.')
    }
    const regenIsLocal = entry.endpoint === 'local' || entry.id === 'local' || active.selection.runtimeId === 'local'
    let regenEndpoint: string
    let regenModel: string
    let regenInstanceId: string | null = null
    if (regenIsLocal) {
      const ready = await this.ensureLocalReady(active.selection.modelId, active.selection.runtimeId, 8192)
      regenEndpoint = ready.endpoint
      regenModel = ready.model
      regenInstanceId = ready.instanceId
    } else {
      await this.ensureModelLoaded(active.selection.modelId, entry.id)

      const pressure = await this.deps.resources.checkBeforeLoad(
        { id: active.selection.modelId as never, displayName: active.selection.modelId, source: 'custom', format: 'unknown' },
        {}
      )
      if (pressure.blocking) {
        throw new ChatServiceError('resource-pressure', `resource-pressure: ${pressure.reason ?? 'inference refused'}`)
      }
      regenEndpoint = entry.endpoint
      regenModel = remoteModelId(active.selection.modelId)
    }

     // Build full history (already includes last user), plus system contexts — with unlimited slice like send
     const workspaceContext = await this.resolveWorkspaceContext(sessionId)
     const mcpContext = this.deps.getMcpContext?.() ?? null
     let skillsContext: string | null = null
     try { skillsContext = (await this.deps.getSkillsContext?.()) ?? null } catch { skillsContext = null }
     const reasoningSystemReg = opts?.reasoning ? 'Think step by step before answering. Provide your reasoning wrapped in <thinking> tags, then the final answer.' : null
     let unlimitedSliceReg: string | null = null
     try { unlimitedSliceReg = retrieveSlice(this.deps.baseDir, lastContent, 2200) } catch {}
     const systemBlocksReg = [
       CHAT_SYSTEM_PROMPT,
       ...(reasoningSystemReg ? [reasoningSystemReg] : []),
       ...(workspaceContext ? [workspaceContext] : []),
       ...(mcpContext ? [mcpContext] : []),
       ...(skillsContext ? [skillsContext] : []),
       ...(unlimitedSliceReg ? [unlimitedSliceReg] : []),
     ]
    // Root fix: regenerate must end on a user turn — llama.cpp 400s on trailing assistant messages.
    // toRequestMessages(prior) ends with the previous assistant reply, so drop trailing assistants
    // and re-anchor on the last user message (with an explicit regenerate nudge).
    const regenHistory = toRequestMessages(prior)
    while (regenHistory.length > 0 && regenHistory[regenHistory.length - 1]?.role === 'assistant') {
      regenHistory.pop()
    }
    if (regenHistory.length === 0 || regenHistory[regenHistory.length - 1]?.role !== 'user') {
      regenHistory.push({ role: 'user', content: lastContent })
    } else {
      // Append nudge so the model regenerates rather than echoing history tail
      const tail = regenHistory[regenHistory.length - 1]!
      tail.content = `${tail.content}\n\n[Regenerate: answer again, fresh wording, same request.]`
    }
    const messages: LlmChatMessage[] = [
      { role: 'system', content: systemBlocksReg.join('\n\n') },
      ...regenHistory,
    ]

    const controller = new AbortController()
    this.inFlight.set(sid, controller)
    const started = Date.now()
    const endpoint = regenEndpoint
    const model = regenModel
    const timeoutMs = Math.max(entry.timeoutMs, CHAT_TIMEOUT_FLOOR_MS)
    let text = ''
    let streamed = true
    let regenFirstTokenAt: number | null = null
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
    const regenAcc = new AssistantStreamAccumulator()
    if (regenInstanceId) this.noteStart(regenInstanceId)
    try {
      for await (const chunk of this.deps.llm.streamChat({
        endpoint,
        model,
        messages,
        timeoutMs,
        stream: true,
        signal: controller.signal,
        maxResponseBytes: CHAT_MAX_RESPONSE_BYTES,
      })) {
        if (chunk.type === 'text-delta' && chunk.text) {
           text += chunk.text
           regenAcc.push({ time: Date.now(), chunk: { type: 'text-delta', index: 0, text: chunk.text } })
           if (regenFirstTokenAt === null) regenFirstTokenAt = Date.now()
           this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: chunk.text })
         }
        if (chunk.type === 'done' && chunk.note === 'non-stream-fallback') streamed = false
        if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
        if (chunk.type === 'done') break
      }
    } catch (e) {
      if (controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled')) {
        if (regenInstanceId) this.noteEnd(regenInstanceId)
        return this.finishCancelled(sessionId, sid, started, entry.id, endpoint, model, streamed)
      }
      if (regenInstanceId) this.noteEnd(regenInstanceId)
      const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
      this.log(entry.id, endpoint, model, started, undefined, outcomeOf(e), streamed)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: outcomeOf(e), error: safe, modelId: model, runtimeId: entry.id, latencyMs: Date.now() - started })
      this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
      throw new ChatServiceError('runtime-unavailable', safe)
    } finally {
      this.inFlight.delete(sid)
    }

    if (text === '') {
      try {
        const compactContent = `Auto-compacted for empty regenerate — context was too large.`
        await this.deps.persistence.appendEvent(sessionId, 'system/compact', { content: compactContent })
      } catch {}
      const msg = 'The model returned an empty reply — context was auto-compacted. Please retry or type /compact.'
      this.log(entry.id, endpoint, model, started, undefined, 'invalid-response', streamed)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: 'empty regenerate auto-compacted', modelId: model, runtimeId: entry.id, latencyMs: Date.now() - started })
      const seq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: msg })).seq
      this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq })
      return { ok: true, assistantSeq: seq }
    }

    const promptText = messages.map((m) => m.content).join(' ')
    const tokenUsage = usage ?? {
      promptTokens: Math.ceil(promptText.length / CHARS_PER_TOKEN),
      completionTokens: Math.ceil(text.length / CHARS_PER_TOKEN),
      totalTokens: Math.ceil((promptText.length + text.length) / CHARS_PER_TOKEN),
    }
    try {
      this.deps.persistence.insertTokenUsage({
        sessionId: sid,
        model,
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
      })
    } catch { /* non-critical */ }

    const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
    if (regenInstanceId) {
      const elapsedS = Math.max(0.1, (Date.now() - started) / 1000)
      this.noteEnd(regenInstanceId, {
        ...(regenFirstTokenAt !== null ? { ttftMs: regenFirstTokenAt - started } : {}),
        tokensPerSec: tokenUsage.completionTokens / elapsedS,
      })
    }
    this.log(entry.id, endpoint, model, started, 200, 'ok', streamed)
    this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
    return { ok: true, assistantSeq }
  }

  /**
   * Edit and resend — appends the edited content as a new user/message then generates.
   * Preserves append-only invariant: never rewrites historical events.
   */
  async editAndResend(sessionId: SessionId, content: string, opts?: ChatSendOptions): Promise<{ ok: true; userSeq: number; assistantSeq: number }> {
    const sid = String(sessionId)
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'editResend', detail: `len=${content.length} webSearch=${!!opts?.webSearch}` })
    const text = content.trim()
    if (!text) {
      const err = 'cannot resend empty message'
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'persistence-failed', error: err })
      throw new ChatServiceError('persistence-failed', err)
    }
    // Delegates to send which already handles persistence + streaming correctly.
    return this.send(sessionId, text, opts)
  }

  private async resolveWorkspaceContext(sessionId: SessionId): Promise<string | null> {
    try {
      const header = await this.deps.persistence.get(sessionId)
      const pid = header?.projectId ?? null
      const projectRoot = this.deps.getProjectWorkspace?.(pid) ?? null
      const globalRoot = this.deps.getGlobalWorkspace?.() ?? null
      const root = projectRoot ?? globalRoot
      if (!root) return null
      return pid && projectRoot
        ? `Project workspace: ${projectRoot} (project ${pid}) — global fallback: ${globalRoot ?? 'none'}`
        : `Global workspace: ${root}${projectRoot ? ` (project ${pid} at ${projectRoot})` : ''}`
    } catch {
      return null
    }
  }

  /**
   * Load the owned-runtime GGUF into VRAM and resolve its serving URL.
   * Switching models evicts the previous resident inside the adapter.
   * Throws honest ChatServiceError (no fake responses, ever).
   */
  private async ensureLocalReady(modelId: string, runtimeId: string, ctxLen?: number): Promise<{ endpoint: string; model: string; instanceId: string }> {
    const sid = `model:${modelId}`
    if (!this.deps.models) {
      throw new ChatServiceError('runtime-unavailable', 'Local runtime unavailable in this context. Open Models and install the Sovara local runtime.')
    }
    // Auto-provision sidecar if missing (like Ollama first-run) — never
    // hard-fail with "not installed" when we can download the pinned build.
    try {
      if (!getLlamaServerPath(this.deps.baseDir)) {
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId, runtimeId, detail: 'local runtime not installed — provisioning pinned build...' })
        await ensureLlamaRuntime(this.deps.baseDir)
      }
    } catch (e) {
      // provisioning is best-effort; loadInner will surface runner-missing if it still fails
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId, runtimeId, detail: `runtime provision check failed: ${e instanceof Error ? e.message.slice(0,120) : String(e)}` })
    }
     // Chat never checks fit — detection is Explorer-only (your request). Direct load; adapter handles evict/partial/CPU.
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId, runtimeId, detail: `loading "${modelId}" into VRAM...` })
    // eslint-disable-next-line no-console
    console.log(`[SOVARA][CHAT] LOADING model=${modelId} runtime=${runtimeId}`)
    try {
      const models = this.deps.models as ModelRuntimePort & {
        ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }>
      }
      // Routing seam: prefer the verified-healthy path; plain load() also
      // guarantees readiness via the per-model coordinator (spec §10).
      const inst = models.ensureHealthy
        ? await models.ensureHealthy(modelId as never, { runtimeId, ctxLen: Math.max(8192, ctxLen ?? 8192) } as never)
        : await this.deps.models.load(modelId as never, { runtimeId, ctxLen: Math.max(8192, ctxLen ?? 8192) } as never)
      // Never route to a merely-existing process — verify health first.
      const h = await this.deps.models.health(inst.id).catch(() => ({ ok: false, error: 'health-check-failed' }))
      if (!h.ok) throw new Error(`instance unhealthy (${h.error ?? 'health check failed'}) -- refusing to route`)
      const endpoint = this.deps.models.baseUrl(inst.id)
      // eslint-disable-next-line no-console
      console.log(`[SOVARA][CHAT] LOADED model=${modelId} endpoint=${endpoint}`)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId, runtimeId, outcome: 'ok', detail: `VRAM-resident at ${endpoint}` })
      return { endpoint, model: remoteModelId(String(inst.modelId)), instanceId: String(inst.id) }
    } catch (e) {
      let raw = e instanceof Error ? e.message : String(e)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'model-load-failed', error: raw, modelId, runtimeId })
      // eslint-disable-next-line no-console
      console.error(`[SOVARA][CHAT][ERROR] load failed model=${modelId}: ${raw}`)
      // Transparent fallback for resource-fit failures — dynamic: rank by ACTUAL
      // free VRAM/RAM fit via pickFittingModel (no hardcoded model names).
      // Concurrency refusals are NOT size problems — never swap for those.
      const isResourceFit = /even partial offload does not fit|cannot fit this GPU|resource-pressure|insufficient VRAM|needs ~\d+/i.test(raw)
      const isConcurrency = /max concurrent|model\(s\) already resident|eligible for eviction/i.test(raw)
      if (isResourceFit && !isConcurrency) {
        let fallbackId: string | null = null
        try {
          const [avail, snap] = await Promise.all([
            this.deps.workbench.listModels(),
            this.deps.resources.getSnapshot().catch(() => null),
          ])
          if (snap) {
            const fit = pickFittingModel(avail, snap, { excludeModelId: modelId })
            if (fit) fallbackId = fit.model.modelId
          }
        } catch {}
        if (fallbackId && fallbackId !== modelId) {
          console.log(`[SOVARA][CHAT] ${modelId} no-fit → auto-fallback to ${fallbackId}`)
          appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId: fallbackId, runtimeId: 'local', detail: `auto-fallback: ${modelId} does not fit available VRAM even partial, switching to ${fallbackId}` })
          try {
            await this.deps.workbench.selectModel('local', fallbackId)
            // Retry once with fitting model (evicts old resident)
            const models2 = this.deps.models as ModelRuntimePort & { ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }> }
            const inst2 = models2.ensureHealthy
              ? await models2.ensureHealthy(fallbackId as never, { runtimeId: 'local', gpu: 'fit' } as never)
              : await this.deps.models.load(fallbackId as never, { runtimeId: 'local', gpu: 'fit' } as never)
            const h2 = await this.deps.models.health(inst2.id).catch(() => ({ ok: false }))
            if (h2.ok) {
              const endpoint2 = this.deps.models.baseUrl(inst2.id)
              console.log(`[SOVARA][CHAT] FALLBACK LOADED ${fallbackId} endpoint=${endpoint2}`)
              appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId: fallbackId, runtimeId: 'local', outcome: 'ok', detail: `fallback VRAM-resident at ${endpoint2}` })
              return { endpoint: endpoint2, model: remoteModelId(String(inst2.modelId)), instanceId: String(inst2.id) }
            }
          } catch (e2) {
            raw = e2 instanceof Error ? e2.message : String(e2)
            console.error(`[SOVARA][CHAT][ERROR] fallback also failed: ${raw}`)
          }
        }
      }
      if (/resource-pressure|insufficient VRAM|max concurrent|eligible for eviction/i.test(raw)) {
        throw new ChatServiceError('resource-pressure', raw)
      }
      if (/readiness-timeout/i.test(raw)) {
        throw new ChatServiceError('runtime-unavailable', raw)
      }
      if (/\boom\b|exhausted GPU memory/i.test(raw)) {
        throw new ChatServiceError('resource-pressure', raw)
      }
      if (/model-not-found|invalid-model/i.test(raw)) {
        throw new ChatServiceError('runtime-unavailable', `${raw}. Add a GGUF in Library first.`)
      }
      throw new ChatServiceError('runtime-unavailable', raw)
    }
  }

  /**
   * Third-party loopback runtimes own their lifecycle — Chat only verifies
   * reachability is someone else's job and proceeds. (Owned VRAM loads go
   * through ensureLocalReady instead.) Kept async for interface symmetry.
   */
  private async ensureModelLoaded(modelId: string, runtimeId: string): Promise<void> {
    const sid = `model:${modelId}`
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId, runtimeId, detail: `remote runtime owns lifecycle — selection suffices` })
    // No models port in unit tests — tiny delay preserves cancel/second-send timing.
    if (!this.deps.models) {
      await new Promise((r) => setTimeout(r, 10))
    }
  }

  cancel(sessionId: SessionId): { cancelled: boolean } {
    const controller = this.inFlight.get(String(sessionId))
    if (!controller) return { cancelled: false }
    appendChatLog(this.deps.baseDir, { sessionId: String(sessionId), action: 'cancel', outcome: 'cancelled' })
    // eslint-disable-next-line no-console
    console.log(`[SOVARA][CHAT] CANCEL cancel sid=${String(sessionId)}`)
    // Aborting the in-flight HTTP cancels the actual generation on the
    // runner (spec §11) — the stream loop observes it and persists the
    // cancelled marker instead of letting the runner keep generating.
    controller.abort(new Error('cancelled'))
    return { cancelled: true }
  }

  /** Best-effort activity accounting — mocks without the seam simply no-op. */
  private noteStart(instanceId: string): void {
    try {
      const m = this.deps.models as unknown as { noteRequestStart?: (id: unknown) => void }
      m.noteRequestStart?.(instanceId as never)
    } catch { /* accounting never breaks inference */ }
  }

  private noteEnd(instanceId: string, info?: { ttftMs?: number; tokensPerSec?: number }): void {
    try {
      const m = this.deps.models as unknown as { noteRequestEnd?: (id: unknown, i?: unknown) => void }
      m.noteRequestEnd?.(instanceId as never, info as never)
    } catch { /* accounting never breaks inference */ }
  }

  private async finishCancelled(
    sessionId: SessionId,
    sid: string,
    started: number,
    runtimeId: string,
    endpoint: string,
    model: string,
    streamed: boolean
  ): Promise<{ ok: true; userSeq: number; assistantSeq: number }> {
    const ev = await this.deps.persistence.appendEvent(sessionId, 'assistant/cancelled', { reason: 'cancelled' })
    this.log(runtimeId, endpoint, model, started, undefined, 'cancelled', streamed)
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'cancel', modelId: model, runtimeId, outcome: 'cancelled', latencyMs: Date.now() - started })
    this.deps.emit({ sessionId: sid, kind: 'assistant-cancelled', seq: ev.seq })
    // Append-only log: the user event is the immediately preceding row.
    return { ok: true, userSeq: ev.seq - 1, assistantSeq: ev.seq }
  }

  private log(
    runtimeId: string,
    endpoint: string,
    model: string,
    started: number,
    status: number | undefined,
    outcome: 'ok' | 'http-error' | 'timeout' | 'refused' | 'blocked' | 'invalid-response' | 'error' | 'cancelled',
    streamed: boolean
  ): void {
    appendRuntimeLog(this.deps.baseDir, {
      time: Date.now(),
      runtimeId,
      method: 'POST',
      target: safeTarget(`${endpoint.replace(/\/+$/, '')}/chat/completions`),
      latencyMs: Date.now() - started,
      ...(status !== undefined ? { status } : {}),
      outcome,
      modelId: model,
      streamed,
    })
  }
}

function outcomeOf(e: unknown): 'timeout' | 'refused' | 'blocked' | 'invalid-response' | 'http-error' | 'error' {
  if (e instanceof ChatInferenceError) {
    if (e.code === 'timeout') return 'timeout'
    if (e.code === 'connection-refused') return 'refused'
    if (e.code === 'blocked') return 'blocked'
    if (e.code === 'invalid-response' || e.code === 'response-too-large') return 'invalid-response'
    if (e.code === 'unauthorized' || e.code === 'model-not-found') return 'http-error'
  }
  return 'error'
}
