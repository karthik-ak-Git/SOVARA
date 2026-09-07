/**
 * Web sidecar manager (crawl4ai).
 * Spawns the local Python crawl server on port 51821. All HTTP goes through
 * HttpClient (sovereignty: loopback only). When the sidecar or crawl4ai is
 * unavailable, calls throw CrawlUnavailableError and callers fall back to
 * link-only results.
 */

import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { postLoopback, getLoopbackJson } from '../network/HttpClient'

let server: ChildProcess | null = null
let ready = false
let startPromise: Promise<void> | null = null
let crawl4aiPresent: boolean | null = null

export const CRAWL_PORT = 51821
const HEALTH_URL = `http://127.0.0.1:${CRAWL_PORT}/health`
const SEARCH_URL = `http://127.0.0.1:${CRAWL_PORT}/search`
const CRAWL_URL = `http://127.0.0.1:${CRAWL_PORT}/crawl`

export class CrawlUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CrawlUnavailableError'
  }
}

export interface CrawlSource {
  url: string
  title: string
  snippet: string
  content: string
}

export interface CrawlPage {
  url: string
  title: string
  markdown: string
  error?: string
}

function getPythonDir(): string {
  const appRoot = app.getAppPath()
  const devPath = join(appRoot, 'python')
  const prodPath = join(process.resourcesPath ?? '', 'python')
  return existsSync(devPath) ? devPath : prodPath
}

function getPythonCommand(): string {
  return process.platform === 'win32' ? 'python' : 'python3'
}

async function waitForServer(timeoutMs = 45_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const result = await getLoopbackJson(HEALTH_URL, { timeoutMs: 2_000 })
      const body = result.json as { ready?: boolean; crawl4ai?: boolean } | null
      if (body && body.ready === true) {
        ready = true
        crawl4aiPresent = body.crawl4ai === true
        return
      }
    } catch {
      // Server not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Crawl server failed to start within timeout')
}

export async function startCrawlServer(): Promise<void> {
  if (ready) return
  if (startPromise) return startPromise
  startPromise = (async () => {
    try {
      const serverPath = join(getPythonDir(), 'crawl_server.py')
      if (!existsSync(serverPath)) return // sidecar not shipped — callers fall back
      server = spawn(getPythonCommand(), [serverPath, String(CRAWL_PORT)], {
        cwd: getPythonDir(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })
      server.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) console.log(`[crawl:py] ${msg}`)
      })
      server.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        if (msg) console.error(`[crawl:py] ${msg}`)
      })
      server.on('exit', () => {
        server = null
        ready = false
        crawl4aiPresent = null
      })
      server.on('error', () => {
        server = null
        ready = false
        crawl4aiPresent = null
      })
      await waitForServer()
    } catch {
      server = null
      ready = false
    } finally {
      startPromise = null
    }
  })()
  return startPromise
}

export function isCrawlReady(): boolean {
  return ready
}

/** True when the sidecar confirmed crawl4ai extraction is available. */
export function isCrawl4aiPresent(): boolean {
  return crawl4aiPresent === true
}

async function ensureReady(): Promise<void> {
  if (!ready) await startCrawlServer()
  if (!ready) throw new CrawlUnavailableError('Web sidecar is not running (crawl4ai sidecar missing or failed to start).')
}

function asSources(body: unknown): CrawlSource[] {
  if (body === null || typeof body !== 'object') return []
  const raw = (body as Record<string, unknown>)['sources']
  if (!Array.isArray(raw)) return []
  const out: CrawlSource[] = []
  for (const s of raw) {
    if (s === null || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    if (typeof o['url'] !== 'string' || o['url'].length === 0) continue
    out.push({
      url: o['url'],
      title: typeof o['title'] === 'string' ? o['title'] : '',
      snippet: typeof o['snippet'] === 'string' ? o['snippet'] : '',
      content: typeof o['content'] === 'string' ? o['content'] : '',
    })
  }
  return out
}

/** Search via the sidecar: discovered links + crawl4ai page content. */
export async function searchWithCrawl(query: string, maxPages = 3): Promise<{ sources: CrawlSource[]; crawled: boolean }> {
  await ensureReady()
  const { res } = await postLoopback(SEARCH_URL, { query, max_pages: maxPages }, { timeoutMs: 120_000 })
  if (!res.ok) throw new CrawlUnavailableError(`Web sidecar search failed (HTTP ${res.status}).`)
  const body = (await res.json()) as { sources?: unknown; crawled?: boolean; error?: string }
  if (typeof body.error === 'string' && body.error.length > 0) throw new CrawlUnavailableError(`Web sidecar: ${body.error}`)
  return { sources: asSources(body), crawled: body.crawled === true }
}

/** Extract markdown from explicit URLs via crawl4ai. */
export async function crawlUrls(urls: string[], maxChars = 6000): Promise<CrawlPage[]> {
  await ensureReady()
  const { res } = await postLoopback(CRAWL_URL, { urls, max_chars: maxChars }, { timeoutMs: 120_000 })
  if (!res.ok) throw new CrawlUnavailableError(`Web sidecar crawl failed (HTTP ${res.status}).`)
  const body = (await res.json()) as { pages?: unknown; error?: string }
  if (typeof body.error === 'string' && body.error.length > 0) throw new CrawlUnavailableError(`Web sidecar: ${body.error}`)
  if (!Array.isArray(body.pages)) return []
  const out: CrawlPage[] = []
  for (const p of body.pages) {
    if (p === null || typeof p !== 'object') continue
    const o = p as Record<string, unknown>
    if (typeof o['url'] !== 'string') continue
    out.push({
      url: o['url'],
      title: typeof o['title'] === 'string' ? o['title'] : '',
      markdown: typeof o['markdown'] === 'string' ? o['markdown'] : '',
      ...(typeof o['error'] === 'string' && o['error'].length > 0 ? { error: o['error'] } : {}),
    })
  }
  return out
}

/** Lazy start after app ready — non-blocking. */
export function initCrawlServer(): void {
  startCrawlServer().catch(() => {
    // Swallow — sidecar is optional; tools fall back to link-only results.
  })
}
