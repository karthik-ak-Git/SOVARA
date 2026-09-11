import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  startModelSetDownload,
  isDownloaded,
  __resetDownloadsForTests,
  type DownloadEvent,
} from '../src/main/services/modelDownloads'

const PART1 = 'M-Q2_K-00001-of-00002.gguf'
const PART2 = 'M-Q2_K-00002-of-00002.gguf'
const BODY1 = 'a'.repeat(1024)
const BODY2 = 'b'.repeat(2048)

let libDir = ''

function fakeConfig(): unknown {
  return { getAppSetting: () => libDir }
}

beforeEach(() => {
  libDir = mkdtempSync(join(tmpdir(), 'sovara-set-'))
  __resetDownloadsForTests()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith(PART1)) return new Response(BODY1, { status: 200, headers: { 'content-length': String(BODY1.length) } })
    if (url.endsWith(PART2)) return new Response(BODY2, { status: 200, headers: { 'content-length': String(BODY2.length) } })
    return new Response('missing', { status: 404 })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  try { rmSync(libDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

function waitDone(events: DownloadEvent[], groupFile: string, timeoutMs = 15000): Promise<DownloadEvent> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const timer = setInterval(() => {
      const done = events.find((e) => e.rfilename === groupFile && (e.state === 'done' || e.state === 'error' || e.state === 'cancelled'))
      if (done) { clearInterval(timer); resolve(done) }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error('timed out waiting for set completion')) }
    }, 50)
  })
}

describe('multi-part shard-set download', () => {
  it('downloads every part sequentially with aggregate progress under part 1', async () => {
    const events: DownloadEvent[] = []
    const parts = [
      { rfilename: PART1, downloadUrl: `https://huggingface.co/o/r/resolve/main/${PART1}`, sizeBytes: BODY1.length },
      { rfilename: PART2, downloadUrl: `https://huggingface.co/o/r/resolve/main/${PART2}`, sizeBytes: BODY2.length },
    ]
    await startModelSetDownload(fakeConfig() as never, 'userData', 'o/m', parts, undefined, (e) => { events.push(e) })
    const done = await waitDone(events, PART1)
    expect(done.state).toBe('done')
    expect(done.receivedBytes).toBe(BODY1.length + BODY2.length)
    expect(done.totalBytes).toBe(BODY1.length + BODY2.length)
    // every emitted event belongs to the group row — never stray part keys
    expect(events.every((e) => e.rfilename === PART1)).toBe(true)
    expect(isDownloaded(libDir, 'o/m', PART1)).toBe(true)
    // restart-safe sidecar recorded the set
    expect(existsSync(join(libDir, 'o__m', `${PART1}.set.json`))).toBe(true)
  })

  it('installed reads false when any part is missing', async () => {
    const events: DownloadEvent[] = []
    const parts = [
      { rfilename: PART1, downloadUrl: `https://huggingface.co/o/r/resolve/main/${PART1}`, sizeBytes: BODY1.length },
      { rfilename: PART2, downloadUrl: `https://huggingface.co/o/r/resolve/main/${PART2}`, sizeBytes: BODY2.length },
    ]
    await startModelSetDownload(fakeConfig() as never, 'userData', 'o/m', parts, undefined, (e) => { events.push(e) })
    await waitDone(events, PART1)
    expect(isDownloaded(libDir, 'o/m', PART1)).toBe(true)
    unlinkSync(join(libDir, 'o__m', PART2))
    expect(isDownloaded(libDir, 'o/m', PART1)).toBe(false)
  })
})
