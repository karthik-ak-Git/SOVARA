import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  weightFormatOf,
  classifyRepoFormat,
  listRepoWeightFiles,
  parseQuantization,
  normalizeGated,
  matchesFormatFilter,
  pickQuantOptions,
  listExplorerModels,
  getExplorerModel,
  clearExplorerModelCache,
} from '../src/main/services/explorerCatalog'
import {
  startDownload,
  __resetDownloadsForTests,
  type DownloadEvent,
} from '../src/main/services/modelDownloads'
import { zExploreListModels } from '../src/shared/ipc/schemas'

// ── Case E: quantization parsing (tolerant, filename fallback) ──
describe('parseQuantization (tolerant quant detection)', () => {
  const cases: Array<[string, string | undefined]> = [
    ['model-Q4_K_M.gguf', 'Q4_K_M'],
    ['model-Q5_K_M.gguf', 'Q5_K_M'],
    ['model-Q6_K.gguf', 'Q6_K'],
    ['model-Q8_0.gguf', 'Q8_0'],
    ['model-F16.gguf', 'F16'],
    ['model-F32.gguf', 'F32'],
    ['model_Q4_K_M.gguf', 'Q4_K_M'],
    ['model-q4km.gguf', 'Q4_K_M'],
    ['model.Q4-K-M.gguf', 'Q4_K_M'],
    ['M-Q3_K_S.gguf', 'Q3_K_S'],
    ['M-Q3_K_M-00001-of-00002.gguf', 'Q3_K_M'],
    ['M-Q4_0.gguf', 'Q4_0'],
    ['M-Q5_0.gguf', 'Q5_0'],
    ['M-Q2_K.gguf', 'Q2_K'],
    ['M-BF16.gguf', 'BF16'],
    ['M-fp16.gguf', 'F16'],
    ['M-IQ4_NL.gguf', 'IQ4_NL'],
    ['M-MXFP4.gguf', 'MXFP4'],
    // fallback: no confident quant → undefined (UI shows the filename)
    ['model.safetensors', undefined],
    ['pytorch_model.bin', undefined],
    ['random-weights.gguf', undefined],
    ['README.md', undefined],
  ]
  for (const [name, expected] of cases) {
    it(`${name} → ${expected ?? 'filename fallback'}`, () => {
      expect(parseQuantization(name)).toBe(expected)
    })
  }
})

// ── File-extension classification (source of truth = files) ──
describe('weightFormatOf (extension, not name/tags)', () => {
  it('detects gguf / safetensors / other weights', () => {
    expect(weightFormatOf('M-Q4_K_M.gguf')).toBe('gguf')
    expect(weightFormatOf('SUBDIR/M-Q4_K_M.GGUF')).toBe('gguf')
    expect(weightFormatOf('model.safetensors')).toBe('safetensors')
    expect(weightFormatOf('model-00001-of-00002.safetensors')).toBe('safetensors')
    expect(weightFormatOf('pytorch_model.bin')).toBe('other')
    expect(weightFormatOf('model.pth')).toBe('other')
    expect(weightFormatOf('model.pt')).toBe('other')
    expect(weightFormatOf('model.ckpt')).toBe('other')
    expect(weightFormatOf('model.onnx')).toBe('other')
    expect(weightFormatOf('model.h5')).toBe('other')
  })
  it('rejects indexes, configs and docs', () => {
    expect(weightFormatOf('model.safetensors.index.json')).toBeNull()
    expect(weightFormatOf('config.json')).toBeNull()
    expect(weightFormatOf('README.md')).toBeNull()
    expect(weightFormatOf('.gitattributes')).toBeNull()
    expect(weightFormatOf('tokenizer.json')).toBeNull()
  })
})

// ── Cases A–D: repo-level format ──
const sib = (rfilename: string): { rfilename: string } => ({ rfilename })

describe('classifyRepoFormat (cases A–D)', () => {
  it('Case A — GGUF only → gguf', () => {
    expect(classifyRepoFormat([sib('model-Q4_K_M.gguf'), sib('model-Q5_K_M.gguf')])).toBe('gguf')
  })
  it('Case B — Safetensors only → safetensors', () => {
    expect(
      classifyRepoFormat([sib('model-00001-of-00002.safetensors'), sib('model-00002-of-00002.safetensors')]),
    ).toBe('safetensors')
  })
  it('Case C — mixed → mixed', () => {
    expect(classifyRepoFormat([sib('model-Q4_K_M.gguf'), sib('model.safetensors')])).toBe('mixed')
  })
  it('Case D — README + config only → null (not a downloadable model)', () => {
    expect(classifyRepoFormat([sib('README.md'), sib('config.json')])).toBeNull()
    expect(classifyRepoFormat([])).toBeNull()
  })
  it('other weights → other; projector-only gguf does not fake a model', () => {
    expect(classifyRepoFormat([sib('pytorch_model.bin')])).toBe('other')
    expect(classifyRepoFormat([sib('mmproj-Q8_0.gguf'), sib('README.md')])).toBeNull()
  })
  it('a repo named *-GGUF with no gguf files is NOT gguf', () => {
    expect(classifyRepoFormat([sib('model.safetensors'), sib('config.json')])).toBe('safetensors')
  })
})

describe('gated normalization', () => {
  it('boolean and mode strings normalize honestly', () => {
    expect(normalizeGated(true)).toBe(true)
    expect(normalizeGated(false)).toBe(false)
    expect(normalizeGated('true')).toBe(true)
    expect(normalizeGated('manual')).toBe(true)
    expect(normalizeGated('auto')).toBe(true)
    expect(normalizeGated('false')).toBe(false)
    expect(normalizeGated(undefined)).toBe(false)
    expect(normalizeGated(null)).toBe(false)
  })
})

describe('matchesFormatFilter', () => {
  it('gguf/safetensors filters keep mixed (it HAS that format)', () => {
    expect(matchesFormatFilter('gguf', 'gguf')).toBe(true)
    expect(matchesFormatFilter('mixed', 'gguf')).toBe(true)
    expect(matchesFormatFilter('safetensors', 'gguf')).toBe(false)
    expect(matchesFormatFilter('mixed', 'safetensors')).toBe(true)
    expect(matchesFormatFilter('gguf', 'safetensors')).toBe(false)
    expect(matchesFormatFilter('mixed', 'mixed')).toBe(true)
    expect(matchesFormatFilter('other', 'other')).toBe(true)
    expect(matchesFormatFilter('gguf', 'all')).toBe(true)
    expect(matchesFormatFilter(undefined, 'gguf')).toBe(false)
  })
})

// ── Listing level: formats flow through, weight-less repos skipped ──
function listRow(id: string, siblings: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    author: id.split('/')[0],
    likes: 5,
    downloads: 100,
    tags: ['conversational'],
    pipeline_tag: 'text-generation',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-02-01T00:00:00.000Z',
    cardData: {},
    siblings: siblings.map((rfilename) => ({ rfilename })),
    ...extra,
  }
}

const GGUF_ROW = () => listRow('org/gguf-only', ['m-Q4_K_M.gguf', 'm-Q5_K_M.gguf'])
const ST_ROW = () => listRow('Qwen/Qwen3-8B', ['model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors', 'config.json', 'tokenizer.json'])
const MIXED_ROW = () => listRow('org/mixed', ['m-Q4_K_M.gguf', 'model.safetensors'])
const OTHER_ROW = () => listRow('org/other', ['pytorch_model.bin'])
const NONE_ROW = () => listRow('org/docs', ['README.md', 'config.json'])
const GATED_ROW = () => listRow('org/gated-gguf', ['g-Q4_K_M.gguf'], { gated: true, cardData: { license: 'llama3', base_model: 'org/base' } })

describe('format-aware listing', () => {
  beforeEach(() => {
    clearExplorerModelCache()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.startsWith('https://huggingface.co/api/models?')) {
        return Response.json([GGUF_ROW(), ST_ROW(), MIXED_ROW(), OTHER_ROW(), NONE_ROW(), GATED_ROW()])
      }
      return new Response('not found', { status: 404 })
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('classifies every repo from its files; weight-less repos are skipped', async () => {
    const models = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30 })
    const byId = new Map(models.map((m) => [m.id, m]))
    expect(byId.get('org/gguf-only')?.format).toBe('gguf')
    expect(byId.get('Qwen/Qwen3-8B')?.format).toBe('safetensors')
    expect(byId.get('org/mixed')?.format).toBe('mixed')
    expect(byId.get('org/other')?.format).toBe('other')
    expect(byId.has('org/docs')).toBe(false)
    // Safetensors-only: listed, but with NO GGUF download rows
    expect(byId.get('Qwen/Qwen3-8B')?.files).toEqual([])
  })

  it('gated + license + base_model flow through (no open-source labeling)', async () => {
    const models = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30 })
    const gated = models.find((m) => m.id === 'org/gated-gguf')
    expect(gated?.gated).toBe(true)
    expect(gated?.license).toBe('llama3')
    expect(gated?.baseModel).toBe('org/base')
    expect(models.find((m) => m.id === 'org/gguf-only')?.gated).toBe(false)
  })

  it('format filter keeps only matching repos', async () => {
    const gguf = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, format: 'gguf' })
    expect(gguf.map((m) => m.id).sort()).toEqual(['org/gated-gguf', 'org/gguf-only', 'org/mixed'])
    const st = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, format: 'safetensors' })
    expect(st.map((m) => m.id).sort()).toEqual(['Qwen/Qwen3-8B', 'org/mixed'])
    const mixed = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, format: 'mixed' })
    expect(mixed.map((m) => m.id)).toEqual(['org/mixed'])
    const other = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, format: 'other' })
    expect(other.map((m) => m.id)).toEqual(['org/other'])
  })

  it('schema accepts the format filter and stays strict', () => {
    expect(zExploreListModels.safeParse({ format: 'gguf' }).success).toBe(true)
    expect(zExploreListModels.safeParse({ format: 'bogus' }).success).toBe(false)
  })
})

// ── Detail level: inventory, no fake GGUF, source repos ──
describe('format-aware detail', () => {
  beforeEach(() => {
    clearExplorerModelCache()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      if (url === 'https://huggingface.co/api/models/org/mixed') {
        return Response.json({
          id: 'org/mixed',
          author: 'org',
          likes: 1,
          downloads: 2,
          tags: ['conversational'],
          pipeline_tag: 'text-generation',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastModified: '2026-02-01T00:00:00.000Z',
          cardData: {},
          siblings: [{ rfilename: 'm-Q4_K_M.gguf' }, { rfilename: 'model.safetensors' }],
        })
      }
      if (url === 'https://huggingface.co/api/models/Qwen/Qwen3-8B') {
        return Response.json({
          id: 'Qwen/Qwen3-8B',
          author: 'Qwen',
          likes: 1,
          downloads: 2,
          tags: ['conversational'],
          pipeline_tag: 'text-generation',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastModified: '2026-02-01T00:00:00.000Z',
          cardData: { license: 'apache-2.0' },
          siblings: [
            { rfilename: 'model-00001-of-00002.safetensors' },
            { rfilename: 'model-00002-of-00002.safetensors' },
            { rfilename: 'config.json' },
          ],
        })
      }
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': String(1024 ** 3) } })
      }
      return new Response('not found', { status: 404 })
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('mixed repo: format mixed, GGUF rows downloadable, st in inventory', async () => {
    const m = await getExplorerModel('org/mixed')
    expect(m.format).toBe('mixed')
    expect(m.files.length).toBeGreaterThan(0)
    expect(m.files.every((f) => f.format === 'GGUF')).toBe(true)
    expect(m.files[0].sourceRepo).toBe('org/mixed')
    const inv = m.repoFiles ?? []
    expect(inv.some((f) => f.format === 'gguf')).toBe(true)
    expect(inv.some((f) => f.format === 'safetensors')).toBe(true)
  })

  it('safetensors-only base: NO GGUF rows, inventory lists the weights', async () => {
    const m = await getExplorerModel('Qwen/Qwen3-8B')
    expect(m.format).toBe('safetensors')
    expect(m.files).toEqual([])
    expect((m.repoFiles ?? []).map((f) => f.rfilename)).toEqual([
      'model-00001-of-00002.safetensors',
      'model-00002-of-00002.safetensors',
    ])
    expect(m.license).toBe('apache-2.0')
  })

  it('Case A picker: two quant files → two individually downloadable rows', () => {
    const rows = pickQuantOptions(
      [{ repoId: 'org/g', siblings: [sib('model-Q4_K_M.gguf'), sib('model-Q5_K_M.gguf')] }],
      { sizes: new Map([['org/g\nmodel-q4_k_m.gguf', 4 * 1024 ** 3], ['org/g\nmodel-q5_k_m.gguf', 5 * 1024 ** 3]]) },
    )
    expect(rows.map((r) => r.quantization).sort()).toEqual(['Q4_K_M', 'Q5_K_M'])
    expect(new Set(rows.map((r) => r.downloadUrl)).size).toBe(2)
  })

  it('listRepoWeightFiles excludes helpers but keeps both weight kinds', () => {
    const w = listRepoWeightFiles([
      sib('m-Q4_K_M.gguf'), sib('model.safetensors'), sib('mmproj-Q8_0.gguf'), sib('README.md'),
    ])
    expect(w).toEqual([
      { rfilename: 'm-Q4_K_M.gguf', format: 'gguf' },
      { rfilename: 'model.safetensors', format: 'safetensors' },
    ])
  })
})

// ── Case F: selecting one quant downloads ONLY that file ──
describe('single-file download (case F)', () => {
  const Q4 = 'Qwen3-8B-Q4_K_M.gguf'
  const Q8 = 'Qwen3-8B-Q8_0.gguf'
  const BODY = 'q'.repeat(4096)
  let libDir = ''

  function fakeConfig(): unknown {
    return { getAppSetting: () => libDir }
  }

  beforeEach(() => {
    libDir = mkdtempSync(join(tmpdir(), 'sovara-single-'))
    __resetDownloadsForTests()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith(Q4)) return new Response(BODY, { status: 200, headers: { 'content-length': String(BODY.length) } })
      if (url.endsWith(Q8)) return new Response('other-quant', { status: 200 })
      return new Response('missing', { status: 404 })
    }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    try { rmSync(libDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('downloads only the selected GGUF, nothing else from the repo', async () => {
    const events: DownloadEvent[] = []
    await startDownload(
      fakeConfig() as never,
      'userData',
      'org/Qwen3-8B-GGUF',
      Q4,
      `https://huggingface.co/org/Qwen3-8B-GGUF/resolve/main/${Q4}`,
      (e) => { events.push(e) },
    )
    const done = await new Promise<DownloadEvent>((resolve, reject) => {
      const t0 = Date.now()
      const timer = setInterval(() => {
        const hit = events.find((e) => e.rfilename === Q4 && (e.state === 'done' || e.state === 'error'))
        if (hit) { clearInterval(timer); resolve(hit) }
        else if (Date.now() - t0 > 15000) { clearInterval(timer); reject(new Error('timed out')) }
      }, 50)
    })
    expect(done.state).toBe('done')
    const dest = join(libDir, 'org__Qwen3-8B-GGUF', Q4)
    expect(existsSync(dest)).toBe(true)
    expect(readFileSync(dest, 'utf8')).toBe(BODY)
    // the other quantization was never touched
    expect(existsSync(join(libDir, 'org__Qwen3-8B-GGUF', Q8))).toBe(false)
    expect(events.every((e) => e.rfilename === Q4)).toBe(true)
  })
})
