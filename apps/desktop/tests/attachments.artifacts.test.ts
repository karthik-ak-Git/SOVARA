import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { extractPdfText } from '../src/main/backend/pdfText'
import { extractDocxText, extractXlsxText, unzipMember, toMarkdownTable } from '../src/main/backend/officeText'
import { getImageDimensions } from '../src/main/backend/imageMeta'
import { createZip, crc32 } from '../src/main/backend/minizip'
import {
  detectOutputFormat,
  extractCodeBlock,
  markdownToSheets,
  markdownToParagraphs,
  writePdfFile,
  writeXlsxFile,
  writeDocxFile,
  generateArtifactFile,
  sanitizeFileName,
} from '../src/main/backend/artifacts'
import {
  processAttachments,
  buildAttachmentContext,
  sanitizeAttachmentName,
} from '../src/main/backend/attachments'
import { classifyTask } from '../src/main/backend/TaskClassifier'
import { routeModel } from '../src/main/backend/ModelRouter'
import { AgentOrchestrator } from '../src/main/backend/AgentOrchestrator'
import type { PersistencePort, SessionEventView, SessionHeader, SystemResourceManagerPort, LlmChunk } from '../src/shared/types/ports'
import type { SessionId } from '../src/shared/types/branded'
import type { ModelWorkbench } from '../src/main/backend/ModelWorkbench'
import type { ChatStreamEvent } from '../src/shared/types/chat'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-attach-'))
}

function dataUrl(mime: string, buf: Buffer): string {
  return `data:${mime};base64,${buf.toString('base64')}`
}

// ── PDF extraction ──────────────────────────────────────────────

function minimalPdf(innerStream: Buffer, flate: boolean): Buffer {
  const dict = flate ? `<< /Length ${innerStream.length} /Filter /FlateDecode >>` : `<< /Length ${innerStream.length} >>`
  const head = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >> endobj\n4 0 obj ${dict} stream\n`
  const tail = `\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF`
  return Buffer.concat([Buffer.from(head, 'latin1'), innerStream, Buffer.from(tail, 'latin1')])
}

describe('extractPdfText', () => {
  it('extracts Tj text from an unfiltered content stream', () => {
    const pdf = minimalPdf(Buffer.from('BT /F1 12 Tf 72 720 Td (Hello World) Tj ET', 'latin1'), false)
    const r = extractPdfText(pdf)
    expect(r.text).toContain('Hello World')
    expect(r.pages).toBe(1)
    expect(r.truncated).toBe(false)
  })
  it('inflates FlateDecode streams and reads TJ arrays + hex strings', () => {
    const content = Buffer.from('BT (Hello) Tj [<48656c6c6f> 120 (World)] TJ ET', 'latin1')
    const pdf = minimalPdf(deflateSync(content), true)
    const r = extractPdfText(pdf)
    expect(r.text).toContain('Hello')
    expect(r.text).toContain('World')
  })
  it('returns empty text (honest) for image-only content', () => {
    const pdf = minimalPdf(Buffer.from('q 100 0 0 100 0 0 cm /Im1 Do Q', 'latin1'), false)
    const r = extractPdfText(pdf)
    expect(r.text).toBe('')
  })
})

// ── Office extraction ───────────────────────────────────────────

function minimalDocxXml(paras: string[]): string {
  const body = paras.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')
  return `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
}

describe('office extractors', () => {
  it('extractDocxText reads paragraphs from a docx package', () => {
    const buf = createZip([{ name: 'word/document.xml', data: minimalDocxXml(['First line', 'Second & <third>']) }])
    const r = extractDocxText(buf)
    expect(r.text).toContain('First line')
    expect(r.text).toContain('Second & <third>')
  })
  it('unzipMember round-trips stored + deflated entries', () => {
    const big = 'x'.repeat(5000)
    const buf = createZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'b.txt', data: big },
    ])
    expect(unzipMember(buf, 'a.txt')?.toString('utf8')).toBe('hello')
    expect(unzipMember(buf, 'b.txt')?.toString('utf8')).toBe(big)
    expect(unzipMember(buf, 'missing.txt')).toBeNull()
  })
  it('xlsx write → extract round-trips a table', () => {
    const dir = mkTmp()
    const file = path.join(dir, 't.xlsx')
    writeXlsxFile(file, [{ name: 'Sheet1', rows: [['Name', 'Age'], ['Ada', '36']] }])
    const back = extractXlsxText(fs.readFileSync(file))
    expect(back.text).toContain('Ada')
    expect(back.text).toContain('Name')
    expect(back.sheets.length).toBeGreaterThan(0)
  })
  it('toMarkdownTable renders header + separator', () => {
    const md = toMarkdownTable([['a', 'b'], ['1', '2']])
    expect(md).toContain('| a | b |')
    expect(md).toContain('---')
  })
})

// ── Images ──────────────────────────────────────────────────────

function minimalPng(w: number, h: number): Buffer {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'ascii')
  buf.writeUInt32BE(w, 16)
  buf.writeUInt32BE(h, 20)
  return buf
}

describe('getImageDimensions', () => {
  it('reads PNG IHDR', () => {
    expect(getImageDimensions(minimalPng(800, 600), 'image/png')).toEqual({ width: 800, height: 600 })
  })
  it('reads GIF header', () => {
    const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0x10, 0x00, 0x20, 0x00])])
    expect(getImageDimensions(gif, 'image/gif')).toEqual({ width: 16, height: 32 })
  })
  it('returns null for garbage', () => {
    expect(getImageDimensions(Buffer.from('not an image'), 'image/png')).toBeNull()
  })
})

// ── Output format detection ─────────────────────────────────────

describe('detectOutputFormat', () => {
  it('detects explicit filenames', () => {
    expect(detectOutputFormat('save this as report.pdf please')?.kind).toBe('pdf')
    expect(detectOutputFormat('save this as data.xlsx please')?.kind).toBe('xlsx')
    expect(detectOutputFormat('write the code to app.py')?.kind).toBe('code')
  })
  it('detects generate/export verbs', () => {
    expect(detectOutputFormat('generate a pdf report of the results')?.kind).toBe('pdf')
    expect(detectOutputFormat('export this as an excel sheet')?.kind).toBe('xlsx')
    expect(detectOutputFormat('create a word document from this')?.kind).toBe('docx')
  })
  it('stays chat when no file is requested', () => {
    expect(detectOutputFormat('what is this about?')).toBeNull()
    expect(detectOutputFormat('write code to sort a list')).toBeNull()
    expect(detectOutputFormat('explain the pdf format')).toBeNull()
  })
  it('extractCodeBlock prefers the requested language', () => {
    const text = '```js\nconst a = 1\n```\n```py\nx = 1\n```'
    expect(extractCodeBlock(text, 'py')?.code).toContain('x = 1')
    expect(extractCodeBlock(text)?.lang).toBe('js')
    expect(extractCodeBlock('no fences')).toBeNull()
  })
  it('markdownToSheets falls back to raw lines', () => {
    const sheets = markdownToSheets('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(sheets[0]?.rows.length).toBe(2)
    const fallback = markdownToSheets('just some prose')
    expect(fallback[0]?.name).toBe('Content')
  })
  it('markdownToParagraphs strips fences', () => {
    const paras = markdownToParagraphs('# Title\n```js\ncode\n```\nBody text')
    expect(paras.join(' ')).toContain('Title')
    expect(paras.join(' ')).toContain('Body text')
    expect(paras.join(' ')).not.toContain('```')
  })
  it('sanitizeFileName strips traversal', () => {
    expect(sanitizeFileName('../../etc/passwd', 'f')).not.toContain('..')
    expect(sanitizeFileName('', 'fallback.txt')).toBe('fallback.txt')
  })
})

// ── File writers ────────────────────────────────────────────────

describe('artifact writers', () => {
  it('writePdfFile produces a %PDF document', () => {
    const dir = mkTmp()
    const file = path.join(dir, 'out.pdf')
    writePdfFile(file, 'Title', 'Hello PDF body text.')
    const head = fs.readFileSync(file).toString('latin1').slice(0, 5)
    expect(head).toBe('%PDF-')
  })
  it('writeDocxFile round-trips through the docx extractor', () => {
    const dir = mkTmp()
    const file = path.join(dir, 'out.docx')
    writeDocxFile(file, 'Doc Title', ['First para', 'Second para'])
    const back = extractDocxText(fs.readFileSync(file))
    expect(back.text).toContain('Doc Title')
    expect(back.text).toContain('First para')
  })
  it('generateArtifactFile writes code from a fence', () => {
    const dir = mkTmp()
    const file = path.join(dir, 'app.py')
    const made = generateArtifactFile('code', file, 'here:\n```py\nprint("hi")\n```', 'write app.py')
    expect(made).not.toBeNull()
    expect(fs.readFileSync(file, 'utf8')).toContain('print("hi")')
  })
  it('crc32 matches the well-known check value', () => {
    expect(crc32(Buffer.from('123456789', 'ascii'))).toBe(0xcbf43926)
  })
})

// ── Attachment intake ───────────────────────────────────────────

describe('processAttachments', () => {
  it('extracts text files and images with metadata', () => {
    const txt = dataUrl('text/plain', Buffer.from('hello attachment world', 'utf8'))
    const img = dataUrl('image/png', minimalPng(64, 32))
    const r = processAttachments(
      [
        { name: 'note.txt', mime: 'text/plain', size: 22, data: txt },
        { name: 'shot.png', mime: 'image/png', size: 100, data: img },
      ],
      { sessionId: 'sess-1', baseDir: mkTmp(), persist: false }
    )
    expect(r.files.length).toBe(2)
    expect(r.files[0]?.text).toContain('hello attachment world')
    expect(r.files[1]?.kind).toBe('image')
    expect(r.files[1]?.imageWidth).toBe(64)
    expect(r.files[1]?.imageHeight).toBe(32)
    expect(r.files[1]?.imageBase64).not.toBeNull()
    expect(r.hasImage).toBe(true)
    expect(r.manifestLine).toContain('📎 Attachments (2)')
  })
  it('flags unreadable types honestly', () => {
    const r = processAttachments(
      [{ name: 'blob.bin', mime: 'application/octet-stream', size: 4, data: dataUrl('application/octet-stream', Buffer.from([1, 2, 3, 4])) }],
      { sessionId: 'sess-1', baseDir: mkTmp(), persist: false }
    )
    expect(r.files[0]?.text).toBe('')
    expect(r.files[0]?.note).not.toBeNull()
  })
  it('sanitizeAttachmentName strips traversal', () => {
    expect(sanitizeAttachmentName('../../x.txt')).toBe('x.txt')
  })
  it('buildAttachmentContext is explicit about missing vision', () => {
    const ctx = buildAttachmentContext(
      [{ name: 'a.png', mime: 'image/png', size: 10, kind: 'image', storedPath: null, text: '', truncated: false, note: null, imageBase64: 'xx', imageWidth: 10, imageHeight: 10 }],
      false
    )
    expect(ctx[0]).toContain('no vision support')
  })
})

// ── Classifier + router: vision-aware auto-pick ─────────────────

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

describe('vision-aware routing', () => {
  it('classifier flags image attachments with requiresVision', () => {
    const c = classifyTask('what is in this photo?', { hasImage: true, attachmentChars: 100 })
    expect(c.requiresVision).toBe(true)
    expect(c.requiredCapabilities).toContain('vision')
  })
  it('classifier leaves text tasks untouched', () => {
    const c = classifyTask('hello there')
    expect(c.requiresVision).toBeFalsy()
    expect(c.requiredCapabilities).not.toContain('vision')
  })
  it('router prefers the vision-capable model when requiresVision', async () => {
    const models = [
      { modelId: 'rt:llama-strong', displayName: 'Llama', runtimeId: 'rt', source: 'custom' as const, capabilities: ['chat', 'reasoning', 'analysis'], available: true, contextLength: 8192 },
      { modelId: 'rt:qwen-vl', displayName: 'Qwen VL', runtimeId: 'rt', source: 'custom' as const, capabilities: ['chat', 'vision'], available: true, contextLength: 8192 },
    ]
    const task = classifyTask('describe this image', { hasImage: true })
    const r = await routeModel({ task, models, active: null, resources: await okResources.getSnapshot() })
    expect(r.modelId).toBe('rt:qwen-vl')
    expect(r.switched).toBe(true)
  })
})

// ── Orchestrator end-to-end with attachments + artifacts ────────

function makePersistence(): PersistencePort & { events: Map<string, SessionEventView[]> } {
  const events = new Map<string, SessionEventView[]>()
  const headers = new Map<string, SessionHeader>()
  headers.set('sess-1', { id: 'sess-1' as never, title: 't', createdAt: 1, updatedAt: 1, projectId: null })
  return {
    events,
    async create(title?: string): Promise<SessionHeader> {
      const id = 'sess-x' as never
      return { id, title: title ?? 't', createdAt: 1, updatedAt: 1 }
    },
    async list(): Promise<SessionHeader[]> { return [...headers.values()] },
    async listArchived(): Promise<SessionHeader[]> { return [] },
    async get(id: SessionId): Promise<SessionHeader | null> { return headers.get(String(id)) ?? null },
    async rename(id: SessionId): Promise<SessionHeader> { return { id, title: 't', createdAt: 1, updatedAt: 1 } },
    async deletePermanently(): Promise<void> {},
    async createProject(name: string, rootPath: string) { return { id: 'proj-1', name, rootPath, createdAt: 1, updatedAt: 1 } },
    async listProjects() { return [] },
    async renameProject(id: string, name: string) { return { id, name, rootPath: '', createdAt: 1, updatedAt: 1 } },
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

function scriptLlm(script: string[]) {
  return {
    async *stream(): AsyncIterable<LlmChunk> { throw new Error('unused') },
    async *streamChat(): AsyncIterable<LlmChunk> {
      for (const text of script) yield { type: 'text-delta' as const, text }
      yield { type: 'done' as const }
    },
  }
}

function makeWorkbench(): ModelWorkbench {
  const active = { runtimeId: 'local', modelId: 'local:qwen-test' }
  return {
    listModels: () => [{ modelId: 'local:qwen-test', displayName: 'Qwen', runtimeId: 'local', source: 'custom' as const, capabilities: ['chat', 'coding'], available: true, contextLength: 8192 }],
    getActiveModel: () => ({ selection: { ...active }, available: true, displayName: 'Qwen', runtimeDisplayName: 'local' }),
    describeRuntime: () => ({ id: 'local', displayName: 'Local', type: 'llama.cpp', endpoint: 'local', enabled: true, timeoutMs: 8000 }),
    selectModel: async (runtimeId: string, modelId: string) => {
      active.runtimeId = runtimeId
      active.modelId = modelId
      return { selection: { ...active }, available: true, displayName: 'Qwen', runtimeDisplayName: 'local' }
    },
  } as unknown as ModelWorkbench
}

function makeOrchestrator(deps?: { llmScript?: string[]; baseDir?: string }): {
  orch: AgentOrchestrator
  persistence: PersistencePort & { events: Map<string, SessionEventView[]> }
  emitted: ChatStreamEvent[]
} {
  const persistence = makePersistence()
  const emitted: ChatStreamEvent[] = []
  const baseDir = deps?.baseDir ?? mkTmp()
  const orch = new AgentOrchestrator({
    persistence,
    llm: scriptLlm(deps?.llmScript ?? ['answer text']),
    tools: { list: () => [], dispatch: async () => '{}' },
    workbench: makeWorkbench(),
    resources: okResources,
    models: {
      listLocalModels: async () => [],
      load: async () => { throw new Error('unused') },
      unload: async () => {},
      health: async () => ({ ok: true }),
      baseUrl: () => 'http://127.0.0.1:9',
      listInstances: async () => [],
      probeRuntime: async () => ({ available: true }),
      ensureHealthy: async () => ({ id: 'inst-1', modelId: 'local:qwen-test' }),
    } as never,
    baseDir,
    emit: (e) => { emitted.push(e) },
  })
  return { orch, persistence, emitted }
}

describe('orchestrator attachments + artifacts', () => {
  it('reads attachments, emits reading/prompting stages, persists manifest', async () => {
    const { orch, persistence, emitted } = makeOrchestrator()
    const txt = dataUrl('text/plain', Buffer.from('file body here', 'utf8'))
    const res = await orch.execute('sess-1' as never, 'summarize this', {
      attachments: [{ name: 'note.txt', mime: 'text/plain', size: 15, data: txt }],
    })
    expect(res.ok).toBe(true)
    const kinds = emitted.map((e) => e.kind)
    expect(kinds).toContain('task:reading')
    expect(kinds).toContain('task:prompting')
    const evts = await persistence.getEvents('sess-1' as never)
    const user = evts.find((e) => e.type === 'user/message')
    expect(String((user?.data as { content?: string })?.content ?? '')).toContain('📎 Attachments (1)')
    expect(evts.some((e) => e.type === 'attachment/added')).toBe(true)
  })
  it('generates a PDF artifact on explicit request and emits artifact stages', async () => {
    const baseDir = mkTmp()
    const { orch, persistence, emitted } = makeOrchestrator({ llmScript: ['Quarterly results are up.'], baseDir })
    await orch.execute('sess-1' as never, 'generate a pdf report of the results')
    const kinds = emitted.map((e) => e.kind)
    expect(kinds).toContain('artifact:writing')
    expect(kinds).toContain('artifact:ready')
    const evts = await persistence.getEvents('sess-1' as never)
    const created = evts.find((e) => e.type === 'artifact/created')
    expect(created).toBeTruthy()
    const filePath = (created?.data as { path?: string })?.path ?? ''
    expect(fs.existsSync(filePath)).toBe(true)
    const assistant = [...evts].reverse().find((e) => e.type === 'assistant/message')
    expect(String((assistant?.data as { content?: string })?.content ?? '')).toContain('Generated file:')
  })
  it('emits task:thinking when reasoning is required', async () => {
    const { emitted } = (await (async () => {
      // Reasoning mode routes untagged deltas to thinking — the script must
      // close its <thinking> block so a final answer streams afterwards.
      const ctx = makeOrchestrator({ llmScript: ['<thinking>considering</thinking>final answer'] })
      await ctx.orch.execute('sess-1' as never, 'solve this step by step puzzle carefully now', { reasoning: true })
      return ctx
    })())
    expect(emitted.map((e) => e.kind)).toContain('task:thinking')
  })
})
