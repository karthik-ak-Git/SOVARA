import { describe, it, expect } from 'vitest'
import {
  parseLmCount,
  parseLmSizeGB,
  parseLmUpdatedAgo,
  extractLmArtifact,
  parseLmFamilies,
  parseLmFamilyVariants,
  parseLmFamilyMeta,
  parseLmVariant,
  capsFromLm,
  parseExplorerSearch,
} from '../src/main/services/explorerCatalog'

const CARD_HTML = `<a data-model-page-has-cloud="false" data-model-page-has-downloads="true" data-model-page-type="ARTIFACT_COLLECTION" target="_self" rel="noopener noreferrer" class="card" title="" href="/models/qwen3.8"><div class="flex items-center justify-between gap-2"><div class="flex items-center justify-start gap-2"><div class="text-lg font-medium">Qwen3.8</div><div class="flex items-center gap-1"><div class="chip" title="Available to download"><svg></svg><span class="sr-only">Available to download</span></div></div><div class="hidden items-center gap-1 sm:flex"><div class="size" title="Model size: 27B parameters">27B</div></div></div><div class="flex items-center gap-2"><div class="cursor-help" style="border-color:rgb(var(--lm-yellow));color:rgb(var(--lm-yellow))"><svg></svg></div><div class="cursor-help" style="border-color:rgb(var(--lm-blue));color:rgb(var(--lm-blue))"><svg></svg></div></div></div><div class="desc text-[15px]">Qwen3.8-27B is a dense 27B vision-language model for coding work.</div></div><div class="flex flex-row items-center justify-between text-[14px] opacity-70"><div><div><svg></svg><span class="font-medium" data-model-page-downloads="1161714">1.2M</span></div><div><svg><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg><span class="font-medium">102</span></div></div></div><div class="opacity-70">Updated <!-- -->25 days ago</div></div></a>`
  + `<a data-model-page-has-cloud="true" data-model-page-has-downloads="false" data-model-page-type="ARTIFACT_COLLECTION" class="card" title="" href="/models/glm-5.3"><div><div class="text-lg font-medium">GLM-5.3</div></div><div class="opacity-70">Updated <!-- -->11 days ago</div></div></a>`

const FAMILY_HTML = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"CreativeWork","name":"Qwen3.8","description":"Dense 27B vision-language model.","url":"https://lmstudio.ai/models/qwen3.8"}</script>`
  + `<div><svg></svg><a target="_self" class="v" title="" href="/models/qwen/qwen3.8-27b">qwen/qwen3.8-27b</a></div><div class="w-full text-right text-[13px] tabular-nums opacity-50 dark:opacity-70" data-state="closed">16.10 GB</div><div class="flex justify-start" data-model-page-stars="102"><button>star</button></div>`
  + `<p>See the <a href="https://huggingface.co/Qwen/Qwen3.8-27B">official Qwen3.8-27B model card</a></p>`

const VARIANT_HTML = `self.__next_f.push([1,"...\\n...\\"artifact\\":{\\"identifier\\":\\"qwen/qwen3.8-27b\\",\\"owner\\":\\"qwen\\",\\"name\\":\\"qwen3.8-27b\\",\\"description\\":\\"State-of-the-art laptop size model\\",\\"createdAt\\":\\"2026-08-14T15:17:52.103Z\\",\\"updatedAt\\":\\"2026-08-17T18:05:00.192Z\\",\\"likeCount\\":102,\\"downloadCount\\":1161714,\\"current\\":{\\"revisionNumber\\":4}}\\n..."])`
  + `<div>metadataOverrides:\\n domain: llm\\n architectures:\\n - qwen35\\n compatibilityTypes:\\n - gguf\\n - safetensors\\n paramsStrings:\\n - 27B\\n minMemoryUsageBytes: 16100000000\\n contextLengths:\\n - 262144\\n vision: true\\n reasoning: true\\n trainedForToolUse: true\\nconfig:</div>`
  + `<a href="https://huggingface.co/lmstudio-community/Qwen3.8-27B-GGUF" target="_blank">lmstudio-community/Qwen3.8-27B-GGUF</a><span>→</span></div><p class="pill">GGUF</p>`
  + `<a href="https://huggingface.co/lmstudio-community/Qwen3.8-27B-MLX-4bit">x</a><span>→</span></div><p class="pill">MLX</p>`

describe('lm number/date parsers', () => {
  it('parses abbreviated counts', () => {
    expect(parseLmCount('1.2M')).toBe(1200000)
    expect(parseLmCount('102')).toBe(102)
    expect(parseLmCount('3.4K')).toBe(3400)
    expect(parseLmCount('')).toBe(0)
  })
  it('parses sizes to GB', () => {
    expect(parseLmSizeGB('16.10 GB')).toBeCloseTo(16.1)
    expect(parseLmSizeGB('850 MB')).toBeCloseTo(850 / 1024)
    expect(parseLmSizeGB('nope')).toBe(0)
  })
  it('parses relative dates to ISO', () => {
    const iso = parseLmUpdatedAgo('25 days ago')
    expect(new Date(iso).getTime()).toBeLessThan(Date.now())
    expect(new Date(iso).getTime()).toBeGreaterThan(Date.now() - 26 * 86400e3)
    expect(parseLmUpdatedAgo('garbage')).not.toBe('')
  })
})

describe('lm list/family parsers', () => {
  it('parses family cards with chips, sizes, counts', () => {
    const fams = parseLmFamilies(CARD_HTML)
    expect(fams).toHaveLength(2)
    const q = fams[0]
    expect(q.slug).toBe('qwen3.8')
    expect(q.name).toBe('Qwen3.8')
    expect(q.downloadable).toBe(true)
    expect(q.sizes).toContain('27B')
    expect(q.downloads).toBe(1161714)
    expect(q.likes).toBe(102)
    expect(q.updatedAgo).toBe('25 days ago')
    expect(q.chips).toEqual(expect.arrayContaining(['lm-yellow', 'lm-blue']))
    expect(fams[1].downloadable).toBe(false)
  })
  it('parses variant rows with sizes and stars', () => {
    const rows = parseLmFamilyVariants(FAMILY_HTML)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('qwen/qwen3.8-27b')
    expect(rows[0].sizeGB).toBeCloseTo(16.1)
    expect(rows[0].stars).toBe(102)
  })
  it('parses family meta description + base repo', () => {
    const meta = parseLmFamilyMeta(FAMILY_HTML)
    expect(meta.description).toContain('Dense 27B')
    expect(meta.baseRepo).toBe('Qwen/Qwen3.8-27B')
  })
})

describe('lm variant parser', () => {
  it('extracts artifact JSON escape-aware', () => {
    const art = extractLmArtifact(VARIANT_HTML)
    expect(art?.identifier).toBe('qwen/qwen3.8-27b')
    expect(art?.downloadCount).toBe(1161714)
  })
  it('parses config booleans, params, arch, formats, memory, context, sources', () => {
    const v = parseLmVariant(VARIANT_HTML)
    expect(v?.config.vision).toBe(true)
    expect(v?.config.reasoning).toBe(true)
    expect(v?.config.toolUse).toBe(true)
    expect(v?.config.params).toEqual(['27B'])
    expect(v?.config.arch).toEqual(['qwen35'])
    expect(v?.config.formats).toEqual(expect.arrayContaining(['gguf']))
    expect(v?.config.minMemoryBytes).toBe(16100000000)
    expect(v?.config.contextLengths).toEqual([262144])
    const gguf = v?.config.sources.find((s) => s.format === 'GGUF')
    expect(gguf?.repo).toBe('lmstudio-community/Qwen3.8-27B-GGUF')
  })
})

describe('lm capabilities + search', () => {
  it('maps curated booleans to Vision/Tools/Thinking with Text baseline', () => {
    expect(capsFromLm({ vision: true, reasoning: true, toolUse: true }, 'qwen/qwen3.8-27b'))
      .toEqual(['Vision', 'Tools', 'Thinking', 'Text'])
  })
  it('adds Code from id knowledge, Text-only when nothing known', () => {
    expect(capsFromLm({ vision: false, reasoning: false, toolUse: false }, 'x/qwen3-coder-30b')).toContain('Code')
    expect(capsFromLm({ vision: false, reasoning: false, toolUse: false }, 'x/plain-7b')).toEqual(['Text'])
  })
  it('parses lmstudio.ai pastes', () => {
    expect(parseExplorerSearch('https://lmstudio.ai/models/qwen/qwen3.8-27b'))
      .toMatchObject({ kind: 'url', modelId: 'qwen/qwen3.8-27b' })
    expect(parseExplorerSearch('https://lmstudio.ai/models/qwen3.8'))
      .toMatchObject({ kind: 'family', slug: 'qwen3.8' })
    expect(parseExplorerSearch('qwen/qwen3.8-27b'))
      .toMatchObject({ kind: 'id', modelId: 'qwen/qwen3.8-27b' })
    expect(parseExplorerSearch('coder 30b')).toMatchObject({ kind: 'keyword' })
    expect(parseExplorerSearch('')).toMatchObject({ kind: 'empty' })
  })
})
