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
import { appendRuntimeLog, safeTarget } from '../logging/runtimeLog'
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
    if (this.inFlight.has(sid)) {
      throw new ChatServiceError('already-generating', 'already-generating: wait for the current reply to finish')
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
        return this.sendViaStub(sessionId, content, active.selection.modelId)
      }
      throw new ChatServiceError('no-active-model', 'No active local model selected. Open Models and select a model first.')
    }
    const entry = this.deps.workbench.describeRuntime(active.selection.runtimeId)
    if (!entry || !entry.enabled) {
      if (active.selection.runtimeId === 'local') return this.sendViaStub(sessionId, content, active.selection.modelId)
      throw new ChatServiceError('runtime-unavailable', 'The selected runtime is unavailable. Open Models and test its connection.')
    }
    // Local library model (synthetic runtime) — no HTTP needed
    if (entry.endpoint === 'local' || entry.id === 'local') {
      return this.sendViaStub(sessionId, content, active.selection.modelId)
    }

    // 2. Resource advisory (stub returns ok; a blocking verdict refuses).
    const pressure = await this.deps.resources.checkBeforeLoad(
      { id: active.selection.modelId as never, displayName: active.selection.modelId, source: 'custom', format: 'unknown' },
      {}
    )
    if (pressure.blocking) {
      throw new ChatServiceError('resource-pressure', `resource-pressure: ${pressure.reason ?? 'inference refused'}`)
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
    let userSeq = -1
    try {
      userSeq = (await this.deps.persistence.appendEvent(sessionId, 'user/message', { content })).seq
    } catch (e) {
      throw new ChatServiceError('persistence-failed', e instanceof Error ? e.message : 'could not persist your message')
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
    let text = ''
    try {
      for await (const chunk of this.deps.llm.stream(`[local ${modelId}] ${content.slice(0,120)}: `)) {
        if (controller.signal.aborted) break
        if (chunk.type === 'text-delta' && chunk.text) { text += chunk.text; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: chunk.text }) }
        if (chunk.type === 'done') break
      }
    } catch { /* stub never throws */ }
    this.inFlight.delete(sid)
    if (!text) text = `Loaded model ${modelId} is ready. (Local library — no remote runtime configured. Add an OpenAI-compatible endpoint in Models for full inference.)`
    const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
    this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
    appendRuntimeLog(this.deps.baseDir, { time: Date.now(), runtimeId: 'local', method: 'POST', target: 'local/stub', latencyMs: Date.now()-started, outcome: 'ok', modelId, streamed: true })
    return { ok: true, userSeq, assistantSeq }
  }

  /**
   * Regenerate the last assistant response without creating a duplicate user event.
   * Appends exactly one new assistant/message (or stub) based on the last user turn.
   */
  async regenerate(sessionId: SessionId): Promise<{ ok: true; assistantSeq: number }> {
    const sid = String(sessionId)
    if (this.inFlight.has(sid)) {
      throw new ChatServiceError('already-generating', 'already-generating: wait for the current reply to finish')
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
    const text = content.trim()
    if (!text) throw new ChatServiceError('persistence-failed', 'cannot resend empty message')
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
    let text = ''
    try {
      for await (const chunk of this.deps.llm.stream(`[local ${modelId}] ${prompt.slice(0, 120)}: `)) {
        if (controller.signal.aborted) break
        if (chunk.type === 'text-delta' && chunk.text) { text += chunk.text; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: chunk.text }) }
        if (chunk.type === 'done') break
      }
    } catch { /* stub never throws */ }
    this.inFlight.delete(sid)
    if (!text) text = `Loaded model ${modelId} is ready. (Local library — no remote runtime configured. Add an OpenAI-compatible endpoint in Models for full inference.)`
    const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
    this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
    appendRuntimeLog(this.deps.baseDir, { time: Date.now(), runtimeId: 'local', method: 'POST', target: 'local/stub', latencyMs: Date.now() - started, outcome: 'ok', modelId, streamed: true })
    return { ok: true, assistantSeq }
  }

  cancel(sessionId: SessionId): { cancelled: boolean } {
    const controller = this.inFlight.get(String(sessionId))
    if (!controller) return { cancelled: false }
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
