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

import fs from 'node:fs'
import path from 'node:path'
import type { SessionId } from '@shared/types/branded'
import type { ChatStreamEvent } from '@shared/types/chat'
import type { LlmPort, PersistencePort, SystemResourceManagerPort, ModelRuntimePort, ToolPort, LlmImagePart } from '@shared/types/ports'
import type { ModelWorkbench } from './ModelWorkbench'
import { classifyTask } from './TaskClassifier'
import { routeModel } from './ModelRouter'
import { resolveCapabilities } from '@shared/types/modelCapabilities'
import { ChatInferenceError } from './ports/LocalOpenAIChatAdapter'
import { appendChatLog, appendRuntimeLog, safeTarget } from '../logging/runtimeLog'
import { getArtifactsDir } from '../storage/paths'
import { processAttachments, buildAttachmentContext, type IncomingAttachment } from './attachments'
import { detectOutputFormat, generateArtifactFile, sanitizeFileName } from './artifacts'
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
    opts?: { webSearch?: boolean; reasoning?: boolean; attachments?: IncomingAttachment[] }
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

      // ── PHASE 1b: attachment intake — decode + extract BEFORE classify so
      // the classifier sees image presence and attachment size for routing ──
      const incoming = (opts?.attachments ?? []).slice(0, 5)
      for (const a of incoming) {
        if (controller.signal.aborted) break
        this.emit(sid, 'task:reading', { taskKind: 'chat', fileName: a.name, detail: `Reading ${a.name}…` })
      }
      const attached = processAttachments(incoming, { sessionId: sid, baseDir: this.deps.baseDir })
      if (attached.files.length > 0) {
        try {
          await this.deps.persistence.appendEvent(sessionId, 'attachment/added', {
            files: attached.files.map((f) => ({
              name: f.name, mime: f.mime, size: f.size, kind: f.kind, storedPath: f.storedPath,
              chars: f.text.length, truncated: f.truncated, note: f.note,
              width: f.imageWidth, height: f.imageHeight,
            })),
          })
        } catch { /* audit best-effort */ }
        this.emit(sid, 'task:reading', { taskKind: 'chat', detail: attached.manifestLine })
      }

      const classification = classifyTask(content, {
        reasoning: opts?.reasoning,
        webSearch: opts?.webSearch,
        hasImage: attached.hasImage,
        attachmentChars: attached.totalChars,
      })
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

      // ── PHASE 4: model lifecycle — owned runtime loads the GGUF into VRAM
      // (switch evicts the previous resident). Third-party loopback runtimes
      // own their lifecycle — selection alone suffices, no sidecar spawn.
      const vramTotal = resources.vram.totalMB
      const isOwnedRuntime = entry.endpoint === 'local' || entry.id === 'local' || routing.runtimeId === 'local'
      let ownedEndpoint: string | null = null
      let ownedInstanceForMetrics: string | null = null

      this.emit(sid, 'model:loading', {
        taskKind: classification.kind,
        modelId: routing.modelId,
        runtimeId: routing.runtimeId,
        vramTotalMB: vramTotal,
        detail: switched ? `selected ${routing.modelId} — loading` : `model ${routing.modelId} — checking`,
      })

      try {
        if (isOwnedRuntime) {
          // Blocking load: resolves only when /health is green (VRAM-resident).
          // Verify health before routing — never trust process existence alone.
          const models = this.deps.models as ModelRuntimePort & {
            ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }>
          }
          const inst = models.ensureHealthy
            ? await models.ensureHealthy(routing.modelId as never, {
              ctxLen: classification.contextLengthNeeded,
              runtimeId: routing.runtimeId,
            })
            : await this.deps.models.load(routing.modelId as never, {
              ctxLen: classification.contextLengthNeeded,
              runtimeId: routing.runtimeId,
            })
          const h = await this.deps.models.health(inst.id).catch(() => ({ ok: false, error: 'health-check-failed' }))
          if (!h.ok) throw new AgentOrchestratorError('model-load-failed', `instance unhealthy (${h.error ?? 'health check failed'}) -- refusing to route`)
          ownedEndpoint = this.deps.models.baseUrl(inst.id)
          try {
            (this.deps.models as unknown as { noteRequestStart?: (id: unknown) => void }).noteRequestStart?.(inst.id)
            ownedInstanceForMetrics = String(inst.id)
          } catch { /* accounting never blocks */ }
        } else if (controller.signal.aborted) {
          throw new AgentOrchestratorError('cancelled', 'cancelled')
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

      // ── PHASE 4b: vision check — does the routed model actually see pixels?
      // resolveCapabilities is the ONLY capability source (registry or
      // adapter-advertised); text-only winners get metadata, never fake sight.
      const routedModel = models.find((m) => m.modelId === routing.modelId && m.runtimeId === routing.runtimeId)
      const routedCaps = resolveCapabilities(
        routing.modelId,
        routedModel?.capabilities,
        routedModel?.contextLength ?? classification.contextLengthNeeded
      )
      const visionCapable = routedCaps.capabilities.includes('vision')
      const visionImages: LlmImagePart[] = []
      for (const f of attached.files) {
        if (f.kind !== 'image' || !f.imageBase64 || !visionCapable) continue
        visionImages.push({
          name: f.name,
          mime: f.mime,
          base64: f.imageBase64,
          ...(f.imageWidth != null && f.imageHeight != null ? { width: f.imageWidth, height: f.imageHeight } : {}),
        })
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

      // ── PHASE 5b: prompt assembly state (honest stage for the send animation) ──
      const attachmentContext = buildAttachmentContext(attached.files, visionCapable)
      this.emit(sid, 'task:prompting', {
        taskKind: classification.kind,
        modelId: routing.modelId,
        runtimeId: routing.runtimeId,
        detail: attached.files.length > 0
          ? `assembling prompt — ${attached.files.length} attachment(s), vision ${visionCapable ? 'on' : 'off'}`
          : 'assembling prompt — history + workspace context',
      })

      // Persist user event first (source of truth, never after LLM).
      // The attachment manifest rides with the message so the timeline shows
      // what was sent; extracted content travels as system context below.
      const userContent = attached.manifestLine ? `${attached.manifestLine}\n\n${content}` : content
      let userSeq = -1
      try {
        userSeq = (await this.deps.persistence.appendEvent(sessionId, 'user/message', { content: userContent })).seq
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
        ...attachmentContext.map((c) => ({ role: 'system' as const, content: c })),
        ...toRequestMessages(prior),
        { role: 'user', content, ...(visionImages.length > 0 ? { images: visionImages } : {}) },
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
      if (classification.reasoningRequired || opts?.reasoning) {
        this.emit(sid, 'task:thinking', {
          taskKind: classification.kind,
          modelId: routing.modelId,
          runtimeId: routing.runtimeId,
          detail: 'thinking through the request…',
        })
      }
      this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 0, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: 'llm generation' })

      // Owned sidecar serves on its own loopback port; third-party runtimes
      // serve on their registered endpoint. Either way this is REAL streaming
      // through LlmPort — no canned text anywhere on this path.
      const endpoint = ownedEndpoint ?? entry.endpoint
      const model = remoteModelId(routing.modelId)
      const timeoutMs = Math.max(entry.timeoutMs, 120_000)
      let streamed = true
      let text = ''
      let reasoningBuffer = ''
      let inReasoning = !!(classification.reasoningRequired || opts?.reasoning)
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

      // Real streaming (owned sidecar or remote runtime — same protocol)
      let orchFirstTokenAt: number | null = null
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
                const tail = parts[0] ?? ''
                reasoningBuffer += tail
                // Exactly-once streaming: earlier chunks were already
                // emitted incrementally — emit only the not-yet-streamed
                // tail. The full buffer is persisted once below.
                if (tail) this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: tail })
                if (reasoningBuffer) {
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
            if (orchFirstTokenAt === null) orchFirstTokenAt = Date.now()
            this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: delta })
          }
          if (chunk.type === 'done' && chunk.note === 'non-stream-fallback') streamed = false
          if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
          if (chunk.type === 'done') break
        }
      } catch (e) {
        if (controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled')) {
          this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: 'cancelled' })
          this.noteEndQuiet(ownedInstanceForMetrics)
          return await this.finishCancelled(sessionId, sid, startedAll, routing.runtimeId, endpoint, model, streamed, userSeq)
        }
        const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
        this.log(routing.runtimeId, endpoint, model, startedAll, undefined, outcomeOf(e), streamed)
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: outcomeOf(e), error: safe, modelId: model, runtimeId: routing.runtimeId, latencyMs: Date.now() - startedAll })
        this.emit(sid, 'task:error', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, detail: safe, error: safe })
        this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
        this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `failed: ${safe}` })
        this.noteEndQuiet(ownedInstanceForMetrics)
        throw new AgentOrchestratorError('llm-failed', safe)
      }

      this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `llm done — ${text.length} chars streamed=${streamed}` })

      // Unclosed <thinking> block (model never emitted the close tag):
      // deltas already streamed incrementally — persist the full text so a
      // later refresh reconstructs the same reasoning instead of losing it.
      if (reasoningBuffer) {
        try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}
        reasoningBuffer = ''
      }

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
                  this.noteEndQuiet(ownedInstanceForMetrics)
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
        this.noteEndQuiet(ownedInstanceForMetrics)
        return await this.finishCancelled(sessionId, sid, startedAll, routing.runtimeId, endpoint, model, streamed, userSeq)
      }

      if (text.trim() === '') {
        const msg = 'invalid-response: the local model returned an empty reply'
        this.noteEndQuiet(ownedInstanceForMetrics)
        this.log(routing.runtimeId, endpoint, model, startedAll, undefined, 'invalid-response', streamed)
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'invalid-response', error: msg, modelId: model, runtimeId: routing.runtimeId, latencyMs: Date.now() - startedAll })
        this.emit(sid, 'task:error', { taskKind: classification.kind, detail: msg, error: msg })
        this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: msg })
        throw new AgentOrchestratorError('llm-failed', msg)
      }

      // ── Required-output artifact: the user asked for a FILE (pdf / excel /
      // word / code). Derive it from the final reply, persist an audit event,
      // and append the saved path to the reply so the timeline keeps it. ──
      const detected = detectOutputFormat(content)
      if (detected) {
        this.emit(sid, 'artifact:writing', {
          taskKind: classification.kind,
          modelId: routing.modelId,
          runtimeId: routing.runtimeId,
          fileName: detected.fileName,
          detail: `generating ${detected.fileName}…`,
        })
        try {
          const dir = getArtifactsDir(sid, this.deps.baseDir)
          fs.mkdirSync(dir, { recursive: true })
          const target = uniqueArtifactPath(dir, detected.fileName)
          const made = generateArtifactFile(detected.kind, target, text, content)
          if (made) {
            try {
              await this.deps.persistence.appendEvent(sessionId, 'artifact/created', {
                kind: detected.kind,
                fileName: path.basename(made.path),
                path: made.path,
                bytes: made.bytes,
              })
            } catch { /* audit best-effort */ }
            text += `\n\n📄 Generated file: **${path.basename(made.path)}** — saved to ${made.path}`
            this.emit(sid, 'artifact:ready', {
              taskKind: classification.kind,
              modelId: routing.modelId,
              runtimeId: routing.runtimeId,
              fileName: path.basename(made.path),
              artifactPath: made.path,
              artifactKind: detected.kind,
              detail: `saved ${path.basename(made.path)} (${made.bytes.toLocaleString()} bytes)`,
            })
          }
        } catch (e) {
          // Artifact failure never destroys the chat reply — it stands alone.
          appendChatLog(this.deps.baseDir, {
            sessionId: sid, action: 'error', outcome: 'error',
            error: `artifact generation failed: ${e instanceof Error ? e.message : String(e)}`,
            modelId: model, runtimeId: routing.runtimeId,
          })
        }
      }

      const promptText = messages.map((m) => m.content).join(' ')
      const visionTokenEstimate = messages.reduce((n, m) => n + (m.images?.length ?? 0) * 1024, 0)
      const tokenUsage = usage ?? {
        promptTokens: Math.ceil(promptText.length / 4) + visionTokenEstimate,
        completionTokens: Math.ceil(text.length / 4),
        totalTokens: Math.ceil((promptText.length + text.length) / 4) + visionTokenEstimate,
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
      if (ownedInstanceForMetrics) {
        const elapsedS = Math.max(0.1, (Date.now() - startedAll) / 1000)
        this.noteEndQuiet(ownedInstanceForMetrics, {
          ...(orchFirstTokenAt !== null ? { ttftMs: orchFirstTokenAt - startedAll } : {}),
          tokensPerSec: tokenUsage.completionTokens / elapsedS,
        })
        ownedInstanceForMetrics = null
      }
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
      this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, vramTotalMB: resources.vram.totalMB, progress: 10, detail: 'Reserving VRAM...' })
      // Owned runtime: blocking VRAM load. Remote runtimes own their
      // lifecycle — no sidecar spawn, proceed straight to ready.
      let regenOwnedEndpoint: string | null = null
      const regenIsOwned = entry.endpoint === 'local' || entry.id === 'local' || routing.runtimeId === 'local'
      if (regenIsOwned) {
        this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, vramTotalMB: resources.vram.totalMB, progress: 35, detail: 'Loading GGUF into VRAM...' })
        const models = this.deps.models as ModelRuntimePort & {
          ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }>
        }
        const inst = models.ensureHealthy
          ? await models.ensureHealthy(routing.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: routing.runtimeId })
          : await this.deps.models.load(routing.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: routing.runtimeId })
        this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, vramTotalMB: resources.vram.totalMB, progress: 75, detail: 'Verifying health...' })
        const h = await this.deps.models.health(inst.id).catch(() => ({ ok: false, error: 'health-check-failed' }))
        if (!h.ok) throw new AgentOrchestratorError('model-load-failed', `instance unhealthy (${h.error ?? 'health check failed'}) -- refusing to route`)
        regenOwnedEndpoint = this.deps.models.baseUrl(inst.id)
      } else if (controller.signal.aborted) {
        throw new AgentOrchestratorError('cancelled', 'cancelled')
      }
      const snapAfter = await this.deps.resources.getSnapshot().catch(() => resources)
      this.emit(sid, 'model:ready', { taskKind: classification.kind, modelId: routing.modelId, runtimeId: routing.runtimeId, vramUsedMB: snapAfter.models.totalVramUsedMB, vramTotalMB: snapAfter.vram.totalMB, detail: routing.reason, progress: 100 })
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
      const endpoint = regenOwnedEndpoint ?? entry.endpoint
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
                const tail = parts[0] ?? ''
                reasoningBuffer += tail
                // Exactly-once streaming (see execute()): emit the tail only.
                if (tail) { this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: tail }) }
                if (reasoningBuffer) { try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}; reasoningBuffer = '' }
                inReasoning = false; delta = parts.slice(1).join(''); if (!delta) continue
              }
              if (inReasoning) { reasoningBuffer += delta; this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: delta }); continue }
            }
            text += delta; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: delta, progress: Math.min(95, 10 + Math.floor(text.length / 40)) })
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
      // Unclosed <thinking> block: deltas already streamed — persist the
      // full text so a later refresh reconstructs it instead of losing it.
      if (reasoningBuffer) {
        try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}
        reasoningBuffer = ''
      }
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

  async editAndResend(sessionId: SessionId, content: string, opts?: { webSearch?: boolean; reasoning?: boolean; attachments?: IncomingAttachment[] }): Promise<{ ok: true; userSeq: number; assistantSeq: number; routing: ModelRoutingDecision; classification: TaskClassification }> {
    const text = content.trim()
    if (!text) throw new AgentOrchestratorError('persistence-failed', 'cannot resend empty message')
    return this.execute(sessionId, text, opts)
  }

  private emit(sessionId: string, kind: ChatStreamEvent['kind'], extra: Partial<ChatStreamEvent> = {}): void {
    this.deps.emit({ sessionId, kind, ...extra })
  }

  /** Best-effort activity accounting — null-safe, never breaks inference. */
  private noteEndQuiet(instanceId: string | null, info?: { ttftMs?: number; tokensPerSec?: number }): void {
    if (!instanceId) return
    try {
      (this.deps.models as unknown as { noteRequestEnd?: (id: unknown, i?: unknown) => void }).noteRequestEnd?.(instanceId as never, info as never)
    } catch { /* accounting never breaks inference */ }
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

/** First-free path inside dir for an artifact name (stem, stem-2, stem-3, …). */
function uniqueArtifactPath(dir: string, fileName: string): string {
  const safe = sanitizeFileName(fileName, 'sovara-output')
  const ext = path.extname(safe)
  const stem = path.basename(safe, ext) || 'sovara-output'
  let candidate = path.join(dir, `${stem}${ext}`)
  for (let i = 2; i < 1000 && fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${stem}-${i}${ext}`)
  }
  return candidate
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
