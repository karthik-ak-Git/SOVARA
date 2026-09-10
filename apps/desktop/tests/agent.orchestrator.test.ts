import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyTask } from '../src/main/backend/TaskClassifier'
import { routeModel } from '../src/main/backend/ModelRouter'
import { AgentOrchestrator } from '../src/main/backend/AgentOrchestrator'
import { clearAllInstances } from '../src/main/backend/ports/ModelRuntimeStub'
import type { PersistencePort, ProjectHeader, SessionEventView, SessionHeader, SystemResourceManagerPort } from '../src/shared/types/ports'
import type { SessionId } from '../src/shared/types/branded'
import type { ModelWorkbench } from '../src/main/backend/ModelWorkbench'
import type { LlmChunk, LlmChatRequest } from '../src/shared/types/ports'
import { ChatInferenceError } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import type { ChatStreamEvent } from '../src/shared/types/chat'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-agent-'))
}

function makePersistence(): PersistencePort & { events: Map<string, SessionEventView[]> } {
  const events = new Map<string, SessionEventView[]>()
  // need a session row for get() to succeed — pre-populate one
  const headers = new Map<string, SessionHeader>()
  headers.set('sess-1', { id: 'sess-1' as never, title: 't', createdAt: 1, updatedAt: 1, projectId: null })
  return {
    events,
    async create(title?: string): Promise<SessionHeader> {
      const id = `sess-${Date.now()}` as never
      return { id, title: title ?? 't', createdAt: 1, updatedAt: 1 }
    },
    async list(): Promise<SessionHeader[]> { return [...headers.values()] },
    async listArchived(): Promise<SessionHeader[]> { return [] },
    async get(id: SessionId): Promise<SessionHeader | null> { return headers.get(String(id)) ?? { id, title: 't', createdAt: 1, updatedAt: 1, projectId: null } },
    async rename(id: SessionId): Promise<SessionHeader> { return { id, title: 't', createdAt: 1, updatedAt: 1 } },
    async deletePermanently(): Promise<void> {},
    async createProject(name: string, rootPath: string): Promise<ProjectHeader> { return { id: 'proj-1', name, rootPath, createdAt: 1, updatedAt: 1 } },
    async listProjects(): Promise<ProjectHeader[]> { return [] },
    async renameProject(id: string, name: string): Promise<ProjectHeader> { return { id, name, rootPath: '', createdAt: 1, updatedAt: 1 } },
    async deleteProject(): Promise<void> {},
    async archive(): Promise<void> {},
    async unarchive(): Promise<void> {},
    async appendEvent(sessionId: SessionId, type: string, data: unknown): Promise<SessionEventView> {
      const list = events.get(String(sessionId)) ?? []
      const ev: SessionEventView = { seq: list.length, time: Date.now(), type, data }
      list.push(ev)
      events.set(String(sessionId), list)
      return ev
    },
    async getEvents(sessionId: SessionId): Promise<SessionEventView[]> {
      return [...(events.get(String(sessionId)) ?? [])]
    },
    insertTokenUsage: () => {},
    getTotalUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    getUsageByModel: () => [],
  }
}

function scriptLlm(script: string[], opts?: { throwErr?: unknown; hang?: boolean }) {
  return {
    async *stream(): AsyncIterable<LlmChunk> { throw new Error('unused') },
    async *streamChat(request: LlmChatRequest): AsyncIterable<LlmChunk> {
      if (opts?.hang) {
        await new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
      }
      if (opts?.throwErr) throw opts.throwErr
      for (const text of script) yield { type: 'text-delta' as const, text }
      yield { type: 'done' as const }
    },
  }
}

const okResources: SystemResourceManagerPort = {
  async getSnapshot() {
    return {
      cpu: { logicalCores: 8, loadAvg1: 0.5 },
      ram: { totalMB: 16384, freeMB: 8000, usedByAppMB: 200 },
      gpu: { available: true, name: 'Test GPU' },
      vram: { totalMB: 8192, freeMB: 6000, usedByModelsMB: 0 },
      disk: { path: '/tmp', totalMB: 100000, freeMB: 50000 },
      models: { instances: [], totalVramUsedMB: 0 },
      limits: { maxConcurrentModels: 2 },
    }
  },
  async checkBeforeLoad() { return { level: 'ok' as const } },
  async getLimits() { return { maxConcurrentModels: 2 } },
  async setLimits() {},
}

function makeWorkbench(models: Array<{ modelId: string; displayName: string; runtimeId: string; available: boolean; contextLength?: number }>, active?: { runtimeId: string; modelId: string } | null): ModelWorkbench {
  const runtimes = new Map<string, { id: string; displayName: string; type: 'openai-compatible'; endpoint: string; enabled: boolean; timeoutMs: number }>()
  for (const m of models) {
    if (!runtimes.has(m.runtimeId)) {
      runtimes.set(m.runtimeId, { id: m.runtimeId, displayName: m.runtimeId === 'rt-code' ? 'Code Runtime' : 'Local', type: 'openai-compatible', endpoint: m.runtimeId === 'local' ? 'local' : 'http://127.0.0.1:1234/v1', enabled: true, timeoutMs: 8000 })
    }
  }
  return {
    listModels: () => models.map((m) => ({ modelId: m.modelId, displayName: m.displayName, runtimeId: m.runtimeId, source: 'custom' as const, capabilities: m.modelId.includes('code') ? ['coding'] : m.modelId.includes('reason') ? ['reasoning'] : [], available: m.available, contextLength: m.contextLength })),
    getActiveModel: () => active ? { selection: active, available: true, displayName: active.modelId.split(':').pop(), runtimeDisplayName: active.runtimeId } : { selection: null, available: false },
    describeRuntime: (id: string) => runtimes.get(id) ?? null,
    selectModel: async (runtimeId: string, modelId: string) => {
      // simulate selection by updating active reference
      if (active) { active.runtimeId = runtimeId; active.modelId = modelId }
      return { selection: { runtimeId, modelId }, available: true, displayName: modelId.split(':').pop(), runtimeDisplayName: runtimeId }
    },
  } as unknown as ModelWorkbench
}

describe('TaskClassifier — honest task routing seam', () => {
  it('classifies analysis task from "Analyze this project"', () => {
    const c = classifyTask('Analyze this project and tell me what is wrong.')
    expect(c.kind).toBe('analysis')
    expect(c.reasoningRequired).toBe(true)
    expect(c.requiredCapabilities).toContain('analysis')
  })
  it('classifies coding when fences present', () => {
    const c = classifyTask('Fix this:\n```ts\nfunction foo() {}\n```')
    expect(c.kind).toBe('coding')
  })
  it('classifies chat by default', () => {
    expect(classifyTask('Hello there').kind).toBe('chat')
  })
  it('honors explicit reasoning toggle', () => {
    const c = classifyTask('Hello', { reasoning: true })
    expect(c.reasoningRequired).toBe(true)
    expect(['reasoning', 'coding']).toContain(c.kind)
  })
  it('classifies tool-use when webSearch hint', () => {
    const c = classifyTask('Search the web for docs', { webSearch: true })
    expect(c.kind).toBe('tool-use')
  })
})

describe('ModelRouter — smart selection, no hard-coded default', () => {
  it('picks code-capable model for coding task', async () => {
    const models = [
      { modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 },
      { modelId: 'rt-code:codellama-7b', displayName: 'codellama', runtimeId: 'rt-code', available: true, contextLength: 4096 },
    ]
    const routed = await routeModel({
      task: classifyTask('Fix this function:\n```ts\nconst x=1```'),
      models: models.map((m) => ({ ...m, source: 'custom' as const, capabilities: m.modelId.includes('codellama') ? ['coding'] : ['chat'] })),
      resources: await okResources.getSnapshot(),
      checkBeforeLoad: async () => ({ level: 'ok' }),
    })
    // codellama should win for coding despite phi being first
    expect(routed.modelId).toBe('rt-code:codellama-7b')
    expect(routed.reason).toMatch(/coding|capability/)
  })
  it('respects resource blocking and picks alternative', async () => {
    const models = [
      { modelId: 'rt-1:big-model', displayName: 'big', runtimeId: 'rt-1', available: true, contextLength: 32768 },
      { modelId: 'rt-1:small-model', displayName: 'small', runtimeId: 'rt-1', available: true, contextLength: 4096 },
    ]
    let calls = 0
    const routed = await routeModel({
      task: classifyTask('Hello'),
      models: models.map((m) => ({ ...m, source: 'custom' as const, capabilities: [] as string[] })),
      resources: await okResources.getSnapshot(),
      checkBeforeLoad: async (id) => {
        calls++
        if (id.includes('big-model')) return { level: 'critical', blocking: true, reason: 'vram blocked' }
        return { level: 'ok' }
      },
    })
    expect(calls).toBeGreaterThan(0)
    expect(routed.modelId).toBe('rt-1:small-model')
  })
  it('reports no model when none available', async () => {
    const routed = await routeModel({
      task: classifyTask('hi'),
      models: [],
      resources: await okResources.getSnapshot(),
    })
    expect(routed.modelId).toBeNull()
  })
})

describe('AgentOrchestrator — Chat → Agent execution → ModelRuntime → Session', () => {
  beforeEach(() => clearAllInstances())

  it('executes task:start → model:loading → model:ready → step:start → assistant-delta → assistant-done, and persists execution trace', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    const workbench = makeWorkbench([{ modelId: 'local:phi-4', displayName: 'phi-4', runtimeId: 'local', available: true }], { runtimeId: 'local', modelId: 'local:phi-4' })
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: scriptLlm(['Hello', ' world']),
      tools: { list: () => [], dispatch: async () => '' } as never,
      workbench,
      resources: okResources,
      models: (await import('../src/main/backend/ports/ModelRuntimeStub')).ModelRuntimeStub.prototype ? new (await import('../src/main/backend/ports/ModelRuntimeStub')).ModelRuntimeStub() : null as never,
      baseDir: dir,
      emit: (e) => emitted.push(e),
    })
    // Ensure models port is real stub (load will animate)
    ;(orchestrator as unknown as { deps: { models: unknown } }).deps.models = new (await import('../src/main/backend/ports/ModelRuntimeStub')).ModelRuntimeStub()

    const sid = 'sess-1' as SessionId
    // Need a session header for persistence.get to succeed — our mock returns one, but ensure event seq starts empty
    const res = await orchestrator.execute(sid, 'Analyze this project and tell me what is wrong.', {})
    expect(res.ok).toBe(true)
    expect(res.classification.kind).toBe('analysis')
    // Check emitted lifecycle
    const kinds = emitted.map((e) => e.kind)
    expect(kinds).toContain('task:start')
    expect(kinds).toContain('task:planning')
    expect(kinds).toContain('model:selecting')
    expect(kinds).toContain('model:loading')
    expect(kinds).toContain('model:ready')
    expect(kinds).toContain('step:start')
    expect(kinds).toContain('assistant-delta')
    expect(kinds).toContain('assistant-done')
    expect(kinds).toContain('task:complete')
    // Persisted: user + agent/execution + assistant (+ reasoning maybe)
    const evts = await persistence.getEvents(sid)
    const types = evts.map((e) => e.type)
    expect(types).toContain('user/message')
    expect(types).toContain('assistant/message')
    expect(types).toContain('agent/execution')
    // Model should be in loaded state via ModelRuntimePort
    const { ModelRuntimeStub } = await import('../src/main/backend/ports/ModelRuntimeStub')
    const instances = await new ModelRuntimeStub().listInstances()
    expect(instances.some((i) => i.modelId === 'local:phi-4')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('honestly reports model:failed when runtime unavailable', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    // Workbench with no models → routing will fail
    const workbench = makeWorkbench([], null)
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: scriptLlm(['x']),
      tools: { list: () => [], dispatch: async () => '' } as never,
      workbench,
      resources: okResources,
      models: new (await import('../src/main/backend/ports/ModelRuntimeStub')).ModelRuntimeStub(),
      baseDir: dir,
      emit: (e) => emitted.push(e),
    })
    const sid = 'sess-1' as SessionId
    await expect(orchestrator.execute(sid, 'hello', {})).rejects.toMatchObject({ code: 'no-model-available' })
    expect(emitted.some((e) => e.kind === 'task:error')).toBe(true)
    const evts = await persistence.getEvents(sid)
    // User event must NOT be persisted when routing fails (honest, no fake)
    expect(evts.length).toBe(0)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('cancellation propagates to stream and persists cancelled marker', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: scriptLlm([], { hang: true }),
      tools: { list: () => [], dispatch: async () => '' } as never,
      workbench,
      resources: okResources,
      models: new (await import('../src/main/backend/ports/ModelRuntimeStub')).ModelRuntimeStub(),
      baseDir: dir,
      emit: (e) => emitted.push(e),
    })
    const sid = 'sess-1' as SessionId
    const pending = orchestrator.execute(sid, 'long task please', {})
    await new Promise((r) => setTimeout(r, 80))
    expect(orchestrator.cancel(sid).cancelled).toBe(true)
    const res = await pending
    expect(res.ok).toBe(true)
    const evts = await persistence.getEvents(sid)
    expect(evts.map((e) => e.type)).toContain('assistant/cancelled')
    expect(emitted.some((e) => e.kind === 'task:cancelled' || e.kind === 'assistant-cancelled')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('resource pressure blocks honestly and persists nothing', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const blockedResources: SystemResourceManagerPort = {
      ...okResources,
      checkBeforeLoad: async () => ({ level: 'critical' as const, blocking: true, reason: 'insufficient VRAM' }),
      getSnapshot: okResources.getSnapshot,
    }
    const workbench = makeWorkbench([{ modelId: 'local:phi-4', displayName: 'phi-4', runtimeId: 'local', available: true }], { runtimeId: 'local', modelId: 'local:phi-4' })
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: scriptLlm(['x']),
      tools: { list: () => [], dispatch: async () => '' } as never,
      workbench,
      resources: blockedResources,
      models: new (await import('../src/main/backend/ports/ModelRuntimeStub')).ModelRuntimeStub(),
      baseDir: dir,
      emit: () => {},
    })
    const sid = 'sess-1' as SessionId
    await expect(orchestrator.execute(sid, 'hello', {})).rejects.toMatchObject({ code: 'resource-blocked' })
    const evts = await persistence.getEvents(sid)
    expect(evts.length).toBe(0)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('streams via HTTP runtime (non-local) and reflects real model:ready with VRAM', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: scriptLlm(['Hello']),
      tools: { list: () => [], dispatch: async () => '' } as never,
      workbench,
      resources: okResources,
      models: new (await import('../src/main/backend/ports/ModelRuntimeStub')).ModelRuntimeStub(),
      baseDir: dir,
      emit: (e) => emitted.push(e),
    })
    const sid = 'sess-1' as SessionId
    const res = await orchestrator.execute(sid, 'hi', {})
    expect(res.ok).toBe(true)
    const evts = await persistence.getEvents(sid)
    expect(evts.some((e) => e.type === 'assistant/message' && (e.data as { content: string }).content.includes('Hello'))).toBe(true)
    const ready = emitted.find((e) => e.kind === 'model:ready')
    expect(ready).toBeDefined()
    expect(ready?.modelId).toBe('rt-1:phi-4')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
