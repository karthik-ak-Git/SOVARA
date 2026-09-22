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
import { routeModel, pickFittingModel } from './ModelRouter'
import { resolveCapabilities, capabilitiesForTask } from '@shared/types/modelCapabilities'
import { ChatInferenceError } from './ports/LocalOpenAIChatAdapter'
import { appendChatLog, appendRuntimeLog, safeTarget } from '../logging/runtimeLog'
import { getArtifactsDir } from '../storage/paths'
import { gateDispatch } from '../services/execPermissions'
import { processAttachments, buildAttachmentContext, type IncomingAttachment } from './attachments'
import { detectOutputFormat, generateArtifactFile, sanitizeFileName } from './artifacts'
import type { TaskClassification, ModelRoutingDecision } from '@shared/types/task'
import type { DiscoveredModel } from '@shared/types/models'
import { SOVARA_SYSTEM_PROMPT, STRUCTURED_OUTPUT_INSTRUCTION } from './prompts/sovaraSystem'
import { DEFAULT_TUNING } from '../config/tuning'

// ── Tool Infrastructure (DeepSeek Harness-style) ──
import { getToolInfrastructure, ToolInfrastructure } from './tools/index'
import { extractToolFences, stripToolFences, looksLikeToolFence, looksLikeBareToolCall, extractBareToolCalls, stripBareToolCalls } from './tools/fenceTools'
import type {
  ToolExecutionContext,
  ToolHook,
  ExecutionPolicy,
  ExecutionMode,
  ToolExecutionResult,
} from './tools/types'

/** 64 MB buffer headroom for local agent code generation & reasoning traces. */
const AGENT_MAX_RESPONSE_BYTES = 64_000_000

function isArtifactTruncated(text: string, detected: { kind: string; fileName: string }): boolean {
  const t = text.trim()
  if (!detected) return false
  const fences = (t.match(/```/g) ?? []).length
  if (fences % 2 === 1) return true
  if (detected.fileName.toLowerCase().endsWith('.html') || detected.kind === 'code') {
    if (/```html|<!doctype html|<html/i.test(t)) {
      if (!/<\/html\s*>/i.test(t)) return true
      if (/ppt|slides?|presentation/i.test(detected.fileName) && (t.match(/<\/section>/gi) ?? []).length < 2) {
      }
    }
  }
  if (t.length > 9000 && /```/.test(t) && !t.endsWith('```')) return true
  return false
}

// ── Hybrid context compression — mirrors ChatService.buildBudgetedHistory ──
// Microsoft hybrid (summary + sliding window 3-5), ACC-RAG adaptive, VSCode ghost-data fix (lossy, not near-lossless)
// Importance: decisions, errors, code fences, URLs, artifacts — preserved; tool traces & duplicated file content omitted.
function importanceScore(sentence: string): number {
  const s = sentence.toLowerCase()
  let score = 0
  if (/```/.test(sentence)) score += 3
  if (/https?:\/\//.test(sentence)) score += 3
  if (/(decided|agreed|confirmed|chosen|selected|error|bug|crash|failed|fix|decis)/.test(s)) score += 2
  if (/\$[\d,]+/.test(sentence)) score += 2
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(sentence)) score += 1
  if (/(artifact|saved at|generated file|ppt|html|pdf|xlsx|docx)/.test(s)) score += 2.5
  if (sentence.length > 40 && sentence.length < 240) score += 0.5
  return score
}
function summarizeOlderTurns(older: import('@shared/types/ports').LlmChatMessage[], maxChars: number): string | null {
  if (older.length === 0) return null
  const collapsed = older.map((m) => {
    let c = m.content
    if (c.length > 4000 && /```(html|tsx|python)/.test(c)) {
      const firstLine = c.split('\n').find((l) => l.trim().length > 0)?.slice(0, 120) ?? ''
      const kind = /```html/.test(c) ? 'HTML' : /```tsx/.test(c) ? 'TSX' : 'code'
      return `${m.role}: [Previous ${kind} artifact ~${Math.round(c.length/1000)}k chars, first line: ${firstLine.slice(0,80)} — saved on disk, not repeated]`
    }
    if (c.length > 1200) {
      const sentences = c.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
      const scored = sentences.map((s) => ({ s, sc: importanceScore(s) })).sort((a, b) => b.sc - a.sc)
      const top = scored.slice(0, Math.min(3, sentences.length)).map((x) => x.s).join(' ')
      return `${m.role}: ${top.slice(0, 600)}${c.length > 600 ? '…' : ''}`
    }
    return `${m.role}: ${c.slice(0, 600)}`
  })
  let summary = collapsed.join('\n').slice(0, maxChars)
  if (summary.length > maxChars) summary = summary.slice(0, maxChars - 20) + '…'
  return summary
}
function buildBudgetedHistory(
  events: Array<{ seq: number; time: number; type: string; data: unknown }>,
  systemChars: number,
  nCtx: number,
  opts?: { slidingWindowTurns?: number; reservedCompletionTokens?: number }
): import('@shared/types/ports').LlmChatMessage[] {
  const sliding = opts?.slidingWindowTurns ?? DEFAULT_TUNING.slidingWindowTurns
  const reserved = opts?.reservedCompletionTokens ?? DEFAULT_TUNING.reservedCompletionTokens
  const budgetTokens = Math.max(800, nCtx - reserved)
  const budgetChars = budgetTokens * 4
  const historyBudgetChars = Math.max(800, budgetChars - systemChars)
  const allTurns = toRequestMessages(events)
  if (allTurns.length === 0) return allTurns
  const totalChars = allTurns.reduce((n, m) => n + m.content.length, 0)
  if (totalChars <= historyBudgetChars) return allTurns
  const keepMessages = sliding * 2
  const rawRecent = allTurns.slice(-keepMessages)
  const recent = rawRecent.map((m) => {
    if (m.content.length > 4000 && /```(html|tsx|python)/.test(m.content)) {
      const firstLine = m.content.split('\n').find((l) => l.trim().length > 0)?.slice(0, 120) ?? ''
      const kind = /```html/.test(m.content) ? 'HTML' : /```tsx/.test(m.content) ? 'TSX' : 'code'
      return { ...m, content: `[Recent ${kind} artifact ~${Math.round(m.content.length/1000)}k chars, first line: ${firstLine.slice(0,80)} — saved on disk, history reference only]\n${m.content.slice(0, 800)}…[truncated for budget, see saved file]` }
    }
    return m
  })
  const older = allTurns.slice(0, -keepMessages)
  if (older.length === 0) {
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
  const summaryMsg: import('@shared/types/ports').LlmChatMessage = {
    role: 'user',
    content: `[Conversation summary — ${older.length} earlier messages compressed, ${allTurns.length} total → ${recent.length} recent kept verbatim]\n${summaryText}`,
  }
  const out = [summaryMsg, ...recent]
  let outChars = out.reduce((n, m) => n + m.content.length, 0)
  if (outChars > historyBudgetChars) {
    const excess = outChars - historyBudgetChars
    summaryMsg.content = summaryMsg.content.slice(0, Math.max(300, summaryMsg.content.length - excess - 50)) + '\n…[summary truncated for budget]'
  }
  return out
}
function compactForCtx(messages: import('@shared/types/ports').LlmChatMessage[], nCtx: number): import('@shared/types/ports').LlmChatMessage[] {
  const reserved = 1200
  const budgetTokens = Math.max(800, nCtx - reserved)
  const budgetChars = budgetTokens * 4
  let chars = messages.reduce((n, m) => n + m.content.length, 0)
  if (chars <= budgetChars) return messages
  const out = [...messages]
  // 1. Drop intermediate history turns first
  while (out.length > 2 && chars > budgetChars) {
    const dropIdx = 1
    chars -= out[dropIdx].content.length
    out.splice(dropIdx, 1)
  }
  if (chars > budgetChars && out.length > 2) {
    const excess = chars - budgetChars
    out[1].content = out[1].content.slice(0, Math.max(200, out[1].content.length - excess - 200)) + '…[truncated]'
    chars = out.reduce((n, m) => n + m.content.length, 0)
  }
  // 2. If still over budget with only system + user message, truncate oversized system block or prompt
  if (chars > budgetChars && out.length >= 1) {
    const excess = chars - budgetChars
    if (out.length > 1 && out[0].content.length > out[1].content.length) {
      out[0].content = out[0].content.slice(0, Math.max(1000, out[0].content.length - excess - 100)) + '\n…[system prompt truncated for context budget]'
    } else if (out.length > 1) {
      out[1].content = out[1].content.slice(0, Math.max(500, out[1].content.length - excess - 100)) + '\n…[user prompt truncated for context budget]'
    } else {
      out[0].content = out[0].content.slice(0, Math.max(1000, out[0].content.length - excess - 100)) + '\n…[truncated]'
    }
  }
  return out
}

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
  getSkillsContext?: (userPrompt?: string, wsRoot?: string) => Promise<string | null>
  getTodoContext?: () => string | null
  getExecMode?: () => 'off' | 'ask' | 'review' | 'allow'
  // ── Tool Infrastructure (DeepSeek Harness-style) ──
  toolInfrastructure?: ToolInfrastructure
}

const CHAT_SYSTEM_PROMPT = SOVARA_SYSTEM_PROMPT

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
  const bounded = turns.slice(-DEFAULT_TUNING.historyMaxMessages)
  let chars = bounded.reduce((n, m) => n + m.content.length, 0)
  while (bounded.length > 1 && chars > DEFAULT_TUNING.historyMaxChars) {
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
  private readonly pendingApprovals = new Map<string, { resolve: (val: { approved: boolean, modifiedArgs?: any }) => void }>()

  public resolveToolApproval(toolCallId: string, approved: boolean, modifiedArgs?: any) {
    const pending = this.pendingApprovals.get(toolCallId)
    if (pending) {
      pending.resolve({ approved, modifiedArgs })
      this.pendingApprovals.delete(toolCallId)
    }
  }

  constructor(private readonly deps: AgentOrchestratorDeps) {}

  setEmit(emit: (event: ChatStreamEvent) => void): void {
    ;(this.deps as { emit: (event: ChatStreamEvent) => void }).emit = emit
  }

  // ── Tool Infrastructure Access ──
  private getToolInfra(): ToolInfrastructure | null {
    return this.deps.toolInfrastructure ?? getToolInfrastructure()
  }

  /**
   * Execute a tool using the comprehensive tool infrastructure (DeepSeek Harness-style).
   * Supports lifecycle hooks, parallel execution, PTC mode, and execution policies.
   */
  private async executeToolWithInfrastructure(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
    context: {
      taskKind: string
      stepIndex: number
      parallelStrategy?: 'sequential' | 'all' | 'race' | 'settled' | 'exclusive'
      executionPolicy?: ExecutionPolicy
      lifecycleHooks?: any
      maxConcurrency?: number
    }
  ): Promise<{ ok: true; output: string; durationMs: number } | { ok: false; error: string; durationMs: number }> {
    const startTime = Date.now()
    const infra = this.getToolInfra()

    // 1. If tool is registered in the enhanced infrastructure with a registered handler, run it there
    if (infra && infra.getRegistry().has(toolName)) {
      try {
        const policy: ExecutionPolicy = {
          mode: context.parallelStrategy === 'exclusive' ? 'exclusive' : 'parallel',
          maxConcurrent: context.maxConcurrency,
        }
        const toolContext: ToolExecutionContext = {
          toolCallId: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          toolName,
          arguments: args,
          sessionId,
          startTime,
          metadata: {
            source: 'orchestrator',
            taskKind: context.taskKind,
            stepIndex: context.stepIndex,
          },
        }
        const result = await infra.getScheduler().schedule(toolName, args, policy, toolContext)
        if (result.success) {
          const outStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? '')
          return { ok: true, output: outStr, durationMs: result.executionTime }
        }
      } catch {
        // Fall back to primary dispatch
      }
    }

    // 2. Primary tool dispatcher via ToolStubAdapter (fs_list, fs_read, fs_write, fs_patch, todo_write, shell_exec, etc.)
    try {
      const output = await (this.deps.tools as unknown as { dispatch: (n: string, a: Record<string, unknown>) => Promise<string> }).dispatch(toolName, args)
      return { ok: true, output, durationMs: Date.now() - startTime }
    } catch (e) {
      return { ok: false, error: String(e), durationMs: Date.now() - startTime }
    }
  }

  /**
   * Execute multiple tools in parallel using the ExecutionScheduler.
   * Respects exclusive tool constraints and max concurrency settings.
   */
  private async executeToolsParallel(
    sessionId: string,
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>,
    context: {
      taskKind: string
      parallelStrategy?: string
      maxConcurrency?: number
    }
  ): Promise<Array<{ name: string; result: ToolExecutionResult }>> {
    const infra = this.getToolInfra()
    if (!infra) {
      // Fallback to sequential legacy dispatch
      const results: Array<{ name: string; result: ToolExecutionResult }> = []
      for (const tc of toolCalls) {
        try {
          const output = await (this.deps.tools as unknown as { dispatch: (n: string, a: Record<string, unknown>) => Promise<string> }).dispatch(tc.name, tc.args)
          results.push({
            name: tc.name,
            result: {
              toolCallId: `call_${Date.now()}`,
              toolName: tc.name,
              success: true,
              output,
              executionTime: 0,
            },
          })
        } catch (e) {
          results.push({
            name: tc.name,
            result: {
              toolCallId: `call_${Date.now()}`,
              toolName: tc.name,
              success: false,
              error: String(e),
              executionTime: 0,
            },
          })
        }
      }
      return results
    }

    // Use the infrastructure's scheduler for parallel execution
    const toolContext: ToolExecutionContext = {
      toolCallId: `batch_${Date.now()}`,
      toolName: 'batch',
      arguments: {},
      sessionId,
      startTime: Date.now(),
      metadata: {
        taskKind: context.taskKind,
        source: 'orchestrator-parallel',
        batchSize: toolCalls.length,
      },
    }

    const tasks = toolCalls.map((tc) => ({
      toolName: tc.name,
      arguments: tc.args,
      context: toolContext,
    }))

    const batchResults = await infra.getScheduler().scheduleParallel(tasks, context.maxConcurrency)
    return batchResults.map((res) => ({ name: res.toolName, result: res }))
  }

  private safeLog(msg: string): void { try { console.log(msg) } catch {} }
  cancel(sessionId: SessionId): { cancelled: boolean } {
    const c = this.inFlight.get(String(sessionId))
    if (!c) return { cancelled: false }
    this.safeLog(`[AgentOrchestrator] cancel sid=${String(sessionId)}`)
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
    // Hard stall guard: empty waits are user-hostile. Abort if no token arrives within
    // the tunable stall window and surface a friendly ack.
    let stallTimer: ReturnType<typeof setTimeout> | null = null
    const armStallGuard = (firstTokenAtRef: { value: number | null }): void => {
      const stallMs = DEFAULT_TUNING.stallGuardMs
      stallTimer = setTimeout(() => {
        if (firstTokenAtRef.value === null && this.inFlight.has(sid) && !controller.signal.aborted) {
          appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'timeout', error: `stall-timeout: no token after ${Math.round(stallMs / 1000)}s (model ${sid})` })
          controller.abort(new Error(`stall-timeout: the local model did not produce any token in ${Math.round(stallMs / 1000)}s`))
        }
      }, stallMs)
      // Node timers should not keep process alive after UI closed
      if (stallTimer && typeof (stallTimer as unknown as { unref?: () => void }).unref === 'function') (stallTimer as unknown as { unref: () => void }).unref!()
    }

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
      // Snapshot the user's initially selected model as the "base" that
      // will book-end the run: base → (tool models)* → base (formatted).
      this.emit(sid, 'model:selecting', { taskKind: classification.kind, detail: `routing for ${classification.kind}` })
      const isAutoPre = this.deps.workbench.getActiveModel().selection?.modelId === '__auto__'
      const wbHidden = this.deps.workbench as unknown as { listModelsForRouting?: () => DiscoveredModel[] }
      const models = isAutoPre && typeof wbHidden.listModelsForRouting === 'function'
        ? wbHidden.listModelsForRouting()
        : this.deps.workbench.listModels()
      const active = this.deps.workbench.getActiveModel()
      const resources = await this.deps.resources.getSnapshot()
      const baseSnapshot = active.selection ? { modelId: active.selection.modelId, runtimeId: active.selection.runtimeId } : null

      // Pinned vs Auto: user selected model is used for entire chat; Auto smart-routes per task.
      // The pill shows which: pinned = local model name, Auto = "Auto" smart.
      // Hidden needle3 is included in modelsForRouting when Auto, so tool-use picks needle3.
      const isAuto = active.selection?.modelId === '__auto__' && active.selection?.runtimeId === 'auto'
      let routing: Awaited<ReturnType<typeof routeModel>>
      if (!isAuto && baseSnapshot) {
        // Pinned — no smart routing, entire chat uses user selection (user request)
        routing = {
          modelId: baseSnapshot.modelId,
          runtimeId: baseSnapshot.runtimeId,
          reason: `pinned ${baseSnapshot.modelId} — entire chat uses user selection`,
          task: classification,
          candidatesConsidered: 1,
          switched: false,
        } as unknown as Awaited<ReturnType<typeof routeModel>>
      } else {
        // Auto — smart route per task via ModelRouter (capability + VRAM aware)
        // Hidden needle3 (Cactus-Compute/needle3) is first in listModelsForRouting when downloaded — tool-use will prefer it
        routing = await routeModel({
          task: classification,
          models,
          active: isAuto ? null : active.selection ?? null,
          resources,
          checkBeforeLoad: async (modelId) => {
            try {
              const m = models.find((x) => x.modelId === modelId)
              const resolvedPath = this.resolveModelFilePath(modelId) ?? (m as { path?: string })?.path ?? (m as { filePath?: string })?.filePath
              return await this.deps.resources.checkBeforeLoad(
                { id: modelId as never, displayName: m?.displayName ?? modelId, path: resolvedPath, source: 'custom', format: 'gguf' } as never,
                { ctxLen: classification.contextLengthNeeded }
              )
            } catch {
              return { level: 'ok' as const }
            }
          },
        })
        // For simple tasks honor base over scored GLM (even when router ran due to no base check) — but only if not Auto
        if (!isAuto && baseSnapshot && (classification.kind === 'chat' || classification.kind === 'summarization') && !classification.requiresVision && routing.modelId !== baseSnapshot.modelId) {
          routing = {
            modelId: baseSnapshot.modelId,
            runtimeId: baseSnapshot.runtimeId,
            reason: `honoring pinned ${baseSnapshot.modelId} over scored ${routing.modelId} (simple)`,
            task: classification,
            candidatesConsidered: 1,
            switched: false,
          } as unknown as Awaited<ReturnType<typeof routeModel>>
        }
      }

      if (!routing.modelId! || !routing.runtimeId!) {
        const msg = `No compatible model available for task "${classification.kind}". ${routing.reason}`
        this.emit(sid, 'task:error', { taskKind: classification.kind, detail: msg, error: msg })
        throw new AgentOrchestratorError('no-model-available', msg)
      }

      // Resource block already handled by router, but final guard with real path
      const routedM = models.find((x) => x.modelId === routing.modelId!)
      const routedPath = this.resolveModelFilePath(routing.modelId!) ?? (routedM as { path?: string })?.path ?? (routedM as { filePath?: string })?.filePath
      const pressure = await this.deps.resources.checkBeforeLoad(
        { id: routing.modelId! as never, displayName: routedM?.displayName ?? routing.modelId!, path: routedPath, source: 'custom', format: 'gguf' } as never,
        { ctxLen: classification.contextLengthNeeded }
      )
      if (pressure.blocking) {
        const msg = pressure.reason ?? 'load refused'
        // Auto-fallback: try next model in router score order (score already computed) — pick first non-blocking
        const remaining = models.filter((m) => m.available && m.modelId !== routing.modelId!)
        let fallback: typeof routing | null = null
        for (const cand of remaining) {
          try {
            const candPath = this.resolveModelFilePath(cand.modelId) ?? (cand as { path?: string })?.path
            const p = await this.deps.resources.checkBeforeLoad({ id: cand.modelId as never, displayName: cand.displayName, path: candPath, source: 'custom', format: 'gguf' } as never, { ctxLen: classification.contextLengthNeeded })
            if (!p.blocking) {
              fallback = { modelId: cand.modelId, runtimeId: cand.runtimeId, reason: `auto-fallback from ${routing.modelId!} blocked (${msg.slice(0,60)}) → ${cand.modelId}`, task: classification, candidatesConsidered: remaining.length, switched: true }
              break
            }
          } catch {}
        }
        if (fallback) {
          this.safeLog(`[SOVARA][ROUTER] auto-fallback ${routing.modelId!} blocked → ${fallback.modelId} (${msg})`)
          this.emit(sid, 'model:selecting', { taskKind: classification.kind, detail: `auto-fallback to ${fallback.modelId}` })
          routing = fallback
        } else {
          const errMsg = `resource-pressure: ${msg}`
          this.emit(sid, 'task:error', { taskKind: classification.kind, detail: errMsg, error: errMsg })
          throw new AgentOrchestratorError('resource-blocked', errMsg)
        }
      }

      // ── PHASE 3: user selection sovereign — honor it; try full then partial/CPU offload transparently
      {
        const selModel = models.find((m) => m.modelId === routing.modelId!)
        const selPath = this.resolveModelFilePath(routing.modelId!) ?? (selModel as { path?: string })?.path ?? (selModel as { filePath?: string })?.filePath
        const fullPressure = await this.deps.resources.checkBeforeLoad(
          { id: routing.modelId! as never, displayName: selModel?.displayName ?? routing.modelId!, path: selPath, source: 'custom', format: 'gguf' } as never,
          { ctxLen: classification.contextLengthNeeded },
        ).catch(() => ({ blocking: false } as never))
        if ((fullPressure as { blocking?: boolean }).blocking || (fullPressure as { level?: string }).level === 'warn') {
          this.safeLog(`[SOVARA][ROUTER] user-selected ${routing.modelId!} exceeds full VRAM, enabling partial/CPU offload`)
          ;(routing as unknown as Record<string, unknown>).gpuMode = 'fit'
        }
        // Mark switched so workbench persists selection if needed and lifecycle uses correct gpuMode
        if (baseSnapshot && routing.modelId === baseSnapshot.modelId) {
          routing.switched = false
        }
      }
      let entry = this.deps.workbench.describeRuntime(routing.runtimeId!)
      if (!entry || !entry.enabled) {
        const msg = 'The selected runtime is unavailable. Open Models and test its connection.'
        this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: msg, error: msg })
        throw new AgentOrchestratorError('runtime-unavailable', msg)
      }

      // If router switched, make it the active selection (persisted, not silent)
      let switched = false
      if (routing.switched) {
        try {
          await this.deps.workbench.selectModel(routing.runtimeId!, routing.modelId!)
          switched = true
          entry = this.deps.workbench.describeRuntime(routing.runtimeId!)!
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'model selection failed'
          this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: msg, error: msg })
          throw new AgentOrchestratorError('model-load-failed', msg)
        }
      }

      // ── PHASE 4: model lifecycle — owned runtime loads the GGUF into VRAM
      // (switch evicts the previous resident). Third-party loopback runtimes
      // own their lifecycle — selection alone suffices, no sidecar spawn.
      const vramTotal = resources.vram.totalMB
      const isOwnedRuntime = entry!.endpoint === 'local' || entry.id === 'local' || routing.runtimeId! === 'local'
      let ownedEndpoint: string | null = null
      let ownedInstanceForMetrics: string | null = null

      this.emit(sid, 'model:loading', {
        taskKind: classification.kind,
        modelId: routing.modelId!,
        runtimeId: routing.runtimeId!,
        vramTotalMB: vramTotal,
        detail: switched ? `selected ${routing.modelId!} — loading` : `model ${routing.modelId!} — checking`,
      })

      try {
        if (isOwnedRuntime) {
          // Blocking load: resolves only when /health is green (VRAM-resident).
          // Verify health before routing — never trust process existence alone.
          const models = this.deps.models as ModelRuntimePort & {
            ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }>
          }
          const gpuMode = (routing as unknown as { gpuMode?: string }).gpuMode as 'fit' | undefined
          const inst = models.ensureHealthy
            ? await models.ensureHealthy(routing.modelId! as never, {
              ctxLen: classification.contextLengthNeeded,
              runtimeId: routing.runtimeId!,
              ...(gpuMode ? { gpu: gpuMode } : {}),
            })
            : await this.deps.models.load(routing.modelId! as never, {
              ctxLen: classification.contextLengthNeeded,
              runtimeId: routing.runtimeId!,
              ...(gpuMode ? { gpu: gpuMode } : {}),
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
        // Invalidate cached hardware metrics to capture fresh post-load VRAM
        this.deps.resources.clearHwCache?.()
        const snapAfter = await this.deps.resources.getSnapshot().catch(() => resources)
        this.emit(sid, 'model:ready', {
          taskKind: classification.kind,
          modelId: routing.modelId!,
          runtimeId: routing.runtimeId!,
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
          // Transparent fallback for "even partial does not fit" — dynamic: rank by ACTUAL
          // free VRAM/RAM fit via pickFittingModel (no hardcoded model names).
          let handledFallback = false
          if (/even partial offload does not fit/i.test(msg)) {
            const fit = pickFittingModel(models, resources, { excludeModelId: routing.modelId!, ctxLenNeeded: classification.contextLengthNeeded })
            const fallback: DiscoveredModel | null = fit?.model ?? null
            if (fallback && fallback.modelId !== routing.modelId) {
              const fitLabel = fit!.gpu ? `fits ${fit!.fitMb.toFixed(0)}MB VRAM` : `fits ${fit!.fitMb.toFixed(0)}MB RAM (CPU offload)`
              this.safeLog(`[SOVARA][LLAMA] ${routing.modelId!} no-fit → auto-fallback to ${fallback.modelId} (${fitLabel}, was user-selected but cannot fit ${(resources.vram.totalMB ?? 0).toFixed(0)}MB VRAM)`)
              this.emit(sid, 'task:planning', { taskKind: classification.kind, detail: `Selected ${routing.modelId!} too large for this GPU (even partial), auto-switching to ${fallback.displayName} that fits` })
              // Persist fallback as new active so pill and next turn stay consistent
              try { await this.deps.workbench.selectModel('local', fallback.modelId) } catch {}
              routing.modelId = fallback.modelId
              routing.runtimeId = fallback.runtimeId
              routing.reason = `auto-fallback: ${msg.slice(0,60)} → ${fallback.modelId}`
              // Retry load once with fitting model (evicts old resident transparently)
              try {
                const retryInst = (this.deps.models as ModelRuntimePort & { ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown }> }).ensureHealthy
                  ? await (this.deps.models as ModelRuntimePort & { ensureHealthy: (m: never, o?: unknown) => Promise<{ id: unknown }> }).ensureHealthy(fallback.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: 'local' } as never)
                  : await this.deps.models.load(fallback.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: 'local' } as never)
                const h2 = await this.deps.models.health(retryInst.id).catch(() => ({ ok: false }))
                if (h2.ok) {
                  ownedEndpoint = this.deps.models.baseUrl(retryInst.id)
                  try { (this.deps.models as unknown as { noteRequestStart?: (id: unknown) => void }).noteRequestStart?.(retryInst.id); ownedInstanceForMetrics = String(retryInst.id) } catch {}
                  const snapAfter2 = await this.deps.resources.getSnapshot().catch(() => resources)
                  this.emit(sid, 'model:ready', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, vramUsedMB: snapAfter2.models.totalVramUsedMB, vramTotalMB: snapAfter2.vram.totalMB, detail: routing.reason })
                  handledFallback = true
                  // Fallback succeeded — don't throw, let execution continue to streaming with new model
                } else {
                  const msg2 = `fallback ${fallback.modelId} also unhealthy`
                  this.emit(sid, 'task:error', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: msg2, error: msg2 })
                  throw new AgentOrchestratorError('resource-blocked', msg2)
                }
              } catch (e2) {
                const msg2 = e2 instanceof Error ? e2.message : String(e2)
                this.emit(sid, 'task:error', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: msg2, error: msg2 })
                throw new AgentOrchestratorError('resource-blocked', msg2)
              }
            }
          }
          if (!handledFallback) {
            this.emit(sid, 'task:error', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: msg, error: msg })
            throw new AgentOrchestratorError('resource-blocked', msg)
          }
          // Fallback succeeded (fitting model loaded) — skip sovereign-fallback below,
          // which would otherwise re-throw the stale message via its else branch.
        } else {
          // Not a resource error → sovereign fallback check below applies.
          // (Resource errors with successful fitting-model fallback already continued to
          // inference above and never reach here.)
          // Sovereign fallback: owned sidecar blocked (spawn UNKNOWN / MOTW /
          // WDAC) → try LM Studio / Ollama loopback before failing. The user's
          // GGUFs already live in .lmstudio/models, so LM Studio can serve them
          // with zero reinstall when our binary is quarantined.
          if (isOwnedRuntime && /spawn unknown|could not start|blocked|not installed|unknown/i.test(msg)) {
          const fb = await this.tryExternalFallback(sid, classification, routing.modelId!)
          if (fb) {
            this.emit(sid, 'model:selecting', { taskKind: classification.kind, detail: `owned sidecar blocked — fallback to ${fb.displayName} (${fb.modelId})` })
            routing.modelId = fb.modelId
            routing.runtimeId = fb.runtimeId
            routing.reason = `${routing.reason} | fallback: owned blocked → ${fb.displayName}`
            entry = this.deps.workbench.describeRuntime(fb.runtimeId)!
            // External runtimes own their lifecycle — no sidecar spawn.
            ownedEndpoint = null
            ownedInstanceForMetrics = null
            const snapAfter = await this.deps.resources.getSnapshot().catch(() => resources)
            this.emit(sid, 'model:ready', {
              taskKind: classification.kind,
              modelId: routing.modelId!,
              runtimeId: routing.runtimeId!,
              vramUsedMB: snapAfter.models.totalVramUsedMB,
              vramTotalMB: snapAfter.vram.totalMB,
              detail: `fallback ready via ${fb.displayName}`,
            })
            // Fall through to inference with the external endpoint below.
          } else {
            const hint = `${msg} — Owned sidecar blocked and no LM Studio/Ollama server answered. Fix: Models → Unblock & Retry (MOTW), or start LM Studio server on :1234 (Server tab → Start), or Ollama on :11434, then Test + Select.`
            this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: hint, error: hint })
            throw new AgentOrchestratorError('model-load-failed', hint)
          }
        } else {
          this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: msg, error: msg })
          throw new AgentOrchestratorError('model-load-failed', msg)
        }
        } // else: non-resource load error handled by sovereign fallback above
      }

      // ── PHASE 4b: vision check — does the routed model actually see pixels?
      // resolveCapabilities is the ONLY capability source (registry or
      // adapter-advertised); text-only winners get metadata, never fake sight.
      const routedModel = models.find((m) => m.modelId === routing.modelId! && m.runtimeId === routing.runtimeId!)
      const routedCaps = resolveCapabilities(
        routing.modelId!,
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
      let wsRoot: string | null = null
      try {
        const header = await this.deps.persistence.get(sessionId)
        const pid = header?.projectId ?? null
        const projectRoot = this.deps.getProjectWorkspace?.(pid) ?? null
        const globalRoot = this.deps.getGlobalWorkspace?.() ?? null
        wsRoot = projectRoot ?? globalRoot
        if (wsRoot) {
          workspaceContext = pid && projectRoot
            ? `Project workspace: ${projectRoot} (project ${pid}) — global fallback: ${globalRoot ?? 'none'}`
            : `Global workspace: ${wsRoot}${projectRoot ? ` (project ${pid} at ${projectRoot})` : ''}`
        }
      } catch { /* advisory */ }
      let mcpContext: string | null = null
      try { 
        mcpContext = this.deps.getMcpContext?.() ?? null
        if (mcpContext) this.emit(sid, 'task:reading', { taskKind: classification.kind, fileName: 'MCP Context', detail: 'Reading configured MCP servers...' })
      } catch { /* ignore */ }
      let skillsContext: string | null = null
      try { 
        skillsContext = (await this.deps.getSkillsContext?.(content, wsRoot ?? undefined)) ?? null
        if (skillsContext) {
          const matchSkillHeader = skillsContext.match(/\[Superpower Orchestrator Active Skills:\s*([^\]]+)\]/)
          const skillList = matchSkillHeader ? matchSkillHeader[1] : 'Enterprise Skills'
          this.emit(sid, 'task:reading', { taskKind: classification.kind, fileName: `Skills: ${skillList}`, detail: `Active skills: ${skillList}` })
        }
      } catch { /* ignore */ }
      let todoContext: string | null = null
      try { todoContext = this.deps.getTodoContext?.() ?? null } catch { /* ignore */ }
      let webContext: string | null = null
      if (opts?.webSearch && this.deps.webSearch) {
        try { webContext = await this.deps.webSearch(content) } catch { webContext = null }
      }

      // ── OCR fallback for images when model has no vision/mmproj (e.g. baidu.Unlimited-OCR GGUF) ──
      // Unlimited-OCR via sidecar is the best model — run it and inject text so non-vision GGUF still reads the image
      if (!visionCapable) {
        for (const f of attached.files) {
          if (f.kind === 'image' && f.imageBase64 && !f.text) {
            try {
              const { ocrImage } = await import('../services/voiceServer')
              const r = await ocrImage(f.imageBase64, 'rapidocr')
              if (r?.text) { f.text = r.text; f.note = null }
            } catch {}
          }
        }
      }
      // ── PHASE 5b: prompt assembly state (honest stage for the send animation) ──
      const attachmentContext = buildAttachmentContext(attached.files, visionCapable)
      this.emit(sid, 'task:prompting', {
        taskKind: classification.kind,
        modelId: routing.modelId!,
        runtimeId: routing.runtimeId!,
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
          modelId: routing.modelId!,
          runtimeId: routing.runtimeId!,
          reason: routing.reason,
        })
      } catch { /* audit event best-effort */ }

      const thinkingLevel = (opts as unknown as { thinkingLevel?: string })?.thinkingLevel ?? (opts?.reasoning ? 'medium' : 'off')
      const reasoningSystem =
        thinkingLevel === 'off' ? null
        : thinkingLevel === 'low'
          ? 'Think briefly (1-2 sentences) inside <thinking> tags, then give the final answer.'
          : thinkingLevel === 'high'
            ? 'Think extensively step by step inside <thinking> tags (explore alternatives, verify plan), then give the final comprehensive answer.'
            : 'Think step by step inside <thinking> tags, then give the final answer.'
      // Single leading system message — Bonsai/Mistral Jinja aborts if any
      // system turn appears after index 0 ("System message must be at the
      // beginning"). Merge all advisory blocks into one.
      // Human fix: local llama.cpp gets NO native tools array (adapter sends messages-only),
      // so the model must be told the exact tool-call convention. Otherwise Qwen-7/32 hallucinates
      // <fs_list> text and we exit after 1 step with 62 tokens.
      let toolCatalog: string | null = null
      try {
        const infra = this.getToolInfra()
        const defs = infra ? infra.getRegistry().list() : (this.deps.tools as unknown as { list?: () => Array<{ name: string; description: string }> }).list?.() ?? []
        
        if (defs.length > 0) {
          const lines = defs.map((d) => `- ${d.name}: ${d.description}`).join('\n')
          toolCatalog =
            `TOOLS — call with a fenced block, NOT XML. Format exactly:\n\`\`\`tool:fs_list\n{"path": "."}\n\`\`\`\n` +
            `Available tools:\n${lines}\n` +
            `Rules: 1) For exploration or inspections, you may call fs_list or fs_read directly. ` +
            `2) Emit ONE fenced tool block per step, then wait for its [Tool result] before the next. ` +
            `3) Use shell_exec for running python, bash, powershell, or npm scripts. Use run_code ONLY for JavaScript snippets executing programmatic tool calls (PTC). ` +
            `4) When asked to build, write, or generate code/apps/files, generate the complete functioning implementation immediately.`
        }
      } catch { /* advisory */ }
      // No hard-coded bypasses — all workspace FS goes through the global ToolInfrastructure.
      // getProjectWorkspace / getGlobalWorkspace (AppBackend.ts:128,171) resolves the
      // visually-selected project (Session's projectId) for every tool dispatch.
      // DeepSeek harness parity: ToolRegistry + ExecutionScheduler (isConcurrencySafe) + BlockAssembler
      const shouldStructured = classification.kind === 'coding' || classification.kind === 'tool-use' || classification.kind === 'agent' || /\b(build|create|write|make|dashboard|implement|generate|update|code|fix|check|solve|repair|setup|add|edit|refactor|render|draw|review|canvas|game|timer|mermaid|diagram|app|react|html)\b/i.test(content)
      const systemBlocks = [
        CHAT_SYSTEM_PROMPT,
        ...(shouldStructured ? [STRUCTURED_OUTPUT_INSTRUCTION] : []),
        ...(reasoningSystem ? [reasoningSystem] : []),
        ...(toolCatalog ? [toolCatalog] : []),
        ...(workspaceContext ? [workspaceContext] : []),
        ...(mcpContext ? [mcpContext] : []),
        ...(skillsContext ? [skillsContext] : []),
        ...(todoContext ? [todoContext] : []),
        ...(webContext ? [webContext] : []),
        ...attachmentContext,
      ]
      // ── Budget-aware hybrid compression (prod pattern: summary + sliding window) ──
      // Research: Microsoft "Summarized Context + Sliding Window" (3-5 recent full, older summarized),
      // ACC-RAG adaptive, VSCode ghost-data fix (lossy, omit tool traces, reference file path not content).
      // We fit prompt into nCtx minus reserved completion, preserving decisions/code/URLs via importance.
      let nCtx = classification.contextLengthNeeded || 8192
      // Try to read actual server ctx from resident instance
      try {
        const insts = await this.deps.models?.listInstances?.() as unknown as Array<{ id: string; ctxLen?: number; modelId?: string }> | undefined
        const hit = insts?.find((x) => String(x.modelId) === String(routing.modelId!) || String(x.id).includes(String(routing.modelId!).replace(/[^a-z0-9]/gi, '_')))
        if (hit?.ctxLen && hit.ctxLen > 0) nCtx = hit.ctxLen
      } catch {}
      const systemChars = systemBlocks.join('\n\n').length
      // Floor 8192 — sovereign prompt is 6460 tokens, so 4096 always overflows.
      // RAG first, then budget hybrid as fallback
      const { retrieveRelevant } = await import('./rag/semanticSearch')
      const ragPrior = retrieveRelevant(prior, content, { maxChunks: 6, maxChars: 12000 })
      let historyMsgs: import('@shared/types/ports').LlmChatMessage[]
      // If RAG already fits budget, use it; else hybrid compress the FULL prior (not just RAG) to preserve detail via summary
      const ragTurns = toRequestMessages(ragPrior)
      const estRagTokens = Math.ceil((systemChars + ragTurns.reduce((n, m) => n + m.content.length, 0) + content.length) / 4)
      const budgetTokens = Math.max(800, nCtx - 1200)
      if (estRagTokens <= budgetTokens) {
        historyMsgs = ragTurns
      } else {
        // Hybrid: last 3 turns verbatim, older summarized via importance (code/URLs/decisions/artifacts)
        historyMsgs = buildBudgetedHistory(prior, systemChars, nCtx, { slidingWindowTurns: 3, reservedCompletionTokens: 1200 })
      }
      let messages: import('@shared/types/ports').LlmChatMessage[] = compactForCtx(
        [
          { role: 'system', content: systemBlocks.join('\n\n') },
          ...historyMsgs,
          { role: 'user', content, ...(visionImages.length > 0 ? { images: visionImages } : {}) },
        ],
        nCtx
      )
      let autoRetried = false // one automatic retry after compact on empty/stall

      appendChatLog(this.deps.baseDir, {
        sessionId: sid,
        action: 'send',
        modelId: routing.modelId!,
        runtimeId: routing.runtimeId!,
        injected: { workspace: !!workspaceContext, mcp: !!mcpContext, skills: !!skillsContext, webSearch: !!webContext },
        detail: `task=${classification.kind} conf=${classification.confidence.toFixed(2)} routing=${routing.reason} history=${prior.length}→${messages.length} base=${baseSnapshot?.modelId ?? 'none'}`,
      })

      // ── PHASE 5c: base → tool-model fan-out → base (reload for formatted response) ──
      // User intent: the initially selected model is the "base" book-end.
      // 1) baseSnapshot is the anchor (what the user picked).
      // 2) For tasks needing tools/agents, the base decides which tool models
      //    to call. Here we derive that list deterministically via scoring of
      //    tool-capable candidates (LLM-planned JSON can replace this later
      //    without changing the load→dispatch→reload lifecycle).
      // 3) Each tool model is loaded (evicting the prior), dispatched, then
      //    self-evicts logically via noteEndQuiet before the next load.
      // 4) The base is re-loaded last so the formatted synthesis always comes
      //    from the user's chosen model, even if intermediates used others.
      let toolContextForFinal: string | null = null
      const needsMultiModel = classification.kind === 'tool-use' || classification.kind === 'agent' || classification.kind === 'coding'
      if (needsMultiModel && baseSnapshot && !controller.signal.aborted) {
        // Derive tool model list: top scoring tool/coding-capable models
        // distinct from base, up to 2. Honors VRAM pressure via checkBeforeLoad.
        const toolCands = models
          .filter((m) => m.available && m.modelId !== baseSnapshot.modelId && (m.capabilities?.includes('tool-use' as never) || m.capabilities?.includes('coding' as never) || m.capabilities?.includes('reasoning' as never)))
          .slice(0, 8)
        // Re-score for tool-use
        const needCaps = capabilitiesForTask('tool-use')
        const scoredTools = toolCands
          .map((m) => {
            const caps = m.capabilities ?? []
            const hits = needCaps.filter((c) => (caps as string[]).includes(c)).length
            return { m, hits, len: m.contextLength ?? 0 }
          })
          .sort((a, b) => b.hits - a.hits || b.len - a.len)
          .slice(0, 2)
          .map((x) => x.m)
        // Also respect resource blocking — drop blocked candidates
        const toolModelList: Array<{ modelId: string; runtimeId: string }> = []
        for (const tm of scoredTools) {
          try {
            const p = await this.deps.resources.checkBeforeLoad({ id: tm.modelId as never, displayName: tm.modelId, source: 'custom', format: 'unknown' } as never, { ctxLen: classification.contextLengthNeeded })
            if (!p.blocking) toolModelList.push({ modelId: tm.modelId, runtimeId: tm.runtimeId })
          } catch { toolModelList.push({ modelId: tm.modelId, runtimeId: tm.runtimeId }) }
        }
        // If base chose to delegate, run each tool model as an isolated load→dispatch
        if (toolModelList.length > 0) {
          this.emit(sid, 'task:prompting', { taskKind: classification.kind, detail: `base ${baseSnapshot.modelId} planned ${toolModelList.length} tool model(s): ${toolModelList.map((t) => t.modelId).join(', ')}` })
          const toolOutputs: string[] = []
          for (let idx = 0; idx < toolModelList.length; idx++) {
            if (controller.signal.aborted) break
            const tm = toolModelList[idx]!
            const tmEntry = this.deps.workbench.describeRuntime(tm.runtimeId)
            if (!tmEntry || !tmEntry.enabled) continue
            this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: tm.modelId, runtimeId: tm.runtimeId, detail: `loading tool model ${tm.modelId} (${idx + 1}/${toolModelList.length})` })
            // Load tool model (evicts base/other tool — single resident invariant)
            let tmEndpoint: string
            let tmInstanceId: string | null = null
            try {
              const inst = (this.deps.models as unknown as { ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }> }).ensureHealthy
                ? await (this.deps.models as unknown as { ensureHealthy: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }> }).ensureHealthy(tm.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: tm.runtimeId })
                : await this.deps.models.load(tm.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: tm.runtimeId } as never)
              const h = await this.deps.models.health(inst.id as never).catch(() => ({ ok: false, error: 'health-check-failed' }))
              if (!h.ok) throw new Error(`tool instance unhealthy (${h.error})`)
              tmEndpoint = this.deps.models.baseUrl(inst.id as never)
              try { (this.deps.models as unknown as { noteRequestStart?: (id: unknown) => void }).noteRequestStart?.(inst.id); tmInstanceId = String(inst.id) } catch {}
              this.emit(sid, 'model:ready', { taskKind: classification.kind, modelId: tm.modelId, runtimeId: tm.runtimeId, detail: `tool model ready — dispatching` })
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: tm.modelId, runtimeId: tm.runtimeId, detail: msg, error: msg })
              continue
            }
            // Dispatch tool model on a focused sub-prompt derived from the user request
            this.emit(sid, 'tool:start', { taskKind: classification.kind, stepIndex: idx, toolName: tm.modelId, detail: `dispatching ${tm.modelId}` })
            const toolPrompt: import('@shared/types/ports').LlmChatMessage[] = [
              { role: 'system', content: `You are a specialized tool model (${tm.modelId}). Solve ONLY your sub-task for the user request: "${content.slice(0, 300)}". Return concise, factual output.` },
              { role: 'user', content },
            ]
            let tText = ''
            try {
              for await (const chunk of this.deps.llm.streamChat({ endpoint: tmEndpoint!, model: remoteModelId(tm.modelId), messages: toolPrompt, timeoutMs: Math.max(tmEntry.timeoutMs, 60_000), stream: true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })) {
                if (controller.signal.aborted) break
                if (chunk.type === 'text-delta' && chunk.text) { tText += chunk.text; this.deps.emit({ sessionId: sid, kind: 'tool:delta', text: chunk.text.slice(0, 400), toolName: tm.modelId }) }
                if (chunk.type === 'done') break
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: idx, toolName: tm.modelId, detail: `tool ${tm.modelId} failed: ${msg}` })
              this.noteEndQuiet(tmInstanceId)
              continue
            }
            try { await this.deps.persistence.appendEvent(sessionId, 'tool/result', { toolCallId: `tool-${tm.modelId}-${Date.now()}` as never, content: tText.slice(0, 8000) }) } catch {}
            this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: idx, toolName: tm.modelId, detail: `tool ${tm.modelId} returned ${tText.length} chars` })
            this.noteEndQuiet(tmInstanceId)
            // Self-dispatch from load: metrics closed, next load will evict this resident
            if (tText.trim()) toolOutputs.push(`[${tm.modelId}]\n${tText.trim()}`)
          }
          if (toolOutputs.length > 0) toolContextForFinal = toolOutputs.join('\n\n---\n\n')
          // Reload base last — formatted response must come from the user's chosen model
          if (!controller.signal.aborted) {
            const baseEntry = this.deps.workbench.describeRuntime(baseSnapshot.runtimeId)
            if (baseEntry && baseEntry.enabled) {
              this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: baseSnapshot.modelId, runtimeId: baseSnapshot.runtimeId, detail: `reloading base ${baseSnapshot.modelId} for formatted response` })
              try {
                const inst = (this.deps.models as unknown as { ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }> }).ensureHealthy
                  ? await (this.deps.models as unknown as { ensureHealthy: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }> }).ensureHealthy(baseSnapshot.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: baseSnapshot.runtimeId })
                  : await this.deps.models.load(baseSnapshot.modelId as never, { ctxLen: classification.contextLengthNeeded, runtimeId: baseSnapshot.runtimeId } as never)
                const h = await this.deps.models.health(inst.id as never).catch(() => ({ ok: false, error: 'health-check-failed' }))
                if (!h.ok) throw new Error(`base reload unhealthy (${h.error})`)
                ownedEndpoint = this.deps.models.baseUrl(inst.id as never)
                try { (this.deps.models as unknown as { noteRequestStart?: (id: unknown) => void }).noteRequestStart?.(inst.id); ownedInstanceForMetrics = String(inst.id) } catch {}
                // Re-anchor routing/entry to base for the final stream and completion event
                ;(routing as { modelId: string; runtimeId: string }).modelId = baseSnapshot.modelId
                ;(routing as { runtimeId: string }).runtimeId = baseSnapshot.runtimeId
                entry = baseEntry
                this.emit(sid, 'model:ready', { taskKind: classification.kind, modelId: baseSnapshot.modelId, runtimeId: baseSnapshot.runtimeId, detail: 'base reloaded — ready for formatted response' })
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                this.emit(sid, 'model:failed', { taskKind: classification.kind, modelId: baseSnapshot.modelId, runtimeId: baseSnapshot.runtimeId, detail: `base reload failed: ${msg}`, error: msg })
              }
            }
          }
          // Inject tool outputs into the message that the final base will format
          if (toolContextForFinal) {
            messages.push({ role: 'user', content: `Tool results for synthesis (from dispatched models):\n${toolContextForFinal.slice(0, 8000)}\n\nUsing the tool results above, provide the final formatted answer for the original request: "${content.slice(0, 300)}"` })
          }
        }
      }

      // ── PHASE 6: agent execution loop (LLM stream + optional tool steps) ──
      let loopSteps = 0; const MAX_LOOP = DEFAULT_TUNING.maxToolLoopSteps
      const inlineToolOutputs: string[] = []
      // hoisted so post-loop synthesis (1558ff) can access them — fixes text/is not defined
      let endpoint = ownedEndpoint ?? entry!.endpoint
      let model = remoteModelId(routing.modelId!)
      let timeoutMs = Math.max(entry.timeoutMs, DEFAULT_TUNING.timeoutFloorMs)
      let streamed = true
      let text = ''
      let reasoningBuffer = ''
      let allReasoning = ''
      let inReasoning = !!(classification.reasoningRequired || opts?.reasoning)
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
      let orchFirstTokenAt: number | null = null
      const firstTokenRef = { value: null as number | null }
      let chunkMode = false
      // Hoisted into the while scope so the RESUME-ON-TRUNCATE continuation branch
      // (outside the if(!chunkMode) guard) can also set this flag without declaring its own.
      let shouldContinueLoop = false

      // ── Dynamic max_tokens computation ─────────────────────────────────────
      // Estimate prompt size in tokens (1 token ≈ 4 chars for English).
      // Then compute how many tokens remain for the model's response:
      //   available = nCtx - promptEstimate - reservedCompletionTokens
      // Cap at maxCompletionTokensCap (default 8192) so we never ask for more
      // than the model + hardware can reasonably deliver.
      // This replaces the adapter's former hardcoded 2048/4096.
      const promptTokenEstimate = messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0)
      const maxCompletionTokens = Math.max(
        512,  // floor: always allow at least a short reply
        Math.min(
          nCtx - promptTokenEstimate - DEFAULT_TUNING.reservedCompletionTokens,
          DEFAULT_TUNING.maxCompletionTokensCap
        )
      )

      // ── Tools to pass natively to the model ────────────────────────────────
      // For tool-use / agent / coding tasks we send the full tool catalog in
      // the HTTP body so the model can emit native tool_calls.
      // For chat / reasoning / vision we skip tools to avoid confusing the model
      // and wasting context budget on tool descriptions.
      const shouldSendTools = (
        classification.kind === 'tool-use' ||
        classification.kind === 'agent' ||
        classification.kind === 'coding' ||
        classification.kind === 'reasoning' ||
        /\b(read|write|list|file|files|code|build|create|dashboard|make|generate|implement)\b/i.test(content)
      )
      const toolsForRequest = shouldSendTools ? this.deps.tools.list() : []

      toolLoop: while (loopSteps++ < MAX_LOOP) {
        shouldContinueLoop = false
        if (classification.reasoningRequired || opts?.reasoning) {
        this.emit(sid, 'task:thinking', {
          taskKind: classification.kind,
          modelId: routing.modelId!,
          runtimeId: routing.runtimeId!,
          detail: 'thinking through the request…',
        })
      }
      this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 0, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: 'llm generation' })
      // eslint-disable-next-line no-console
      this.safeLog(`[SOVARA][CHAT] -> stream sid=${sid} endpoint=${ownedEndpoint ?? entry!.endpoint} model=${remoteModelId(routing.modelId!)} toolCtx=${toolContextForFinal ? toolContextForFinal.length : 0} msgs=${messages.length}`)

      // Owned sidecar serves on its own loopback port; third-party runtimes
      // serve on their registered endpoint. Either way this is REAL streaming
      // through LlmPort — no canned text anywhere on this path.
      // reset per-loop (hoisted vars reused post-loop for synthesis)
      endpoint = ownedEndpoint ?? entry!.endpoint
      model = remoteModelId(routing.modelId!)
      timeoutMs = Math.max(entry.timeoutMs, DEFAULT_TUNING.timeoutFloorMs)
      streamed = true
      text = ''
      reasoningBuffer = ''
      allReasoning = ''
      inReasoning = !!(classification.reasoningRequired || opts?.reasoning)
      usage = undefined
      orchFirstTokenAt = null
      // Deduplicated fence set: fences collected during streaming are executed
      // exactly once after the stream ends, then cleared per loop iteration.
      const streamFenceSet = new Set<string>()
      const pendingStreamCalls: Array<{ toolName: string; args: Record<string, unknown> }> = []
      firstTokenRef.value = null
      chunkMode = false
      // Real streaming (owned sidecar or remote runtime — same protocol)
      // Chunk large prompts: process till end, then synthesize for exact results
      const CHUNK_THRESHOLD = DEFAULT_TUNING.chunkThresholdChars
      const shouldChunk = content.length > CHUNK_THRESHOLD
      if (shouldChunk) {
        const { chunkText } = await import('./rag/chunker')
        const chunks = chunkText(content, { chunkSize: DEFAULT_TUNING.chunkSizeChars, overlap: 400, maxChunks: 12 })
        if (chunks.length > 1) {
          chunkMode = true
          this.emit(sid, 'step:start', { taskKind: classification.kind, detail: `chunking ${content.length} chars into ${chunks.length} parts` })
          const partials:string[]=[]
          for (let ci=0; ci<chunks.length; ci++){
            const ch = chunks[ci]!
            const chunkMessages = [
              { role: 'system' as const, content: systemBlocks.join('\n\n') + `\n\n[Chunk ${ci+1}/${chunks.length} of original prompt — answer this part, will be synthesized.]` },
              ...toRequestMessages((await import('./rag/semanticSearch')).retrieveRelevant(prior, ch.text, {maxChunks:4})),
              { role: 'user' as const, content: ch.text }
            ]
            let part=''
            for await (const ck of this.deps.llm.streamChat({ endpoint, model, messages: chunkMessages, timeoutMs, stream:true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })){
              if (ck.type==='text-delta' && ck.text) part+=ck.text
              if (ck.type==='done') break
            }
            partials.push(part); this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: `\n[chunk ${ci+1}/${chunks.length}]\n`+part.slice(0,500) })
          }
          // Final synthesis pass over partials
          const synthMessages = [
            { role: 'system' as const, content: systemBlocks.join('\n\n') + '\n\nSynthesize the chunk answers below into one exact final answer for the original request. Do not omit any chunk.' },
            { role: 'user' as const, content: `Original request: ${content.slice(0,400)}\n\nChunk answers:\n${partials.map((p,i)=>`[Chunk ${i+1}]\n${p}`).join('\n---\n').slice(0,12000)}` }
          ]
          for await (const ck of this.deps.llm.streamChat({ endpoint, model, messages: synthMessages, timeoutMs, stream:true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })){
            if (ck.type==='text-delta' && ck.text) { text+=ck.text; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: ck.text }) }
            if (ck.type==='done' && ck.usage) usage=ck.usage
            if (ck.type==='done') break
          }
        }
      }
      armStallGuard(firstTokenRef)
      // shouldContinueLoop is declared at the while (toolLoop) level so it is in scope
      // both here (inside the try) and in the RESUME-ON-TRUNCATE branch below.
      if (!chunkMode) try {
        // ── Helper: Execute tool with optional infrastructure (DeepSeek Harness-style) ──
        const execTool = async (toolName: string, args: Record<string, unknown>): Promise<{ success: boolean; output: string; error?: string }> => {
          const infra = this.getToolInfra()
          if (infra) {
            const result = await this.executeToolWithInfrastructure(sid, toolName, args, {
              taskKind: classification.kind,
              stepIndex: 0,
              parallelStrategy: 'sequential',
              executionPolicy: { mode: 'parallel' },
            })
            return { success: result.ok, output: result.ok ? result.output : '', error: !result.ok ? result.error : undefined }
          } else {
            try {
              const output = await (this.deps.tools as unknown as { dispatch: (n: string, a: Record<string, unknown>) => Promise<string> }).dispatch(toolName, args)
              return { success: true, output }
            } catch (e) {
              return { success: false, output: '', error: String(e) }
            }
          }
        }

        const streamStartTime = Date.now()
        for await (const chunk of this.deps.llm.streamChat({
          endpoint,
          model,
          messages,
          timeoutMs,
          stream: true,
          signal: controller.signal,
          // Pass the computed ceiling so the adapter doesn't hardcode 2048.
          maxCompletionTokens,
          maxResponseBytes: AGENT_MAX_RESPONSE_BYTES,
          // Send tool definitions when relevant — the model emits tool_calls
          // in the SSE stream, which we capture below on the 'done' chunk.
          ...(toolsForRequest.length > 0 ? { tools: toolsForRequest } : {}),
        })) {
          if (controller.signal.aborted) break
          if (chunk.type === 'text-delta' && chunk.text) {
            if (orchFirstTokenAt === null) {
              orchFirstTokenAt = Date.now()
              firstTokenRef.value = orchFirstTokenAt
              if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
              console.log(`[SOVARA][STREAM] First token received (TTFT: ${orchFirstTokenAt - streamStartTime}ms)`)
            }
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
                allReasoning += tail
                if (tail) this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: tail })
                if (reasoningBuffer) {
                  try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}
                  reasoningBuffer = ''
                }
                inReasoning = false
                // Rate-limit: only log every 800 chars to avoid spam
                if (allReasoning.length % 800 < 100) console.log(`[SOVARA][THINKING] block closed (${allReasoning.length} chars)`)
                delta = parts.slice(1).join('')
                if (!delta) continue
              }
              if (inReasoning) {
                reasoningBuffer += delta
                allReasoning += delta
                this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: delta })
                continue
              }
            }

            // Collect all tool fences encountered during streaming so they can participate
            // in the actual toolLoop on completion. We strip them from the displayed delta
            // to keep user chat output clean, and queue them for execution.
            if (looksLikeToolFence(delta)) {
              const fences = extractToolFences(delta)
              for (const f of fences) {
                const sig = `${f.toolName}:${JSON.stringify(f.args)}`
                if (!streamFenceSet.has(sig)) {
                  streamFenceSet.add(sig)
                  pendingStreamCalls.push(f)
                }
              }
              delta = stripToolFences(delta)
              if (!delta) continue
            }
            text += delta
            if (orchFirstTokenAt === null) orchFirstTokenAt = Date.now()
            this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: delta })
          }
          if (chunk.type === 'done' && chunk.note === 'non-stream-fallback') streamed = false
          if (chunk.type === 'done' && chunk.usage) usage = chunk.usage

          // ── Native tool_calls handling ──────────────────────────────────────
          // When llama-server returns finish_reason:'tool_calls', the adapter
          // delivers the accumulated call list on the 'done' chunk.
          // We also inject any tool calls discovered in fences or bare calls during streaming
          // so they participate in the actual toolLoop.
          if (chunk.type === 'done' && !controller.signal.aborted) {
            // 1. Inject any tool fences collected during streaming
            if (pendingStreamCalls.length > 0) {
              chunk.toolCalls = chunk.toolCalls || []
              for (const f of pendingStreamCalls) {
                if (f.toolName === 'fs_list' && typeof f.args['path'] === 'string') {
                  const p = (f.args['path'] as string).replace(/\\/g, '/').trim()
                  if (/^[a-z]:\//i.test(p) || require('path').isAbsolute(p)) f.args['path'] = '.'
                }
                chunk.toolCalls.push({
                  id: `${f.toolName}-${Date.now()}-${Math.floor(Math.random()*1000)}`,
                  type: 'function',
                  function: { name: f.toolName, arguments: JSON.stringify(f.args) }
                })
              }
            }

            // 2. Convert any bare tool calls or missed fences from final text and reasoning
            let injectedCalls = false
            const checkAndInject = (sourceText: string) => {
              if (!sourceText) return
              const fences = []
              if (looksLikeToolFence(sourceText)) fences.push(...extractToolFences(sourceText))
              if (looksLikeBareToolCall(sourceText)) fences.push(...extractBareToolCalls(sourceText))
              
              for (const f of fences) {
                if (f.toolName === 'fs_list' && typeof f.args['path'] === 'string') {
                  const p = (f.args['path'] as string).replace(/\\/g, '/').trim()
                  if (/^[a-z]:\//i.test(p) || require('path').isAbsolute(p)) f.args['path'] = '.'
                }
                const sig = `${f.toolName}:${JSON.stringify(f.args)}`
                if (!streamFenceSet.has(sig)) {
                  streamFenceSet.add(sig)
                  chunk.toolCalls = chunk.toolCalls || []
                  chunk.toolCalls.push({
                    id: `${f.toolName}-${Date.now()}-${Math.floor(Math.random()*1000)}`,
                    type: 'function',
                    function: { name: f.toolName, arguments: JSON.stringify(f.args) }
                  })
                  injectedCalls = true
                }
              }
            }
            checkAndInject(text)
            checkAndInject(allReasoning)
            if (injectedCalls || pendingStreamCalls.length > 0) {
              if (looksLikeToolFence(text)) text = stripToolFences(text)
              if (looksLikeBareToolCall(text)) text = stripBareToolCalls(text)
            }
          }

          if (chunk.type === 'done' && chunk.toolCalls && chunk.toolCalls.length > 0 && !controller.signal.aborted) {
            // Stall guard no longer needed — we're about to do real work
            if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
            this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: loopSteps - 1, detail: `model requested ${chunk.toolCalls.length} tool(s)` })

            // Append the model's tool-call request to the message history first
            // (required by the OpenAI protocol: assistant message with tool_calls
            // must come before the tool result messages)
            const assistantToolCallMsg: import('@shared/types/ports').LlmChatMessage = {
              role: 'assistant',
              content: text.trim() || '',
              tool_calls: chunk.toolCalls.map((tc) => ({
                id: tc.id,
                type: tc.type,
                function: tc.function,
              })),
            }
            messages.push(assistantToolCallMsg)

            // Execute each requested tool and append its result
            for (const tc of chunk.toolCalls) {
              const toolName = tc.function.name
              let toolArgs: Record<string, unknown> = {}
              try { toolArgs = JSON.parse(tc.function.arguments || '{}') } catch { /* bad JSON from model — use empty args */ }

              // Normalize paths emitted by local models (e.g. Windows absolute paths or escaped backslashes)
              if (typeof toolArgs['path'] === 'string') {
                toolArgs['path'] = (toolArgs['path'] as string).replace(/\\/g, '/').trim()
                if (toolName === 'fs_list' && (/^[a-z]:\//i.test(toolArgs['path'] as string) || path.isAbsolute(toolArgs['path'] as string))) {
                  toolArgs['path'] = '.'
                }
              }

              this.emit(sid, 'tool:start', { taskKind: classification.kind, stepIndex: loopSteps - 1, toolName, detail: `executing ${toolName}` })
              this.deps.emit({ sessionId: sid, kind: 'tool:delta', text: `[${toolName}] ...`, toolName } as never)
              console.log(`[SOVARA][TOOL_DISPATCH] Starting tool="${toolName}" step=${loopSteps} args=${JSON.stringify(toolArgs)}`)

              let toolResult: string
              try {
                const mode = this.deps.getExecMode?.() ?? 'review'
                const gate = gateDispatch(mode, toolName)
                
                if (!gate.allowed) {
                  if (gate.reason === 'disabled') {
                    toolResult = JSON.stringify({ error: `Tool execution disabled by permission policy (mode: off).` })
                  } else {
                    // needs-approval
                    // Pause and wait for user approval
                    this.deps.emit({ sessionId: sid, kind: 'agent:needs-approval', toolCallId: tc.id, toolName, args: toolArgs } as never)
                    const approval = await new Promise<{ approved: boolean, modifiedArgs?: any }>((resolve) => {
                      this.pendingApprovals.set(tc.id, { resolve })
                    })
                    if (!approval.approved) {
                      toolResult = JSON.stringify({ error: 'User denied tool execution.' })
                    } else {
                      toolArgs = approval.modifiedArgs || toolArgs
                      const result = await execTool(toolName, toolArgs)
                      toolResult = result.output || (result.error ? `Error: ${result.error}` : '{}')
                    }
                  }
                } else {
                  // autoApproved (gate.allowed === true)
                  const result = await execTool(toolName, toolArgs)
                  toolResult = result.output || (result.error ? `Error: ${result.error}` : '{}')
                }
              } catch (toolErr) {
                toolResult = JSON.stringify({ error: String(toolErr) })
              }

              console.log(`[SOVARA][TOOL_DISPATCH] Completed tool="${toolName}" resultLen=${toolResult.length} preview="${toolResult.slice(0, 150).replace(/\s+/g, ' ')}"`)

              try { await this.deps.persistence.appendEvent(sessionId, 'tool/result', { toolCallId: tc.id as never, content: toolResult }) } catch {}
              this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: loopSteps - 1, toolName, detail: `${toolName} → ${toolResult.slice(0, 120)}` })
              this.deps.emit({ sessionId: sid, kind: 'tool:delta', text: toolResult.slice(0, 400), toolName } as never)

              // Append as a tool-result message so the model sees it on the next turn
              messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: toolResult.slice(0, 8000), // cap to avoid context overflow
              })
            }

            // Reset text accumulator — the model's next response is the actual answer
            text = ''
            shouldContinueLoop = true
            break // exit the chunk iterator; continue toolLoop
          }

          if (chunk.type === 'done') break
        }
      } catch (e) {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
        // Stall guard abort -> friendly timeout ack instead of handler crash
        const rawStall = e instanceof Error ? e.message : String(e)
        if (/stall-timeout/i.test(rawStall)) {
          const secs = Math.round((Date.now() - startedAll) / 1000)
          const msg = `The model stalled for ${secs}s with no tokens — context was auto-compacted. Try /compact, a shorter prompt, or a smaller quant.`
          try { await this.deps.persistence.appendEvent(sessionId, 'system/compact', { content: `Stall-timeout after ${secs}s — auto-compacted.` }) } catch {}
          this.log(routing.runtimeId!, endpoint, model, startedAll, undefined, 'timeout', streamed)
          appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'timeout', error: msg, modelId: model, runtimeId: routing.runtimeId!, latencyMs: Date.now() - startedAll })
          const seq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: msg })).seq
          this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq })
          this.emit(sid, 'task:complete', { taskKind: classification.kind, detail: `stall-timeout ack after ${secs}s`, stepIndex: 0 })
          this.noteEndQuiet(ownedInstanceForMetrics)
          return { ok: true, userSeq, assistantSeq: seq, routing, classification }
        }
        const errMsg = e instanceof Error ? e.message : String(e)
        if (!autoRetried && (/exceed.*context|context.*size/i.test(errMsg) || errMsg.includes('exceed_context_size_error'))) {
          autoRetried = true
          if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
          console.warn(`[SOVARA][ORCH] Context size exceeded, auto-compacting and retrying once...`)
          const reducedCtx = Math.max(2048, Math.floor(nCtx / 2))
          nCtx = reducedCtx
          messages = compactForCtx(messages, reducedCtx)
          this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 0, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: `compacted context to ${reducedCtx} tokens, retrying...` })
          shouldContinueLoop = true
          continue
        }
        if (controller.signal.aborted || (e instanceof ChatInferenceError && e.code === 'cancelled')) {
          this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: 'cancelled' })
          this.noteEndQuiet(ownedInstanceForMetrics)
          return await this.finishCancelled(sessionId, sid, startedAll, routing.runtimeId!, endpoint, model, streamed, userSeq)
        }
        const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
        this.log(routing.runtimeId!, endpoint, model, startedAll, undefined, outcomeOf(e), streamed)
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: outcomeOf(e), error: safe, modelId: model, runtimeId: routing.runtimeId!, latencyMs: Date.now() - startedAll })
        this.emit(sid, 'task:error', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: safe, error: safe })
        this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
        this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `failed: ${safe}` })
        this.noteEndQuiet(ownedInstanceForMetrics)
        throw new AgentOrchestratorError('llm-failed', safe)
      }
      // Set by the text.trim() === '' block above when the model returned empty text and
      // we want to retry the turn rather than emit nothing.  Must be outside the try
      // so the continue can legally jump to the while (toolLoop) header.
      if (shouldContinueLoop) continue
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }

      this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `llm done — ${text.length} chars streamed=${streamed}` })

      // Unclosed <thinking> block (model never emitted the close tag):
      // deltas already streamed incrementally — persist the full text so a
      // later refresh reconstructs the same reasoning instead of losing it.
      if (reasoningBuffer) {
        try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}
        allReasoning += reasoningBuffer
        reasoningBuffer = ''
      }

      // ── Unlimited-context chunked fallback: if message still > nCtx, split and execute chunks sequentially (user requested half-half) ──
      const approxTokens = messages.reduce((n, m) => n + Math.ceil(m.content.length / 4), 0)
      if (approxTokens > nCtx - 1200 && messages.length > 3) {
        const mid = Math.floor(messages.length / 2)
        const chunks = [messages.slice(0, mid), messages.slice(mid)]
        this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: `\n[Unlimited-context: splitting ${approxTokens} tokens > ${nCtx} into ${chunks.length} chunks]\n` } as never)
        let merged = ''
        for (let ci = 0; ci < chunks.length; ci++) {
          const chunkMsgs = [{ role: 'system', content: chunks[ci][0]?.role === 'system' ? chunks[ci][0].content : systemBlocks.join('\n\n') }, ...chunks[ci].filter(m => m.role !== 'system')] as typeof messages
          for await (const ch of this.deps.llm.streamChat({ endpoint, model, messages: chunkMsgs, timeoutMs, stream: true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })) {
            if (ch.type === 'text-delta' && ch.text) { merged += ch.text; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: ch.text }) }
            if (ch.type === 'done') break
          }
          if (ci < chunks.length - 1) merged += '\n\n--- chunk boundary ---\n\n'
        }
        if (merged.trim().length > 100) text = merged
      }

      // ── Optional second step: tool use (honest multi-step) ──
      // Uses comprehensive tool infrastructure when available (DeepSeek Harness-style)
      // harness retry: invalid-response → retry once lite without reasoning (deepseek-harness llm-retry)
      // handled below in catch, keep flag
      if ((classification.kind === 'tool-use' || classification.kind === 'agent') && !controller.signal.aborted) {
        const defs = this.deps.tools.list()
        if (defs.some((d) => d.name === 'web_search')) {
          this.emit(sid, 'tool:start', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `dispatching web_search for: ${content.slice(0,60)}` })
          let toolText = ''
          try {
            // Use tool infrastructure when available, with parallel strategy and lifecycle hooks
            const infra = this.getToolInfra()
            let raw: string
            if (infra) {
              const result = await this.executeToolWithInfrastructure(sid, 'web_search', { queries: [content.slice(0, 200)] }, {
                taskKind: classification.kind,
                stepIndex: 1,
                parallelStrategy: 'sequential',
                executionPolicy: { mode: 'parallel' },
              })
              raw = result.ok ? result.output : `{"error": "${result.error}"}`
            } else {
              raw = await this.deps.tools.dispatch('web_search', { queries: [content.slice(0,200)] })
            }
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
              this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 1, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: 'llm generation (with tool context)' })
              const followMessages: import('@shared/types/ports').LlmChatMessage[] = [
                ...messages,
                { role: 'assistant', content: text },
                { role: 'user', content: `Tool web_search result (untrusted external content):\n${toolText.slice(0, 3000)}\n\nUsing the tool result above, provide the final answer concisely.` },
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
                  maxResponseBytes: AGENT_MAX_RESPONSE_BYTES,
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
                  return await this.finishCancelled(sessionId, sid, startedAll, routing.runtimeId!, endpoint, model, streamed, userSeq)
                }
              }
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'web_search', detail: `tool failed: ${msg}` })
          }
          // harness loop note — inline tools already appended via tryInlineTools above, no extra loop needed for this turn
        }
      }

      // ── JARVIS SOUL: Autonomous Multi-Step Continuation ──
      // If the model executed exploratory/planning tools (fs_list, fs_read, todo_write)
      // or reviewed workspace files, and the task requires coding/building/fixing/updating,
      // DO NOT STOP to ask the user to type "continue". Drive the next step automatically!
      const isTaskOrBuildIntent = classification.kind === 'coding' || classification.kind === 'tool-use' || classification.kind === 'agent' || /\b(build|create|write|make|dashboard|implement|generate|update|code|fix|check|solve|repair|setup|add|edit|refactor|render|draw|review)\b/i.test(content)
      const didExploration = messages.some((m) => m.role === 'tool' && (m.content.includes('"entries"') || m.content.includes('"todos"'))) || /todo_write|list_files|fs_list|explore/i.test(text)
      const hasRealCodeFence = /```(?:html|javascript|js|typescript|ts|tsx|jsx|react|mermaid|css|svg|python|py|json|sh|bash|powershell)\b[\s\S]{80,}```/i.test(text)
      const hasWrittenCode = messages.some((m) => m.role === 'tool' && (m.content.includes('"bytes"') || m.content.includes('"path"') || m.content.includes('"success":true'))) || hasRealCodeFence
      const isFakeFileClaim = (/json:response|"action":\s*"created"|files created|created.*dashboard|i've created|created standard/i.test(text)) && !hasWrittenCode

      // Continue autonomously if:
      // 1. Model emitted a fake JSON claim instead of writing code, OR
      // 2. Model did exploration (fs_list) but hasn't written code yet
      // Loop guard: limit consecutive continuation re-entries to avoid infinite loops when model output contains no tools or code
      const continuationCount = messages.filter((m) => m.role === 'user' && m.content.includes('[Autonomous Agent Directive]')).length
      const shouldJarvisContinue = isTaskOrBuildIntent && (isFakeFileClaim || (didExploration && !hasWrittenCode)) && loopSteps < MAX_LOOP && continuationCount < 2 && !controller.signal.aborted

      if (shouldJarvisContinue) {
          const nextDirective = isFakeFileClaim
            ? `[Autonomous Agent Directive]: You summarized that files were created, but the actual code was not written to disk yet. Immediately write the complete, functioning code using fs_write (e.g. fs_write {"path": "script.py", "content": "..."}) or output the full code in a named markdown code block. Do not output a json:response summary. Consult your <skills_context> and MCP tools if necessary. Write the real code now.`
            : `[Autonomous Agent Directive]: Workspace inspection complete. Now proceed immediately to write the complete, functional code and implementation using fs_write (e.g. app.py, main.js) or a full markdown code block. Review the Enterprise Skills and MCP tools in your context before writing. Do not stop or ask for confirmation.`

        this.deps.emit({
          sessionId: sid,
          kind: 'assistant-delta',
          text: `\n\n*[Jarvis Agent: Autonomously proceeding to write code...]*\n\n`,
        })
        messages.push({ role: 'assistant', content: text.trim() || 'Workspace inspected.' })
        messages.push({
          role: 'user',
          content: nextDirective,
        })
        text = ''
        shouldContinueLoop = true
        continue toolLoop
      }

      break
      }

      if (controller.signal.aborted) {
        this.noteEndQuiet(ownedInstanceForMetrics)
        return await this.finishCancelled(sessionId, sid, startedAll, routing.runtimeId!, endpoint, model, streamed, userSeq)
      }

      // Synthesis pass: if toolLoop exited without final text (e.g. model called tools or hit loop cap),
      // prompt the model to synthesize all tool results and answer the original request.
      // We omit tools here so the model focuses 100% on text/code output.
      if (text.trim() === '' && !controller.signal.aborted) {
        this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: loopSteps, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: 'final synthesis' })
        const synthMsgs: import('@shared/types/ports').LlmChatMessage[] = [
          ...messages,
          {
            role: 'user',
            content: 'Synthesize the tool results above and provide your complete, detailed response addressing the original request with all requested code and files. At the end, provide a summary of created/modified files with their paths. If a dev server or application was run or configured to run on a local port, explicitly report the port and live URL (e.g. http://localhost:5173). Include full code in fenced markdown blocks (e.g. ```tsx or ```html) so the user can inspect the code and preview the application in the artifact viewer.',
          },
        ]
        try {
          for await (const ch of this.deps.llm.streamChat({
            endpoint,
            model,
            messages: synthMsgs,
            timeoutMs,
            stream: true,
            signal: controller.signal,
            maxCompletionTokens,
            maxResponseBytes: AGENT_MAX_RESPONSE_BYTES,
          })) {
            if (controller.signal.aborted) break
            if (ch.type === 'text-delta' && ch.text) {
              text += ch.text
              this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: ch.text })
            }
            if (ch.type === 'done' && ch.usage) usage = ch.usage
            if (ch.type === 'done') break
          }
          this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: loopSteps, detail: `synthesis complete — ${text.length} chars` })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          this.safeLog(`[SOVARA][SYNTHESIS] error: ${msg}`)
        }
      }

      // Fallback: streaming split may have missed fences — scan full text for any unexecuted ```tool: fences
      // and execute them now so they don't leak to the bubble as raw markdown (see screenshot).
      // Handles 3-4 backticks, Windows abs paths like D:\data\rewards, and double-fenced spam.
      // workspaceRoot for path normalization (re-resolve, post-loop not in earlier scope)
      let fallbackWsRoot: string | null = null
      try {
        const h = await this.deps.persistence.get(sessionId).catch(() => null) as { projectId?: string | null } | null
        const pid2 = h?.projectId ?? null
        fallbackWsRoot = this.deps.getProjectWorkspace?.(pid2) ?? this.deps.getGlobalWorkspace?.() ?? null
      } catch {}
      // Post-stream recovery — scans BOTH the text channel and the reasoning
      // channel (allReasoning). The reasoning branch `continue`s before
      // tryInlineTools ever runs, so fences inside <think> (the 2:09/3:30 PM
      // traces) were previously stored as text and NEVER executed → empty reply.
      // Dedupe per fence signature (tool+args) so text+reasoning duplicates
      // (the model emits the same call twice) dispatch exactly once.
      const executedSignatures = new Set<string>()
      const dispatchMissedFence = async (tName: string, args: Record<string, unknown>): Promise<boolean> => {
        const sig = `${tName}:${JSON.stringify(args)}`
        if (executedSignatures.has(sig)) return false
        executedSignatures.add(sig)
        // Enforce exec permission gate — do not auto-run risky tools under review/ask
        try {
          const mode = this.deps.getExecMode?.() ?? 'review'
          const verdict = gateDispatch(mode as any, tName)
          if (!verdict.allowed) {
            const tid = `${tName}-${Date.now()}-${Math.floor(Math.random()*1000)}`
            this.deps.emit({ sessionId: sid, kind: 'agent:needs-approval' as any, toolCallId: tid, toolName: tName, args } as never)
            try { await this.deps.persistence.appendEvent(sessionId, 'tool/call' as never, { toolCallId: tid as never, name: tName, args } as never) } catch {}
            // Blocked — surface approval card, do not auto-dispatch
            inlineToolOutputs.push(`[${tName} ${JSON.stringify(args)}]\nBLOCKED: ${verdict.reason} — ${verdict.message}`)
            return false
          }
        } catch {}
        try {
          this.deps.emit({ sessionId: sid, kind: 'tool:start', toolName: tName, detail: `post-stream ${tName} — dispatching` } as never)
          const r = await (this.deps.tools as unknown as { dispatch: (n: string, a: Record<string, unknown>) => Promise<string> }).dispatch(tName, args)
          inlineToolOutputs.push(`[${tName} ${JSON.stringify(args)}]\n${r.slice(0,4000)}`)
          try { await this.deps.persistence.appendEvent(sessionId, 'tool/result' as never, { toolCallId: `${tName}-${Date.now()}` as never, content: r.slice(0,8000) } as never) } catch {}
          this.deps.emit({ sessionId: sid, kind: 'tool:end', toolName: tName, detail: `post-stream ${tName} returned ${r.length} chars` } as never)
          return true
        } catch { return false }
      }
      let missed = 0
      if (looksLikeToolFence(text)) {
        // Hardened parser (fenceTools): handles glued `````` fences, 4/5-tick,
        // mismatched tick counts, and lenient JSON — the strict-JSON regex
        // missed these, leaving empty text → "empty reply after Ns".
        for (const f of extractToolFences(text)) {
          const args = { ...f.args } as Record<string, unknown>
          // Normalize absolute workspace path the model emits (D:\data\rewards) to relative "." so resolveWorkspacePath works
          if (f.toolName === 'fs_list' && typeof args['path'] === 'string') {
            const p = (args['path'] as string).replace(/\\/g, '/').trim()
            if (/^[a-z]:\//i.test(p) || path.isAbsolute(p as string)) {
              try {
                const wsNorm = fallbackWsRoot ? path.resolve(fallbackWsRoot).replace(/\\/g, '/').toLowerCase() : ''
                if (wsNorm && (p.toLowerCase() === wsNorm || p.toLowerCase() === wsNorm + '/')) args['path'] = '.'
                else if (wsNorm && p.toLowerCase().startsWith(wsNorm + '/')) args['path'] = p.slice(wsNorm.length + 1) || '.'
                else args['path'] = '.'
              } catch { args['path'] = '.' }
            }
          }
          if (await dispatchMissedFence(f.toolName, args)) missed++
        }
        if (missed > 0) {
          // strip raw fences by span (fenceTools) so user never sees leak (3/4/5-tick, glued)
          text = stripToolFences(text)
        }
      }
      // Reasoning-channel recovery: fences inside <think> never hit the text path.
      if (looksLikeToolFence(allReasoning)) {
        for (const f of extractToolFences(allReasoning)) {
          const args = { ...f.args } as Record<string, unknown>
          if (f.toolName === 'fs_list' && typeof args['path'] === 'string') {
            const p = (args['path'] as string).replace(/\\/g, '/').trim()
            if (/^[a-z]:\//i.test(p) || path.isAbsolute(p as string)) args['path'] = '.'
          }
          if (await dispatchMissedFence(f.toolName, args)) missed++
        }
      }
      // Bare tool call recovery: models like Nemotron-3-Nano emit tool calls
      // as plain text (fs_list {path:"."}) or XML tags (<fs_list path=".">) without
      // backtick fences. Detect and dispatch these from both text and reasoning.
      const normBareArgs = (toolName: string, args: Record<string, unknown>): Record<string, unknown> => {
        if (toolName === 'fs_list' && typeof args['path'] === 'string') {
          const p = (args['path'] as string).replace(/\\/g, '/').trim()
          if (/^[a-z]:\//i.test(p) || path.isAbsolute(p)) args['path'] = '.'
        }
        return args
      }
      if (looksLikeBareToolCall(text)) {
        for (const f of extractBareToolCalls(text)) {
          const args = normBareArgs(f.toolName, { ...f.args })
          if (await dispatchMissedFence(f.toolName, args)) missed++
        }
        if (missed > 0) text = stripBareToolCalls(text)
      }
      if (looksLikeBareToolCall(allReasoning)) {
        for (const f of extractBareToolCalls(allReasoning)) {
          const args = normBareArgs(f.toolName, { ...f.args })
          if (await dispatchMissedFence(f.toolName, args)) missed++
        }
      }
      // Inline fs/shell leak follow-up: Qwen at 7/32 layers often emits <fs_list path="."> as text instead of tool_call.
      // We already executed it via tryInlineTools and have inlineToolOutputs — now synthesize a final answer with those results
      // so we don't exit with just "I'll explore the workspace..." and the raw tag.
      if (inlineToolOutputs.length > 0 && text.trim().length < 1200) {
        const toolCtx = inlineToolOutputs.join('\n\n---\n\n').slice(0, 6000)
        this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 1, detail: 'fs/shell result synthesis' })
        const followMessages: import('@shared/types/ports').LlmChatMessage[] = [
          ...messages,
          { role: 'assistant', content: text },
          { role: 'user', content: `Tool results (fs_list/fs_read/shell_exec you requested):\n${toolCtx}\n\nNow provide the final complete answer. List all files and folders created or modified with their paths. If a local or dev server was launched or detected, explicitly state the port and running URL (e.g. http://localhost:5173). Include full code artifacts with proper language tags (e.g. \`\`\`tsx) so the user can inspect the code and preview the application. Do not repeat the <fs_list> tag.` },
        ]
        let secondText = ''
        try {
          for await (const chunk of this.deps.llm.streamChat({ endpoint, model, messages: followMessages, timeoutMs, stream: true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })) {
            if (controller.signal.aborted) break
            if (chunk.type === 'text-delta' && chunk.text) { secondText += chunk.text; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: chunk.text }) }
            if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
            if (chunk.type === 'done') break
          }
          if (secondText.trim().length > 20) text = secondText
          this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 1, detail: 'inline tool synthesis done' })
        } catch (e) {
          this.emit(sid, 'tool:end', { taskKind: classification.kind, stepIndex: 1, toolName: 'inline', detail: `synthesis failed: ${e instanceof Error ? e.message : String(e)}` })
        }
      }

      // If text is only bare tool calls with no real content, strip them and
      // treat text as effectively empty so synthesis/fallback kicks in.
      if (text.trim() !== '' && looksLikeBareToolCall(text)) {
        const stripped = stripBareToolCalls(text)
        if (stripped.trim().length < 10) text = ''
      }

      if (text.trim() === '') {
        // Priority 1: Use inline tool outputs from dispatched tools
        if (inlineToolOutputs.length > 0) {
          // Synthesize tool results into a proper response
          const toolCtxForSynth = inlineToolOutputs.join('\n\n---\n\n').slice(0, 6000)
          const synthMsgs2: import('@shared/types/ports').LlmChatMessage[] = [
            ...messages,
            { role: 'user', content: `Tool results:\n${toolCtxForSynth}\n\nUsing the tool results above, provide the complete answer for the original request. List all created or modified files with their paths. If a dev server was started or running on a port, report the final URL and port (e.g. http://localhost:5173). Include full code inside fenced code blocks so it can be previewed. Do not emit raw tool call tags.` },
          ]
          try {
            let synthText = ''
            for await (const ch of this.deps.llm.streamChat({ endpoint, model, messages: synthMsgs2, timeoutMs, stream: true, signal: controller.signal, maxCompletionTokens, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })) {
              if (controller.signal.aborted) break
              if (ch.type === 'text-delta' && ch.text) { synthText += ch.text; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: ch.text }) }
              if (ch.type === 'done' && ch.usage) usage = ch.usage
              if (ch.type === 'done') break
            }
            if (synthText.trim().length > 20 && !looksLikeBareToolCall(synthText)) {
              text = synthText
            } else {
              text = `Here are the results:\n\n${inlineToolOutputs.join('\n\n')}`
            }
          } catch {
            text = `Here are the results:\n\n${inlineToolOutputs.join('\n\n')}`
          }
        // Priority 2: Promote reasoning if it's NOT a raw tool call
        } else {
          const reasoningFallback = (allReasoning || reasoningBuffer).trim()
          const isToolOnly = reasoningFallback.length > 0 && looksLikeBareToolCall(reasoningFallback) && stripBareToolCalls(reasoningFallback).trim().length < 10
          if (reasoningFallback.length > 40 && !isToolOnly) {
            text = reasoningFallback
            appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `promoted reasoning to answer (${reasoningFallback.length} chars)` })
          } else if (reasoningFallback.length > 0 && !isToolOnly) {
            text = reasoningFallback
          } else {
            const toolResults = messages.filter((m) => m.role === 'tool')
            if (toolResults.length > 0) {
              text = `Executed ${toolResults.length} tool(s) successfully.\n\n` + toolResults.map((t) => t.content).join('\n\n')
            } else {
              text = 'I couldn\'t generate a response. Please try again with a more specific prompt.'
            }
          }
        }
      }

    // ── RESUME-ON-TRUNCATE: compaction must NOT restart from initial state ──
    // If the model streamed a partial HTML/code file and got cut (``` not closed
    // or </html> missing), continue from the exact suffix instead of restarting.
    const detectedEarly = detectOutputFormat(content)
    if (detectedEarly && isArtifactTruncated(text, detectedEarly) && !autoRetried && !controller.signal.aborted) {
      autoRetried = true
      const suffix = text.slice(-900)
      const prefixLen = text.length
      // Persist the partial prefix so history survives compact (append-only)
      try { await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text + '\n<!-- TRUNCATED — continuation follows (do not re-render as final) -->' }) } catch {}
      appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `artifact truncated at ${prefixLen} chars — resuming with continuation prompt` })
      this.emit(sid, 'task:planning', { taskKind: classification.kind, detail: `partial artifact ${prefixLen} chars — continuing from suffix, not restarting` })
      // Build continuation prompt: system + history including prefix + explicit resume user turn
      try {
        const liveEvents = await this.deps.persistence.getEvents(sessionId)
        const continuationSystem = SOVARA_SYSTEM_PROMPT + '\n\n[SYSTEM CONTINUATION: Your previous output was truncated. Continue exactly from the last character of the prior assistant message. Do NOT restart, do NOT re-emit the header/slide 1. Emit only the remainder to a valid closed file.]'
        messages = [
          { role: 'system', content: continuationSystem },
          ...toRequestMessages(liveEvents),
          { role: 'user', content: `SYSTEM CONTINUATION: Continue the previous file from exactly where it stopped. Last 900 chars for alignment:\n${suffix}\n\nContinue to a valid closed file. Do NOT restart from the beginning.` },
        ]
      } catch { /* fallback: just suffix as user prompt */ messages.push({ role: 'user', content: `Continue from suffix:\n${suffix}` }) }
      // Re-arm stall guard and extend token budget for the remainder
      let cont = ''
      reasoningBuffer = ''
      inReasoning = false
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
      const contRef = { value: null as number | null }
      armStallGuard(contRef)
      this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 1, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: 'continuing truncated artifact' })
      try {
        for await (const chunk of this.deps.llm.streamChat({ endpoint, model, messages, timeoutMs, stream: true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })) {
          if (controller.signal.aborted) break
          if (chunk.type === 'text-delta' && chunk.text) {
            let delta = chunk.text
            // Strip any echoed prefix duplication (model sometimes repeats last line)
            if (cont.length === 0 && delta.trimStart().startsWith(suffix.trimStart().slice(0, 60))) {
              // skip duplicated header echo — keep streaming but don't duplicate prefix
              const overlap = suffix.trimStart().slice(0, 60)
              if (delta.includes(overlap)) delta = delta.slice(delta.indexOf(overlap) + overlap.length)
              if (!delta) continue
            }
            cont += delta
            text += delta
            this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: delta })
          }
          if (chunk.type === 'done' && chunk.usage) usage = chunk.usage
          if (chunk.type === 'done') break
        }
      } catch (e2) {
        if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
        // Continuation failure is non-fatal — keep prefix; artifact will be partial but valid
        appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'error', outcome: 'error', error: e2 instanceof Error ? e2.message : String(e2), detail: 'continuation failed, keeping prefix' })
      }
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
      this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 1, detail: `continuation ${cont.length} chars — total ${text.length}` })
    }
      // ── Required-output artifact: fallback ONLY if model didn't already create the file via fs_write/shell_exec.
      // This prevents hardcoded duplication when the skill-driven flow (search_skills→read_skill→todo_write→fs_write→shell_exec) already materialized the file.
      const detected = detectOutputFormat(content)
      if (detected) {
        const alreadyHasArtifact = (() => {
          const needle = `.${detected.kind}`.toLowerCase()
          const hay = inlineToolOutputs.join(' ').toLowerCase()
          if (hay.includes(needle) && hay.includes('"ok":true')) return true
          // Also consider any artifact path already in inline outputs
          if (hay.includes(needle) && hay.includes('path')) return true
          return false
        })()
        if (alreadyHasArtifact) {
          appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `artifact ${detected.kind} already created via tools — skipping fallback hardcoded generation` })
        } else {
        this.emit(sid, 'artifact:writing', {
          taskKind: classification.kind,
          modelId: routing.modelId!,
          runtimeId: routing.runtimeId!,
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
              modelId: routing.modelId!,
              runtimeId: routing.runtimeId!,
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
            modelId: model, runtimeId: routing.runtimeId!,
          })
        }
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
      this.log(routing.runtimeId!, endpoint, model, startedAll, 200, 'ok', streamed)
      appendChatLog(this.deps.baseDir, {
        sessionId: sid,
        action: 'done',
        modelId: model,
        runtimeId: routing.runtimeId!,
        outcome: 'ok',
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
        latencyMs: Date.now() - startedAll,
        detail: `agent steps=${loopSteps} task=${classification.kind} routing=${routing.reason}`,
      })
      this.emit(sid, 'task:complete', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: `done in ${Date.now() - startedAll}ms`, stepIndex: 0 })
      this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: assistantSeq })

      // Optional: persist execution summary for audit
      try {
        await this.deps.persistence.appendEvent(sessionId, 'agent/trace', {
          kind: classification.kind,
          modelId: routing.modelId!,
          runtimeId: routing.runtimeId!,
          steps: loopSteps,
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
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null }
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
      // Honor pinned selection (same as execute): user picked GLM/gemma in pill → regenerate must NOT re-route to Qwen.
      const isAutoRegen = active.selection?.modelId === '__auto__' && active.selection?.runtimeId === 'auto'
      let routing: Awaited<ReturnType<typeof routeModel>>
      if (!isAutoRegen && active.selection) {
        routing = {
          modelId: active.selection.modelId,
          runtimeId: active.selection.runtimeId,
          reason: `pinned ${active.selection.modelId} — regenerate honors user selection (not re-routing)`,
          task: classification,
          candidatesConsidered: 1,
          switched: false,
        } as unknown as Awaited<ReturnType<typeof routeModel>>
      } else {
        routing = await routeModel({
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
      }
      if (!routing.modelId! || !routing.runtimeId!) throw new AgentOrchestratorError('no-model-available', `No compatible model for "${classification.kind}". ${routing.reason}`)
      const pressure = await this.deps.resources.checkBeforeLoad(
        { id: routing.modelId! as never, displayName: routing.modelId!, source: 'custom', format: 'unknown' } as never,
        { ctxLen: classification.contextLengthNeeded }
      )
      if (pressure.blocking) {
        // Pinned-but-unfittable: dynamic fallback ranked by ACTUAL free VRAM/RAM fit
        // (pickFittingModel) instead of hardcoded size/name assumptions.
        const vramTotalMb = resources.vram.totalMB ?? 0
        const fit = pickFittingModel(models, resources, { excludeModelId: routing.modelId!, ctxLenNeeded: classification.contextLengthNeeded })
        const cand = fit?.model ?? null
        if (cand) {
          const fitLabel = fit!.gpu ? `fits ${fit!.fitMb.toFixed(0)}MB VRAM` : `fits ${fit!.fitMb.toFixed(0)}MB RAM (CPU offload)`
          this.emit(sid, 'model:selecting', { taskKind: classification.kind, detail: `pinned ${routing.modelId} cannot fit ${vramTotalMb > 0 ? `${vramTotalMb.toFixed(0)}MB GPU` : 'available memory'} → auto-fallback to ${cand.modelId}` })
          routing = {
            modelId: cand.modelId,
            runtimeId: cand.runtimeId,
            reason: `pinned ${routing.modelId} does not fit ${vramTotalMb > 0 ? `${vramTotalMb.toFixed(0)}MB GPU` : 'available memory'} — auto-fallback to fitting ${cand.modelId} (${fitLabel})`,
            task: classification,
            candidatesConsidered: 1,
            switched: true,
          } as unknown as Awaited<ReturnType<typeof routeModel>>
        }
        if (!cand) {
          throw new AgentOrchestratorError('resource-blocked', `resource-pressure: ${pressure.reason ?? 'load refused'}`)
        }
      }
      let entry = this.deps.workbench.describeRuntime(routing.runtimeId!)
      if (!entry || !entry.enabled) throw new AgentOrchestratorError('runtime-unavailable', 'The selected runtime is unavailable. Open Models and test its connection.')
      if (routing.switched) {
        await this.deps.workbench.selectModel(routing.runtimeId!, routing.modelId!)
        entry = this.deps.workbench.describeRuntime(routing.runtimeId!)!
      }
      this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, vramTotalMB: resources.vram.totalMB, progress: 10, detail: 'Reserving VRAM...' })
      // Owned runtime: blocking VRAM load. Remote runtimes own their
      // lifecycle — no sidecar spawn, proceed straight to ready.
      let regenOwnedEndpoint: string | null = null
      const regenIsOwned = entry!.endpoint === 'local' || entry.id === 'local' || routing.runtimeId! === 'local'
      if (regenIsOwned) {
        this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, vramTotalMB: resources.vram.totalMB, progress: 35, detail: 'Loading GGUF into VRAM...' })
        const models = this.deps.models as ModelRuntimePort & {
          ensureHealthy?: (m: never, o?: unknown) => Promise<{ id: unknown; modelId: unknown }>
        }
        const inst = models.ensureHealthy
          ? await models.ensureHealthy(routing.modelId! as never, { ctxLen: classification.contextLengthNeeded, runtimeId: routing.runtimeId! })
          : await this.deps.models.load(routing.modelId! as never, { ctxLen: classification.contextLengthNeeded, runtimeId: routing.runtimeId! })
        this.emit(sid, 'model:loading', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, vramTotalMB: resources.vram.totalMB, progress: 75, detail: 'Verifying health...' })
        const h = await this.deps.models.health(inst.id).catch(() => ({ ok: false, error: 'health-check-failed' }))
        if (!h.ok) throw new AgentOrchestratorError('model-load-failed', `instance unhealthy (${h.error ?? 'health check failed'}) -- refusing to route`)
        regenOwnedEndpoint = this.deps.models.baseUrl(inst.id)
      } else if (controller.signal.aborted) {
        throw new AgentOrchestratorError('cancelled', 'cancelled')
      }
      this.deps.resources.clearHwCache?.()
      const snapAfter = await this.deps.resources.getSnapshot().catch(() => resources)
      this.emit(sid, 'model:ready', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, vramUsedMB: snapAfter.models.totalVramUsedMB, vramTotalMB: snapAfter.vram.totalMB, detail: routing.reason, progress: 100 })
      if (controller.signal.aborted) throw new AgentOrchestratorError('cancelled', 'cancelled')

      const prior = await this.deps.persistence.getEvents(sessionId)
      let workspaceContext: string | null = null
      let wsRoot: string | null = null
      try {
        const header = await this.deps.persistence.get(sessionId)
        const pid = header?.projectId ?? null
        const projectRoot = this.deps.getProjectWorkspace?.(pid) ?? null
        const globalRoot = this.deps.getGlobalWorkspace?.() ?? null
        wsRoot = projectRoot ?? globalRoot
        if (wsRoot) workspaceContext = pid && projectRoot ? `Project workspace: ${projectRoot} (project ${pid}) — global fallback: ${globalRoot ?? 'none'}` : `Global workspace: ${wsRoot}${projectRoot ? ` (project ${pid} at ${projectRoot})` : ''}`
      } catch { /* ignore */ }
      let mcpContext: string | null = null
      try { mcpContext = this.deps.getMcpContext?.() ?? null } catch {}
      let skillsContext: string | null = null
      try { skillsContext = (await this.deps.getSkillsContext?.(content, wsRoot ?? undefined)) ?? null } catch {}
      let todoContextReg: string | null = null
      try { todoContextReg = this.deps.getTodoContext?.() ?? null } catch {}

      const reasoningSystem = classification.reasoningRequired || opts?.reasoning ? 'Think step by step before answering. Provide your reasoning wrapped in <thinking> tags, then the final answer.' : null
      const systemBlocksReg = [
        CHAT_SYSTEM_PROMPT,
        ...(reasoningSystem ? [reasoningSystem] : []),
        ...(workspaceContext ? [workspaceContext] : []),
        ...(mcpContext ? [mcpContext] : []),
        ...(skillsContext ? [skillsContext] : []),
        ...(todoContextReg ? [todoContextReg] : []),
      ]
      // Root fix (same as ChatService): regenerate history must end on user — drop trailing assistants.
      const regenHistory = toRequestMessages(prior)
      while (regenHistory.length > 0 && regenHistory[regenHistory.length - 1]?.role === 'assistant') {
        regenHistory.pop()
      }
      if (regenHistory.length === 0 || regenHistory[regenHistory.length - 1]?.role !== 'user') {
        regenHistory.push({ role: 'user', content: `${content}\n\n[Regenerate: answer again, fresh wording.]` })
      } else {
        const tail = regenHistory[regenHistory.length - 1]!
        if (!tail.content.includes('[Regenerate:')) {
          tail.content = `${tail.content}\n\n[Regenerate: answer again, fresh wording, same request.]`
        }
      }
      let messages: import('@shared/types/ports').LlmChatMessage[] = [
        { role: 'system', content: systemBlocksReg.join('\n\n') },
        ...regenHistory,
      ]
  // Compact if prompt would exceed ctx (2375 > 2304 case): history truncation before stream
       // Also handle exceed_context_size_error retry: if first attempt 400s, auto-compact 50% and retry once
       let ctxNeed = classification.contextLengthNeeded
       const compactForRetry = (msgs: typeof messages): typeof messages => {
         const sys = msgs[0]; const rest = msgs.slice(1); let chars = rest.reduce((n, m) => n + m.content.length, 0)
         const maxChars = Math.max(800, ctxNeed * 2.5); while (rest.length > 2 && chars > maxChars) { chars -= rest.shift()!.content.length }
         return [sys, ...rest]
       }
       if (messages.reduce((n, m) => n + m.content.length, 0) > ctxNeed * 3) {
         messages = compactForRetry(messages)
         this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 0, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: `compacted history for ctx ${ctxNeed}` })
       } else {
         this.emit(sid, 'step:start', { taskKind: classification.kind, stepIndex: 0, modelId: routing.modelId!, runtimeId: routing.runtimeId! })
       }
      const endpoint = regenOwnedEndpoint ?? entry!.endpoint
      const model = remoteModelId(routing.modelId!)
      const timeoutMs = Math.max(entry.timeoutMs, DEFAULT_TUNING.timeoutFloorMs)
      let text = ''
      let reasoningBuffer = ''
      let allReasoning = ''
      let inReasoning = !!(classification.reasoningRequired || opts?.reasoning)
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
      let streamed = true
      const inlineToolOutputs: string[] = []
      try {
        for await (const chunk of this.deps.llm.streamChat({ endpoint, model, messages, timeoutMs, stream: true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })) {
          if (chunk.type === 'text-delta' && chunk.text) {
            let delta = chunk.text
            if (inReasoning || delta.includes('<thinking>') || delta.includes('<think>')) {
              if (delta.includes('<thinking>') || delta.includes('<think>')) { inReasoning = true; delta = delta.replace(/<thinking>|<think>/g, '') }
              if (delta.includes('</thinking>') || delta.includes('</think>')) {
                const parts = delta.split(/<\/thinking>|<\/think>/)
                const tail = parts[0] ?? ''
                reasoningBuffer += tail
                allReasoning += tail
                // Exactly-once streaming (see execute()): emit the tail only.
                if (tail) { this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: tail }) }
                if (reasoningBuffer) { try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}; reasoningBuffer = '' }
                inReasoning = false; delta = parts.slice(1).join(''); if (!delta) continue
              }
              if (inReasoning) { reasoningBuffer += delta; allReasoning += delta; this.deps.emit({ sessionId: sid, kind: 'reasoning-delta', text: delta }); continue }
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
          this.log(routing.runtimeId!, endpoint, model, startedAll, undefined, 'cancelled', streamed)
          this.deps.emit({ sessionId: sid, kind: 'assistant-cancelled', seq: ev.seq })
          this.emit(sid, 'task:cancelled', { taskKind: classification.kind })
          return { ok: true, assistantSeq: ev.seq, routing, classification }
        }
        const raw = e instanceof ChatInferenceError ? e.message : String(e)
        if (/exceed.*context|context.*size/i.test(raw)) {
          // Auto-retry once after compacting history — prevents sticky invalid-response banner
          this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `context overflow — compacting and retrying` })
          try { await this.deps.persistence.appendEvent(sessionId, 'system/compact', { content: `Auto-compacted for context overflow (${raw.slice(0,120)})` }) } catch {}
          messages = compactForRetry(messages); text = ''; reasoningBuffer = ''; inReasoning = false
          try {
            for await (const chunk of this.deps.llm.streamChat({ endpoint, model, messages, timeoutMs, stream: true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })) {
              if (chunk.type === 'text-delta' && chunk.text) { text += chunk.text; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: chunk.text }) }
              if (chunk.type === 'done') break
            }
            if (text.trim() !== '') { this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `retry after compact — ${text.length} chars` }); /* fall through to normal post-processing */ } else { throw e }
          } catch (e2) { e = e2 }
          if (text.trim() === '') {
            const safe = e instanceof ChatInferenceError ? e.message : String(e)
            this.log(routing.runtimeId!, endpoint, model, startedAll, undefined, outcomeOf(e), streamed)
            this.emit(sid, 'task:error', { taskKind: classification.kind, detail: safe, error: safe })
            this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: `Context too large even after auto-compact — try /compact or new chat. (${raw.slice(0,150)})` })
            throw new AgentOrchestratorError('llm-failed', safe)
          }
        } else {
          const safe = e instanceof ChatInferenceError ? e.message : 'stream-error: the local runtime interrupted the reply'
          this.log(routing.runtimeId!, endpoint, model, startedAll, undefined, outcomeOf(e), streamed)
          this.emit(sid, 'task:error', { taskKind: classification.kind, detail: safe, error: safe })
          this.deps.emit({ sessionId: sid, kind: 'assistant-error', error: safe })
          throw new AgentOrchestratorError('llm-failed', safe)
        }
      }
      this.emit(sid, 'step:end', { taskKind: classification.kind, stepIndex: 0, detail: `llm done — ${text.length} chars` })
      // Unclosed <thinking> block: deltas already streamed — persist the
      // full text so a later refresh reconstructs it instead of losing it.
      if (reasoningBuffer) {
        try { await this.deps.persistence.appendEvent(sessionId, 'assistant/reasoning', { content: reasoningBuffer }) } catch {}
        allReasoning += reasoningBuffer
        reasoningBuffer = ''
      }
      // Post-stream recovery (mirrors execute()): the reasoning branch `continue`s
      // before any tool parsing, so fences inside  (the 3:42 PM regenerate
      // trace) and glued text fences were never executed → empty text → the
      // "empty reply after Ns — auto-compacted" ack. Scan BOTH channels;
      // dedupe by tool+args so duplicated calls dispatch exactly once.
      const executedSignatures = new Set<string>()
      const dispatchMissedFence = async (tName: string, args: Record<string, unknown>): Promise<boolean> => {
        const sig = `${tName}:${JSON.stringify(args)}`
        if (executedSignatures.has(sig)) return false
        executedSignatures.add(sig)
        try {
          this.deps.emit({ sessionId: sid, kind: 'tool:start', toolName: tName, detail: `post-stream ${tName} — dispatching` } as never)
          const r = await (this.deps.tools as unknown as { dispatch: (n: string, a: Record<string, unknown>) => Promise<string> }).dispatch(tName, args)
          inlineToolOutputs.push(`[${tName} ${JSON.stringify(args)}]\n${r.slice(0, 4000)}`)
          try { await this.deps.persistence.appendEvent(sessionId, 'tool/result' as never, { toolCallId: `${tName}-${Date.now()}` as never, content: r.slice(0, 8000) } as never) } catch {}
          this.deps.emit({ sessionId: sid, kind: 'tool:end', toolName: tName, detail: `post-stream ${tName} returned ${r.length} chars` } as never)
          return true
        } catch { return false }
      }
      let missed = 0
      const normalizeAbsPath = (f: { toolName: string; args: Record<string, unknown> }): void => {
        // Absolute paths the model emits (D:\SOVARA) normalize to workspace-relative '.'
        if (f.toolName === 'fs_list' && typeof f.args['path'] === 'string') {
          const p = (f.args['path'] as string).replace(/\\/g, '/').trim()
          if (/^[a-z]:\//i.test(p) || path.isAbsolute(p)) f.args['path'] = '.'
        }
      }
      if (looksLikeToolFence(text)) {
        for (const f of extractToolFences(text)) { normalizeAbsPath(f); if (await dispatchMissedFence(f.toolName, { ...f.args })) missed++ }
        if (missed > 0) text = stripToolFences(text)
      }
      if (looksLikeToolFence(allReasoning)) {
        for (const f of extractToolFences(allReasoning)) { normalizeAbsPath(f); if (await dispatchMissedFence(f.toolName, { ...f.args })) missed++ }
      }
      // Bare tool call recovery (regenerate path): same as execute() — detect
      // bare tool calls like fs_list {path:"."} in both text and reasoning.
      if (looksLikeBareToolCall(text)) {
        for (const f of extractBareToolCalls(text)) { normalizeAbsPath(f); if (await dispatchMissedFence(f.toolName, { ...f.args })) missed++ }
        if (missed > 0) text = stripBareToolCalls(text)
      }
      if (looksLikeBareToolCall(allReasoning)) {
        for (const f of extractBareToolCalls(allReasoning)) { normalizeAbsPath(f); if (await dispatchMissedFence(f.toolName, { ...f.args })) missed++ }
      }
      // Strip bare tool calls from text before checking if it's empty (regenerate path)
      if (text.trim() !== '' && looksLikeBareToolCall(text)) {
        const stripped = stripBareToolCalls(text)
        if (stripped.trim().length < 10) text = ''
      }
      if (text.trim() === '') {
        // Tool results recovered post-stream — the model just never wrote prose.
        // Answer deterministically from tool output instead of the error ack
        // (same policy as execute(); the 3:42 PM trace hit exactly this).
        if (inlineToolOutputs.length > 0) {
          const toolCtxForSynth = inlineToolOutputs.join('\n\n---\n\n').slice(0, 6000)
          const synthMsgs2: import('@shared/types/ports').LlmChatMessage[] = [
            ...messages,
            { role: 'user', content: `Tool results:\n${toolCtxForSynth}\n\nUsing the tool results above, provide the complete answer for the original request. List the actual files/folders found. Do not emit tool calls.` },
          ]
          try {
            let synthText = ''
            for await (const ch of this.deps.llm.streamChat({ endpoint, model, messages: synthMsgs2, timeoutMs, stream: true, signal: controller.signal, maxResponseBytes: AGENT_MAX_RESPONSE_BYTES })) {
              if (controller.signal.aborted) break
              if (ch.type === 'text-delta' && ch.text) { synthText += ch.text; this.deps.emit({ sessionId: sid, kind: 'assistant-delta', text: ch.text }) }
            }
            if (synthText.trim().length > 20 && !looksLikeBareToolCall(synthText)) {
              text = synthText
            } else {
              text = `Here are the results:\n\n${inlineToolOutputs.join('\n\n')}`
            }
          } catch {
            text = `Here are the results:\n\n${inlineToolOutputs.join('\n\n')}`
          }
          this.log(routing.runtimeId!, endpoint, model, startedAll, 200, 'ok', streamed)
          appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `tool-result synthesis answer after regenerate (${inlineToolOutputs.length} tool outputs) — empty-reply ack avoided` })
          this.emit(sid, 'task:complete', { taskKind: classification.kind, detail: 'answered from synthesized tool results (regenerate recovery)', stepIndex: 0 })
          const detSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
          this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq: detSeq })
          return { ok: true, assistantSeq: detSeq, routing, classification }
        }
        // allReasoning survives the per-chunk persist clears — the old
        // `reasoningBuffer.trim()` read an already-cleared buffer and never fired.
        const reasoningFallback2 = (allReasoning || reasoningBuffer).trim()
        const isToolOnly2 = reasoningFallback2.length > 0 && looksLikeBareToolCall(reasoningFallback2) && stripBareToolCalls(reasoningFallback2).trim().length < 10
        if (reasoningFallback2.length > 40 && !isToolOnly2) {
          text = reasoningFallback2
          appendChatLog(this.deps.baseDir, { sessionId: sid, action: 'send', detail: `promoted reasoning to answer after regenerate (${reasoningFallback2.length} chars)` })
        } else if (reasoningFallback2.length > 0 && !isToolOnly2) {
          text = reasoningFallback2
        } else {
          const secs = Math.round((Date.now() - startedAll) / 1000)
          const compactMsg = `Auto-compacted for empty regenerate — model ${model} returned no text after ${secs}s.`
          try { await this.deps.persistence.appendEvent(sessionId, 'system/compact', { content: compactMsg }) } catch {}
          const ack = `The model returned an empty reply after ${secs}s — context was auto-compacted. Retry or type /compact.`
          this.log(routing.runtimeId!, endpoint, model, startedAll, undefined, 'invalid-response', streamed)
          this.emit(sid, 'task:error', { taskKind: classification.kind, detail: ack, error: ack })
          const seq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: ack })).seq
          this.deps.emit({ sessionId: sid, kind: 'assistant-done', seq })
          this.emit(sid, 'task:complete', { taskKind: classification.kind, detail: `empty-regenerate ack after ${secs}s`, stepIndex: 0 })
          return { ok: true, assistantSeq: seq, routing, classification }
        }
      }
      const promptText = messages.map((m) => m.content).join(' ')
      const tokenUsage = usage ?? { promptTokens: Math.ceil(promptText.length / 4), completionTokens: Math.ceil(text.length / 4), totalTokens: Math.ceil((promptText.length + text.length) / 4) }
      try { this.deps.persistence.insertTokenUsage({ sessionId: sid, model, promptTokens: tokenUsage.promptTokens, completionTokens: tokenUsage.completionTokens, totalTokens: tokenUsage.totalTokens }) } catch {}
      const assistantSeq = (await this.deps.persistence.appendEvent(sessionId, 'assistant/message', { content: text })).seq
      this.log(routing.runtimeId!, endpoint, model, startedAll, 200, 'ok', streamed)
      this.emit(sid, 'task:complete', { taskKind: classification.kind, modelId: routing.modelId!, runtimeId: routing.runtimeId!, detail: `done in ${Date.now() - startedAll}ms`, stepIndex: 0 })
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

  /**
   * External fallback when the owned sidecar is quarantined: probe LM Studio
   * then Ollama (loopback, 3s each). Returns the first reachable model, or
   * null when neither server answers. Never throws — caller decides.
   */
  private async tryExternalFallback(
    _sid: string,
    _classification: TaskClassification,
    wantedModelId: string
  ): Promise<{ modelId: string; runtimeId: string; displayName: string } | null> {
    try {
      const wb = this.deps.workbench as unknown as {
        probeRuntime?: (id: string) => Promise<{ reachable: boolean; models: Array<{ modelId: string; displayName: string }> }>
        listModels?: (runtimeId?: string) => Array<{ modelId: string; displayName: string; runtimeId: string; available: boolean }>
      }
      for (const rid of ['lmstudio', 'ollama']) {
        try {
          const probe = await wb.probeRuntime?.(rid)
          if (probe && probe.reachable && probe.models.length > 0) {
            // Prefer a model whose id contains the wanted basename (same GGUF family)
            const needle = wantedModelId.split('/').pop()?.replace(/\.gguf$/i, '').toLowerCase() ?? ''
            const hit = (needle ? probe.models.find((m) => m.displayName.toLowerCase().includes(needle.slice(0, 12)) || m.modelId.toLowerCase().includes(needle.slice(0, 12))) : undefined) ?? probe.models[0]!
            try { await (this.deps.workbench as unknown as { selectModel: (r: string, m: string) => Promise<unknown> }).selectModel(rid, hit.modelId) } catch { /* selection best-effort */ }
            return { modelId: hit.modelId, runtimeId: rid, displayName: hit.displayName }
          }
        } catch { /* next candidate */ }
      }
      // Last resort: already-probed snapshot without a fresh probe
      try {
        const known = wb.listModels?.()
        const ext = (known ?? []).filter((m) => (m.runtimeId === 'lmstudio' || m.runtimeId === 'ollama') && m.available)
        if (ext.length > 0) {
          const first = ext[0]!
          return { modelId: first.modelId, runtimeId: first.runtimeId, displayName: first.displayName }
        }
      } catch { /* ignore */ }
    } catch { /* ignore */ }
    return null
  }

  private emit(sessionId: string, kind: ChatStreamEvent['kind'], extra: Partial<ChatStreamEvent> = {}): void {
    this.deps.emit({ sessionId, kind, ...extra })
  }

  private resolveModelFilePath(modelId?: string | null): string | undefined {
    if (!modelId) return undefined
    try {
      const res = (this.deps.models as unknown as { resolveModelPath?: (id: string) => string })?.resolveModelPath?.(modelId)
      if (res && fs.existsSync(res)) return res
    } catch {}
    return undefined
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

  // ── Tool Infrastructure Public API ──

  /**
   * Get the current tool infrastructure status.
   * Returns information about registered tools, MCP servers, execution logs, and scheduler state.
   */
  getToolInfrastructureStatus(): {
    available: boolean
    registeredTools: number
    mcpServers: string[]
    executionLogsCount: number
    schedulerState: {
      pending: number
      running: number
      completed: number
      maxConcurrency: number
    } | null
    ptcEnabled: boolean
  } {
    const infra = this.getToolInfra()
    if (!infra) {
      return {
        available: false,
        registeredTools: 0,
        mcpServers: [],
        executionLogsCount: 0,
        schedulerState: null,
        ptcEnabled: false,
      }
    }

    const status = infra.getStatus()
    return {
      available: true,
      registeredTools: status.toolCount,
      mcpServers: status.mcpServers.map((s) => s.name),
      executionLogsCount: infra.getExecutionLogs().length,
      schedulerState: status.executionStatus ? {
        pending: (status.executionStatus as any).queued ?? 0,
        running: ((status.executionStatus as any).runningParallel ?? 0) + ((status.executionStatus as any).runningExclusive ?? 0),
        completed: infra.getExecutionLogs().length,
        maxConcurrency: 4,
      } : null,
      ptcEnabled: false,
    }
  }

  /**
   * Get recent tool execution logs for debugging/analysis.
   */
  getToolExecutionLogs(limit: number = 50): Array<{
    id: string
    toolName: string
    status: 'success' | 'error' | 'cancelled'
    durationMs: number
    timestamp: number
    sessionId?: string
  }> {
    const infra = this.getToolInfra()
    if (!infra) return []

    return infra.getExecutionLogs(limit).map((entry: any) => ({
      id: entry.id,
      toolName: entry.toolName,
      status: entry.status,
      durationMs: entry.durationMs,
      timestamp: entry.timestamp,
      sessionId: entry.context?.sessionId,
    }))
  }

  /**
   * Get tool catalog (all registered tools with their metadata).
   */
  getToolCatalog(): Array<{
    name: string
    description: string
    inputSchema: unknown
    tags: string[]
    isMcp: boolean
    serverId?: string
  }> {
    const infra = this.getToolInfra()
    if (!infra) {
      // Fallback to legacy tool list
      return this.deps.tools.list().map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: {},
        tags: [],
        isMcp: false,
      }))
    }

    return infra.listTools().map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters || t.inputSchema || {},
      tags: t.tags ?? [],
      isMcp: t.isMcp ?? false,
      serverId: t.serverId,
    }))
  }

  /**
   * Execute a tool directly (for programmatic/tool calls from code).
   * This enables the PTC (Programmatic Tool Call) pattern.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    opts?: {
      sessionId?: string
      parallelStrategy?: 'sequential' | 'all' | 'race' | 'settled'
      executionPolicy?: ExecutionPolicy
    }
  ): Promise<{ ok: true; output: string; durationMs: number } | { ok: false; error: string; durationMs: number }> {
    return this.executeToolWithInfrastructure(
      opts?.sessionId ?? 'direct',
      toolName,
      args,
      {
        taskKind: 'direct',
        stepIndex: 0,
        parallelStrategy: opts?.parallelStrategy ?? 'sequential',
        executionPolicy: opts?.executionPolicy ?? { mode: 'parallel' },
      }
    )
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
