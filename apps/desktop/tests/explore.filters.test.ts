import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  listExplorerModels,
  listExplorerModelsPage,
  mergeExplorerPages,
  matchesQuantFilter,
  matchesParamsFilter,
  matchesLicenseFilter,
  matchesCapabilityFilter,
  matchesGatedFilter,
  matchesDownloadedFilter,
  matchesCompatFilter,
  matchesAllFilters,
  modelCompatTier,
  modelIsDownloaded,
  scoreExplorerModel,
  normalizeLicenseFamily,
  parseParamsB,
  parseNextCursor,
  clearExplorerModelCache,
  type ExplorerListOpts,
} from '../src/main/services/explorerCatalog'
import type { ExploreModel, ExploreModelFile, HardwareInfo } from '../src/shared/types/explore'

const hw: HardwareInfo = {
  totalRamMB: 32 * 1024,
  freeRamMB: 24 * 1024,
  totalVramMB: 12 * 1024,
  freeVramMB: 10 * 1024,
  gpuAvailable: true,
}

function hfRow(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    author: id.split('/')[0],
    likes: 10,
    downloads: 100,
    tags: ['conversational'],
    pipeline_tag: 'text-generation',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-02-01T00:00:00.000Z',
    cardData: {},
    siblings: [{ rfilename: `${id.split('/').pop()}-Q4_K_M.gguf` }],
    ...extra,
  }
}

function mkModel(over: Partial<ExploreModel> & { files: ExploreModelFile[] }): ExploreModel {
  return {
    id: 'org/m',
    name: 'm',
    slug: 'org/m',
    author: 'org',
    description: 'd',
    longDescription: 'ld',
    downloads: 100,
    likes: 10,
    staffPick: false,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    parameters: '7B',
    architecture: 'llama',
    capabilities: ['Text'],
    tags: [],
    iconType: 'hf',
    ...over,
  }
}

function ggufFile(rfilename: string, quantization?: string): ExploreModelFile {
  return { format: 'GGUF', quantization, sizeGB: 0, downloadUrl: `https://huggingface.co/org/m/resolve/main/${rfilename}`, rfilename, sizeBytes: 0, runnable: true }
}

function stubList(rows: Record<string, unknown>[]): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('https://huggingface.co/api/models?')) {
      return Response.json(rows)
    }
    return new Response('not found', { status: 404 })
  }))
}

beforeEach(() => {
  clearExplorerModelCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// ── Quant filter ────────────────────────────────────────────────────
describe('quant filter (runnable files only)', () => {
  it('matches when ANY runnable file carries the quant', () => {
    const files = [ggufFile('m-Q4_K_M.gguf', 'Q4_K_M'), ggufFile('m-Q8_0.gguf', 'Q8_0')]
    expect(matchesQuantFilter(files, ['Q4_K_M'])).toBe(true)
    expect(matchesQuantFilter(files, ['Q2_K'])).toBe(false)
    expect(matchesQuantFilter(files, [])).toBe(true)
    expect(matchesQuantFilter(files, undefined)).toBe(true)
  })

  it('ignores non-runnable rows and matches Other for unparsed quants', () => {
    const files = [
      { ...ggufFile('m-custom.gguf'), quantization: undefined },
      { ...ggufFile('mmproj.gguf', 'Q8_0'), runnable: false },
    ]
    expect(matchesQuantFilter(files, ['Other'])).toBe(true)
    expect(matchesQuantFilter(files, ['Q8_0'])).toBe(false)
    expect(matchesQuantFilter([], ['Q4_K_M'])).toBe(false)
  })

  it('flows through listing', async () => {
    stubList([
      hfRow('org/a-7b', { siblings: [{ rfilename: 'a-Q4_K_M.gguf' }, { rfilename: 'a-Q8_0.gguf' }] }),
      hfRow('org/b-7b', { siblings: [{ rfilename: 'b-Q8_0.gguf' }] }),
    ])
    const models = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, quants: ['Q4_K_M'] }, hw)
    expect(models.map((m) => m.id)).toEqual(['org/a-7b'])
  })
})

// ── Params filter (count, never file size) ──────────────────────────
describe('params filter', () => {
  it('buckets boundaries without overlap; Unknown never matches', () => {
    expect(parseParamsB('7B')).toBe(7)
    expect(parseParamsB('0.5B')).toBe(0.5)
    expect(parseParamsB('Unknown')).toBe(0)
    expect(matchesParamsFilter('7B', 'b7to14')).toBe(true)
    expect(matchesParamsFilter('7B', 'b3to7')).toBe(false)
    expect(matchesParamsFilter('14B', 'b14to32')).toBe(true)
    expect(matchesParamsFilter('70B', 'gt70')).toBe(true)
    expect(matchesParamsFilter('70B', 'b32to70')).toBe(false)
    expect(matchesParamsFilter('2B', 'lt3')).toBe(true)
    expect(matchesParamsFilter('Unknown', 'lt3')).toBe(false)
    expect(matchesParamsFilter('Unknown', 'all')).toBe(true)
    expect(matchesParamsFilter('Unknown', undefined)).toBe(true)
  })

  it('flows through listing (tags + id heuristics, no fabrication)', async () => {
    stubList([
      hfRow('org/small-2b', { tags: ['conversational', '2b'] }),
      hfRow('org/mid-8b', { tags: ['conversational', '8B'] }),
      hfRow('Qwen/Qwen3-14B-GGUF'),
      hfRow('org/mystery'),
    ])
    const mid = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, params: 'b7to14' }, hw)
    expect(mid.map((m) => m.id)).toEqual(['org/mid-8b'])
    // Buckets partition cleanly: 14B lives in 14B–32B, not 7B–14B.
    const big = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, params: 'b14to32' }, hw)
    expect(big.map((m) => m.id)).toEqual(['Qwen/Qwen3-14B-GGUF'])
    const all = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30 }, hw)
    expect(all.length).toBe(4) // 'all' keeps Unknown
  })
})

// ── License filter ──────────────────────────────────────────────────
describe('license filter (families from card metadata)', () => {
  it('normalizes without relabeling everything open-source', () => {
    expect(normalizeLicenseFamily('apache-2.0')).toBe('Apache-2.0')
    expect(normalizeLicenseFamily('MIT')).toBe('MIT')
    expect(normalizeLicenseFamily('llama3.1')).toBe('Llama')
    expect(normalizeLicenseFamily('Llama-3.3-70B')).toBe('Llama')
    expect(normalizeLicenseFamily('gpl-3.0')).toBe('Other')
    expect(normalizeLicenseFamily(undefined)).toBe('Unknown')
    expect(normalizeLicenseFamily('')).toBe('Unknown')
    expect(matchesLicenseFilter('mit', ['MIT'])).toBe(true)
    expect(matchesLicenseFilter('apache-2.0', ['MIT'])).toBe(false)
    expect(matchesLicenseFilter(undefined, [])).toBe(true)
  })

  it('flows through listing', async () => {
    stubList([
      hfRow('org/a', { cardData: { license: 'apache-2.0' } }),
      hfRow('org/b', { cardData: { license: 'llama3' } }),
      hfRow('org/c', {}),
    ])
    const mit = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, licenses: ['Apache-2.0'] }, hw)
    expect(mit.map((m) => m.id)).toEqual(['org/a'])
    const unknown = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, licenses: ['Unknown'] }, hw)
    expect(unknown.map((m) => m.id)).toEqual(['org/c'])
  })
})

// ── Capability / gated filters ──────────────────────────────────────
describe('capability + gated filters', () => {
  it('matches classified caps (OR within the category)', () => {
    expect(matchesCapabilityFilter(['Vision', 'Text'], ['Vision'])).toBe(true)
    expect(matchesCapabilityFilter(['Text'], ['Vision'])).toBe(false)
    expect(matchesCapabilityFilter(['Text'], ['Vision', 'Code'])).toBe(false)
    expect(matchesCapabilityFilter(['Code', 'Text'], ['Vision', 'Code'])).toBe(true)
    expect(matchesCapabilityFilter(['Text'], [])).toBe(true)
  })

  it('gated comes from normalized API metadata', () => {
    expect(matchesGatedFilter(true, 'gated')).toBe(true)
    expect(matchesGatedFilter(false, 'gated')).toBe(false)
    expect(matchesGatedFilter(true, 'accessible')).toBe(false)
    expect(matchesGatedFilter(undefined, 'accessible')).toBe(true)
    expect(matchesGatedFilter(true, 'all')).toBe(true)
  })

  it('flows through listing', async () => {
    stubList([
      hfRow('org/vis', { pipeline_tag: 'image-text-to-text', tags: ['conversational'] }),
      hfRow('org/code', { tags: ['conversational', 'code'] }),
      hfRow('org/gated', { gated: 'manual' }),
    ])
    const vis = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, capabilities: ['Vision'] }, hw)
    expect(vis.map((m) => m.id)).toEqual(['org/vis'])
    const gated = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, gated: 'gated' }, hw)
    expect(gated.map((m) => m.id)).toEqual(['org/gated'])
    const open = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, gated: 'accessible' }, hw)
    expect(open.map((m) => m.id).sort()).toEqual(['org/code', 'org/vis'])
  })
})

// ── Compat tiers ────────────────────────────────────────────────────
describe('compat tiers (one engine)', () => {
  const tierModel = (id: string, parameters: string, sizeGB = 0): ExploreModel =>
    mkModel({ id, parameters, files: [{ ...ggufFile('x.gguf', 'Q4_K_M'), sizeBytes: sizeGB * 1024 ** 3, sizeGB }] })

  it('likely / possible / unlikely / unknown from real signals', () => {
    expect(modelCompatTier(tierModel('o/small', '3B'), hw)).toBe('likely')
    expect(modelCompatTier(tierModel('o/mid', '27B'), hw)).toBe('possible')
    expect(modelCompatTier(tierModel('o/huge', '70B'), hw)).toBe('unlikely')
    expect(modelCompatTier(tierModel('o/mystery', 'Unknown'), hw)).toBe('unknown')
    expect(modelCompatTier(mkModel({ id: 'o/empty', parameters: '7B', files: [] }), hw)).toBe('unknown')
  })

  it('known sizes beat params probes; missing hw matches only unknown', () => {
    // 70B label but a tiny known file → likely (files are the truth)
    expect(modelCompatTier(tierModel('o/small-file', '70B', 1), hw)).toBe('likely')
    expect(matchesCompatFilter(tierModel('o/small', '3B'), undefined, 'likely')).toBe(false)
    expect(matchesCompatFilter(tierModel('o/small', '3B'), undefined, 'unknown')).toBe(true)
    expect(matchesCompatFilter(tierModel('o/small', '3B'), hw, 'all')).toBe(true)
  })

  it('flows through listing', async () => {
    stubList([
      hfRow('org/small-3b', { safetensors: { total: 3e9 } }),
      hfRow('org/mid-27b', { safetensors: { total: 27e9 } }),
      hfRow('org/huge-70b', { safetensors: { total: 70e9 } }),
    ])
    const likely = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, compat: 'likely' }, hw)
    expect(likely.map((m) => m.id)).toEqual(['org/small-3b'])
    const possible = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, compat: 'possible' }, hw)
    expect(possible.map((m) => m.id)).toEqual(['org/mid-27b'])
  })
})

// ── Downloaded filter (registry map, no N+1) ────────────────────────
describe('downloaded filter', () => {
  const filesA = [ggufFile('a-Q4_K_M.gguf', 'Q4_K_M')]
  const filesB = [ggufFile('b-Q4_K_M.gguf', 'Q4_K_M')]
  const env = { installedByRepo: new Map([['org/a', new Set(['a-q4_k_m.gguf'])]]) }

  it('model-level: ANY installed file counts; per-variant stays in detail', () => {
    const a = mkModel({ id: 'org/a', files: filesA })
    const b = mkModel({ id: 'org/b', files: filesB })
    expect(modelIsDownloaded(a, env.installedByRepo)).toBe(true)
    expect(modelIsDownloaded(b, env.installedByRepo)).toBe(false)
    expect(matchesDownloadedFilter(a, env.installedByRepo, 'downloaded')).toBe(true)
    expect(matchesDownloadedFilter(b, env.installedByRepo, 'downloaded')).toBe(false)
    expect(matchesDownloadedFilter(b, env.installedByRepo, 'available')).toBe(true)
    // Unverifiable registry → hide nothing
    expect(matchesDownloadedFilter(b, undefined, 'downloaded')).toBe(true)
    expect(matchesDownloadedFilter(b, undefined, 'available')).toBe(true)
  })

  it('flows through listing', async () => {
    stubList([hfRow('org/a'), hfRow('org/b')])
    const dl = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, downloaded: 'downloaded' }, hw, env)
    expect(dl.map((m) => m.id)).toEqual(['org/a'])
    const avail = await listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, downloaded: 'available' }, hw, env)
    expect(avail.map((m) => m.id)).toEqual(['org/b'])
  })
})

// ── Combinations + clearing ─────────────────────────────────────────
describe('filter combinations (AND across categories)', () => {
  beforeEach(() => {
    stubList([
      hfRow('org/hit-8b', {
        tags: ['conversational', '8B'],
        cardData: { license: 'apache-2.0' },
        safetensors: { total: 8e9 },
        siblings: [{ rfilename: 'hit-Q4_K_M.gguf' }, { rfilename: 'hit-Q8_0.gguf' }],
      }),
      hfRow('org/wrong-quant-8b', {
        tags: ['conversational', '8B'],
        cardData: { license: 'apache-2.0' },
        safetensors: { total: 8e9 },
        siblings: [{ rfilename: 'w-Q8_0.gguf' }],
      }),
      hfRow('org/wrong-size-70b', {
        tags: ['conversational'],
        cardData: { license: 'apache-2.0' },
        safetensors: { total: 70e9 },
        siblings: [{ rfilename: 'w-Q4_K_M.gguf' }],
      }),
    ])
  })

  function combo(over: Partial<ExplorerListOpts>): Promise<ExploreModel[]> {
    return listExplorerModels({ query: 'q', sortBy: 'downloads', limit: 30, ...over }, hw)
  }

  it('GGUF + Q4_K_M', async () => {
    const models = await combo({ format: 'gguf', quants: ['Q4_K_M'] })
    expect(models.map((m) => m.id).sort()).toEqual(['org/hit-8b', 'org/wrong-size-70b'])
  })

  it('GGUF + Q4_K_M + 7B–14B', async () => {
    const models = await combo({ format: 'gguf', quants: ['Q4_K_M'], params: 'b7to14' })
    expect(models.map((m) => m.id)).toEqual(['org/hit-8b'])
  })

  it('GGUF + Q4_K_M + 7B–14B + likely', async () => {
    const models = await combo({ format: 'gguf', quants: ['Q4_K_M'], params: 'b7to14', compat: 'likely' })
    expect(models.map((m) => m.id)).toEqual(['org/hit-8b'])
  })

  it('adding unlikely instead yields only the too-large row', async () => {
    const models = await combo({ format: 'gguf', quants: ['Q4_K_M'], compat: 'unlikely' })
    expect(models.map((m) => m.id)).toEqual(['org/wrong-size-70b'])
  })

  it('clearing every filter returns the full set', async () => {
    const models = await combo({})
    expect(models.length).toBe(3)
  })
})

// ── Recommendation scoring ──────────────────────────────────────────
describe('recommendation scoring (available signals only)', () => {
  const base = { parameters: '7B', capabilities: ['Text'] as string[] }
  it('gated penalty sorts equal models below open ones', () => {
    const open = mkModel({ ...base, id: 'org/open', downloads: 100, likes: 10, files: [ggufFile('o.gguf', 'Q4_K_M')] })
    const gated = mkModel({ ...base, id: 'org/gated', downloads: 100, likes: 10, gated: true, files: [ggufFile('g.gguf', 'Q4_K_M')] })
    expect(scoreExplorerModel(open, hw).score).toBeGreaterThan(scoreExplorerModel(gated, hw).score)
  })

  it('requested-capability matches raise the score', () => {
    // Fixed timestamps: recency must not jitter the tie-break assertion.
    const stamp = { updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }
    const plain = mkModel({ ...base, ...stamp, id: 'org/plain', downloads: 100, likes: 10, files: [ggufFile('o.gguf', 'Q4_K_M')] })
    const vision = mkModel({ ...base, ...stamp, id: 'org/vis', downloads: 100, likes: 10, capabilities: ['Vision', 'Text'], files: [ggufFile('v.gguf', 'Q4_K_M')] })
    expect(scoreExplorerModel(vision, hw, { capabilities: ['Vision'] }).score)
      .toBeGreaterThan(scoreExplorerModel(plain, hw, { capabilities: ['Vision'] }).score)
    // ...and never invents quality: with no requested caps the only gap is the
    // vision projector's 0.9 GB inside the fit estimate (size term, bounded).
    expect(Math.abs(scoreExplorerModel(vision, hw).score - scoreExplorerModel(plain, hw).score)).toBeLessThan(0.05)
  })

  it('Recommended respects the capability filter end to end', async () => {
    stubList([
      hfRow('org/vis-7b', { pipeline_tag: 'image-text-to-text', tags: ['conversational', '7B'], safetensors: { total: 7e9 } }),
      hfRow('org/plain-7b', { tags: ['conversational', '7B'], safetensors: { total: 7e9 } }),
    ])
    const models = await listExplorerModels({ query: '', sortBy: 'Recommended', limit: 10, capabilities: ['Vision'] }, hw)
    expect(models.length).toBe(1)
    expect(models[0].id).toBe('org/vis-7b')
  })
})

// ── Pagination: cursor + merge without dupes ────────────────────────
describe('cursor pagination', () => {
  it('parses the next cursor from the Link header', () => {
    expect(parseNextCursor(null)).toBeNull()
    expect(parseNextCursor('<https://huggingface.co/api/models?cursor=abc123>; rel="next"')).toBe('abc123')
    expect(parseNextCursor('<https://huggingface.co/api/models?x=1>; rel="prev"')).toBeNull()
    expect(parseNextCursor('garbage')).toBeNull()
  })

  it('page 1 + page 2 merge without duplicates', async () => {
    const p1 = [hfRow('org/a'), hfRow('org/b')]
    const p2 = [hfRow('org/b'), hfRow('org/c')]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('cursor=page2')) return Response.json(p2)
      if (typeof url === 'string' && url.startsWith('https://huggingface.co/api/models?')) {
        return Response.json(p1, { headers: { link: '<https://huggingface.co/api/models?cursor=page2>; rel="next"' } })
      }
      return new Response('not found', { status: 404 })
    }))
    const first = await listExplorerModelsPage({ query: 'q', sortBy: 'downloads', limit: 30 }, hw)
    expect(first.models.map((m) => m.id)).toEqual(['org/a', 'org/b'])
    expect(first.nextCursor).toBe('page2')
    const second = await listExplorerModelsPage({ query: 'q', sortBy: 'downloads', limit: 30, cursor: first.nextCursor ?? undefined }, hw)
    expect(second.models.map((m) => m.id)).toEqual(['org/b', 'org/c'])
    expect(second.nextCursor).toBeNull()
    const merged = mergeExplorerPages(first.models, second.models)
    expect(merged.map((m) => m.id)).toEqual(['org/a', 'org/b', 'org/c'])
    // Cursor is actually sent back to HF
    const urls = (vi.mocked(fetch).mock.calls as unknown[][]).map((a) => String(a[0]))
    expect(urls.some((u) => u.includes('cursor=page2'))).toBe(true)
  })
})

// ── Cache, dedup, TTL ───────────────────────────────────────────────
describe('list cache + in-flight dedup', () => {
  it('repeat visits cost zero fetches; concurrent twins cost one', async () => {
    stubList([hfRow('org/a')])
    const opts = { query: 'q', sortBy: 'downloads', limit: 30 }
    await listExplorerModels(opts, hw)
    await listExplorerModels(opts, hw)
    const calls = (vi.mocked(fetch).mock.calls as unknown[][]).filter((a) => String(a[0]).startsWith('https://huggingface.co/api/models?'))
    expect(calls).toHaveLength(1)
    clearExplorerModelCache()
    vi.mocked(fetch).mockClear()
    await Promise.all([listExplorerModels(opts, hw), listExplorerModels(opts, hw)])
    const calls2 = (vi.mocked(fetch).mock.calls as unknown[][]).filter((a) => String(a[0]).startsWith('https://huggingface.co/api/models?'))
    expect(calls2).toHaveLength(1)
  })

  it('entries expire after the TTL', async () => {
    stubList([hfRow('org/a')])
    const nowSpy = vi.spyOn(Date, 'now')
    let now = 1_000_000
    nowSpy.mockImplementation(() => now)
    try {
      const opts = { query: 'q', sortBy: 'downloads', limit: 30 }
      await listExplorerModels(opts, hw)
      await listExplorerModels(opts, hw)
      const count = (): number => (vi.mocked(fetch).mock.calls as unknown[][])
        .filter((a) => String(a[0]).startsWith('https://huggingface.co/api/models?')).length
      expect(count()).toBe(1)
      now += 120_001
      await listExplorerModels(opts, hw)
      expect(count()).toBe(2)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('downloaded-filtered listings bypass the cache (install state moves)', async () => {
    stubList([hfRow('org/a')])
    const opts = { query: 'q', sortBy: 'downloads', limit: 30, downloaded: 'available' as const }
    const env = { installedByRepo: new Map<string, Set<string>>() }
    await listExplorerModels(opts, hw, env)
    await listExplorerModels(opts, hw, env)
    const calls = (vi.mocked(fetch).mock.calls as unknown[][]).filter((a) => String(a[0]).startsWith('https://huggingface.co/api/models?'))
    expect(calls).toHaveLength(2)
  })
})

// ── Measured request budget (mocked transport; counts, not wall-clock) ──
describe('request budget (measured)', () => {
  const sweeps = (): number => (vi.mocked(fetch).mock.calls as unknown[][])
    .filter((a) => String(a[0]).startsWith('https://huggingface.co/api/models?')).length

  it('initial Recommended load costs one sweep; repeat costs zero', async () => {
    stubList([hfRow('org/small-3b', { safetensors: { total: 3e9 } })])
    await listExplorerModels({ query: '', sortBy: 'Recommended', limit: 30 }, hw)
    expect(sweeps()).toBe(1)
    await listExplorerModels({ query: '', sortBy: 'Recommended', limit: 30 }, hw)
    expect(sweeps()).toBe(1)
  })

  it('empty trending costs one sweep (previously three parallel sweeps)', async () => {
    stubList([hfRow('org/a')])
    await listExplorerModels({ query: '', sortBy: 'trending', limit: 30 }, hw)
    expect(sweeps()).toBe(1)
  })

  it('hardware profile read is cached (reference-equal within TTL)', async () => {
    const { getCachedHardwareProfile } = await import('../src/main/services/explorerCatalog')
    clearExplorerModelCache()
    const a = getCachedHardwareProfile()
    expect(getCachedHardwareProfile()).toBe(a)
    expect(a.totalRamMB).toBeGreaterThan(0)
  })

  it('detail repeat opens cost zero row/HEAD fetches (pre-existing model cache)', async () => {
    const { getExplorerModel } = await import('../src/main/services/explorerCatalog')
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
      if (url === 'https://huggingface.co/api/models/o/m') {
        return Response.json(hfRow('o/m', { siblings: [{ rfilename: 'm-Q4_K_M.gguf' }] }))
      }
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': String(4 * 1024 ** 3) } })
      }
      return new Response('not found', { status: 404 })
    }))
    const calls = (): number => (vi.mocked(fetch).mock.calls as unknown[][]).length
    await getExplorerModel('o/m')
    const afterFirst = calls()
    expect(afterFirst).toBeGreaterThan(0)
    await getExplorerModel('o/m')
    expect(calls()).toBe(afterFirst)
  })
})

// ── Created sort + schema ───────────────────────────────────────────
describe('created sort + payload validation', () => {
  it('sorts the page by creation date, newest first', async () => {
    stubList([
      hfRow('org/old', { createdAt: '2024-01-01T00:00:00.000Z' }),
      hfRow('org/new', { createdAt: '2026-06-01T00:00:00.000Z' }),
    ])
    const models = await listExplorerModels({ query: 'q', sortBy: 'created', limit: 30 }, hw)
    expect(models.map((m) => m.id)).toEqual(['org/new', 'org/old'])
    expect(models[0].createdAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('matchesAllFilters is a pure AND across categories', () => {
    const m = mkModel({
      id: 'org/a',
      parameters: '8B',
      capabilities: ['Vision', 'Text'],
      license: 'apache-2.0',
      gated: false,
      format: 'gguf',
      files: [ggufFile('a-Q4_K_M.gguf', 'Q4_K_M')],
    })
    const base = { format: 'gguf' as const }
    expect(matchesAllFilters(m, base, {})).toBe(true)
    expect(matchesAllFilters(m, { ...base, quants: ['Q8_0'] }, {})).toBe(false)
    expect(matchesAllFilters(m, { ...base, params: 'b32to70' }, {})).toBe(false)
    expect(matchesAllFilters(m, { ...base, licenses: ['MIT'] }, {})).toBe(false)
    expect(matchesAllFilters(m, { ...base, capabilities: ['Code'] }, {})).toBe(false)
    expect(matchesAllFilters(m, { ...base, gated: 'gated' }, {})).toBe(false)
    expect(matchesAllFilters(m, { ...base, compat: 'unlikely' }, { hw })).toBe(false)
    expect(matchesAllFilters(m, { ...base, compat: 'likely' }, { hw })).toBe(true)
  })
})
