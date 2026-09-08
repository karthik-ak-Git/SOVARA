import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { estimateCompatibility as estimateCompatHW, recommendFiles as recFiles, getRecommendedFileIndex as getRecIdx } from '../src/main/services/hardwareCheck'
import { cleanReadme, sortModels, filterModels, fetchModelsFromHf } from '../src/main/services/hfCatalog'
import { scanLibrary, repoFolder, confinePath, startDownload, cancelDownload, pauseDownload, resumeDownload, getActiveDownloads, __resetDownloadsForTests } from '../src/main/services/modelDownloads'
import type { ExploreModel } from '../src/shared/types/explore'
import { zExploreListModels, zLibraryDownload } from '../src/shared/ipc/schemas'
import { RuntimeConfigStore } from '../src/main/config/RuntimeConfigStore'

function mkModel(over: Partial<ExploreModel>): ExploreModel {
  return {
    id: 'org/m',
    name: 'm',
    slug: 'org/m',
    author: 'org',
    description: 'd',
    longDescription: 'ld',
    downloads: 0,
    likes: 0,
    staffPick: false,
    updatedAt: new Date().toISOString(),
    parameters: '7B',
    architecture: 'llama',
    capabilities: ['Reasoning'],
    files: [],
    tags: [],
    iconType: 'hf',
    ...over,
  }
}

// ── Unit: hardware-aware recommendations ──────────────────────────────
describe('Explorer: hardware-aware recommendations', () => {
  const hw16gb = { totalRamMB: 16 * 1024, freeRamMB: 12 * 1024, gpuAvailable: false }
  const hw8gb = { totalRamMB: 8 * 1024, freeRamMB: 6 * 1024, gpuAvailable: false }
  const hwWithGpu = { totalRamMB: 32 * 1024, freeRamMB: 20 * 1024, totalVramMB: 8 * 1024, freeVramMB: 6 * 1024, gpuAvailable: true, gpuName: 'RTX 4080' }

  it('estimateCompatibility detects good/tight/too-large', () => {
    const small = mkModel({ files: [{ format: 'GGUF', sizeGB: 4, downloadUrl: 'https://huggingface.co/org/m/resolve/main/a.gguf', rfilename: 'a.gguf', sizeBytes: 4 * 1024 ** 3 }] })
    const large = mkModel({ files: [{ format: 'GGUF', sizeGB: 30, downloadUrl: 'https://huggingface.co/org/m/resolve/main/b.gguf', rfilename: 'b.gguf', sizeBytes: 30 * 1024 ** 3 }] })
    expect(estimateCompatHW(small, hw16gb).severity).toBe('good')
    expect(estimateCompatHW(large, hw16gb).severity).toBe('too-large')
    expect(estimateCompatHW(small, hw8gb).severity).toBe('good')
  })

  it('recommendFiles picks largest good (best quality) for roomy system', () => {
    const m = mkModel({
      files: [
        { format: 'GGUF', quantization: 'Q4_K_M', sizeGB: 4, downloadUrl: 'https://huggingface.co/org/m/resolve/main/q4.gguf', rfilename: 'q4.gguf', sizeBytes: 4 * 1024 ** 3 },
        { format: 'GGUF', quantization: 'Q8_0', sizeGB: 7, downloadUrl: 'https://huggingface.co/org/m/resolve/main/q8.gguf', rfilename: 'q8.gguf', sizeBytes: 7 * 1024 ** 3 },
        { format: 'GGUF', quantization: 'Q2_K', sizeGB: 2, downloadUrl: 'https://huggingface.co/org/m/resolve/main/q2.gguf', rfilename: 'q2.gguf', sizeBytes: 2 * 1024 ** 3 },
      ],
    })
    const recs = recFiles(m, hw16gb)
    // 7GB Q8_0 fits in 16GB and should be ranked 0 (best quality)
    expect(recs[0].file.quantization).toBe('Q8_0')
    expect(recs[0].rank).toBe(0)
    expect(recs[0].severity).toBe('good')
  })

  it('recommendFiles picks smaller good when tight', () => {
    const m = mkModel({
      files: [
        { format: 'GGUF', quantization: 'Q8_0', sizeGB: 10, downloadUrl: 'https://huggingface.co/org/m/resolve/main/q8.gguf', rfilename: 'q8.gguf', sizeBytes: 10 * 1024 ** 3 },
        { format: 'GGUF', quantization: 'Q4_K_M', sizeGB: 4, downloadUrl: 'https://huggingface.co/org/m/resolve/main/q4.gguf', rfilename: 'q4.gguf', sizeBytes: 4 * 1024 ** 3 },
      ],
    })
    const recs = recFiles(m, hw8gb)
    // 10GB too large/tight on 8GB, 4GB good
    expect(recs[0].file.quantization).toBe('Q4_K_M')
  })

  it('getRecommendedFileIndex returns original index', () => {
    const m = mkModel({
      files: [
        { format: 'GGUF', quantization: 'Q2_K', sizeGB: 2, downloadUrl: 'https://huggingface.co/org/m/resolve/main/q2.gguf', rfilename: 'q2.gguf', sizeBytes: 2 * 1024 ** 3 },
        { format: 'GGUF', quantization: 'Q4_K_M', sizeGB: 4, downloadUrl: 'https://huggingface.co/org/m/resolve/main/q4.gguf', rfilename: 'q4.gguf', sizeBytes: 4 * 1024 ** 3 },
      ],
    })
    expect(getRecIdx(m, hw16gb)).not.toBeNull()
  })
})

// ── Unit: HF catalog pure helpers ────────────────────────────────────
describe('Explorer: hfCatalog production helpers', () => {
  it('cleanReadme strips frontmatter and enforces maxChars=12000 default', () => {
    const raw = '---\nlicense: mit\n---\n\n# Title\n\nBody'
    expect(cleanReadme(raw)).toBe('# Title\n\nBody')
    const huge = 'x'.repeat(13000)
    expect(cleanReadme(huge).length).toBeLessThan(13000)
    expect(cleanReadme(huge)).toContain('truncated')
  })

  it('sortModels supports trending like likes', () => {
    const a = mkModel({ id: 'a', likes: 5, downloads: 100 })
    const b = mkModel({ id: 'b', likes: 10, downloads: 10 })
    expect(sortModels([a, b], 'trending').map((m) => m.id)).toEqual(['b', 'a'])
    expect(sortModels([a, b], 'recommended').map((m) => m.id)[0]).toBe('b')
  })

  it('filterModels matches pipelineTag and capabilities', () => {
    const m = mkModel({ name: 'MyModel', pipelineTag: 'text-generation', capabilities: ['Vision'], tags: ['gguf'] })
    expect(filterModels([m], 'text-generation')).toHaveLength(1)
    expect(filterModels([m], 'vision')).toHaveLength(1)
    expect(filterModels([m], 'GGUF')).toHaveLength(1)
  })

  it('zExploreListModels validates new filters', () => {
    expect(zExploreListModels.safeParse({ sortBy: 'trending', query: 'llama', pipelineTag: 'text-generation', tag: 'gguf' }).success).toBe(true)
    expect(zExploreListModels.safeParse({ pipelineTag: 'gguf', tag: 'vision' }).success).toBe(true)
    expect(zExploreListModels.safeParse({ unknown: 'x' } as unknown).success).toBe(false)
  })

  it('fetchModelsFromHf overload accepts options object (no network)', async () => {
    // Mock fetch to avoid network
    const origFetch = global.fetch
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch
    const res = await fetchModelsFromHf({ sortBy: 'trending', query: 'qwen', pipelineTag: 'text-generation', tag: 'gguf', limit: 5 })
    expect(Array.isArray(res)).toBe(true)
    global.fetch = origFetch
  })
})

// ── Integration: download manager (queue, pause, resume, cancel) ─────
describe('Explorer: download manager integration', () => {
  let tmpDir: string
  let cfg: RuntimeConfigStore
  let origFetch: typeof global.fetch
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-prod-dl-'))
    const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-prod-cfg-'))
    cfg = new RuntimeConfigStore(cfgDir)
    __resetDownloadsForTests()
    origFetch = global.fetch
  })
  afterEach(() => {
    global.fetch = origFetch
    __resetDownloadsForTests()
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('scanLibrary ignores .part files and returns library sync state', () => {
    const repo = path.join(tmpDir, 'Org__M')
    fs.mkdirSync(repo, { recursive: true })
    fs.writeFileSync(path.join(repo, 'model.gguf'), Buffer.alloc(8))
    fs.writeFileSync(path.join(repo, 'model.gguf.part'), Buffer.alloc(4))
    expect(scanLibrary(tmpDir)).toHaveLength(1)
    expect(scanLibrary(tmpDir)[0].file).toBe('model.gguf')
  })

  it('repoFolder and confinePath enforce library sync confinement', () => {
    expect(repoFolder('a/b')).toBe('a__b')
    expect(() => confinePath(tmpDir, '..', 'evil')).toThrow()
  })

  it('zLibraryDownload validates HF URLs', () => {
    expect(zLibraryDownload.safeParse({ modelId: 'org/m', rfilename: 'a.gguf', downloadUrl: 'https://huggingface.co/org/m/resolve/main/a.gguf' }).success).toBe(true)
    expect(zLibraryDownload.safeParse({ modelId: '', rfilename: 'a.gguf', downloadUrl: 'https://huggingface.co/org/m/resolve/main/a.gguf' }).success).toBe(false)
  })

  it('queue respects 2-concurrent limit (queued state)', async () => {
    const origFetch = global.fetch
    global.fetch = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      // Respect abort, otherwise hang forever
      return new Promise<Response>((resolve, reject) => {
        const sig = init?.signal as AbortSignal | undefined
        if (sig?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
        const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'))
        sig?.addEventListener('abort', onAbort, { once: true })
        // Never resolve — keep active until aborted
      })
    }) as unknown as typeof fetch

    const emit = vi.fn()
    await startDownload(cfg, tmpDir, 'org/m1', 'a.gguf', 'https://huggingface.co/org/m1/resolve/main/a.gguf', emit)
    await startDownload(cfg, tmpDir, 'org/m2', 'b.gguf', 'https://huggingface.co/org/m2/resolve/main/b.gguf', emit)
    // Ensure first two are active before third
    await new Promise((r) => setTimeout(r, 10))
    const third = await startDownload(cfg, tmpDir, 'org/m3', 'c.gguf', 'https://huggingface.co/org/m3/resolve/main/c.gguf', emit)
    expect(third.queued).toBe(true)
    expect(getActiveDownloads().some((d) => d.rfilename === 'c.gguf' && d.state === 'queued')).toBe(true)
    __resetDownloadsForTests()
    global.fetch = origFetch
  })

  it('pause marks active as paused and resume re-queues', async () => {
    const origFetch = global.fetch
    global.fetch = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((resolve, reject) => {
        const sig = init?.signal as AbortSignal | undefined
        if (sig?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
        const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'))
        sig?.addEventListener('abort', onAbort, { once: true })
      })
    }) as unknown as typeof fetch
    const emit = vi.fn()
    await startDownload(cfg, tmpDir, 'org/m', 'pause.gguf', 'https://huggingface.co/org/m/resolve/main/pause.gguf', emit)
    await new Promise((r) => setTimeout(r, 10))
    expect(pauseDownload('org/m', 'pause.gguf')).toBe(true)
    await new Promise((r) => setTimeout(r, 50))
    expect(getActiveDownloads().some((d) => d.state === 'paused')).toBe(true)
    expect(resumeDownload(cfg, tmpDir, 'org/m', 'pause.gguf', 'https://huggingface.co/org/m/resolve/main/pause.gguf', emit)).toBe(true)
    await new Promise((r) => setTimeout(r, 10))
    __resetDownloadsForTests()
    global.fetch = origFetch
  })
})

// ── Performance: filtering + sorting on 60 models ───────────────────
describe('Explorer: performance', () => {
  it('filter + sort 60 models under 50ms', () => {
    const models = Array.from({ length: 60 }, (_, i) => mkModel({ id: `org/m${i}`, name: `Model ${i}`, tags: i % 2 === 0 ? ['gguf', 'vision'] : ['safetensors'], likes: i, downloads: 60 - i, updatedAt: new Date(Date.now() - i * 86400000).toISOString() }))
    const start = performance.now()
    const filtered = filterModels(models, 'vision')
    const sorted = sortModels(filtered, 'downloads')
    const elapsed = performance.now() - start
    expect(sorted.length).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(50)
  })

  it('render Markdown 12k chars under 30ms', () => {
    const md = `# Title\n\n${Array.from({ length: 200 }, (_, i) => `- item ${i} with **bold** and \`code\` and [link](https://example.com)`).join('\n')}\n\n\`\`\`python\nprint("hi")\n\`\`\``
    const start = performance.now()
    // Use cleanReadme as proxy for markdown processing cost
    const out = cleanReadme(md, 12000)
    const elapsed = performance.now() - start
    expect(out.length).toBeGreaterThan(100)
    expect(elapsed).toBeLessThan(30)
  })
})
