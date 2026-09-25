import { describe, it, expect, beforeEach, vi } from 'vitest'
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

function sequenceLlm(responses: string[][]) {
  let call = 0
  return {
    async *stream(): AsyncIterable<LlmChunk> { throw new Error('unused') },
    async *streamChat(_request: LlmChatRequest): AsyncIterable<LlmChunk> {
      const response = responses[Math.min(call++, responses.length - 1)] ?? ['done']
      for (const text of response) yield { type: 'text-delta' as const, text }
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
    // Owned-runtime path, honestly mocked at the PORT boundary: load resolves
    // a serving instance, baseUrl points at it, and the scripted LLM streams.
    // No canned assistant text anywhere in shipped code — the script stands in
    // for the sidecar's HTTP stream only.
    const loaded: Array<{ id: string; modelId: string }> = []
    const mockModels = {
      load: async (modelId: string) => {
        const inst = { id: `inst_${String(modelId).replace(/[^a-z0-9]/gi, '_')}`, modelId }
        loaded.push(inst)
        return inst
      },
      baseUrl: (id: string) => {
        if (!loaded.some((i) => i.id === String(id))) throw new Error('instance not found')
        return 'http://127.0.0.1:9/v1'
      },
      unload: async () => {},
      health: async () => ({ ok: true }),
      listInstances: async () => loaded.map((i) => ({ id: i.id, modelId: i.modelId, runtimeId: 'local', status: 'loaded' as const, ctxLen: 4096 })),
      probeRuntime: async () => ({ available: true }),
      listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      // 'analysis' tasks enable reasoning: the stream carries a closed
      // <thinking> block first (as a real reasoning model would), then answer.
      llm: scriptLlm(['<thinking>checking the project</thinking>', 'Hello', ' world']),
      tools: { list: () => [], dispatch: async () => '' } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      emit: (e) => emitted.push(e),
    })

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
    // The streamed reply is the LLM's real output, not a canned stub —
    // plus the enforced ## Recap ending (what was done + files touched).
    expect((evts.find((e) => e.type === 'assistant/message')?.data as { content: string }).content).toBe(
      'Hello world\n\n## Recap\n- Did: answered directly (no tools used)\n- Files: none\n- Model: phi-4'
    )
    // Model went through ModelRuntimePort.load (the VRAM seam)
    expect(loaded.some((i) => i.modelId === 'local:phi-4')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('honestly reports model:failed when runtime unavailable', async () => {    const dir = mkTmp()
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
    // Pre-stream failure now persists user + ⚠️ bubble so the timeline
    // isn't left with a bubble-less user prompt (no fake success text).
    expect(evts.map((e) => e.type)).toEqual(['user/message', 'assistant/message'])
    expect((evts.find((e) => e.type === 'assistant/message')?.data as { content: string }).content).toMatch(/^⚠️ /)
    expect(evts.some((e) => e.type === 'assistant/done' || e.type === 'assistant/message')).toBe(true)
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

  it('resource pressure blocks honestly and persists user + ⚠️ bubble', async () => {
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
    // Pre-stream resource block persists user + ⚠️ bubble (bubble-less fix).
    expect(evts.map((e) => e.type)).toEqual(['user/message', 'assistant/message'])
    expect((evts.find((e) => e.type === 'assistant/message')?.data as { content: string }).content).toMatch(/^⚠️ /)
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

describe('AgentOrchestrator — action-first autonomy', () => {
  it('continues past a plan-only response and dispatches the requested file tool', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const toolDefs = [
      { name: 'search_skills', description: 'Search skills', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'read_skill', description: 'Read skill', parameters: { type: 'object', properties: { skill_name: { type: 'string' } }, required: ['skill_name'] } },
      { name: 'fs_write', description: 'Write a file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
      { name: 'shell_exec', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
    ]
    const workbench = makeWorkbench([{ modelId: 'local:code-phi', displayName: 'code-phi', runtimeId: 'local', available: true }], { runtimeId: 'local', modelId: 'local:code-phi' })
    const loaded: Array<{ id: string; modelId: string }> = []
    const mockModels = {
      load: async (modelId: string) => {
        const inst = { id: `inst_${String(modelId).replace(/[^a-z0-9]/gi, '_')}`, modelId }
        loaded.push(inst)
        return inst
      },
      baseUrl: () => 'http://127.0.0.1:9/v1',
      unload: async () => {},
      health: async () => ({ ok: true }),
      listInstances: async () => loaded.map((i) => ({ id: i.id, modelId: i.modelId, runtimeId: 'local', status: 'loaded' as const, ctxLen: 4096 })),
      probeRuntime: async () => ({ available: true }),
      listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: sequenceLlm([
        ['```tool:search_skills\n{"query":"python"}\n```'],
        ['```tool:read_skill\n{"skill_name":"python"}\n```'],
        ["I'll extract the code, create the Python file, install the packages, and run the sample input. Here's my plan: first inspect the image, then write and execute everything."],
        ['```tool:fs_write\n{"path":"solution.py","content":"print(\'done\')"}\n```'],
        ['```tool:shell_exec\n{"command":"python solution.py"}\n```'],
        ['Created solution.py and ran the sample input successfully.'],
      ]),
      tools: {
        list: () => toolDefs,
        dispatch: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args })
          if (name === 'search_skills') return JSON.stringify({ skills: ['python'] })
          if (name === 'read_skill') return JSON.stringify({ content: 'Use fs_write for files.' })
          if (name === 'fs_write') return JSON.stringify({ success: true, path: args.path, bytes: String(args.content).length })
          if (name === 'shell_exec') return JSON.stringify({ ok: true, output: 'done' })
          return JSON.stringify({ error: `unexpected tool ${name}` })
        },
      } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: (e) => emitted.push(e),
      // Keep the test on the real dispatch seam without a global infrastructure
      // implementation from another test changing the behavior.
      toolInfrastructure: { getRegistry: () => ({ list: () => [], has: () => false }) } as never,
    })

    const res = await orchestrator.execute(
      'sess-1' as SessionId,
      'Create a Python file from the image, install its packages, and run the sample input.',
      {},
    )

    expect(res.ok).toBe(true)
    expect(calls.map((c) => c.name)).toEqual(['search_skills', 'read_skill', 'fs_write', 'shell_exec'])
    expect(calls.find((c) => c.name === 'fs_write')?.args).toMatchObject({ path: 'solution.py' })
    expect(emitted.some((e) => e.kind === 'tool:start' && e.toolName === 'fs_write')).toBe(true)
    const answer = (await persistence.getEvents('sess-1' as SessionId)).find((e) => e.type === 'assistant/message')?.data as { content: string }
    expect(answer.content).toContain('Created solution.py')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('executes a legacy JSON tool envelope and keeps the envelope out of the answer', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const workbench = makeWorkbench([{ modelId: 'local:code-phi', displayName: 'code-phi', runtimeId: 'local', available: true }], { runtimeId: 'local', modelId: 'local:code-phi' })
    const loaded: Array<{ id: string; modelId: string }> = []
    const mockModels = {
      load: async (modelId: string) => {
        const inst = { id: `inst_${String(modelId).replace(/[^a-z0-9]/gi, '_')}`, modelId }
        loaded.push(inst)
        return inst
      },
      baseUrl: () => 'http://127.0.0.1:9/v1',
      unload: async () => {},
      health: async () => ({ ok: true }),
      listInstances: async () => loaded.map((i) => ({ id: i.id, modelId: i.modelId, runtimeId: 'local', status: 'loaded' as const, ctxLen: 4096 })),
      probeRuntime: async () => ({ available: true }),
      listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: sequenceLlm([
        ['```json-output\n{"thought":"Run the command","action":"shell_exec","tool_call":{"command":"node --version"}}\n```'],
        ['The command ran successfully.'],
      ]),
      tools: {
        list: () => [{ name: 'shell_exec', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
        dispatch: async (name: string, args: Record<string, unknown>) => {
          calls.push({ name, args })
          return JSON.stringify({ ok: true, output: 'v22.0.0' })
        },
      } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: (e) => emitted.push(e),
      toolInfrastructure: { getRegistry: () => ({ list: () => [], has: () => false }) } as never,
    })

    const result = await orchestrator.execute('sess-1' as SessionId, 'Run node --version now and report the output.', {})
    expect(result.ok).toBe(true)
    expect(calls).toEqual([{ name: 'shell_exec', args: { command: 'node --version' } }])
    const events = await persistence.getEvents('sess-1' as SessionId)
    const answer = events.find((e) => e.type === 'assistant/message')?.data as { content: string }
    expect(answer.content).not.toContain('json-output')
    expect(events.some((e) => e.type === 'tool/call' && (e.data as { name?: string }).name === 'shell_exec')).toBe(true)
    expect(emitted.some((e) => e.kind === 'tool:start' && e.toolName === 'shell_exec')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('promotes nested run_code tools into the persisted trace and recap', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const workbench = makeWorkbench([{ modelId: 'local:code-phi', displayName: 'code-phi', runtimeId: 'local', available: true }], { runtimeId: 'local', modelId: 'local:code-phi' })
    const loaded: Array<{ id: string; modelId: string }> = []
    const mockModels = {
      load: async (modelId: string) => {
        const inst = { id: `inst_${String(modelId).replace(/[^a-z0-9]/gi, '_')}`, modelId }
        loaded.push(inst)
        return inst
      },
      baseUrl: () => 'http://127.0.0.1:9/v1',
      unload: async () => {},
      health: async () => ({ ok: true }),
      listInstances: async () => loaded.map((i) => ({ id: i.id, modelId: i.modelId, runtimeId: 'local', status: 'loaded' as const, ctxLen: 4096 })),
      probeRuntime: async () => ({ available: true }),
      listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: sequenceLlm([
        ['```tool:run_code\n{"code":"return await tools.fs_write({ path: \'nested.txt\', content: \'hello\' })"}\n```'],
        ['Created nested.txt.'],
      ]),
      tools: {
        list: () => [{ name: 'run_code', description: 'Run JavaScript with tools', parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] } }],
        dispatch: async (name: string) => {
          if (name === 'run_code') {
            return JSON.stringify({
              output: 'ok',
              toolCalls: [
                { toolName: 'fs_list', arguments: { path: '.' }, result: { entries: [] }, timestamp: 1 },
                { toolName: 'fs_write', arguments: { path: 'nested.txt', content: 'hello' }, result: { ok: true, path: 'nested.txt' }, timestamp: 2 },
              ],
            })
          }
          return JSON.stringify({ error: `unexpected tool ${name}` })
        },
      } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: () => {},
      toolInfrastructure: { getRegistry: () => ({ list: () => [], has: (name: string) => name === 'run_code' }) } as never,
    })

    const result = await orchestrator.execute('sess-1' as SessionId, 'Inspect a workspace and create a file.', {})
    expect(result.ok).toBe(true)
    const events = await persistence.getEvents('sess-1' as SessionId)
    const calls = events.filter((e) => e.type === 'tool/call').map((e) => (e.data as { name?: string }).name)
    expect(calls).toEqual(expect.arrayContaining(['run_code', 'fs_write']))
    const answer = events.find((e) => e.type === 'assistant/message')?.data as { content: string }
    expect(answer.content).toContain('nested.txt')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('dispatches a subagent, parks the parent, and resumes with the real answer', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const loaded = [{ id: 'inst-1', modelId: 'rt-1:phi-4', runtimeId: 'rt-1', status: 'loaded' as const, ctxLen: 4096 }]
    const mockModels = {
      ensureHealthy: async () => loaded[0],
      load: async () => loaded[0],
      unload: async () => {},
      health: async () => ({ ok: true }),
      listInstances: async () => loaded,
      probeRuntime: async () => ({ available: true }),
      listLocalModels: async () => [],
    }

    let subagentFinished = false
    const orchestrator = new AgentOrchestrator({
      persistence,
      // Parent turn 1 delegates; parent turn 2 reports what came back.
      llm: sequenceLlm([
        ['```tool:invoke_subagent\n{"role":"explore","description":"find the config"}\n```'],
        ['The subagent found it.'],
      ]),
      tools: {
        list: () => [{ name: 'invoke_subagent', description: 'Delegate', parameters: { type: 'object', properties: { role: { type: 'string' }, description: { type: 'string' } }, required: ['description'] } }],
        dispatch: async (name: string, args: Record<string, unknown>) => {
          if (name === 'invoke_subagent') {
            // The parent must be suspended here, not generating.
            expect(orchestrator.isGenerating('sess-1' as SessionId)).toBe(true)
            subagentFinished = true
            return JSON.stringify({
              ok: true,
              jobId: 'sub_1',
              role: args.role,
              answer: 'the config lives in src/config.ts',
            })
          }
          return JSON.stringify({ error: `unexpected tool ${name}` })
        },
      } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: (e: ChatStreamEvent) => emitted.push(e),
      toolInfrastructure: { getRegistry: () => ({ list: () => [], has: (name: string) => name === 'invoke_subagent' }) } as never,
    })

    const result = await orchestrator.execute('sess-1' as SessionId, 'Find the config file for me.', {})
    expect(result.ok).toBe(true)
    expect(subagentFinished).toBe(true)

    // The delegated answer must reach the parent's transcript as real evidence.
    const events = await persistence.getEvents('sess-1' as SessionId)
    const calls = events.filter((e) => e.type === 'tool/call').map((e) => (e.data as { name?: string }).name)
    expect(calls).toContain('invoke_subagent')
    const resultEvent = events.find((e) => e.type === 'tool/result')?.data as { content?: string }
    expect(resultEvent.content).toContain('src/config.ts')

    // And the parent's final answer is persisted.
    const answer = [...events].reverse().find((e) => e.type === 'assistant/message')?.data as { content: string }
    expect(answer.content).toContain('found it')

    // Live lifecycle events were projected for the UI.
    const kinds = emitted.filter((e) => e.sessionId === 'sess-1').map((e) => e.kind)
    expect(kinds).toContain('tool:start')
    expect(kinds).toContain('tool:end')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not let a failed subagent satisfy the completion gate', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const loaded = [{ id: 'inst-1', modelId: 'rt-1:phi-4', runtimeId: 'rt-1', status: 'loaded' as const, ctxLen: 4096 }]
    const mockModels = {
      ensureHealthy: async () => loaded[0], load: async () => loaded[0], unload: async () => {},
      health: async () => ({ ok: true }), listInstances: async () => loaded,
      probeRuntime: async () => ({ available: true }), listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: sequenceLlm([
        ['```tool:invoke_subagent\n{"role":"explore","description":"find the config"}\n```'],
        ['I looked, but it failed.'],
      ]),
      tools: {
        list: () => [{ name: 'invoke_subagent', description: 'Delegate', parameters: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] } }],
        dispatch: async () => JSON.stringify({
          ok: false, jobId: 'sub_1', status: 'failed',
          error: 'model resident and busy', code: 'SUBAGENT_FAILED',
        }),
      } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: () => {},
      toolInfrastructure: { getRegistry: () => ({ list: () => [], has: (name: string) => name === 'invoke_subagent' }) } as never,
    })

    // The gate must still refuse: a failed delegation is not evidence of work.
    await expect(orchestrator.execute('sess-1' as SessionId, 'Find and read the config file.', {}))
      .rejects.toThrow(/did not complete/i)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not leak a subagent fence into the assistant answer', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const loaded = [{ id: 'inst-1', modelId: 'rt-1:phi-4', runtimeId: 'rt-1', status: 'loaded' as const, ctxLen: 4096 }]
    const mockModels = {
      ensureHealthy: async () => loaded[0], load: async () => loaded[0], unload: async () => {},
      health: async () => ({ ok: true }), listInstances: async () => loaded,
      probeRuntime: async () => ({ available: true }), listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: sequenceLlm([
        ['```tool:invoke_subagent\n{}\n```'],
        ['Done.'],
      ]),
      tools: {
        list: () => [{ name: 'invoke_subagent', description: 'Delegate', parameters: { type: 'object', properties: { description: { type: 'string' } }, required: ['description'] } }],
        // An empty description must be rejected, and still must not leak markup.
        dispatch: async () => JSON.stringify({ error: 'invoke_subagent requires { description: string }', code: 'INVALID_ARGUMENTS' }),
      } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: () => {},
      toolInfrastructure: { getRegistry: () => ({ list: () => [], has: (name: string) => name === 'invoke_subagent' }) } as never,
    })

    await orchestrator.execute('sess-1' as SessionId, 'Delegate this.', {})
    const events = await persistence.getEvents('sess-1' as SessionId)
    const answer = [...events].reverse().find((e) => e.type === 'assistant/message')?.data as { content: string }
    expect(answer.content).not.toContain('tool:invoke_subagent')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a second turn on the same session while one is generating', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const loaded = [{ id: 'inst-1', modelId: 'rt-1:phi-4', runtimeId: 'rt-1', status: 'loaded' as const, ctxLen: 4096 }]
    const mockModels = {
      ensureHealthy: async () => loaded[0], load: async () => loaded[0], unload: async () => {},
      health: async () => ({ ok: true }), listInstances: async () => loaded,
      probeRuntime: async () => ({ available: true }), listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: sequenceLlm([['first'], ['second']]),
      tools: { list: () => [], dispatch: async () => '{}' } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: () => {},
    })

    const first = orchestrator.execute('sess-1' as SessionId, 'one', {})
    await vi.waitFor(() => expect(orchestrator.isGenerating('sess-1' as SessionId)).toBe(true))
    // The real guard: a colliding request is refused, not interleaved.
    await expect(orchestrator.execute('sess-1' as SessionId, 'two', {})).rejects.toThrow(/already-generating/)
    await first
    // Once the first turn finishes, the session is usable again.
    expect(orchestrator.isGenerating('sess-1' as SessionId)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('runs a subagent in an isolated slot so it never blocks its own parent session', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const loaded = [{ id: 'inst-1', modelId: 'rt-1:phi-4', runtimeId: 'rt-1', status: 'loaded' as const, ctxLen: 4096 }]
    const mockModels = {
      ensureHealthy: async () => loaded[0], load: async () => loaded[0], unload: async () => {},
      health: async () => ({ ok: true }), listInstances: async () => loaded,
      probeRuntime: async () => ({ available: true }), listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: sequenceLlm([['parent answer'], ['child answer']]),
      tools: { list: () => [], dispatch: async () => '{}' } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: () => {},
    })

    const parent = orchestrator.execute('sess-1' as SessionId, 'parent turn', {})
    await vi.waitFor(() => expect(orchestrator.isGenerating('sess-1' as SessionId)).toBe(true))

    // The subagent shares the parent session id but uses its own slot, so it
    // must be accepted instead of tripping the already-generating guard.
    const child = orchestrator.execute(
      'sess-1' as SessionId,
      'child task',
      {},
      { slotKey: 'subagent:sub_test' },
    )
    await expect(child).resolves.toMatchObject({ ok: true })
    await parent

    // And cancelling the parent must not have been confused by the child.
    expect(orchestrator.isGenerating('sess-1' as SessionId)).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('cancels child subagents when the parent turn is cancelled', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const loaded = [{ id: 'inst-1', modelId: 'rt-1:phi-4', runtimeId: 'rt-1', status: 'loaded' as const, ctxLen: 4096 }]
    const mockModels = {
      ensureHealthy: async () => loaded[0], load: async () => loaded[0], unload: async () => {},
      health: async () => ({ ok: true }), listInstances: async () => loaded,
      probeRuntime: async () => ({ available: true }), listLocalModels: async () => [],
    }
    const cancelledChildren: string[] = []
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: sequenceLlm([['never finishes in time']]),
      tools: { list: () => [], dispatch: async () => '{}' } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: () => {},
    })
    orchestrator.setSubagentCanceller((sid) => {
      cancelledChildren.push(sid)
      return 1
    })

    const turn = orchestrator.execute('sess-1' as SessionId, 'long turn', {})
    await vi.waitFor(() => expect(orchestrator.isGenerating('sess-1' as SessionId)).toBe(true))
    orchestrator.cancel('sess-1' as SessionId)
    // The canceller ran for this session, so no child is left holding the model.
    expect(cancelledChildren).toEqual(['sess-1'])
    await turn.catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not report success when a required command is never dispatched', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    const workbench = makeWorkbench([{ modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', available: true, contextLength: 8192 }], { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: scriptLlm(["I'll run that command now."]),
      tools: {
        list: () => [{ name: 'shell_exec', description: 'Run a command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } }],
        dispatch: async () => JSON.stringify({ error: 'must not be called' }),
      } as never,
      workbench,
      resources: okResources,
      models: new (await import('../src/main/backend/ports/ModelRuntimeStub')).ModelRuntimeStub(),
      baseDir: dir,
      getExecMode: () => 'allow',
      emit: (e) => emitted.push(e),
    })

    await expect(orchestrator.execute('sess-1' as SessionId, 'Run `python --version` now and report the output.', {})).rejects.toMatchObject({ code: 'llm-failed' })
    expect(emitted.some((e) => e.kind === 'task:complete')).toBe(false)
    const answer = (await persistence.getEvents('sess-1' as SessionId)).find((e) => e.type === 'assistant/message')?.data as { content: string }
    expect(answer.content).toContain('Autonomous execution did not complete')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('AgentOrchestrator — clarify', () => {
  it('clarify emits a real question card and returns the user answer', async () => {
    const emitted: ChatStreamEvent[] = []
    const orchestrator = new AgentOrchestrator({
      persistence: makePersistence(),
      emit: (event: ChatStreamEvent) => emitted.push(event),
    } as never)
    const pending = (orchestrator as unknown as {
      handleClarifyCall: (sessionId: string, toolCallId: string, args: Record<string, unknown>, projectId: string | null) => Promise<string>
    }).handleClarifyCall('sess-1', 'clarify-test', {
      questions: [{ question: 'Which runtime?', options: ['Node.js', 'Python'] }],
    }, null)

    expect(emitted.find((e) => e.kind === 'agent:clarify')).toMatchObject({
      toolCallId: 'clarify-test',
      questions: [{ id: 'q1', question: 'Which runtime?', options: ['Node.js', 'Python'] }],
    })
    orchestrator.resolveToolApproval('clarify-test', true, { answers: { q1: 'Node.js' } })
    await expect(pending).resolves.toBe(JSON.stringify({ answers: { q1: 'Node.js' }, skipped: false }))
  })
})

describe('AgentOrchestrator — reasoning streams exactly once', () => {
  function reasoningHarness(script: string[]) {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: ChatStreamEvent[] = []
    const workbench = makeWorkbench([{ modelId: 'local:phi-4', displayName: 'phi-4', runtimeId: 'local', available: true }], { runtimeId: 'local', modelId: 'local:phi-4' })
    const loaded: Array<{ id: string; modelId: string }> = []
    const mockModels = {
      load: async (modelId: string) => {
        const inst = { id: `inst_${String(modelId).replace(/[^a-z0-9]/gi, '_')}`, modelId }
        loaded.push(inst)
        return inst
      },
      baseUrl: () => 'http://127.0.0.1:9/v1',
      unload: async () => {},
      health: async () => ({ ok: true }),
      listInstances: async () => [],
      probeRuntime: async () => ({ available: true }),
      listLocalModels: async () => [],
    }
    const orchestrator = new AgentOrchestrator({
      persistence,
      llm: scriptLlm(script),
      tools: { list: () => [], dispatch: async () => '' } as never,
      workbench,
      resources: okResources,
      models: mockModels as never,
      baseDir: dir,
      emit: (e) => emitted.push(e),
    })
    return { dir, persistence, emitted, orchestrator }
  }

  it('split <thinking> close emits the tail only (no double count), persists full text', async () => {
    const { dir, persistence, emitted, orchestrator } = reasoningHarness(['<thinking>ab', 'cd</thinking>', 'Hi'])
    const res = await orchestrator.execute('sess-1' as SessionId, 'Analyze this project and tell me what is wrong.', {})
    expect(res.ok).toBe(true)
    const deltas = emitted.filter((e) => e.kind === 'reasoning-delta').map((e) => (e as { text?: string }).text ?? '')
    expect(deltas.join('')).toBe('abcd') // 'ab' + 'cd' — never 'ab' + 'abcd'
    const evts = await persistence.getEvents('sess-1' as SessionId)
    const persisted = evts.filter((e) => e.type === 'assistant/reasoning').map((e) => (e.data as { content: string }).content)
    expect(persisted).toEqual(['abcd'])
    expect((evts.find((e) => e.type === 'assistant/message')?.data as { content: string }).content).toBe(
      'Hi\n\n## Recap\n- Did: answered directly (no tools used)\n- Files: none\n- Model: phi-4'
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('unclosed <thinking> block still persists streamed reasoning', async () => {
    // No close tag: everything stays reasoning, so the run ends as
    // invalid-response — but the streamed reasoning must be persisted,
    // not silently dropped.
    const { dir, persistence, emitted, orchestrator } = reasoningHarness(['<thinking>ab', 'cd'])
    const res = await orchestrator.execute('sess-1' as SessionId, 'Analyze this project and tell me what is wrong.', {})
    expect(res.ok).toBe(true)
    const deltas = emitted.filter((e) => e.kind === 'reasoning-delta').map((e) => (e as { text?: string }).text ?? '')
    expect(deltas.join('')).toBe('abcd')
    const evts = await persistence.getEvents('sess-1' as SessionId)
    const persisted = evts.filter((e) => e.type === 'assistant/reasoning').map((e) => (e.data as { content: string }).content)
    expect(persisted).toEqual(['abcd']) // flushed at end of stream, not lost
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
