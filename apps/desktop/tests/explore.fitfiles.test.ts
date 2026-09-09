import { describe, it, expect } from 'vitest'
import { estimateExplorerFit, fitExplorerFiles } from '../src/main/services/explorerFit'
import { classifySibling } from '../src/main/services/explorerCatalog'
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
    updatedAt: new Date().toISOString(), parameters: '27B', architecture: 'qwen3',
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
