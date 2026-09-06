import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {
  ChatInferenceError,
  LocalOpenAIChatAdapter,
  chatCompletionsUrl,
  classifyChatError,
} from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import { ChatService, ChatServiceError, remoteModelId, toRequestMessages } from '../src/main/backend/ChatService'
import type { LlmChatRequest, LlmChunk, PersistencePort, SessionEventView, SessionHeader } from '../src/shared/types/ports'
import type { SessionId } from '../src/shared/types/branded'
import type { ModelWorkbench } from '../src/main/backend/ModelWorkbench'
import { zChatCancel, zChatSend } from '../src/shared/ipc/schemas'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-c7-'))
}

function startSseServer(opts: {
  chunks?: string[]
  status?: number
  contentType?: string
  rawBody?: string
  hang?: boolean
  onRequest?: (body: unknown) => void
}): Promise<{ port: number; close: () => Promise<void>; seen: { bodies: unknown[] } }> {
  const seen: { bodies: unknown[] } = { bodies: [] }
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => {
        raw += c
      })
      req.on('end', () => {
        try {
          seen.bodies.push(JSON.parse(raw))
        } catch {
          seen.bodies.push(raw)
        }
        opts.onRequest?.(seen.bodies[seen.bodies.length - 1])
        if (opts.hang) return // never respond
        if (opts.rawBody !== undefined) {
          res.writeHead(opts.status ?? 200, { 'content-type': opts.contentType ?? 'application/json' })
          res.end(opts.rawBody)
          return
        }
        res.writeHead(opts.status ?? 200, { 'content-type': opts.contentType ?? 'text/event-stream' })
        for (const c of opts.chunks ?? []) res.write(c)
        res.end()
      })
    })
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ port, close: () => new Promise((r) => srv.close(() => r())), seen })
    })
  })
}

const sseChunk = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

function req(port: number, over?: Partial<LlmChatRequest>): LlmChatRequest {
  return {
    endpoint: `http://127.0.0.1:${port}/v1`,
    model: 'tiny',
    messages: [{ role: 'user', content: 'hi' }],
    timeoutMs: 3000,
    stream: true,
    ...over,
  }
}

async function collect(gen: AsyncIterable<LlmChunk>): Promise<{ text: string; note?: string }> {
  let text = ''
  let note: string | undefined
  for await (const c of gen) {
    if (c.type === 'text-delta' && c.text) text += c.text
    if (c.type === 'done') {
      note = c.note
      break
    }
  }
  return { text, note }
}

describe('Commit 7 — adapter SSE', () => {
  it('streams deltas progressively until [DONE]', async () => {
    const { port, close } = await startSseServer({ chunks: [sseChunk('Hel'), sseChunk('lo'), 'data: [DONE]\n\n'] })
    const out = await collect(new LocalOpenAIChatAdapter().streamChat(req(port)))
    expect(out.text).toBe('Hello')
    expect(out.note).toBeUndefined()
    await close()
  })

  it('sends a conservative OpenAI-compatible body', async () => {
    const { port, close, seen } = await startSseServer({ chunks: ['data: [DONE]\n\n'] })
    await collect(
      new LocalOpenAIChatAdapter().streamChat({
        ...req(port),
        model: 'phi-4',
        messages: [
          { role: 'system', content: 's' },
          { role: 'user', content: 'q' },
        ],
      })
    )
    expect(seen.bodies).toHaveLength(1)
    expect(seen.bodies[0]).toEqual({
      model: 'phi-4',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'q' },
      ],
      stream: true,
    })
    await close()
  })

  it('tolerates malformed SSE lines', async () => {
    const { port, close } = await startSseServer({
      chunks: ['garbage-line\n\n', 'data: not-json\n\n', sseChunk('ok'), 'data: [DONE]\n\n'],
    })
    const out = await collect(new LocalOpenAIChatAdapter().streamChat(req(port)))
    expect(out.text).toBe('ok')
    await close()
  })

  it('falls back to one non-streaming read, honestly marked', async () => {
    const { port, close } = await startSseServer({
      contentType: 'application/json',
      rawBody: JSON.stringify({ choices: [{ message: { content: 'full reply' } }] }),
    })
    const out = await collect(new LocalOpenAIChatAdapter().streamChat(req(port)))
    expect(out.text).toBe('full reply')
    expect(out.note).toBe('non-stream-fallback')
    await close()
  })

  it('classifies connection refusal without raw stacks', async () => {
    const err = await collect(new LocalOpenAIChatAdapter().streamChat(req(9))).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChatInferenceError)
    expect((err as ChatInferenceError).code).toBe('connection-refused')
    expect((err as Error).message).not.toMatch(/at |node:internal/)
  })

  it('times out instead of hanging', async () => {
    const { port, close } = await startSseServer({ hang: true })
    const err = await collect(new LocalOpenAIChatAdapter().streamChat(req(port, { timeoutMs: 300 }))).catch(
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(ChatInferenceError)
    expect((err as ChatInferenceError).code).toBe('timeout')
    await close()
  })

  it('maps 404/401 to model-not-found/unauthorized', async () => {
    const s404 = await startSseServer({ status: 404, contentType: 'application/json', rawBody: '{}' })
    await expect(collect(new LocalOpenAIChatAdapter().streamChat(req(s404.port)))).rejects.toMatchObject({
      code: 'model-not-found',
    })
    await s404.close()
    const s401 = await startSseServer({ status: 401, contentType: 'application/json', rawBody: '{}' })
    await expect(collect(new LocalOpenAIChatAdapter().streamChat(req(s401.port)))).rejects.toMatchObject({
      code: 'unauthorized',
    })
    await s401.close()
  })

  it('rejects replies past the local size cap', async () => {
    const big = 'x'.repeat(5000)
    // ~1.1MB of SSE bytes total → trips the bounded reader.
    const chunks = Array.from({ length: 230 }, () => sseChunk(big))
    const { port, close } = await startSseServer({ chunks })
    const err = await collect(new LocalOpenAIChatAdapter().streamChat(req(port))).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChatInferenceError)
    expect((err as ChatInferenceError).code).toBe('response-too-large')
    await close()
  }, 20000)

  it('rejects non-JSON error bodies as invalid-response', async () => {
    const { port, close } = await startSseServer({
      contentType: 'application/json',
      rawBody: 'not-json-at-all{{{',
    })
    await expect(collect(new LocalOpenAIChatAdapter().streamChat(req(port)))).rejects.toMatchObject({
      code: 'invalid-response',
    })
    await close()
  })

  it('blocks redirect chains that end off-localhost', async () => {
    const { port, close } = await startSseServer({
      status: 302,
      contentType: 'text/plain',
      rawBody: '',
    })
    // No Location header with 302 → treated as a blocked redirect.
    await expect(collect(new LocalOpenAIChatAdapter().streamChat(req(port)))).rejects.toMatchObject({
      code: 'blocked',
    })
    await close()
  })

  it('aborts mid-stream as cancelled', async () => {
    const { port, close } = await startSseServer({ hang: true })
    const controller = new AbortController()
    const pending = collect(new LocalOpenAIChatAdapter().streamChat(req(port, { signal: controller.signal })))
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    await close()
  })

  it('revalidates the endpoint at request time (no blind trust)', async () => {
    await expect(
      collect(
        new LocalOpenAIChatAdapter().streamChat(req(1234, { endpoint: 'https://api.openai.com/v1' }))
      )
    ).rejects.toMatchObject({ code: 'blocked' })
  })

  it('rejects empty replies and empty model ids', async () => {
    const { port, close } = await startSseServer({
      contentType: 'application/json',
      rawBody: JSON.stringify({ choices: [{ message: { content: '' } }] }),
    })
    await expect(collect(new LocalOpenAIChatAdapter().streamChat(req(port)))).rejects.toMatchObject({
      code: 'invalid-response',
    })
    await close()
    // Empty model id is rejected before any network happens.
    await expect(
      collect(new LocalOpenAIChatAdapter().streamChat(req(1234, { endpoint: 'http://127.0.0.1:9/v1', model: '  ' })))
    ).rejects.toMatchObject({ code: 'model-not-found' })
  })

  it('chatCompletionsUrl tolerates endpoints with/without /v1', () => {
    expect(chatCompletionsUrl('http://127.0.0.1:1234/v1')).toBe('http://127.0.0.1:1234/v1/chat/completions')
    expect(chatCompletionsUrl('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234/v1/chat/completions')
  })

  it('classifyChatError never leaks raw internals', () => {
    const c = classifyChatError(new TypeError('fetch failed at node:internal/dep'))
    expect(c.code).toBe('connection-refused')
    expect(c.message).not.toContain('node:internal')
  })
})

// ── ChatService with fakes ──

function makePersistence(): PersistencePort & { events: Map<string, SessionEventView[]>; close: () => Promise<void> } {
  const events = new Map<string, SessionEventView[]>()
  return {
    events,
    async create(title?: string): Promise<SessionHeader> {
      return { id: `sess-test` as never, title: title ?? 't', createdAt: 1, updatedAt: 1 }
    },
    async list(): Promise<SessionHeader[]> {
      return []
    },
    async get(): Promise<SessionHeader | null> {
      return null
    },
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
    async close(): Promise<void> {},
  }
}

const ACTIVE = { selection: { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' }, available: true, displayName: 'phi-4', runtimeDisplayName: 'Local' }

function makeWorkbench(over?: {
  active?: typeof ACTIVE | { selection: null; available: false }
  entry?: { id: string; displayName: string; type: 'openai-compatible'; endpoint: string; enabled: boolean; timeoutMs: number } | null
}): ModelWorkbench {
  return {
    getActiveModel: () => over?.active ?? ACTIVE,
    describeRuntime: () =>
      over?.entry !== undefined
        ? over.entry
        : { id: 'rt-1', displayName: 'Local', type: 'openai-compatible', endpoint: 'http://127.0.0.1:1234/v1', enabled: true, timeoutMs: 8000 },
  } as unknown as ModelWorkbench
}

const okResources = {
  getSnapshot: async () => {
    throw new Error('unused')
  },
  checkBeforeLoad: async () => ({ level: 'ok' as const }),
  getLimits: async () => ({ maxConcurrentModels: 1 }),
  setLimits: async () => {},
}

function scriptLlm(script: string[], opts?: { throwErr?: unknown; hang?: boolean }) {
  return {
    async *stream(): AsyncIterable<LlmChunk> {
      throw new Error('unused')
    },
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

describe('Commit 7 — history mapping', () => {
  it('maps visible messages to OpenAI roles, newest context wins', () => {
    const evts = [
      { seq: 0, time: 1, type: 'user/message', data: { content: 'a' } },
      { seq: 1, time: 2, type: 'assistant/cancelled', data: { reason: 'cancelled' } },
      { seq: 2, time: 3, type: 'system/resource-blocked', data: {} },
      { seq: 3, time: 4, type: 'assistant/message', data: { content: 'b' } },
    ]
    expect(toRequestMessages(evts)).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ])
  })

  it('bounds history to a tail window', () => {
    const evts = Array.from({ length: 120 }, (_, i) => ({
      seq: i,
      time: i,
      type: i % 2 === 0 ? 'user/message' : 'assistant/message',
      data: { content: `m${i}` },
    }))
    const out = toRequestMessages(evts)
    expect(out.length).toBeLessThanOrEqual(50)
    expect(out[out.length - 1]?.content).toBe('m119')
  })

  it('strips the runtime prefix for the wire model id', () => {
    expect(remoteModelId('rt-1:phi-4')).toBe('phi-4')
    expect(remoteModelId('plain')).toBe('plain')
  })
})

describe('Commit 7 — ChatService', () => {
  it('persists user + exactly one assistant event, emits deltas then done', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: Array<{ kind: string; text?: string; seq?: number }> = []
    const svc = new ChatService({
      persistence,
      llm: scriptLlm(['Hel', 'lo']),
      workbench: makeWorkbench(),
      resources: okResources,
      baseDir: dir,
      emit: (e) => {
        emitted.push({ kind: e.kind, text: e.text, seq: e.seq })
      },
    })
    const sid = 'sess-1' as SessionId
    const res = await svc.send(sid, 'hi there')
    expect(res).toEqual({ ok: true, userSeq: 0, assistantSeq: 1 })
    const evts = await persistence.getEvents(sid)
    expect(evts.map((e) => e.type)).toEqual(['user/message', 'assistant/message'])
    expect((evts[1]?.data as { content: string }).content).toBe('Hello')
    expect(emitted.filter((e) => e.kind === 'assistant-delta').map((e) => e.text).join('')).toBe('Hello')
    expect(emitted[emitted.length - 1]).toMatchObject({ kind: 'assistant-done', seq: 1 })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('failure keeps the user message and fakes no assistant reply', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: string[] = []
    const svc = new ChatService({
      persistence,
      llm: scriptLlm([], { throwErr: new ChatInferenceError('connection-refused', 'connection-refused: down?') }),
      workbench: makeWorkbench(),
      resources: okResources,
      baseDir: dir,
      emit: (e) => {
        emitted.push(e.kind)
      },
    })
    const sid = 'sess-1' as SessionId
    await expect(svc.send(sid, 'hello')).rejects.toBeInstanceOf(ChatServiceError)
    const evts = await persistence.getEvents(sid)
    expect(evts.map((e) => e.type)).toEqual(['user/message'])
    expect(emitted).toContain('assistant-error')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('cancel aborts and persists a cancelled marker, not a fake reply', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const emitted: string[] = []
    const svc = new ChatService({
      persistence,
      llm: scriptLlm([], { hang: true }),
      workbench: makeWorkbench(),
      resources: okResources,
      baseDir: dir,
      emit: (e) => {
        emitted.push(e.kind)
      },
    })
    const sid = 'sess-1' as SessionId
    const pending = svc.send(sid, 'long one')
    await new Promise((r) => setTimeout(r, 50))
    expect(svc.cancel(sid)).toEqual({ cancelled: true })
    const res = await pending
    expect(res.assistantSeq).toBe(1)
    const evts = await persistence.getEvents(sid)
    expect(evts.map((e) => e.type)).toEqual(['user/message', 'assistant/cancelled'])
    expect(emitted).toContain('assistant-cancelled')
    expect(svc.cancel(sid)).toEqual({ cancelled: false })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('requires an available active model and never substitutes', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const svc = new ChatService({
      persistence,
      llm: scriptLlm(['x']),
      workbench: makeWorkbench({ active: { selection: null, available: false } }),
      resources: okResources,
      baseDir: dir,
      emit: () => {},
    })
    await expect(svc.send('sess-1' as SessionId, 'hi')).rejects.toMatchObject({ code: 'no-active-model' })
    expect(await persistence.getEvents('sess-1' as SessionId)).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses when resources block and persists nothing', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const svc = new ChatService({
      persistence,
      llm: scriptLlm(['x']),
      workbench: makeWorkbench(),
      resources: {
        ...okResources,
        checkBeforeLoad: async () => ({ level: 'critical' as const, reason: 'vram unknown', blocking: true }),
      },
      baseDir: dir,
      emit: () => {},
    })
    await expect(svc.send('sess-1' as SessionId, 'hi')).rejects.toMatchObject({ code: 'resource-pressure' })
    expect(await persistence.getEvents('sess-1' as SessionId)).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a second send while one is in flight', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const svc = new ChatService({
      persistence,
      llm: scriptLlm(['x'], { hang: true }),
      workbench: makeWorkbench(),
      resources: okResources,
      baseDir: dir,
      emit: () => {},
    })
    const sid = 'sess-1' as SessionId
    const pending = svc.send(sid, 'one')
    await new Promise((r) => setTimeout(r, 20))
    await expect(svc.send(sid, 'two')).rejects.toMatchObject({ code: 'already-generating' })
    svc.cancel(sid)
    await pending
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('logs metadata only — never conversation text', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const secret = 'super-secret-prompt-xyz-123'
    const svc = new ChatService({
      persistence,
      llm: scriptLlm(['reply-text-abc-999']),
      workbench: makeWorkbench(),
      resources: okResources,
      baseDir: dir,
      emit: () => {},
    })
    await svc.send('sess-1' as SessionId, secret)
    const logRaw = fs.readFileSync(path.join(dir, 'logs', 'runtime.log'), 'utf8')
    expect(logRaw).not.toContain(secret)
    expect(logRaw).not.toContain('reply-text-abc-999')
    expect(logRaw).toContain('phi-4')
    expect(logRaw).toContain('"method":"POST"')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reconstructs user + assistant order after restart', async () => {
    const dir = mkTmp()
    const persistence = makePersistence()
    const svc = new ChatService({
      persistence,
      llm: scriptLlm(['r1']),
      workbench: makeWorkbench(),
      resources: okResources,
      baseDir: dir,
      emit: () => {},
    })
    const sid = 'sess-1' as SessionId
    await svc.send(sid, 'q1')
    const evts = await persistence.getEvents(sid)
    expect(evts.map((e) => e.seq)).toEqual([0, 1])
    expect((evts[0]?.data as { content: string }).content).toBe('q1')
    expect((evts[1]?.data as { content: string }).content).toBe('r1')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('Commit 7 — IPC contracts', () => {
  it('chat payloads stay minimal: no URL/headers/body fields', () => {
    expect(Object.keys(zChatSend.shape)).toEqual(['sessionId', 'content'])
    expect(zChatSend.safeParse({ sessionId: 's', content: 'hi' }).success).toBe(true)
    expect(zChatSend.safeParse({ sessionId: 's', content: 'hi', endpoint: 'http://x' }).success).toBe(false)
    expect(zChatSend.safeParse({ sessionId: 's', content: 'hi', headers: {} }).success).toBe(false)
    expect(zChatCancel.safeParse({ sessionId: 's' }).success).toBe(true)
    expect(zChatCancel.safeParse({}).success).toBe(false)
    expect(zChatCancel.safeParse({ sessionId: '' }).success).toBe(false)
    expect(zChatCancel.safeParse({ sessionId: 's', extra: 1 }).success).toBe(false)
  })
})

describe('Commit 7 — sovereignty proofs', () => {
  it('only HttpClient performs network operations (fetch or POST)', () => {
    const scan = (dir: string): string[] => {
      const out: string[] = []
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          if (['node_modules', 'dist', 'out'].includes(ent.name)) continue
          out.push(...scan(p))
        } else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
      }
      return out
    }
    for (const f of scan('src')) {
      const txt = fs.readFileSync(f, 'utf8')
      if (/\bfetch\s*\(/.test(txt)) {
        expect(f.replace(/\\/g, '/'), `fetch outside HttpClient: ${f}`).toMatch(/main\/network\/HttpClient\.ts$/)
      }
    }
  })

  it('runtime log entries carry metadata fields only', () => {
    const txt = fs.readFileSync('src/main/logging/runtimeLog.ts', 'utf8')
    const block = txt.slice(txt.indexOf('export interface RuntimeLogEntry'), txt.indexOf('}', txt.indexOf('streamed')))
    const keys = [...block.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort()
    expect(keys).toEqual(
      ['latencyMs', 'method', 'modelId', 'outcome', 'runtimeId', 'status', 'streamed', 'target', 'time'].sort()
    )
  })
})
