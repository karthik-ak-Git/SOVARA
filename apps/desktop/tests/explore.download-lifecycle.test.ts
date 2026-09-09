import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  startDownload,
  pauseDownload,
  resumeDownload,
  getFileStatus,
  reconcileLibrary,
  resolveModelFolder,
  resolveLibraryDir,
  getActiveDownloads,
  __resetDownloadsForTests,
  type DownloadEvent,
} from '../src/main/services/modelDownloads'
import { RuntimeConfigStore, downloadRowId } from '../src/main/config/RuntimeConfigStore'

const FULL = Buffer.alloc(4096, 7)
const MODEL = 'Qwen/Qwen3-8B-GGUF'
const FILE_Q4 = 'Qwen3-8B-Q4_K_M.gguf'

let baseDir = ''
let libParent = ''
let cfg: RuntimeConfigStore | null = null

function libRoot(): string {
  return resolveLibraryDir(cfg as unknown as never, libParent)
}

function waitFor(cond: () => boolean, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      try {
        if (cond()) { clearInterval(timer); resolve() }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error('timed out waiting for condition')) }
      } catch (e) {
        clearInterval(timer)
        reject(e)
      }
    }, 25)
  })
}

/** Serve FULL; honor Range for resume; first hits stream 1KB then hold a gate.
 *  The stream errors on abort — mirroring undici, where aborting the request
 *  signal tears down the response body so pause/cancel propagate mid-body. */
function stubGatedFetch(): { release: () => void } {
  let release: (() => void) | null = null
  global.fetch = vi.fn(async (_url: unknown, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => {
    const range = init?.headers?.['Range'] as string | undefined
    if (range) {
      const m = range.match(/bytes=(\d+)-/)
      const start = m ? parseInt(m[1], 10) : 0
      const rest = FULL.subarray(start)
      return new Response(rest as unknown as BodyInit, { status: 206, headers: { 'content-length': String(rest.length) } })
    }
    let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c
        c.enqueue(FULL.subarray(0, 1024))
        void new Promise<void>((r) => { release = r }).then(() => {
          try { c.enqueue(FULL.subarray(1024)); c.close() } catch { /* aborted */ }
        })
      },
      cancel() { try { release?.() } catch { /* ignore */ } },
    })
    init?.signal?.addEventListener('abort', () => {
      try { ctrl?.error(new DOMException('Aborted', 'AbortError')) } catch { /* ignore */ }
      try { release?.() } catch { /* ignore */ }
    }, { once: true })
    return new Response(stream, { status: 200, headers: { 'content-length': String(FULL.length) } })
  }) as unknown as typeof fetch
  return { release: () => { release?.() } }
}

function stubFullFetch(): void {
  global.fetch = vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
    const range = init?.headers?.['Range'] as string | undefined
    if (range) {
      const m = range.match(/bytes=(\d+)-/)
      const start = m ? parseInt(m[1], 10) : 0
      const rest = FULL.subarray(start)
      return new Response(rest as unknown as BodyInit, { status: 206, headers: { 'content-length': String(rest.length) } })
    }
    return new Response(FULL as unknown as BodyInit, { status: 200, headers: { 'content-length': String(FULL.length) } })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-life-cfg-'))
  libParent = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-life-lib-'))
  cfg = new RuntimeConfigStore(baseDir)
  __resetDownloadsForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  __resetDownloadsForTests()
  try { cfg?.close() } catch { /* ignore */ }
  cfg = null
  try { fs.rmSync(baseDir, { recursive: true, force: true }) } catch { /* ignore */ }
  try { fs.rmSync(libParent, { recursive: true, force: true }) } catch { /* ignore */ }
})

function dlUrl(model: string, file: string): string {
  return `https://huggingface.co/${model}/resolve/main/${file}`
}

describe('download lifecycle persistence', () => {
  it('Test 1 — fresh download completes, registry installed, status Downloaded', async () => {
    stubFullFetch()
    const events: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), (e) => { events.push(e) }, { revision: 'main', quantization: 'Q4_K_M' })
    await waitFor(() => events.some((e) => e.state === 'done'))
    const done = events.find((e) => e.state === 'done') as DownloadEvent
    // Real byte ratio: done carries the full total, never a fake 100%.
    expect(done.receivedBytes).toBe(FULL.length)
    expect(done.totalBytes).toBe(FULL.length)
    const dest = path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF', FILE_Q4)
    expect(fs.existsSync(dest)).toBe(true)
    expect(fs.existsSync(`${dest}.part`)).toBe(false)
    expect(fs.readFileSync(dest).equals(FULL)).toBe(true)
    const row = (cfg as unknown as RuntimeConfigStore).getDownloadRow(downloadRowId('huggingface', MODEL, 'main', FILE_Q4))
    expect(row?.status).toBe('completed')
    const st = getFileStatus(cfg as unknown as never, libParent, MODEL, FILE_Q4)
    expect(st.state).toBe('downloaded')
    expect(st.source).toBe('registry')
  })

  it('Test 2 — pause keeps .part, registry paused, bytes preserved', async () => {
    const gate = stubGatedFetch()
    const events: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), (e) => { events.push(e) }, { revision: 'main' })
    await waitFor(() => events.some((e) => e.state === 'progress' && e.receivedBytes >= 1024))
    expect(pauseDownload(MODEL, FILE_Q4)).toBe(true)
    await waitFor(() => events.some((e) => e.state === 'paused'))
    const dest = path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF', FILE_Q4)
    // Paused partial stays on disk and is NOT an installed model.
    expect(fs.existsSync(`${dest}.part`)).toBe(true)
    expect(fs.existsSync(dest)).toBe(false)
    expect(fs.statSync(`${dest}.part`).size).toBe(1024)
    const row = (cfg as unknown as RuntimeConfigStore).getDownloadRow(downloadRowId('huggingface', MODEL, 'main', FILE_Q4))
    expect(row?.status).toBe('paused')
    expect(row?.downloadedBytes).toBeGreaterThanOrEqual(1024)
    const st = getFileStatus(cfg as unknown as never, libParent, MODEL, FILE_Q4)
    expect(st.state).toBe('paused')
    expect(st.downloadedBytes).toBe(1024)
    gate.release()
  })

  it('Test 3 — resume uses Range and continues from existing bytes', async () => {
    const gate = stubGatedFetch()
    const events: DownloadEvent[] = []
    const emit = (e: DownloadEvent): void => { events.push(e) }
    await startDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), emit, { revision: 'main' })
    await waitFor(() => events.some((e) => e.state === 'progress' && e.receivedBytes >= 1024))
    expect(pauseDownload(MODEL, FILE_Q4)).toBe(true)
    await waitFor(() => events.some((e) => e.state === 'paused'))
    events.length = 0
    expect(resumeDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), emit, { revision: 'main' })).toBe(true)
    // Resume must report existing bytes immediately — never a fake 0%.
    await waitFor(() => events.some((e) => (e.state === 'started' || e.state === 'progress') && e.receivedBytes >= 1024))
    gate.release()
    await waitFor(() => events.some((e) => e.state === 'done'))
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const rangeCalls = fetchMock.mock.calls.filter((c) => {
      const h = (c[1] as { headers?: Record<string, string> } | undefined)?.headers
      return typeof h?.['Range'] === 'string'
    })
    expect(rangeCalls.length).toBeGreaterThan(0)
    const dest = path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF', FILE_Q4)
    expect(fs.readFileSync(dest).equals(FULL)).toBe(true)
    expect(getFileStatus(cfg as unknown as never, libParent, MODEL, FILE_Q4).state).toBe('downloaded')
  })

  it('Test 4 — restart restores paused state with bytes (no state loss)', async () => {
    stubGatedFetch()
    const events: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), (e) => { events.push(e) }, { revision: 'main' })
    await waitFor(() => events.some((e) => e.state === 'progress' && e.receivedBytes >= 1024))
    expect(pauseDownload(MODEL, FILE_Q4)).toBe(true)
    await waitFor(() => events.some((e) => e.state === 'paused'))
    // Simulate application close + reopen: fresh registry handle, empty memory.
    cfg?.close()
    __resetDownloadsForTests()
    cfg = new RuntimeConfigStore(baseDir)
    const st = getFileStatus(cfg as unknown as never, libParent, MODEL, FILE_Q4)
    expect(st.state).toBe('paused')
    expect(st.downloadedBytes).toBe(1024)
    // Persisted queue is visible without any transfer running.
    const act = getActiveDownloads(cfg as unknown as never, libParent)
    expect(act.some((d) => d.rfilename === FILE_Q4 && d.state === 'paused')).toBe(true)
    // And it resumes to completion after the restart.
    const events2: DownloadEvent[] = []
    expect(resumeDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), (e) => { events2.push(e) }, { revision: 'main' })).toBe(true)
    await waitFor(() => events2.some((e) => e.state === 'done'))
    expect(getFileStatus(cfg as unknown as never, libParent, MODEL, FILE_Q4).state).toBe('downloaded')
  })

  it('Test 5 — exact quantization detection (Q4 done, Q5 untouched)', async () => {
    stubFullFetch()
    const events: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), (e) => { events.push(e) }, { revision: 'main', quantization: 'Q4_K_M' })
    await waitFor(() => events.some((e) => e.state === 'done'))
    expect(getFileStatus(cfg as unknown as never, libParent, MODEL, FILE_Q4).state).toBe('downloaded')
    expect(getFileStatus(cfg as unknown as never, libParent, MODEL, 'Qwen3-8B-Q5_K_M.gguf').state).toBe('missing')
  })

  it('Test 6 — same filename in different repos does not collide', async () => {
    stubFullFetch()
    const shared = 'model-Q4_K_M.gguf'
    const e1: DownloadEvent[] = []
    const e2: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, 'repoA/m', shared, dlUrl('repoA/m', shared), (e) => { e1.push(e) }, { revision: 'main' })
    await startDownload(cfg as unknown as never, libParent, 'repoB/m', shared, dlUrl('repoB/m', shared), (e) => { e2.push(e) }, { revision: 'main' })
    await waitFor(() => e1.some((e) => e.state === 'done') && e2.some((e) => e.state === 'done'))
    const a = path.join(libRoot(), 'repoA__m', shared)
    const b = path.join(libRoot(), 'repoB__m', shared)
    expect(a).not.toBe(b)
    expect(fs.existsSync(a)).toBe(true)
    expect(fs.existsSync(b)).toBe(true)
    expect(getFileStatus(cfg as unknown as never, libParent, 'repoA/m', shared).state).toBe('downloaded')
    expect(getFileStatus(cfg as unknown as never, libParent, 'repoB/m', shared).state).toBe('downloaded')
  })

  it('Test 7 — manual deletion reconciles back to Download', async () => {
    stubFullFetch()
    const events: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), (e) => { events.push(e) }, { revision: 'main' })
    await waitFor(() => events.some((e) => e.state === 'done'))
    const dest = path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF', FILE_Q4)
    fs.unlinkSync(dest)
    const report = reconcileLibrary(cfg as unknown as never, libParent)
    expect(report.missing.length).toBeGreaterThan(0)
    const st = getFileStatus(cfg as unknown as never, libParent, MODEL, FILE_Q4)
    // No longer Downloaded — the UI must offer Download again.
    expect(st.state).not.toBe('downloaded')
  })

  it('Test 8 — shard set with 2/3 parts is Partial, never Downloaded', async () => {
    const parts = [1, 2, 3].map((i) => ({
      rfilename: `model-0000${i}-of-00003.gguf`,
      downloadUrl: dlUrl(MODEL, `model-0000${i}-of-00003.gguf`),
      sizeBytes: 100,
    }))
    ;(cfg as unknown as RuntimeConfigStore).upsertDownloadRow({
      id: downloadRowId('huggingface', MODEL, 'main', parts[0].rfilename),
      provider: 'huggingface', repoId: MODEL, revision: 'main', rfilename: parts[0].rfilename,
      downloadUrl: parts[0].downloadUrl,
      destPath: path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF', parts[0].rfilename),
      tempPath: path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF', `${parts[0].rfilename}.part`),
      totalBytes: 300, downloadedBytes: 200, status: 'paused', kind: 'set',
      parts: JSON.stringify(parts), companion: null, format: 'GGUF', quantization: null,
      license: null, gated: null, error: null, speedBps: null,
    })
    const repoDir = path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF')
    fs.mkdirSync(repoDir, { recursive: true })
    fs.writeFileSync(path.join(repoDir, parts[0].rfilename), Buffer.alloc(100))
    fs.writeFileSync(path.join(repoDir, parts[1].rfilename), Buffer.alloc(100))
    const st = getFileStatus(cfg as unknown as never, libParent, MODEL, parts[0].rfilename)
    expect(st.state).not.toBe('downloaded')
    expect(st.partsPresent).toBe(2)
    expect(st.partsTotal).toBe(3)
    // Completing the set flips it to Downloaded.
    fs.writeFileSync(path.join(repoDir, parts[2].rfilename), Buffer.alloc(100))
    expect(getFileStatus(cfg as unknown as never, libParent, MODEL, parts[0].rfilename).state).toBe('downloaded')
  })

  it('Test 9 — open folder resolves the managed dir and rejects escape', async () => {
    stubFullFetch()
    const events: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), (e) => { events.push(e) }, { revision: 'main' })
    await waitFor(() => events.some((e) => e.state === 'done'))
    const dir = resolveModelFolder(cfg as unknown as never, libParent, MODEL, FILE_Q4)
    expect(dir).toBe(path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF'))
    expect(() => resolveModelFolder(cfg as unknown as never, libParent, MODEL, '../../evil.gguf')).toThrow()
  })

  it('Test 10 — completed model still Downloaded after app restart', async () => {
    stubFullFetch()
    const events: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, MODEL, FILE_Q4, dlUrl(MODEL, FILE_Q4), (e) => { events.push(e) }, { revision: 'main', quantization: 'Q4_K_M' })
    await waitFor(() => events.some((e) => e.state === 'done'))
    cfg?.close()
    __resetDownloadsForTests()
    cfg = new RuntimeConfigStore(baseDir)
    // Q4_K_M still Downloaded with Open-folder path; Q5_K_M still Download.
    const q4 = getFileStatus(cfg as unknown as never, libParent, MODEL, FILE_Q4)
    expect(q4.state).toBe('downloaded')
    expect(q4.destPath).toBe(path.join(libRoot(), 'Qwen__Qwen3-8B-GGUF', FILE_Q4))
    expect(getFileStatus(cfg as unknown as never, libParent, MODEL, 'Qwen3-8B-Q5_K_M.gguf').state).toBe('missing')
  })
})
