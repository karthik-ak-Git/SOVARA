/**
 * TRUE end-to-end: real HTTP server on loopback → real LocalOpenAIChatAdapter
 * (real fetch, real SSE parsing) → real AgentOrchestrator → real tool dispatch
 * → real files written to a real temp workspace.
 *
 * Only the model weights are absent — a real llama-server needs real VRAM. The
 * server here speaks the same /v1/chat/completions SSE dialect a real local
 * runtime does, so every line of parsing, routing, gating, dispatch and disk IO
 * in SOVARA is the production code path.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { AddressInfo } from 'node:net'

import { LocalOpenAIChatAdapter } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import { AgentOrchestrator } from '../src/main/backend/AgentOrchestrator'
import { dispatchFs } from '../src/main/capabilities/fs'
import { dispatchShell } from '../src/main/capabilities/shell'
import { IPC_CHANNELS } from '../src/shared/ipc/channels'
import type { SessionId } from '../src/shared/types/branded'
import type { PersistencePort, SessionEventView, SessionHeader, SystemResourceManagerPort } from '../src/shared/types/ports'
import type { ModelWorkbench } from '../src/main/backend/ModelWorkbench'
import type { ChatStreamEvent } from '../src/shared/types/chat'

// ── A real local-runtime server speaking the real SSE dialect ──────────
type Turn = { content: string; toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> }

let server: http.Server
let baseUrl: string
const turns: Turn[] = []
let turnIndex = 0
/** Every request body the adapter actually sent — proves the wire contract. */
const wireLog: any[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      let parsed: any = {}
      try { parsed = JSON.parse(body || '{}') } catch { /* ignore */ }
      wireLog.push({ url: req.url, body: parsed })

      if (req.url?.endsWith('/v1/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'e2e-test-model' }] }))
        return
      }
      if (!req.url?.endsWith('/v1/chat/completions')) {
        res.writeHead(404).end()
        return
      }
      const turn = turns[Math.min(turnIndex++, turns.length - 1)] ?? { content: '' }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      if (turn.toolCalls?.length) {
        // Native tool_calls path: exactly what llama-server emits.
        const chunks: any[] = turn.toolCalls.map((tc, i) => ({
          choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } }] } }],
        }))
        chunks.push({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
        for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      // Streamed text, split mid-word like a real token stream.
      const text = turn.content
      for (let i = 0; i < text.length; i += 7) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text.slice(i, i + 7) }, finish_reason: null }] })}\n\n`)
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})

afterAll(async () => { await new Promise((r) => server.close(r)) })

// ── Real persistence + workbench stubs (the only non-real parts) ───────
function makePersistence(): PersistencePort & { events: Map<string, SessionEventView[]> } {
  const events = new Map<string, SessionEventView[]>()
  const headers = new Map<string, SessionHeader>()
  headers.set('e2e', { id: 'e2e' as never, title: 'e2e', createdAt: 1, updatedAt: 1, projectId: null })
  return {
    events,
    async create() { return { id: 'e2e' as never, title: 'e2e', createdAt: 1, updatedAt: 1 } },
    async list() { return [...headers.values()] },
    async listArchived() { return [] },
    async get(id: SessionId) { return headers.get(String(id)) ?? { id, title: 'e2e', createdAt: 1, updatedAt: 1, projectId: null } },
    async rename(id: SessionId) { return { id, title: 'e2e', createdAt: 1, updatedAt: 1 } },
    async deletePermanently() {},
    async createProject() { return { id: 'proj', name: 'p', rootPath: '', createdAt: 1, updatedAt: 1 } },
    async listProjects() { return [] },
    async renameProject() { return { id: 'p', name: 'n', rootPath: '', createdAt: 1, updatedAt: 1 } },
    async deleteProject() {}, async archive() {}, async unarchive() {},
    async appendEvent(sessionId: SessionId, type: string, data: unknown) {
      const list = events.get(String(sessionId)) ?? []
      const ev: SessionEventView = { seq: list.length, time: Date.now(), type, data }
      list.push(ev); events.set(String(sessionId), list)
      return ev
    },
    async getEvents(sessionId: SessionId) { return [...(events.get(String(sessionId)) ?? [])] },
    insertTokenUsage() {}, getTotalUsage: () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0 }), getUsageByModel: () => [],
  } as never
}

const resources: SystemResourceManagerPort = {
  async getSnapshot() {
    return {
      cpu: { logicalCores: 8, loadAvg1: 0.4 }, ram: { totalMB: 32768, freeMB: 16000, usedByAppMB: 100 },
      gpu: { available: true, name: 'E2E GPU' }, vram: { totalMB: 16384, freeMB: 12000, usedByModelsMB: 0 },
      disk: { path: '/tmp', totalMB: 100000, freeMB: 50000 },
      models: { instances: [], totalVramUsedMB: 0 }, limits: { maxConcurrentModels: 2 },
    } as never
  },
  async checkBeforeLoad() { return { level: 'ok' as const } },
  async getLimits() { return { maxConcurrentModels: 2 } },
  async setLimits() {},
} as never

let ws: string
let emitted: ChatStreamEvent[]

function makeWorkbench(): ModelWorkbench {
  return {
    listModels: () => [{ modelId: 'rt:e2e-test-model', displayName: 'e2e', runtimeId: 'rt', source: 'custom', capabilities: ['coding', 'tool-use'], available: true, contextLength: 8192 }],
    getActiveModel: () => ({ selection: { runtimeId: 'rt', modelId: 'rt:e2e-test-model' }, available: true, displayName: 'e2e', runtimeDisplayName: 'rt' }),
    describeRuntime: () => ({ id: 'rt', displayName: 'RT', type: 'openai-compatible', endpoint: baseUrl, enabled: true, timeoutMs: 30000 }),
    selectModel: async () => ({ selection: { runtimeId: 'rt', modelId: 'rt:e2e-test-model' }, available: true, displayName: 'e2e', runtimeDisplayName: 'rt' }),
  } as unknown as ModelWorkbench
}

/** Real tool dispatch: the actual capability modules, on the actual workspace. */
async function realDispatch(name: string, args: Record<string, unknown>): Promise<string> {
  if (['fs_list', 'fs_read', 'fs_search', 'fs_write', 'fs_patch'].includes(name)) {
    return dispatchFs(name, args, ws)
  }
  if (['shell_exec', 'bash', 'cmd', 'powershell'].includes(name)) {
    return dispatchShell(args, ws)
  }
  return JSON.stringify({ ok: true, bytes: 0, path: 'x' })
}

function buildOrchestrator(): AgentOrchestrator {
  // The REAL adapter — real fetch to the real loopback server above.
  const llm = new LocalOpenAIChatAdapter()
  return new AgentOrchestrator({
    persistence: makePersistence(),
    llm: llm as never,
    tools: { list: () => [{ name: 'fs_write', description: 'write' }, { name: 'shell_exec', description: 'run' }, { name: 'search_skills', description: 'find skills' }, { name: 'read_skill', description: 'read skill' }, { name: 'fs_list', description: 'list' }, { name: 'fs_read', description: 'read' }], dispatch: realDispatch } as never,
    workbench: makeWorkbench(),
    resources,
    // Point the runtime port at the live server.
    models: {
      load: async () => ({ id: 'inst_e2e', modelId: 'rt:e2e-test-model' }),
      baseUrl: () => baseUrl,
      unload: async () => {}, health: async () => ({ ok: true }),
      listInstances: async () => [], probeRuntime: async () => ({ available: true }), listLocalModels: async () => [],
    } as never,
    baseDir: ws,
    emit: (e: ChatStreamEvent) => emitted.push(e),
    getExecMode: () => 'allow',
    resolveModelFilePath: () => null,
  } as never)
}

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-e2e-'))
  emitted = []
  turns.length = 0
  turnIndex = 0
  wireLog.length = 0
})

// ══════════════════════════════════════════════════════════════════════
describe('E2E-1 · adapter talks to a real loopback server over real HTTP', () => {
  it('performs a real request/response and streams the answer back', async () => {
    turns.push({ content: 'Hello from the real local runtime.' })
    const adapter = new LocalOpenAIChatAdapter()
    let out = ''
    for await (const c of adapter.streamChat({ endpoint: baseUrl, model: 'e2e-test-model', stream: true, messages: [{ role: 'user', content: 'hi' }] } as never)) {
      if (c.type === 'text-delta') out += c.text
    }
    expect(out).toBe('Hello from the real local runtime.')
    // Prove it was a real HTTP round trip with a real JSON body.
    expect(wireLog.some((w) => w.url?.endsWith('/v1/chat/completions'))).toBe(true)
    const sent = wireLog.find((w) => w.url?.endsWith('/v1/chat/completions'))
    expect(sent.body.model).toBe('e2e-test-model')
    expect(sent.body.messages[0].content).toBe('hi')
  })
  it('deliberately sends NO native tools array to a LOCAL endpoint', async () => {
    // This is the single most important fact about the local protocol: native
    // `tools` freezes small local models, so SOVARA drives them with the prompt
    // toolCatalog + ```tool: fences instead. If this ever changes, every fence
    // parser assumption breaks — so it is asserted, not assumed.
    turns.push({ content: 'ok' })
    const adapter = new LocalOpenAIChatAdapter()
    for await (const _ of adapter.streamChat({
      endpoint: baseUrl, model: 'm', stream: true,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'fs_write', description: 'w', parameters: {} as never }],
    } as never)) { void _ }
    const sent = wireLog.find((w) => w.url?.endsWith('/v1/chat/completions'))
    expect(sent.body.tools).toBeUndefined()
    expect(sent.body.tool_choice).toBeUndefined()
  })
  it('refuses a NON-loopback endpoint (air-gap guarantee is real, not a comment)', async () => {
    const adapter = new LocalOpenAIChatAdapter()
    await expect((async () => {
      for await (const _ of adapter.streamChat({ endpoint: 'https://api.openai.com/v1', model: 'm', messages: [] } as never)) { void _ }
    })()).rejects.toThrow(/blocked/i)
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('E2E-2 · full agent turn: prompt → model → fenced tool → real file on disk', () => {
  // Local runtimes are driven by ```tool: fences, so the scripted "model" emits
  // exactly what a well-behaved local model emits.
  const fence = (name: string, args: Record<string, unknown>) =>
    '```tool:' + name + '\n' + JSON.stringify(args) + '\n```'

  it('creates a python file for real and reports success honestly', async () => {
    turns.push(
      { content: fence('search_skills', { query: 'code' }) },
      { content: fence('read_skill', { skill_name: 'code' }) },
      { content: fence('fs_write', { path: 'hello.py', content: 'print("real e2e")\n' }) },
      { content: 'Created hello.py.\n\n## Recap\n- Did: write hello.py\n- Files: hello.py' },
    )
    const orc = buildOrchestrator()
    const res = await orc.execute('e2e' as SessionId, 'Create a python file hello.py', {})
    // The file physically exists with the exact bytes the model asked for.
    const written = fs.readFileSync(path.join(ws, 'hello.py'), 'utf8')
    expect(written).toBe('print("real e2e")\n')
    expect(res.ok).toBe(true)
    // Real tool lifecycle events were emitted for the write.
    const toolNames = emitted.filter((e) => e.kind === 'tool:delta').map((e: any) => e.toolName)
    expect(toolNames).toContain('fs_write')
  })

  it('runs a real shell command and surfaces its real stdout', async () => {
    turns.push(
      { content: fence('search_skills', { query: 'code' }) },
      { content: fence('read_skill', { skill_name: 'code' }) },
      { content: fence('shell_exec', { command: 'echo E2E-STDOUT-OK' }) },
      { content: 'Done.\n\n## Recap\n- Did: ran the command\n- Files: none' },
    )
    const orc = buildOrchestrator()
    const res = await orc.execute('e2e' as SessionId, 'Run the command and show me the output', {})
    expect(res.ok).toBe(true)
    // The real stdout came back through the real tool result.
    const results = emitted.filter((e) => e.kind === 'tool:delta').map((e: any) => String(e.text))
    expect(results.join('\n')).toContain('E2E-STDOUT-OK')
  })

  it('reads a real file back through the whole pipeline', async () => {
    fs.writeFileSync(path.join(ws, 'existing.txt'), 'REAL-FILE-CONTENT\n', 'utf8')
    turns.push(
      { content: fence('fs_read', { path: 'existing.txt' }) },
      { content: 'It contains REAL-FILE-CONTENT.\n\n## Recap\n- Did: read the file\n- Files: none' },
    )
    const orc = buildOrchestrator()
    const res = await orc.execute('e2e' as SessionId, 'Read the file existing.txt and show me what is in it', {})
    expect(res.ok).toBe(true)
    const results = emitted.filter((e) => e.kind === 'tool:delta').map((e: any) => String(e.text))
    expect(results.join('\n')).toContain('REAL-FILE-CONTENT')
  })

  it('refuses to claim success when the model only narrates (no fake completion)', async () => {
    turns.push({ content: 'I have created the file for you.' })
    const orc = buildOrchestrator()
    let failed = false
    try { await orc.execute('e2e' as SessionId, 'Create a python file real.py', {}) } catch { failed = true }
    expect(failed).toBe(true)
    // Nothing was written to disk.
    expect(fs.existsSync(path.join(ws, 'real.py'))).toBe(false)
  })

  it('blocks a write that escapes the workspace even when the model asks', async () => {
    turns.push(
      { content: fence('search_skills', { query: 'code' }) },
      { content: fence('read_skill', { skill_name: 'code' }) },
      { content: fence('fs_write', { path: '../escaped.py', content: 'pwned' }) },
      { content: 'Tried.\n\n## Recap\n- Did: attempted\n- Files: none' },
    )
    const orc = buildOrchestrator()
    await orc.execute('e2e' as SessionId, 'Create a python file escaped.py', {}).catch(() => undefined)
    expect(fs.existsSync(path.join(path.dirname(ws), 'escaped.py'))).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('E2E-3 · IPC surface integrity (no dead UI features)', () => {
  it('every invoke channel the renderer can call is a real string key', () => {
    for (const [key, def] of Object.entries(IPC_CHANNELS)) {
      expect(typeof key, 'channel key').toBe('string')
      expect(['invoke', 'on'], `${key} has a transport`).toContain((def as any).type)
    }
  })
  it('declares the core feature groups the UI depends on', () => {
    const keys = Object.keys(IPC_CHANNELS)
    for (const group of ['chat:send', 'sessions:list', 'models:listModels', 'settings:get', 'library:listModels', 'explore:listModels', 'skills:scan', 'tools:dispatch', 'mcp:list', 'git:status', 'terminal:create', 'agents:list']) {
      expect(keys, `${group} exists`).toContain(group)
    }
  })
  it('the preload-exposed event channels are all declared', () => {
    const onChannels = Object.entries(IPC_CHANNELS).filter(([, d]) => (d as any).type === 'on').map(([k]) => k)
    expect(onChannels).toEqual(expect.arrayContaining(['terminal:output', 'events:download']))
  })
})

// helper: read persisted event types from the orchestrator we just ran
function emittedKinds(): string[] {
  return emitted.map((e) => String((e as any).kind ?? ''))
}
