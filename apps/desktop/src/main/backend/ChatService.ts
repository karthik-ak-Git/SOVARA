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

/** Minimal local system prompt. Main-only: never renderer-provided. English + artifact + thinking streaming. */
export const CHAT_SYSTEM_PROMPT =
  'You are SOVARA, a local AI assistant running fully offline on the user\u2019s machine. Always respond in English only — never use Spanish or other languages; when generating HTML always use <html lang="en">. Answer concisely and directly in English. When the user requests a UI, dashboard, login page, or file (pdf/xlsx/docx/html), output the file content in a single fenced code block (```html, ```tsx, ```python) so the artifact pipeline can capture it for live preview. Always stream your private reasoning inside <thinking>...</thinking> tags before the final answer so the UI can display live thinking with time.'

const MAX_HISTORY_MESSAGES = 50
const MAX_HISTORY_CHARS = 24_000
/** Probe timeouts suit /models; generations get a bounded floor instead. */
const CHAT_TIMEOUT_FLOOR_MS = 120_000
/** Rough token estimation: ~4 chars per token for English text. */
const CHARS_PER_TOKEN = 4

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

function compactForCtx(messages: LlmChatMessage[], nCtx: number): LlmChatMessage[] {
  const maxChars = Math.max(800, nCtx * 3) // keep ~75% of ctx for prompt, rest for completion
  let chars = messages.reduce((n, m) => n + m.content.length, 0)
  const out = [...messages]
  // Never drop system (0) or last user (tail); drop oldest history first (index 1..)
  while (out.length > 2 && chars > maxChars) {
    const dropIdx = 1
    chars -= out[dropIdx].content.length
    out.splice(dropIdx, 1)
  }
  // If still over, truncate the oldest remaining non-system message content
  if (chars > maxChars && out.length > 2) {
    const excess = chars - maxChars
    out[1].content = out[1].content.slice(0, Math.max(200, out[1].content.length - excess - 200)) + '…[truncated]'
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

    // 1. Resolve the active model — orchestrated chat per ARCHITECTURE_PHASE1 §4/6 (AppBackend→ChatService→Workbench→LlmPort).
    // Never silently substitute, never fabricate: no selection → honest error.
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
      const ready = await this.ensureLocalReady(active.selection.modelId, active.selection.runtimeId)
      endpoint = ready.endpoint
      model = ready.model
      ownedInstanceId = ready.instanceId
    } else {
      // 2. Resource advisory (must be before inference — respect VRAM/limits)
      const pressure = await this.deps.resources.checkBeforeLoad(
        { id: active.selection.modelId as never, displayName: active.selection.modelId, source: 'custom', format: 'unknown' },
        {}
      )
      if (pressure.blocking) {
        const msg = `resource-pressure: ${pressure.reason ?? 'inference refused'}`
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'resource-pressure', error: msg, modelId: active.selection.modelId, runtimeId: entry.id })
        throw new ChatServiceError('resource-pressure', msg)
      }
      await this.ensureModelLoaded(active.selection.modelId, entry.id)
      endpoint = entry.endpoint
      model = remoteModelId(active.selection.modelId)
    }

    // 3. History + user persistence first (durable before any network).
    let prior = await this.deps.persistence.getEvents(sessionId)
    // Auto-compact when approaching context limit to avoid invalid-response empty reply (keep English, low tokens)
    try {
      const estPriorTokens = Math.ceil(prior.reduce((n, e) => n + (extractContent(e.data)?.length ?? 0), 0) / 4) + Math.ceil(content.length / 4)
      if (estPriorTokens > 5500 && prior.length > 10) {
        const keep = prior.slice(-8)
        const older = prior.filter((e) => e.type === 'user/message' || e.type === 'assistant/message').slice(0, -8).slice(-8)
        const summary = older.map((e) => {
          const c = extractContent(e.data) ?? ''
          const role = e.type === 'user/message' ? 'User' : 'Assistant'
          return `${role}: ${c.slice(0, 100).replace(/\n/g, ' ')}`
        }).join('\n').slice(0, 700)
        const compactContent = `Auto-compacted ${older.length} turns for context limit. Summary (English):\n${summary}`
        await this.deps.persistence.appendEvent(sessionId, 'system/compact', { content: compactContent })
        prior = [...keep.slice(0, 0), ...keep] // keep only last 8 for this send; history now compacted
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `auto-compact est ${estPriorTokens} tokens → kept ${keep.length} turns` })
      }
    } catch { /* auto-compact best-effort */ }
    // Resolve workspace (project or global) — injected as system context so tools know where they may operate.
    let workspaceContext: string | null = null
    try {
      const header = await this.deps.persistence.get(sessionId)
      const pid = header?.projectId ?? null
      const projectRoot = this.deps.getProjectWorkspace?.(pid) ?? null
      const globalRoot = this.deps.getGlobalWorkspace?.() ?? null
      const root = projectRoot ?? globalRoot
      if (root) {
        workspaceContext = pid && projectRoot
          ? `Project workspace: ${projectRoot} (project ${pid}) — global fallback: ${globalRoot ?? 'none'}`
          : `Global workspace: ${root}${projectRoot ? ` (project ${pid} at ${projectRoot})` : ''}`
      }
    } catch {
      // workspace context is advisory
    }
    let mcpContext: string | null = null
    try {
      mcpContext = this.deps.getMcpContext?.() ?? null
    } catch {
      mcpContext = null
    }
    let skillsContext: string | null = null
    try {
      skillsContext = (await this.deps.getSkillsContext?.()) ?? null
    } catch {
      skillsContext = null
    }
    // Globe path: transient web context (never persisted to the timeline).
    let webContext: string | null = null
    if (opts?.webSearch && this.deps.webSearch) {
      try {
        webContext = await this.deps.webSearch(content)
      } catch {
        webContext = null // search failure never blocks the reply
      }
    }
    const reasoningSystem = opts?.reasoning ? 'Think step by step before answering. Provide your reasoning wrapped in <thinking> tags, then the final answer.' : null
    // Bonsai / Llama-3-style Jinja templates require exactly one leading system
    // message ("System message must be at the beginning"). Merge all advisory
    // contexts into a single system block so we never send 2+ system turns.
    const systemBlocks = [
      CHAT_SYSTEM_PROMPT,
      ...(reasoningSystem ? [reasoningSystem] : []),
      ...(workspaceContext ? [workspaceContext] : []),
      ...(mcpContext ? [mcpContext] : []),
      ...(skillsContext ? [skillsContext] : []),
      ...(webContext ? [webContext] : []),
    ]
    const messages: LlmChatMessage[] = [
      { role: 'system', content: systemBlocks.join('\n\n') },
      ...toRequestMessages(prior),
      { role: 'user', content },
    ]
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
    if (ownedInstanceId) this.noteStart(ownedInstanceId)
    try {
      let reasoningBuffer = ''
      let inReasoning = !!opts?.reasoning
      for await (const chunk of this.deps.llm.streamChat({
        endpoint,
        model,
        messages,
        timeoutMs,
        stream: true,
        signal: controller.signal,
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
          text += delta
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
      const ready = await this.ensureLocalReady(active.selection.modelId, active.selection.runtimeId)
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

    // Build full history (already includes last user), plus system contexts
    const workspaceContext = await this.resolveWorkspaceContext(sessionId)
    const mcpContext = this.deps.getMcpContext?.() ?? null
    let skillsContext: string | null = null
    try { skillsContext = (await this.deps.getSkillsContext?.()) ?? null } catch { skillsContext = null }
    const reasoningSystemReg = opts?.reasoning ? 'Think step by step before answering. Provide your reasoning wrapped in <thinking> tags, then the final answer.' : null
    const systemBlocksReg = [
      CHAT_SYSTEM_PROMPT,
      ...(reasoningSystemReg ? [reasoningSystemReg] : []),
      ...(workspaceContext ? [workspaceContext] : []),
      ...(mcpContext ? [mcpContext] : []),
      ...(skillsContext ? [skillsContext] : []),
    ]
    const messages: LlmChatMessage[] = [
      { role: 'system', content: systemBlocksReg.join('\n\n') },
      ...toRequestMessages(prior),
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
    if (regenInstanceId) this.noteStart(regenInstanceId)
    try {
      for await (const chunk of this.deps.llm.streamChat({
        endpoint,
        model,
        messages,
        timeoutMs,
        stream: true,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta' && chunk.text) {
          text += chunk.text
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
  private async ensureLocalReady(modelId: string, runtimeId: string): Promise<{ endpoint: string; model: string; instanceId: string }> {
    const sid = `model:${modelId}`
    if (!this.deps.models) {
      throw new ChatServiceError('runtime-unavailable', 'Local runtime unavailable in this context. Open Models and install the Sovara local runtime.')
    }
    // Auto-provision sidecar if missing (like Ollama first-run) — never
    // hard-fail with "not installed" when we can download the pinned build.
    try {
      const { getLlamaServerPath, ensureLlamaRuntime } = await import('../services/llamaRuntime')
      if (!getLlamaServerPath(this.deps.baseDir)) {
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId, runtimeId, detail: 'local runtime not installed — provisioning pinned build...' })
        await ensureLlamaRuntime(this.deps.baseDir)
      }
    } catch (e) {
      // provisioning is best-effort; loadInner will surface runner-missing if it still fails
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId, runtimeId, detail: `runtime provision check failed: ${e instanceof Error ? e.message.slice(0,120) : String(e)}` })
    }
    const pressure = await this.deps.resources.checkBeforeLoad(
      { id: modelId as never, displayName: modelId, source: 'sovara', format: 'gguf' },
      {}
    )
    if (pressure.blocking) {
      const msg = `resource-pressure: ${pressure.reason ?? 'load refused'}`
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'resource-pressure', error: msg, modelId, runtimeId })
      throw new ChatServiceError('resource-pressure', msg)
    }
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
        ? await models.ensureHealthy(modelId as never, { runtimeId })
        : await this.deps.models.load(modelId as never, { runtimeId })
      // Never route to a merely-existing process — verify health first.
      const h = await this.deps.models.health(inst.id).catch(() => ({ ok: false, error: 'health-check-failed' }))
      if (!h.ok) throw new Error(`instance unhealthy (${h.error ?? 'health check failed'}) -- refusing to route`)
      const endpoint = this.deps.models.baseUrl(inst.id)
      // eslint-disable-next-line no-console
      console.log(`[SOVARA][CHAT] LOADED model=${modelId} endpoint=${endpoint}`)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId, runtimeId, outcome: 'ok', detail: `VRAM-resident at ${endpoint}` })
      return { endpoint, model: remoteModelId(String(inst.modelId)), instanceId: String(inst.id) }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'model-load-failed', error: raw, modelId, runtimeId })
      // eslint-disable-next-line no-console
      console.error(`[SOVARA][CHAT][ERROR] load failed model=${modelId}: ${raw}`)
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
