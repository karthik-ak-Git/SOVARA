import { describe, it, expect, beforeEach } from 'vitest'
import {
  validateAgentInput,
  transitionLifecycle,
  AgentRegistry,
  startAgentKnowledgeDownload,
  pauseAgentDownload,
  resumeAgentDownload,
  cancelAgentDownload,
  listAgentDownloads,
  getAgentRecommendations,
  getBestRecommendationIndex,
} from '../src/main/services/agentStudio'
import { RuntimeConfigStore } from '../src/main/config/RuntimeConfigStore'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExploreModel, HardwareInfo } from '../src/shared/types/explore'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-as-'))
}
function mkModel(files: ExploreModel['files']): ExploreModel {
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
    createdAt: new Date().toISOString(),
    parameters: 'Unknown',
    architecture: 'transformers',
    capabilities: [],
    files,
    tags: [],
    iconType: 'hf',
  }
}

// ── Agent lifecycle validation ───────────────────────────────────────

describe('Agent Studio — lifecycle validation', () => {
  it('validates handle/name/description', () => {
    expect(validateAgentInput({ handle: 'ab', name: 'Valid Agent' })).toMatch(/handle must/)
    expect(validateAgentInput({ handle: 'ok-handle', name: 'A' })).toMatch(/name must/)
    expect(validateAgentInput({ handle: 'ok-handle', name: 'Agent', description: 'x'.repeat(501) })).toMatch(/description too long/)
    expect(validateAgentInput({ handle: 'ok-handle', name: 'My Agent', lifecycle: 'bogus' })).toMatch(/invalid lifecycle/)
    expect(validateAgentInput({ handle: 'my-agent-1', name: 'My Agent', lifecycle: 'draft' })).toBeNull()
  })

  it('enforces sequential lifecycle transitions', () => {
    expect(transitionLifecycle('draft', 'build')).toEqual({ ok: true })
    expect(transitionLifecycle('build', 'active')).toEqual({ ok: true })
    expect(transitionLifecycle('active', 'published')).toEqual({ ok: true })
    expect(transitionLifecycle('draft', 'active')).toEqual(expect.objectContaining({ ok: false }))
    expect(transitionLifecycle('published', 'draft')).toEqual(expect.objectContaining({ ok: false }))
    expect(transitionLifecycle('active', 'build')).toEqual(expect.objectContaining({ ok: false }))
    expect(transitionLifecycle('draft', 'draft')).toEqual({ ok: true })
  })
})

describe('Agent Studio — AgentRegistry', () => {
  let reg: AgentRegistry
  beforeEach(() => {
    reg = new AgentRegistry()
  })

  it('creates, lists, gets, updates, removes', () => {
    const a = reg.create({ id: 'ag_1', handle: 'my-agent', name: 'My Agent', description: 'desc', lifecycle: 'draft', model: 'Qwen3 8B', createdAt: 0, updatedAt: 0 })
    expect(a.handle).toBe('my-agent')
    expect(reg.list()).toHaveLength(1)
    expect(reg.get('ag_1')?.name).toBe('My Agent')

    const updated = reg.update('ag_1', { lifecycle: 'build' })
    expect(updated.lifecycle).toBe('build')

    expect(() => reg.update('ag_1', { lifecycle: 'published' })).toThrow(/sequentially/)
    expect(() => reg.create({ id: 'ag_1', handle: 'dup-handle', name: 'Dup', description: '', lifecycle: 'draft', model: '', createdAt: 0, updatedAt: 0 })).toThrow(/already exists/)
    expect(() => reg.create({ id: 'ag_2', handle: 'bad handle!', name: 'Valid Name', description: '', lifecycle: 'draft', model: '', createdAt: 0, updatedAt: 0 })).toThrow(/handle must/)

    expect(reg.remove('ag_1')).toBe(true)
    expect(reg.get('ag_1')).toBeNull()
    expect(reg.list()).toHaveLength(0)
  })

  it('rejects invalid input on create', () => {
    expect(() => reg.create({ id: 'x', handle: 'ok', name: '', description: '', lifecycle: 'draft', model: '', createdAt: 0, updatedAt: 0 })).toThrow(/name must/)
  })
})

// ── Resumable downloads facade ───────────────────────────────────────

describe('Agent Studio — resumable knowledge downloads (facade)', () => {
  it('start validates agent download target', () => {
    const dir = mkTmp()
    const store = new RuntimeConfigStore(dir)
    const bad = { agentId: '', modelId: 'org/m', rfilename: 'a.gguf', downloadUrl: 'https://huggingface.co/org/m/resolve/main/a.gguf' }
    expect(() => startAgentKnowledgeDownload(store, dir, bad as never, () => {})).toThrow(/invalid knowledge/)
    try { store.close() } catch { /* ignore */ }
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* windows lock race */ }
  })

  it('pause/cancel/list delegate to modelDownloads and return false when idle', () => {
    expect(pauseAgentDownload('nope', 'nope.gguf')).toBe(false)
    expect(cancelAgentDownload('nope', 'nope.gguf')).toBe(false)
    // list should be an array (empty when idle)
    const list = listAgentDownloads()
    expect(Array.isArray(list)).toBe(true)
  })

  it('resume returns boolean when not paused/queued', () => {
    const dir = mkTmp()
    const store = new RuntimeConfigStore(dir)
    const dl = { agentId: 'ag_1', modelId: 'org/m', rfilename: 'a.gguf', downloadUrl: 'https://huggingface.co/org/m/resolve/main/a.gguf' }
    const ok = resumeAgentDownload(store, dir, dl, () => {})
    expect(typeof ok).toBe('boolean')
    // Cleanup any queued/active that may have been created (defer rm to next tick to avoid EPERM on Windows)
    cancelAgentDownload('org/m', 'a.gguf')
    setTimeout(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore racing part file */ }
    }, 50)
  })
})

// ── System-aware recommendations ─────────────────────────────────────

describe('Agent Studio — system-aware recommendations', () => {
  const hw: HardwareInfo = {
    totalRamMB: 32 * 1024,
    freeRamMB: 24 * 1024,
    totalVramMB: 8 * 1024,
    freeVramMB: 8 * 1024,
    gpuAvailable: true,
  }

  it('recommends best file that fits', () => {
    const model = mkModel([
      { format: 'GGUF', quantization: 'Q4_K_M', sizeGB: 4.9, sizeBytes: 4.9 * 1024 ** 3, downloadUrl: 'https://huggingface.co/org/m/resolve/main/a.gguf', rfilename: 'a.gguf' },
      { format: 'GGUF', quantization: 'Q8_0', sizeGB: 8.5, sizeBytes: 8.5 * 1024 ** 3, downloadUrl: 'https://huggingface.co/org/m/resolve/main/b.gguf', rfilename: 'b.gguf' },
      { format: 'GGUF', quantization: 'Q2_K', sizeGB: 2.1, sizeBytes: 2.1 * 1024 ** 3, downloadUrl: 'https://huggingface.co/org/m/resolve/main/c.gguf', rfilename: 'c.gguf' },
    ])
    const { recommendations, compatibility } = getAgentRecommendations(model, hw)
    expect(recommendations).toHaveLength(3)
    // Best (rank 0) should be good and fit
    expect(recommendations[0].severity).toBe('good')
    expect(compatibility.severity).toBe('good')
  })

  it('getBestRecommendationIndex returns null for empty', () => {
    const empty = mkModel([])
    expect(getBestRecommendationIndex(empty, hw)).toBeNull()
  })

  it('getBestRecommendationIndex picks best good over tight', () => {
    const model = mkModel([
      { format: 'GGUF', quantization: 'Q4_K_M', sizeGB: 4.9, sizeBytes: 4.9 * 1024 ** 3, downloadUrl: 'https://huggingface.co/org/m/resolve/main/a.gguf', rfilename: 'a.gguf' },
      { format: 'GGUF', quantization: 'Q8_0', sizeGB: 30, sizeBytes: 30 * 1024 ** 3, downloadUrl: 'https://huggingface.co/org/m/resolve/main/big.gguf', rfilename: 'big.gguf' },
    ])
    const idx = getBestRecommendationIndex(model, hw)
    expect(idx).toBe(0)
  })
})
