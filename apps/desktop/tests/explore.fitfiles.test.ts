import { describe, it, expect } from 'vitest'
import { estimateExplorerFit, fitExplorerFiles } from '../src/main/services/explorerFit'
import { classifySibling, pickQuantOptions, parseShard, MIN_RUNNABLE_GGUF_BYTES } from '../src/main/services/explorerCatalog'
import type { ExploreModel, ExploreModelFile, HardwareInfo } from '../src/shared/types/explore'

const GB = 1024 ** 3
const hw: HardwareInfo = {
  totalRamMB: 32 * 1024,
  freeRamMB: 24 * 1024,
  totalVramMB: 12 * 1024,
  freeVramMB: 10 * 1024,
  gpuAvailable: true,
}

function file(partial: Partial<ExploreModelFile> & { rfilename: string }): ExploreModelFile {
  return { format: 'GGUF', sizeGB: 0, downloadUrl: `https://huggingface.co/r/repo/resolve/main/${partial.rfilename}`, sizeBytes: 0, ...partial }
}

function model(files: ExploreModelFile[]): ExploreModel {
  return {
    id: 'qwen/qwen3.8-27b', name: 'qwen3.8-27b', slug: 'qwen/qwen3.8-27b', author: 'qwen',
    description: 'd', longDescription: 'd', downloads: 1, likes: 1, staffPick: false,
    updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), parameters: '27B', architecture: 'qwen3',
    capabilities: ['Vision', 'Tools', 'Reasoning'], files, tags: [], iconType: 'qwen',
  }
}

describe('sibling classification (LM Studio file rows)', () => {
  it('separates weights, helpers and informational files', () => {
    expect(classifySibling('Qwen3.8-27B-Q4_K_M.gguf')).toBe('weight')
    expect(classifySibling('qwen3.8-27b-q8_0.gguf')).toBe('weight')
    expect(classifySibling('.gitattributes')).toBe('meta')
    expect(classifySibling('README.md')).toBe('meta')
    expect(classifySibling('x-mmproj.gguf')).toBe('aux')
    expect(classifySibling('imatrix.dat')).toBe('aux')
  })
})

describe('shard detection', () => {
  it('parses part index/total and rejects whole files', () => {
    expect(parseShard('M-Q2_K-00001-of-00002.gguf')).toEqual({ stem: 'M-Q2_K', idx: 1, total: 2 })
    expect(parseShard('M-Q2_K-00002-of-00002.gguf')).toEqual({ stem: 'M-Q2_K', idx: 2, total: 2 })
    expect(parseShard('M-Q4_K_M.gguf')).toBeNull()
    expect(parseShard('README.md')).toBeNull()
  })
})

describe('exact picker (one primary repo, runnable files only)', () => {
  const GB = 1024 ** 3
  const sib = (rfilename: string): { rfilename: string } => ({ rfilename })
  const sizes = (repoId: string, entries: Array<[string, number]>): Map<string, number> =>
    new Map(entries.map(([f, n]) => [`${repoId.toLowerCase()}\n${f.toLowerCase()}`, n]))

  const primary = {
    repoId: 'ggml-org/Big-Vision-GGUF',
    siblings: [
      sib('Big-Vision-Q4_K_M.gguf'),
      sib('Big-Vision-Q2_K-00001-of-00002.gguf'),
      sib('Big-Vision-Q2_K-00002-of-00002.gguf'),
      sib('Big-Vision-Q3_K-00001-of-00003.gguf'), // incomplete set: part 2..3 missing
      sib('tiny-frag.gguf'), // 5 MB fragment, not a model
      sib('mmproj-Big-Vision-Q8_0.gguf'),
      sib('.gitattributes'),
      sib('README.md'),
    ],
  }
  const primarySizes = sizes(primary.repoId, [
    ['Big-Vision-Q4_K_M.gguf', 9 * GB],
    ['Big-Vision-Q2_K-00001-of-00002.gguf', 60 * GB],
    ['Big-Vision-Q2_K-00002-of-00002.gguf', 50 * GB],
    ['Big-Vision-Q3_K-00001-of-00003.gguf', 40 * GB],
    ['tiny-frag.gguf', 5 * 1024 * 1024],
    ['mmproj-Big-Vision-Q8_0.gguf', Math.round(0.5 * GB)],
  ])

  it('groups complete shard sets into one row and drops fragments, parts, meta', () => {
    const rows = pickQuantOptions([primary], { sizes: primarySizes, vision: true })
    const names = rows.map((f) => f.rfilename)
    // single Q4 + one Q2_K set; nothing else survives
    expect(rows).toHaveLength(2)
    expect(rows[0].quantization).toBe('Q4_K_M')
    expect(rows[0].multipart).not.toBe(true)
    const set = rows.find((f) => f.multipart)
    expect(set?.quantization).toBe('Q2_K')
    expect(set?.parts).toHaveLength(2)
    expect(set?.sizeBytes).toBe(110 * GB)
    expect(set?.rfilename).toBe('Big-Vision-Q2_K-00001-of-00002.gguf')
    expect(names.some((n) => n?.includes('00003') || n?.includes('tiny-frag') || n?.toLowerCase() === 'readme.md')).toBe(false)
    // vision projector attached, never listed as its own row
    expect(rows.some((f) => (f.rfilename ?? '').includes('mmproj'))).toBe(false)
    expect(rows[0].companion?.rfilename).toBe('mmproj-Big-Vision-Q8_0.gguf')
  })

  it('keeps the first repo with exact options — no cross-repo mixing', () => {
    const a = { repoId: 'org/a', siblings: [sib('A-Q4_K_M.gguf')] }
    const b = { repoId: 'org/b', siblings: [sib('B-Q6_K.gguf')] }
    const sz = new Map([
      ...sizes('org/a', [['A-Q4_K_M.gguf', 5 * GB]]),
      ...sizes('org/b', [['B-Q6_K.gguf', 6 * GB]]),
    ])
    const rows = pickQuantOptions([a, b], { sizes: sz })
    expect(rows).toHaveLength(1)
    expect(rows[0].rfilename).toBe('A-Q4_K_M.gguf')
  })

  it('skips a repo with no exact options and uses the next one', () => {
    const empty = { repoId: 'org/empty', siblings: [sib('.gitattributes'), sib('README.md')] }
    const full = { repoId: 'org/full', siblings: [sib('F-Q4_K_M.gguf')] }
    const sz = sizes('org/full', [['F-Q4_K_M.gguf', 5 * GB]])
    const rows = pickQuantOptions([empty, full], { sizes: sz })
    expect(rows.map((f) => f.rfilename)).toEqual(['F-Q4_K_M.gguf'])
  })

  it('no projector attached when the model is not vision', () => {
    const rows = pickQuantOptions([primary], { sizes: primarySizes, vision: false })
    expect(rows.every((f) => !f.companion)).toBe(true)
  })

  it('20 MB floor documented and enforced', () => {
    expect(MIN_RUNNABLE_GGUF_BYTES).toBe(20 * 1024 * 1024)
  })
})

describe('per-file fit gating (LM Studio badges)', () => {
  it('marks informational files too-large even with tiny known sizes', () => {
    const m = model([file({ rfilename: '.gitattributes', sizeBytes: 2048, runnable: false })])
    const r = estimateExplorerFit(m.files[0], m, hw)
    expect(r.fit).toBe('willNotFit')
    expect(r.message).toMatch(/not a runnable model weight/i)
  })

  it('marks unknown-size files too-large instead of guessing', () => {
    const m = model([file({ rfilename: 'README.md', sizeBytes: 0, sizeGB: 0, runnable: false })])
    const r = estimateExplorerFit(m.files[0], m, hw)
    expect(r.fit).toBe('willNotFit')
    const w = model([file({ rfilename: 'Model-Q4_K_M.gguf', sizeBytes: 0, sizeGB: 0, runnable: true })])
    const rw = estimateExplorerFit(w.files[0], w, hw)
    expect(rw.fit).toBe('willNotFit')
    expect(rw.message).toMatch(/size unknown/i)
  })

  it('still fits a small runnable weight on the GPU', () => {
    const m = model([file({ rfilename: 'Small-8B-Q4_K_M.gguf', sizeBytes: 5 * GB, runnable: true })])
    const r = estimateExplorerFit({ ...m.files[0] }, { ...m, parameters: '8B', capabilities: ['Text'] }, hw)
    expect(r.fit).toBe('fullGPUOffload')
  })
})

describe('recommendation eligibility', () => {
  it('never recommends informational files and sorts them last', () => {
    const m = model([
      file({ rfilename: '.gitattributes', sizeBytes: 2048, runnable: false }),
      file({ rfilename: 'Model-Q8_0.gguf', sizeBytes: 30 * GB, quantization: 'Q8_0', runnable: true }),
      file({ rfilename: 'Model-Q4_K_M.gguf', sizeBytes: 9 * GB, quantization: 'Q4_K_M', runnable: true }),
      file({ rfilename: 'README.md', sizeBytes: 0, runnable: false }),
    ])
    const rows = fitExplorerFiles(m, hw)
    expect(rows).toHaveLength(4)
    const rec = rows.find((r) => r.isRecommended)
    expect(rec).toBeDefined()
    expect(m.files[rec!.index].rfilename).toContain('Q4_K_M')
    // meta rows sink below weights (LM Studio order: weights, .gitattributes, README)
    const names = rows.map((r) => m.files[r.index].rfilename)
    expect(names.indexOf('.gitattributes')).toBeGreaterThan(names.indexOf('Model-Q8_0.gguf'))
    expect(names.indexOf('README.md')).toBeGreaterThan(names.indexOf('.gitattributes'))
  })

  it('yields no recommendation when only informational files exist', () => {
    const m = model([
      file({ rfilename: '.gitattributes', sizeBytes: 2048, runnable: false }),
      file({ rfilename: 'README.md', sizeBytes: 0, runnable: false }),
    ])
    const rows = fitExplorerFiles(m, hw)
    expect(rows.every((r) => !r.isRecommended)).toBe(true)
    expect(rows.every((r) => r.fit === 'willNotFit')).toBe(true)
  })
})
