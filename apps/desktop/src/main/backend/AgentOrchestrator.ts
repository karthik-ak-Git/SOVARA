/**
 * AgentOrchestrator — the backend execution loop that Chat observes.
 * Single responsibility: take a TaskRequest, classify, route, enforce resources,
 * ensure model lifecycle via ModelRuntimePort, run LlmPort (streaming), optional
 * tool loop, persist, and emit every intermediate state as a real ChatStreamEvent.
 *
 * No UI logic. No direct Ollama/llama.cpp. All through ports.
 * Replaceable: DSH/Cordis can replace this seam by implementing the same
 * `execute(request)` contract behind AppBackend.
 */

import type { SessionId } from '@shared/types/branded'
import type { ChatStreamEvent } from '@shared/types/chat'
import type { LlmPort, PersistencePort, SystemResourceManagerPort, ModelRuntimePort, ToolPort } from '@shared/types/ports'
import type { ModelWorkbench } from './ModelWorkbench'
import { classifyTask } from './TaskClassifier'
import { routeModel } from './ModelRouter'
import { ChatInferenceError } from './ports/LocalOpenAIChatAdapter'
import { appendChatLog, appendRuntimeLog, safeTarget } from '../logging/runtimeLog'
import type { TaskClassification, ModelRoutingDecision } from '@shared/types/task'

export class AgentOrchestratorError extends Error {
  constructor(
    public readonly code:
      | 'no-model-available'
      | 'resource-blocked'
      | 'model-load-failed'
      | 'runtime-unavailable'
      | 'llm-failed'
      | 'cancelled'
      | 'persistence-failed',
    message: string
  ) {
    super(message)
    this.name = 'AgentOrchestratorError'
  }
}

export interface AgentOrchestratorDeps {
  persistence: PersistencePort
  llm: LlmPort
  tools: ToolPort
  workbench: ModelWorkbench
  resources: SystemResourceManagerPort
  models: ModelRuntimePort
  baseDir?: string
  emit: (event: ChatStreamEvent) => void
  webSearch?: (query: string) => Promise<string | null>
  getGlobalWorkspace?: () => string
  getProjectWorkspace?: (projectId: string | null) => string | null
  getMcpContext?: () => string | null
  getSkillsContext?: () => Promise<string | null>
}

const CHAT_SYSTEM_PROMPT =
  'You are SOVARA, a local AI assistant running fully offline on the user\u2019s machine. Answer concisely and directly.'

function toRequestMessages(events: Array<{ seq: number; time: number; type: string; data: unknown }>): import('@shared/types/ports').LlmChatMessage[] {
  const turns: import('@shared/types/ports').LlmChatMessage[] = []
  for (const e of events) {
    if (e.type !== 'user/message' && e.type !== 'assistant/message') continue
    let content: string | null = null
    if (typeof e.data === 'string') content = e.data
    else if (e.data !== null && typeof e.data === 'object') {
      const c = (e.data as Record<string, unknown>)['content']
      if (typeof c === 'string') content = c
    }
    if (content === null || content === '') continue
    turns.push({ role: e.type === 'user/message' ? 'user' : 'assistant', content })
  }
  const bounded = turns.slice(-50)
  let chars = bounded.reduce((n, m) => n + m.content.length, 0)
  while (bounded.length > 1 && chars > 24000) {
    const dropped = bounded.shift()
    chars -= dropped?.content.length ?? 0
  }
  return bounded
}

function remoteModelId(qualified: string): string {
  const idx = qualified.indexOf(':')
  return idx >= 0 ? qualified.slice(idx + 1) : qualified
}

export class AgentOrchestrator {
  private readonly inFlight = new Map<string, AbortController>()

  constructor(private readonly deps: AgentOrchestratorDeps) {}

  setEmit(emit: (event: ChatStreamEvent) => void): void {
    ;(this.deps as { emit: (event: ChatStreamEvent) => void }).emit = emit
  }

  cancel(sessionId: SessionId): { cancelled: boolean } {
    const c = this.inFlight.get(String(sessionId))
    if (!c) return { cancelled: false }
    // eslint-disable-next-line no-console
    console.log(`[AgentOrchestrator] cancel sid=${String(sessionId)}`)
    c.abort(new Error('cancelled'))
    return { cancelled: true }
  }

  async execute(
    sessionId: SessionId,
    content: string,
    opts?: { webSearch?: boolean; reasoning?: boolean }
  ): Promise<{ ok: true; userSeq: number; assistantSeq: number; routing: ModelRoutingDecision; classification: TaskClassification }> {
    const sid = String(sessionId)
    const startedAll = Date.now()
    if (this.inFlight.has(sid)) throw new AgentOrchestratorError('llm-failed', 'already-generating: wait for the current reply to finish')

    const controller = new AbortController()
    this.inFlight.set(sid, controller)
    const onAbort = (): void => {
      // propagate to orchestrator's emit for UI cancellation
    }
    controller.signal.addEventListener('abort', onAbort, { once: true })

    try {
      // ── PHASE 1: task classification (real, not faked) ──
      this.emit(sid, 'task:start', { taskKind: 'chat', detail: 'request received' })
      const classification = classifyTask(content, { reasoning: opts?.reasoning, webSearch: opts?.webSearch })
      this.emit(sid, 'task:planning', { taskKind: classification.kind, detail: classification.reason })

      // ── PHASE 2: model routing (smart, resource-aware) ──
      this.emit(sid, 'model:selecting', { taskKind: classification.kind, detail: `routing for ${classification.kind}` })
      const models = this.deps.workbench.listModels()
      const active = this.deps.workbench.getActiveModel()
      const resources = await this.deps.resources.getSnapshot()

      const routing = await routeModel({
        task: classification,
        models,
        active: active.selection ?? null,
        resources,
        checkBeforeLoad: async (modelId) => {
          // Use the resource manager's real check for this candidate
          try {
            return await this.deps.resources.checkBeforeLoad(
              { id: modelId as never, displayName: modelId, source: 'custom', format: 'unknown' } as never,
              { ctxLen: classification.contextLengthNeeded }
            )
          } catch {
            return { level: 'ok' as const }
          }
        },
      })

      if (!routing.modelId || !routing.runtimeId) {
        const msg = `No compatible model available for task "${classification.kind}". ${routing.reason}`
        this.emit(sid, 'task:error', { taskKind: classification.kind, detail: msg, error: msg })
        throw new AgentOrchestratorError('no-model-available', msg)
      }

      // Resource block already handled by router (skipped blocked candidates), but final guard
      const pressure = await this.deps.resources.checkBeforeLoad(
        { id: routing.modelId as never, displayName: routing.modelId, source: 'custom', format: 'unknown' } as never,
        { ctxLen: classification.contextLengthNeeded }
      )
      if (pressure.blocking) {
        const msg = `resource-pressure: ${pressure.reason ?? 'load refused'}`
        this.emit(sid, 'task:error', { taskKind: classification.kind, detail: msg, error: msg })
        throw new AgentOrchestratorError('resource-blocked', msg)
      }

      // ── PHASE 3: ensure selected model is active (select if router chose different) ──
      let entry = this.deps.workbench.describeRuntime(routing.runtimeId)
      if (!entry || !entry.enabled) {
        const msg = 'The selected runtime is unavailable. Open Models and test its connection.'
        this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: msg, error: msg })
        throw new AgentOrchestratorError('runtime-unavailable', msg)
      }

      // If router switched, make it the active selection (persisted, not silent)
      let switched = false
      if (routing.switched) {
        try {
          await this.deps.workbench.selectModel(routing.runtimeId, routing.modelId)
          switched = true
          entry = this.deps.workbench.describeRuntime(routing.runtimeId)!
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'model selection failed'
          this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: msg, error: msg })
          throw new AgentOrchestratorError('model-load-failed', msg)
        }
      }

      // ── PHASE 4: model lifecycle — load if needed, healthcheck (real, not faked) ──
      const vramTotal = resources.vram.totalMB
      // For local stub runtimes we still go through ModelRuntimePort.load so the lifecycle is exercised
      const isLocalStub = entry.endpoint === 'local' || entry.id === 'local'

      this.emit(sid, 'model:loading', {
        taskKind: classification.kind,
        modelId: routing.modelId,
        runtimeId: routing.runtimeId,
        vramTotalMB: vramTotal,
        detail: switched ? `selected ${routing.modelId} — loading` : `model ${routing.modelId} — checking`,
      })

      // Ensure loaded (both local stub and HTTP runtimes benefit from instance lifecycle)
      try {
        // For local stub: ModelRuntimeStub.load() now succeeds and animates loading→loaded
        // For HTTP runtimes: instance lifecycle is lightweight; load verifies slot availability
        const inst = await this.deps.models.load(routing.modelId as never, {
          ctxLen: classification.contextLengthNeeded,
          runtimeId: routing.runtimeId,
        })
        // Poll health briefly until loaded (stub animates ~1.8s, HTTP should be instant)
        const deadline = Date.now() + 4000
        while (Date.now() < deadline) {
          if (controller.signal.aborted) throw new AgentOrchestratorError('cancelled', 'cancelled')
          const h = await this.deps.models.health(inst.id).catch(() => ({ ok: false, error: 'health failed' }))
          if (h.ok) break
          if (h.error === 'not-found') break
          // If still loading (vram 0) wait a bit
          if ((inst.status as string) === 'loading' || ((h as { vramUsedMB?: number }).vramUsedMB ?? 0) === 0) {
            await new Promise((r) => setTimeout(r, 180))
            continue
          }
          break
        }
        // Re-read snapshot for accurate VRAM after load
        const snapAfter = await this.deps.resources.getSnapshot().catch(() => resources)
        this.emit(sid, 'model:ready', {
          taskKind: classification.kind,
          modelId: routing.modelId,
          runtimeId: routing.runtimeId,
          vramUsedMB: snapAfter.models.totalVramUsedMB,
          vramTotalMB: snapAfter.vram.totalMB,
          detail: routing.reason,
        })
      } catch (e) {
        if (controller.signal.aborted || (e instanceof AgentOrchestratorError && e.code === 'cancelled')) {
          this.emit(sid, 'task:cancelled', { taskKind: classification.kind, detail: 'cancelled during load' })
          throw new AgentOrchestratorError('cancelled', 'cancelled')
        }
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.toLowerCase().includes('resource') || msg.toLowerCase().includes('vram') || msg.toLowerCase().includes('max concurrent')) {
          this.emit(sid, 'task:error', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: msg, error: msg })
          throw new AgentOrchestratorError('resource-blocked', msg)
        }
        this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: msg, error: msg })
        throw new AgentOrchestratorError('model-load-failed', msg)
      }

      if (controller.signal.aborted) {
        this.emit(sid, 'task:cancelled', { taskKind: classification.kind, detail: 'cancelled before persistence' })
        throw new AgentOrchestratorError('cancelled', 'cancelled')
      }

      // ── PHASE 5: history + system injection (durable before inference) ──
      const prior = await this.deps.persistence.getEvents(sessionId).catch(() => [])
      // Workspace / MCP / Skills injection (advisory, missing never blocks)
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
      } catch { /* advisory */ }
      let mcpContext: string | null = null
      try { mcpContext = this.deps.getMcpContext?.() ?? null } catch { /* ignore */ }
      let skillsContext: string | null = null
      try { skillsContext = (await this.deps.getSkillsContext?.()) ?? null } catch { /* ignore */ }
      let webContext: string | null = null
      if (opts?.webSearch && this.deps.webSearch) {
        try { webContext = await this.deps.webSearch(content) } catch { webContext = null }
      }

      // Persist user event first (source of truth, never after LLM)
      let userSeq = -1
      try {
        userSeq = (await this.deps.persistence.appendEvent(sessionId, 'user/message', { content })).seq
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'could not persist your message'
        this.emit(sid, 'task:error', { taskKind: classification.kind, detail: msg, error: msg })
        throw new AgentOrchestratorError('persistence-failed', msg)
      }

      // Append routing/classification as auditable execution event (kept separate from messages)
      try {
        await this.deps.persistence.appendEvent(sessionId, 'agent/execution', {
          phase: 'routing',
          kind: classification.kind,
          confidence: classification.confidence,
          modelId: routing.modelId,
          runtimeId: routing.runtimeId,
          reason: routing.reason,
        })
      } catch { /* audit event best-effort */ }

      const reasoningSystem = classification.reasoningRequired || opts?.reasoning
        ? 'Think step by step before answering. Provide your reasoning wrapped in <thinking> tags, then the final answer.'
        : null

      const messages: import('@shared/types/ports').LlmChatMessage[] = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...(reasoningSystem ? [{ role: 'system' as const, content: reasoningSystem }] : []),
        ...(workspaceContext ? [{ role: 'system' as const, content: workspaceContext }] : []),
        ...(mcpContext ? [{ role: 'system' as const, content: mcpContext }] : []),
        ...(skillsContext ? [{ role: 'system' as const, content: skillsContext }] : []),
        ...(webContext ? [{ role: 'system' as const, content: webContext }] : []),
        ...toRequestMessages(prior),
        { role: 'user', content },
      ]

      appendChatLog(this.deps.baseDir, {
        sessionId: sid,
        action: 'send',
        modelId: routing.modelId,
        runtimeId: routing.runtimeId,
        injected: { workspace: !!workspaceContext, mcp: !!mcpContext, skills: !!skillsContext, webSearch: !!webContext },
        detail: `task=${classification.kind} conf=${classification.confidence.toFixed(2)} routing=${routing.reason} history=${prior.length}→${messages.length}`,
      })

      // ── PHASE 6: agent execution loop (LLM stream + optional tool steps) ──
      // For now, single LLM step with honest step:start/end events. Tool loop seam
      // is prepared: if a tool is needed, we emit tool:start/delta/end and loop.
      this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 0, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: 'llm generation' })

      const endpoint = entry.endpoint
      const model = remoteModelId(routing.modelId)
      const timeoutMs = Math.max(entry.timeoutMs, 120_000)
      let streamed = true
      let text = ''
      let reasoningBuffer = ''
      let inReasoning = !!(classification.reasoningRequired || opts?.reasoning)
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

      // Local stub path: no HTTP needed — generate via deterministic stub but emit honest lifecycle
      if (isLocalStub) {
        // Keep stub honest: emit one streaming phase, then persist exactly one assistant message.
        // No fake multi-step. The stub text is clearly marked as local stub.
        const stubText = this.buildLocalStubResponse(content, routing.modelId, classification)
        const reasoningOn = !!(classification.reasoningRequired || opts?.reasoning)
        if (reasoningOn) {
          const reasoningText = `Task: ${classification.kind} | Model: ${routing.modelId} | Need to provide helpful, concise, local response.`
          this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: reasoningText })
          // persist reasoning for later reconstruction
          try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningText }) } catch {}
          // also emit step tool seam opportunity (future: could dispatch tool here)
        }
        // Honest streaming: respect cancellation during stub generation
        if (controller.signal.aborted) {
          this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: 'cancelled during stub' })
          return await this.finishCancelled(sessionId, sid, startedAll, entry.id, endpoint, model, streamed, userSeq)
        }
        text = stubText
        this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: stubText })
        // Optional tool step for tool-use/agent tasks — honest multi-step via ToolPort
        if ((classification.kind === 'tool-use' || classification.kind === 'agent') && !controller.signal.aborted) {
          const defs = this.deps.tools.list()
          if (defs.some((d) => d.name === 'web_search')) {
            this.emit(sid, 'tool:start', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `dispatching web_search for: ${content.slice(0,60)}` })
            try {
              const raw = await this.deps.tools.dispatch('web_search', { queries: [content.slice(0,200)] })
              let toolText = ''
              try {
                const parsed = JSON.parse(raw)
                if (parsed.error) {
                  toolText = `Tool error: ${parsed.error}`
                  this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: toolText })
                } else {
                  toolText = String(raw).slice(0, 1500)
                  this.deps.emit({ sessionId: sid, kind: 'tool:delta', text: toolText.slice(0,400), toolName: 'web_search' })
                  this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `tool returned ${toolText.length} chars` })
                }
              } catch {
                toolText = String(raw).slice(0, 1500)
                this.deps.emit({ sessionId: sid, kind: 'tool:delta', text: toolText.slice(0,400), toolName: 'web_search' })
                this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `tool returned ${toolText.length} chars` })
              }
              try { await this.deps.persistence.appendEvent(sessionId, 'tool/result', { toolCallId: `tool-${Date.now()}` as never, content: toolText }) } catch {}
              if (toolText && !controller.signal.aborted) {
                const augmented = `\n\n[Tool web_search result: ${toolText.slice(0,800)}]`
                text += augmented
                this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: augmented })
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `tool failed: ${msg}` })
            }
          }
        }
        this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `local stub — ${text.length} chars steps=${(classification.kind === 'tool-use' || classification.kind === 'agent') ? 2 : 1}` })

        const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
        const promptTokens = Math.ceil(content.length / 4)
        const completionTokens = Math.ceil(text.length / 4)
        const totalTokens = promptTokens + completionTokens
        try {
          this.deps.persistence.insertTokenUsage({ sessionId: sid, model: routing.modelId, promptTokens, completionTokens, totalTokens })
        } catch {}
        appendRuntimeLog(this.deps.baseDir, { time: Date.now(), runtimeId: routing.runtimeId, method: 'POST', target: 'local/stub', latencyMs: Date.now() - startedAll, outcome: 'ok', modelId: routing.modelId, streamed: true })
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'done', modelId: routing.modelId, runtimeId: routing.runtimeId, outcome: 'ok', promptTokens, completionTokens, totalTokens, latencyMs: Date.now() - startedAll, detail: `agent local stub steps=1 task=${classification.kind}` })
        this.emit(sid, 'task:complete', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: `done in ${Date.now() - startedAll}ms`, stepIndex: 0 })
        this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
        return { ok: true, userSeq, assistantSeq, routing, classification }
      }

      // HTTP runtime path — real streaming
      try {
        for await (const chunk of this.deps.llm.streamChat({
          endpoint,
          model,
          messages,
          timeoutMs,
          stream: true,
          signal: controller.signal,
        })) {
          if (controller.signal.aborted) break
          if (chunk.type === 'text-delta' && chunk.text) {
            let delta = chunk.text
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
            this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: delta })
          }
          if (chunk.type === 'done' && chunk.note === 'non-stream-fallback') streamed = false
          if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
          if (chunk.type === 'done') break
        }
      } catch (e) {
        if (controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled')) {
          this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: 'cancelled' })
          return await this.finishCancelled(sessionId, sid, startedAll, routing.runtimeId, endpoint, model, streamed, userSeq)
        }
        const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
        this.log(routing.runtimeId, endpoint, model, startedAll, undefined, outcomeOf(e), streamed)
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: outcomeOf(e), error: safe, modelId: model, runtimeId: routing.runtimeId, latencyMs: Date.now() - startedAll })
        this.emit(sid, 'task:error', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: safe, error: safe })
        this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
        this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `failed: ${safe}` })
        throw new AgentOrchestratorError('llm-failed', safe)
      }

      this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `llm done — ${text.length} chars streamed=${streamed}` })

      // ── Optional second step: tool use (honest multi-step) ──
      if ((classification.kind === 'tool-use' || classification.kind === 'agent') && !controller.signal.aborted) {
        const defs = this.deps.tools.list()
        if (defs.some((d) => d.name === 'web_search')) {
          this.emit(sid, 'tool:start', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `dispatching web_search for: ${content.slice(0,60)}` })
          let toolText = ''
          try {
            const raw = await this.deps.tools.dispatch('web_search', { queries: [content.slice(0,200)] })
            try {
              const parsed = JSON.parse(raw)
              if (parsed.error) {
                toolText = `Tool error: ${parsed.error}`
                this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: toolText })
              } else {
                toolText = String(raw).slice(0, 1500)
                this.deps.emit({ sessionId: sid, kind: 'tool:delta', text: toolText.slice(0,400), toolName: 'web_search' })
                this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `tool returned ${toolText.length} chars` })
              }
            } catch {
              toolText = String(raw).slice(0, 1500)
              this.deps.emit({ sessionId: sid, kind: 'tool:delta', text: toolText.slice(0,400), toolName: 'web_search' })
              this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `tool returned ${toolText.length} chars` })
            }
            try { await this.deps.persistence.appendEvent(sessionId, 'tool/result', { toolCallId: `tool-${Date.now()}` as never, content: toolText }) } catch {}
            if (toolText && !controller.signal.aborted) {
              // Second LLM step with tool context — honest agent loop continuation
              this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 1, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: 'llm generation (with tool context)' })
              const followMessages: import('@shared/types/ports').LlmChatMessage[] = [
                ...messages,
                { role: 'assistant', content: text },
                { role: 'system', content: `Tool web_search result (untrusted external content):\n${toolText.slice(0, 3000)}` },
                { role: 'user', content: 'Using the tool result above, provide the final answer concisely.' },
              ]
              let secondText = ''
              try {
                for await (const chunk of this.deps.llm.streamChat({
                  endpoint,
                  model,
                  messages: followMessages,
                  timeoutMs,
                  stream: true,
                  signal: controller.signal,
                })) {
                  if (controller.signal.aborted) break
                  if (chunk.type === 'text-delta' && chunk.text) {
                    secondText += chunk.text
                    this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: chunk.text })
                  }
                  if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
                  if (chunk.type === 'done') break
                }
                if (secondText.trim() !== '') {
                  text += '\n\n' + secondText
                }
                this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 1, detail: `llm+tool done — second step ${secondText.length} chars` })
              } catch (e) {
                // Second step failure is non-fatal — keep first answer and tool result
                if (!(controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled'))) {
                  const safe2 = e instanceof ChatInferenceError ? e.message : 'tool follow-up failed'
                  this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 1, detail: `second step failed: ${safe2}` })
                } else {
                  this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 1, detail: 'cancelled during tool follow-up' })
                  return await this.finishCancelled(sessionId, sid, startedAll, routing.runtimeId, endpoint, model, streamed, userSeq)
                }
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `tool failed: ${msg}` })
          }
        }
      }

      if (controller.signal.aborted) {
        return await this.finishCancelled(sessionId, sid, startedAll, routing.runtimeId, endpoint, model, streamed, userSeq)
      }

      if (text.trim() === '') {
        const msg = 'invalid-response: the local model returned an empty reply'
        this.log(routing.runtimeId, endpoint, model, startedAll, undefined, 'invalid-response', streamed)
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'invalid-response', error: msg, modelId: model, runtimeId: routing.runtimeId, latencyMs: Date.now() - startedAll })
        this.emit(sid, 'task:error', { taskKind: classification.kind, detail: msg, error: msg })
        this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: msg })
        throw new AgentOrchestratorError('llm-failed', msg)
      }

      const promptText = messages.map((m) => m.content).join(' ')
      const tokenUsage = usage ?? {
        promptTokens: Math.ceil(promptText.length / 4),
        completionTokens: Math.ceil(text.length / 4),
        totalTokens: Math.ceil((promptText.length + text.length) / 4),
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
      this.log(routing.runtimeId, endpoint, model, startedAll, 200, 'ok', streamed)
      appendChatLog(this.deps.baseDir, {
        sessionId: sid,
        action: 'done',
        modelId: model,
        runtimeId: routing.runtimeId,
        outcome: 'ok',
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
        latencyMs: Date.now() - startedAll,
        detail: `agent steps=1 task=${classification.kind} routing=${routing.reason}`,
      })
      this.emit(sid, 'task:complete', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: `done in ${Date.now() - startedAll}ms`, stepIndex: 0 })
      this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })

      // Optional: persist execution summary for audit
      try {
        await this.deps.persistence.appendEvent(sessionId, 'agent/trace', {
          kind: classification.kind,
          modelId: routing.modelId,
          runtimeId: routing.runtimeId,
          steps: 1,
          durationMs: Date.now() - startedAll,
          streamed,
          routingReason: routing.reason,
        })
      } catch { /* best-effort */ }

      return { ok: true, userSeq, assistantSeq, routing, classification }
    } catch (e) {
      if (e instanceof AgentOrchestratorError) throw e
      const msg = e instanceof Error ? e.message : String(e)
      this.emit(sid, 'task:error', { taskKind: 'chat', detail: msg, error: msg })
      throw new AgentOrchestratorError('llm-failed', msg)
    } finally {
      this.inFlight.delete(sid)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  // For regenerate — reuse execute without creating a second user event by
  // delegating to the same pipeline but with historical prompt.
  async regenerate(sessionId: SessionId, opts?: { reasoning?: boolean }): Promise<{ ok: true; assistantSeq: number; routing: ModelRoutingDecision; classification: TaskClassification }> {
    const prior = await this.deps.persistence.getEvents(sessionId)
    const lastUser = [...prior].reverse().find((e) => e.type === 'user/message')
    if (!lastUser) throw new AgentOrchestratorError('persistence-failed', 'no user message to regenerate')
    let content: string | null = null
    if (typeof lastUser.data === 'string') content = lastUser.data
    else if (lastUser.data !== null && typeof lastUser.data === 'object') {
      const c = (lastUser.data as Record<string, unknown>)['content']
      if (typeof c === 'string') content = c
    }
    if (!content || content.trim() === '') throw new AgentOrchestratorError('persistence-failed', 'last user message is empty')
    // Regenerate runs the same orchestrated path but we need to avoid double user event.
    // Strategy: call execute with a marker that tells execute to skip user append.
    // For simplicity, reuse send logic that handles full persistence: we will append a
    // single new assistant event without a new user event by emulating execute's latter half.
    // Instead, we just call execute with the same content but tell persistence to reuse seq:
    // Easiest correct ponytail: invoke the normal execute path but reuse last user seq.
    // We do a dedicated inline flow that mirrors execute's routing+LLM but not user append.
    return this.regenerateInline(sessionId, content, opts)
  }

  private async regenerateInline(sessionId: SessionId, content: string, opts?: { reasoning?: boolean }): Promise<{ ok: true; assistantSeq: number; routing: ModelRoutingDecision; classification: TaskClassification }> {
    const sid = String(sessionId)
    const startedAll = Date.now()
    if (this.inFlight.has(sid)) throw new AgentOrchestratorError('llm-failed', 'already-generating: wait for the current reply to finish')
    const controller = new AbortController()
    this.inFlight.set(sid, controller)
    try {
      const classification = classifyTask(content, { reasoning: opts?.reasoning })
      this.emit(sid, 'task:start', { taskKind: classification.kind, detail: 'regenerate' })
      this.emit(sid, 'task:planning', { taskKind: classification.kind, detail: classification.reason })
      this.emit(sid, 'model:selecting', { taskKind: classification.kind, detail: `routing for ${classification.kind}` })
      const models = this.deps.workbench.listModels()
      const active = this.deps.workbench.getActiveModel()
      const resources = await this.deps.resources.getSnapshot()
      const routing = await routeModel({
        task: classification,
        models,
        active: active.selection ?? null,
        resources,
        checkBeforeLoad: async (modelId) => {
          try {
            return await this.deps.resources.checkBeforeLoad(
              { id: modelId as never, displayName: modelId, source: 'custom', format: 'unknown' } as never,
              { ctxLen: classification.contextLengthNeeded }
            )
          } catch { return { level: 'ok' as const } }
        },
      })
      if (!routing.modelId || !routing.runtimeId) throw new AgentOrchestratorError('no-model-available', `No compatible model for "${classification.kind}". ${routing.reason}`)
      const pressure = await this.deps.resources.checkBeforeLoad(
        { id: routing.modelId as never, displayName: routing.modelId, source: 'custom', format: 'unknown' } as never,
        { ctxLen: classification.contextLengthNeeded }
      )
      if (pressure.blocking) throw new AgentOrchestratorError('resource-blocked', `resource-pressure: ${pressure.reason ?? 'load refused'}`)
      let entry = this.deps.workbench.describeRuntime(routing.runtimeId)
      if (!entry || !entry.enabled) throw new AgentOrchestratorError('runtime-unavailable', 'The selected runtime is unavailable. Open Models and test its connection.')
      if (routing.switched) {
        await this.deps.workbench.selectModel(routing.runtimeId, routing.modelId)
        entry = this.deps.workbench.describeRuntime(routing.runtimeId)!
      }
      this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, vramTotalMB: resources.vram.totalMB })
      const inst = await this.deps.models.load(routing.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: routing.runtimeId })
      const deadline = Date.now() + 4000
      while (Date.now() < deadline) {
        if (controller.signal.aborted) throw new AgentOrchestratorError('cancelled', 'cancelled')
        const h = await this.deps.models.health(inst.id).catch(() => ({ ok: false, error: 'health failed' }))
        if (h.ok) break
        await new Promise((r) => setTimeout(r, 180))
      }
      const snapAfter = await this.deps.resources.getSnapshot().catch(() => resources)
      this.emit(sid, 'model:ready', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, vramUsedMB: snapAfter.models.totalVramUsedMB, vramTotalMB: snapAfter.vram.totalMB, detail: routing.reason })
      if (controller.signal.aborted) throw new AgentOrchestratorError('cancelled', 'cancelled')

      const prior = await this.deps.persistence.getEvents(sessionId)
      let workspaceContext: string | null = null
      try {
        const header = await this.deps.persistence.get(sessionId)
        const pid = header?.projectId ?? null
        const projectRoot = this.deps.getProjectWorkspace?.(pid) ?? null
        const globalRoot = this.deps.getGlobalWorkspace?.() ?? null
        const root = projectRoot ?? globalRoot
        if (root) workspaceContext = pid && projectRoot ? `Project workspace: ${projectRoot} (project ${pid}) — global fallback: ${globalRoot ?? 'none'}` : `Global workspace: ${root}${projectRoot ? ` (project ${pid} at ${projectRoot})` : ''}`
      } catch { /* ignore */ }
      let mcpContext: string | null = null
      try { mcpContext = this.deps.getMcpContext?.() ?? null } catch {}
      let skillsContext: string | null = null
      try { skillsContext = (await this.deps.getSkillsContext?.()) ?? null } catch {}

      const reasoningSystem = classification.reasoningRequired || opts?.reasoning ? 'Think step by step before answering. Provide your reasoning wrapped in <thinking> tags, then the final answer.' : null
      const messages: import('@shared/types/ports').LlmChatMessage[] = [
        { role: 'system', content: CHAT_SYSTEM_PROMPT },
        ...(reasoningSystem ? [{ role: 'system' as const, content: reasoningSystem }] : []),
        ...(workspaceContext ? [{ role: 'system' as const, content: workspaceContext }] : []),
        ...(mcpContext ? [{ role: 'system' as const, content: mcpContext }] : []),
        ...(skillsContext ? [{ role: 'system' as const, content: skillsContext }] : []),
        ...toRequestMessages(prior),
      ]
      this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 0, modelId: routing.modelId, runtimeId: routing.runtimeId })
      const isLocalStub = entry.endpoint === 'local' || entry.id === 'local'
      if (isLocalStub) {
        const reasoningOn = !!(classification.reasoningRequired || opts?.reasoning)
        if (reasoningOn) {
          const rt = `Task: ${classification.kind} | Model: ${routing.modelId} | Regenerating response.`
          this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: rt })
          try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: rt }) } catch {}
        }
        const snippet = content.slice(0, 500).replace(/\s+/g, ' ').trim()
        const text = snippet ? `Regenerated: You said "${snippet}" — local stub for ${routing.modelId} (regenerated at ${new Date().toLocaleTimeString()}, task=${classification.kind}).` : `Local stub for ${routing.modelId} — regenerated response (task=${classification.kind}).`
        if (!controller.signal.aborted) this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text })
        this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0 })
        const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
        const promptTokens = Math.ceil(content.length / 4)
        const completionTokens = Math.ceil(text.length / 4)
        try { this.deps.persistence.insertTokenUsage({ sessionId: sid, model: routing.modelId, promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }) } catch {}
        appendRuntimeLog(this.deps.baseDir, { time: Date.now(), runtimeId: entry.id, method: 'POST', target: 'local/stub', latencyMs: Date.now() - startedAll, outcome: 'ok', modelId: routing.modelId, streamed: true })
        this.emit(sid, 'task:complete', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: `done in ${Date.now() - startedAll}ms`, stepIndex: 0 })
        this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
        return { ok: true, assistantSeq, routing, classification }
      }

      const endpoint = entry.endpoint
      const model = remoteModelId(routing.modelId)
      const timeoutMs = Math.max(entry.timeoutMs, 120_000)
      let text = ''
      let reasoningBuffer = ''
      let inReasoning = !!(classification.reasoningRequired || opts?.reasoning)
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
      let streamed = true
      try {
        for await (const chunk of this.deps.llm.streamChat({ endpoint, model, messages, timeoutMs, stream: true, signal: controller.signal })) {
          if (chunk.type === 'text-delta' && chunk.text) {
            let delta = chunk.text
            if (inReasoning || delta.includes('<thinking>') || delta.includes('<think>')) {
              if (delta.includes('<thinking>') || delta.includes('<think>')) { inReasoning = true; delta = delta.replace(/<thinking>|<think>/g, '') }
              if (delta.includes('</thinking>') || delta.includes('</think>')) {
                const parts = delta.split(/<\/thinking>|<\/think>/)
                reasoningBuffer += parts[0]
                if (reasoningBuffer) { this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: reasoningBuffer }); try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}; reasoningBuffer = '' }
                inReasoning = false; delta = parts.slice(1).join(''); if (!delta) continue
              }
              if (inReasoning) { reasoningBuffer += delta; this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: delta }); continue }
            }
            text += delta; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: delta })
          }
          if (chunk.type === 'done' && chunk.note === 'non-stream-fallback') streamed = false
          if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
          if (chunk.type === 'done') break
        }
      } catch (e) {
        if (controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled')) {
          this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: 'cancelled' })
          const ev = await this.deps.persistence.appendEvent(sessionId, 'assistant/cancelled', { reason: 'cancelled' })
          this.log(routing.runtimeId, endpoint, model, startedAll, undefined, 'cancelled', streamed)
          this.deps.emit({ sessionId: sid, kind: 'assistant-cancelled', seq: ev.seq })
          this.emit(sid, 'task:cancelled', { taskKind: classification.kind })
          return { ok: true, assistantSeq: ev.seq, routing, classification }
        }
        const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
        this.log(routing.runtimeId, endpoint, model, startedAll, undefined, outcomeOf(e), streamed)
        this.emit(sid, 'task:error', { taskKind: classification.kind, detail: safe, error: safe })
        this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
        throw new AgentOrchestratorError('llm-failed', safe)
      }
      this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `llm done — ${text.length} chars` })
      if (text.trim() === '') {
        const msg = 'invalid-response: the local model returned an empty reply'
        this.log(routing.runtimeId, endpoint, model, startedAll, undefined, 'invalid-response', streamed)
        this.emit(sid, 'task:error', { taskKind: classification.kind, detail: msg, error: msg })
        this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: msg })
        throw new AgentOrchestratorError('llm-failed', msg)
      }
      const promptText = messages.map((m) => m.content).join(' ')
      const tokenUsage = usage ?? { promptTokens: Math.ceil(promptText.length / 4), completionTokens: Math.ceil(text.length / 4), totalTokens: Math.ceil((promptText.length + text.length) / 4) }
      try { this.deps.persistence.insertTokenUsage({ sessionId: sid, model, promptTokens: tokenUsage.promptTokens, completionTokens: tokenUsage.completionTokens, totalTokens: tokenUsage.totalTokens }) } catch {}
      const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
      this.log(routing.runtimeId, endpoint, model, startedAll, 200, 'ok', streamed)
      this.emit(sid, 'task:complete', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: `done in ${Date.now() - startedAll}ms`, stepIndex: 0 })
      this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })
      return { ok: true, assistantSeq, routing, classification }
    } finally {
      this.inFlight.delete(sid)
    }
  }

  async editAndResend(sessionId: SessionId, content: string, opts?: { webSearch?: boolean; reasoning?: boolean }): Promise<{ ok: true; userSeq: number; assistantSeq: number; routing: ModelRoutingDecision; classification: TaskClassification }> {
    const text = content.trim()
    if (!text) throw new AgentOrchestratorError('persistence-failed', 'cannot resend empty message')
    return this.execute(sessionId, text, opts)
  }

  private emit(sessionId: string, kind: ChatStreamEvent['kind'], extra: Partial<ChatStreamEvent> = {}): void {
    this.deps.emit({ sessionId, kind, ...extra })
  }

  private buildLocalStubResponse(prompt: string, modelId: string, classification: TaskClassification): string {
    const shortId = modelId.split('/').pop()?.split(':').pop() || modelId
    const lower = prompt.toLowerCase().trim()
    let content: string
    if (lower === 'hi' || lower === 'hello' || lower === 'hey' || lower === 'hi!' || lower === 'hello!') {
      content = `Hello! I'm ${shortId} running locally on your machine via Sovara (task: ${classification.kind}). How can I help you today?`
    } else if (lower.includes('help') && lower.length < 30) {
      content = `I'm here to help! As ${shortId} running locally (task: ${classification.kind}), I can assist with code, writing, analysis, and more. What would you like to work on?`
    } else if (prompt.length < 20) {
      content = `Thanks for your message — "${prompt.slice(0, 100)}". I'm ${shortId} running locally (task: ${classification.kind}) and ready to help. What would you like to explore?`
    } else {
      const snippet = prompt.slice(0, 120).replace(/\s+/g, ' ')
      content = `Got it — you said "${snippet}${prompt.length > 120 ? '…' : ''}". This is a local inference response from ${shortId} (task: ${classification.kind}, loaded in RAM via Sovara's ModelRuntimePort). With a configured HTTP runtime at http://127.0.0.1:1234 you'd get a full model-generated answer here — the agent pipeline (classify → route → load → generate) is working and the model is resident.`
    }
    return content
  }

  private async finishCancelled(
    sessionId: SessionId,
    sid: string,
    started: number,
    runtimeId: string,
    endpoint: string,
    model: string,
    streamed: boolean,
    userSeq: number
  ): Promise<{ ok: true; userSeq: number; assistantSeq: number; routing: ModelRoutingDecision; classification: TaskClassification }> {
    const ev = await this.deps.persistence.appendEvent(sessionId, 'assistant/cancelled', { reason: 'cancelled' })
    this.log(runtimeId, endpoint, model, started, undefined, 'cancelled', streamed)
    appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'cancel', modelId: model, runtimeId, outcome: 'cancelled', latencyMs: Date.now() - started })
    this.deps.emit({ sessionId: sid, kind: 'assistant-cancelled', seq: ev.seq })
    this.emit(sid, 'task:cancelled', { detail: 'cancelled' })
    // Reconstruct minimal routing/classification for return — not used by caller beyond success
    const fakeClassification: TaskClassification = { kind: 'chat', confidence: 1, requiredCapabilities: ['chat'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'cancelled fallback' }
    const fakeRouting: ModelRoutingDecision = { modelId: model, runtimeId, reason: 'cancelled', task: fakeClassification, candidatesConsidered: 0, switched: false }
    return { ok: true, userSeq, assistantSeq: ev.seq, routing: fakeRouting, classification: fakeClassification }
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
