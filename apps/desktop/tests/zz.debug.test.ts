import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDownload, __resetDownloadsForTests, type DownloadEvent } from '../src/main/services/modelDownloads'
import { RuntimeConfigStore } from '../src/main/config/RuntimeConfigStore'

describe('debug gated stream', () => {
  it('logs events', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-cfg-'))
    const libParent = fs.mkdtempSync(path.join(os.tmpdir(), 'zz-lib-'))
    const cfg = new RuntimeConfigStore(baseDir)
    __resetDownloadsForTests()
    const FULL = Buffer.alloc(4096, 7)
    global.fetch = vi.fn(async () => {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(FULL.subarray(0, 1024))
          void new Promise<void>((r) => { setTimeout(() => { try { c.enqueue(FULL.subarray(1024)); c.close() } catch (e) { console.log('enqueue2 failed', e) } }, 3000) })
        },
      })
      return new Response(stream, { status: 200, headers: { 'content-length': String(FULL.length) } })
    }) as unknown as typeof fetch
    const events: DownloadEvent[] = []
    await startDownload(cfg as unknown as never, libParent, 'o/m', 'a.gguf', 'https://huggingface.co/o/m/resolve/main/a.gguf', (e) => { events.push({ ...e }); console.log('EV', e.state, e.receivedBytes, e.totalBytes, e.error ?? '') })
    await new Promise((r) => setTimeout(r, 1500))
    console.log('EVENT COUNT', events.length)
    expect(events.length).toBeGreaterThan(0)
    try { cfg.close() } catch { /* ignore */ }
    fs.rmSync(baseDir, { recursive: true, force: true })
    fs.rmSync(libParent, { recursive: true, force: true })
  }, 20000)
})
