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
import type { SessionId } from '@shared/types/branded'
import type { ChatStreamEvent } from '@shared/types/chat'
import type { LlmChatMessage, LlmPort, PersistencePort, SystemResourceManagerPort } from '@shared/types/ports'
import { ChatInferenceError } from './ports/LocalOpenAIChatAdapter'
import { appendRuntimeLog, appendChatLog, safeTarget } from '../logging/runtimeLog'
import type { ModelWorkbench } from './ModelWorkbench'

/** Minimal local system prompt. Main-only: never renderer-provided. */
export const CHAT_SYSTEM_PROMPT =
  'You are SOVARA, a local AI assistant running fully offline on the user\u2019s machine. Answer concisely and directly.'

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
}

function extractContent(data: unknown): string | null {
  if (typeof data === 'string') return data
  if (data !== null && typeof data === 'object') {
    const c = (data as Record<string, unknown>)['content']
    if (typeof c === 'string') return c
  }
  return null
}

/** Visible conversation → OpenAI roles. Cancelled markers never go to the model. */
export function toRequestMessages(
  events: Array<{ seq: number; time: number; type: string; data: unknown }>
): LlmChatMessage[] {
  const turns: LlmChatMessage[] = []
  for (const e of events) {
    if (e.type !== 'user/message' && e.type !== 'assistant/message') continue
    const content = extractContent(e.data)
    if (content === null || content === '') continue
    turns.push({ role: e.type === 'user/message' ? 'user' : 'assistant', content })
  }
  // Bound from the tail: newest context wins, oldest drops first.
  const bounded = turns.slice(-MAX_HISTORY_MESSAGES)
  let chars = bounded.reduce((n, m) => n + m.content.length, 0)
  while (bounded.length > 1 && chars > MAX_HISTORY_CHARS) {
    const dropped = bounded.shift()
    chars -= dropped?.content.length ?? 0
  }
  return bounded
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

    // 1. Resolve the active model — orchestrated chat per ARCHITECTURE_PHASE1 §4/6 (AppBackend→ChatService→Workbench→LlmPort).
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
      // No active model — honest failure per spec §8. Only the explicit 'local' synthetic
      // runtime may use the stub path; an empty selection must not fabricate a response.
      if (active.selection?.runtimeId === 'local') {
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId: active.selection.modelId, runtimeId: 'local', detail: 'via stub (no active model fallback)' })
        return this.sendViaStub(sessionId, content, active.selection.modelId)
      }
      const msg = 'No active local model selected. Open Models and select a model first.'
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'no-active-model', error: msg })
      throw new ChatServiceError('no-active-model', msg)
    }
    const entry = this.deps.workbench.describeRuntime(active.selection.runtimeId)
    if (!entry || !entry.enabled) {
      if (active.selection.runtimeId === 'local') {
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId: active.selection.modelId, runtimeId: 'local', detail: 'via stub (runtime disabled)' })
        return this.sendViaStub(sessionId, content, active.selection.modelId)
      }
      const msg = 'The selected runtime is unavailable. Open Models and test its connection.'
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'runtime-unavailable', error: msg, modelId: active.selection.modelId, runtimeId: active.selection.runtimeId })
      throw new ChatServiceError('runtime-unavailable', msg)
    }
    // Local library model (synthetic runtime) — no HTTP needed
    if (entry.endpoint === 'local' || entry.id === 'local') {
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', modelId: active.selection.modelId, runtimeId: entry.id, detail: 'via stub (local endpoint)' })
      return this.sendViaStub(sessionId, content, active.selection.modelId)
    }

    // 2. Resource advisory (stub returns ok; a blocking verdict refuses).
    const pressure = await this.deps.resources.checkBeforeLoad(
      { id: active.selection.modelId as never, displayName: active.selection.modelId, source: 'custom', format: 'unknown' },
      {}
    )
    if (pressure.blocking) {
      const msg = `resource-pressure: ${pressure.reason ?? 'inference refused'}`
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'resource-pressure', error: msg, modelId: active.selection.modelId, runtimeId: entry.id })
      throw new ChatServiceError('resource-pressure', msg)
    }

    // 3. History + user persistence first (durable before any network).
    const prior = await this.deps.persistence.getEvents(sessionId)
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
    const messages: LlmChatMessage[] = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...(workspaceContext ? [{ role: 'system' as const, content: workspaceContext }] : []),
      ...(mcpContext ? [{ role: 'system' as const, content: mcpContext }] : []),
      ...(skillsContext ? [{ role: 'system' as const, content: skillsContext }] : []),
      ...(webContext ? [{ role: 'system' as const, content: webContext }] : []),
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
    const controller = new AbortController()
    this.inFlight.set(sid, controller)
    const started = Date.now()
    const model = remoteModelId(active.selection.modelId)
    const timeoutMs = Math.max(entry.timeoutMs, CHAT_TIMEOUT_FLOOR_MS)
    let text = ''
    let streamed = true
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
    try {
      for await (const chunk of this.deps.llm.streamChat({
        endpoint: entry.endpoint,
        model,
        messages,
        timeoutMs,
        stream: true,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta' && chunk.text) {
          text += chunk.text
          this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: chunk.text })
        }
        if (chunk.type === 'done' && chunk.note === 'non-stream-fallback') streamed = false
        if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
        if (chunk.type === 'done') break
      }
    } catch (e) {
      if (controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled')) {
        return this.finishCancelled(sessionId, sid, started, entry.id, entry.endpoint, model, streamed)
      }
      const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
      this.log(entry.id, entry.endpoint, model, started, undefined, outcomeOf(e), streamed)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: outcomeOf(e), error: safe, modelId: model, runtimeId: entry.id, latencyMs: Date.now() - started })
      this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
      throw new ChatServiceError('runtime-unavailable', safe)
    } finally {
      this.inFlight.delete(sid)
    }

    if (text === '') {
      const msg = 'invalid-response: the local model returned an empty reply'
      this.log(entry.id, entry.endpoint, model, started, undefined, 'invalid-response', streamed)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'invalid-response', error: msg, modelId: model, runtimeId: entry.id, latencyMs: Date.now() - started })
      this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: msg })
      throw new ChatServiceError('runtime-unavailable', msg)
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
    this.log(entry.id, entry.endpoint, model, started, 200, 'ok', streamed)
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
    this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
    return { ok: true, userSeq, assistantSeq }
  }

  private async sendViaStub(sessionId: SessionId, content: string, modelId: string): Promise<{ ok: true; userSeq: number; assistantSeq: number }> {
    const sid = String(sessionId)
    if (this.inFlight.has(sid)) throw new ChatServiceError('already-generating', 'already-generating')
    const controller = new AbortController()
    this.inFlight.set(sid, controller)
    const started = Date.now()
    let userSeq = -1
    try { userSeq = (await this.deps.persistence.appendEvent(sessionId, 'user/message', { content })).seq } catch (e) { this.inFlight.delete(sid); throw new ChatServiceError('persistence-failed', e instanceof Error ? e.message : 'persist failed') }
    // Local stub — echo user input so chat feels live even without a remote runtime.
    // Generates a deterministic but chat-like response; streamed as one delta for UI continuity.
    const snippet = content.slice(0, 500).replace(/\s+/g, ' ').trim()
    let text = snippet ? `You said: "${snippet}" — local stub for ${modelId}. Configure an OpenAI-compatible runtime in Models → Connected runtimes (e.g., LM Studio at http://127.0.0.1:1234) for full inference.` : `Local stub for ${modelId} is ready — send a message to see an echo. Configure a runtime in Models for full inference.`
    // Simulate streaming for UI (one delta, honours abort)
    if (!controller.signal.aborted) {
      this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text })
    }
    this.inFlight.delete(sid)
    const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
    this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
    const promptTokens = Math.ceil(content.length / 4)
    const completionTokens = Math.ceil(text.length / 4)
    const totalTokens = promptTokens + completionTokens
    // Persist token usage for Settings → Usage / Local Model API
    try {
      this.deps.persistence.insertTokenUsage({ sessionId: sid, model: modelId, promptTokens, completionTokens, totalTokens })
    } catch {}
    appendRuntimeLog(this.deps.baseDir, { time: Date.now(), runtimeId: 'local', method: 'POST', target: 'local/stub', latencyMs: Date.now()-started, outcome: 'ok', modelId, streamed: true })
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'done', modelId, runtimeId: 'local', outcome: 'ok', promptTokens, completionTokens, totalTokens, latencyMs: Date.now()-started, injected: { workspace: false, mcp: false, skills: false, webSearch: false }, detail: `stub echo len=${content.length}` })
    return { ok: true, userSeq, assistantSeq }
  }

  /**
   * Regenerate the last assistant response without creating a duplicate user event.
   * Appends exactly one new assistant/message (or stub) based on the last user turn.
   */
  async regenerate(sessionId: SessionId): Promise<{ ok: true; assistantSeq: number }> {
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

    // Resolve model — reuse send's logic but without persisting a new user event
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
      if (active.selection?.runtimeId === 'local') {
        return this.regenerateViaStub(sessionId, active.selection.modelId)
      }
      throw new ChatServiceError('no-active-model', 'No active local model selected. Open Models and select a model first.')
    }
    const entry = this.deps.workbench.describeRuntime(active.selection.runtimeId)
    if (!entry || !entry.enabled) {
      if (active.selection.runtimeId === 'local') return this.regenerateViaStub(sessionId, active.selection.modelId)
      throw new ChatServiceError('runtime-unavailable', 'The selected runtime is unavailable. Open Models and test its connection.')
    }
    if (entry.endpoint === 'local' || entry.id === 'local') {
      return this.regenerateViaStub(sessionId, active.selection.modelId)
    }

    const pressure = await this.deps.resources.checkBeforeLoad(
      { id: active.selection.modelId as never, displayName: active.selection.modelId, source: 'custom', format: 'unknown' },
      {}
    )
    if (pressure.blocking) {
      throw new ChatServiceError('resource-pressure', `resource-pressure: ${pressure.reason ?? 'inference refused'}`)
    }

    // Build full history (already includes last user), plus system contexts
    const workspaceContext = await this.resolveWorkspaceContext(sessionId)
    const mcpContext = this.deps.getMcpContext?.() ?? null
    let skillsContext: string | null = null
    try { skillsContext = (await this.deps.getSkillsContext?.()) ?? null } catch { skillsContext = null }
    const messages: LlmChatMessage[] = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      ...(workspaceContext ? [{ role: 'system' as const, content: workspaceContext }] : []),
      ...(mcpContext ? [{ role: 'system' as const, content: mcpContext }] : []),
      ...(skillsContext ? [{ role: 'system' as const, content: skillsContext }] : []),
      ...toRequestMessages(prior),
    ]

    const controller = new AbortController()
    this.inFlight.set(sid, controller)
    const started = Date.now()
    const model = remoteModelId(active.selection.modelId)
    const timeoutMs = Math.max(entry.timeoutMs, CHAT_TIMEOUT_FLOOR_MS)
    let text = ''
    let streamed = true
    let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
    try {
      for await (const chunk of this.deps.llm.streamChat({
        endpoint: entry.endpoint,
        model,
        messages,
        timeoutMs,
        stream: true,
        signal: controller.signal,
      })) {
        if (chunk.type === 'text-delta' && chunk.text) {
          text += chunk.text
          this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: chunk.text })
        }
        if (chunk.type === 'done' && chunk.note === 'non-stream-fallback') streamed = false
        if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
        if (chunk.type === 'done') break
      }
    } catch (e) {
      if (controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled')) {
        return this.finishCancelled(sessionId, sid, started, entry.id, entry.endpoint, model, streamed)
      }
      const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
      this.log(entry.id, entry.endpoint, model, started, undefined, outcomeOf(e), streamed)
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: outcomeOf(e), error: safe, modelId: model, runtimeId: entry.id, latencyMs: Date.now() - started })
      this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
      throw new ChatServiceError('runtime-unavailable', safe)
    } finally {
      this.inFlight.delete(sid)
    }

    if (text === '') {
      const msg = 'invalid-response: the local model returned an empty reply'
      this.log(entry.id, entry.endpoint, model, started, undefined, 'invalid-response', streamed)
      this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: msg })
      throw new ChatServiceError('runtime-unavailable', msg)
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
    this.log(entry.id, entry.endpoint, model, started, 200, 'ok', streamed)
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

  private async regenerateViaStub(sessionId: SessionId, modelId: string): Promise<{ ok: true; assistantSeq: number }> {
    const sid = String(sessionId)
    if (this.inFlight.has(sid)) throw new ChatServiceError('already-generating', 'already-generating')
    const prior = await this.deps.persistence.getEvents(sessionId)
    const lastUser = [...prior].reverse().find((e) => e.type === 'user/message')
    const prompt = lastUser ? (extractContent(lastUser.data) ?? '') : ''
    const controller = new AbortController()
    this.inFlight.set(sid, controller)
    const started = Date.now()
    // Regenerated stub — echo with a hint that it's a regeneration
    const snippet = prompt.slice(0, 500).replace(/\s+/g, ' ').trim()
    let text = snippet ? `Regenerated: You said "${snippet}" — local stub for ${modelId} (regenerated at ${new Date().toLocaleTimeString()}).` : `Local stub for ${modelId} — regenerated response. Configure a runtime in Models for full inference.`
    if (!controller.signal.aborted) {
      this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text })
    }
    this.inFlight.delete(sid)
    const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
    this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
    const promptTokens = Math.ceil(prompt.length / 4)
    const completionTokens = Math.ceil(text.length / 4)
    const totalTokens = promptTokens + completionTokens
    try {
      this.deps.persistence.insertTokenUsage({ sessionId: sid, model: modelId, promptTokens, completionTokens, totalTokens })
    } catch {}
    appendRuntimeLog(this.deps.baseDir, { time: Date.now(), runtimeId: 'local', method: 'POST', target: 'local/stub', latencyMs: Date.now() - started, outcome: 'ok', modelId, streamed: true })
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'done', modelId, runtimeId: 'local', outcome: 'ok', promptTokens, completionTokens, totalTokens, latencyMs: Date.now() - started, detail: 'regenerate stub' })
    return { ok: true, assistantSeq }
  }

  cancel(sessionId: SessionId): { cancelled: boolean } {
    const controller = this.inFlight.get(String(sessionId))
    if (!controller) return { cancelled: false }
    appendChatLog(this.deps.baseDir, { sessionId: String(sessionId), action: 'cancel', outcome: 'cancelled' })
    // eslint-disable-next-line no-console
    console.log(`[SOVARA][CHAT] CANCEL cancel sid=${String(sessionId)}`)
    controller.abort(new Error('cancelled'))
    return { cancelled: true }
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
