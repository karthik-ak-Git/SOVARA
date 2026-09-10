import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanReadme, sortModels, filterModels } from '../src/main/services/hfCatalog'
import {
  cancelDownload,
  confinePath,
  defaultLibraryDir,
  deleteLibraryEntry,
  repoFolder,
  scanLibrary,
} from '../src/main/services/modelDownloads'
import type { ExploreModel } from '../src/shared/types/explore'

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
    createdAt: new Date().toISOString(),
    parameters: 'Unknown',
    architecture: 'transformers',
    capabilities: [],
    files: [],
    tags: [],
    iconType: 'hf',
    ...over,
  }
}

describe('hfCatalog pure helpers', () => {
  it('cleanReadme strips frontmatter and truncates', () => {
    const raw = '---\nlicense: apache-2.0\n---\n\n# Title\n\nBody text.'
    expect(cleanReadme(raw)).toBe('# Title\n\nBody text.')
    expect(cleanReadme('no frontmatter')).toBe('no frontmatter')
    const long = `---\na: b\n---\n${'x'.repeat(7000)}`
    const cleaned = cleanReadme(long, 100)
    expect(cleaned.length).toBeLessThan(7000)
    expect(cleaned).toContain('truncated')
  })

  it('sortModels orders likes/downloads/recency', () => {
    const a = mkModel({ id: 'a', likes: 1, downloads: 100, updatedAt: '2024-01-01T00:00:00Z' })
    const b = mkModel({ id: 'b', likes: 9, downloads: 10, updatedAt: '2026-01-01T00:00:00Z' })
    expect(sortModels([a, b], 'likes').map((m) => m.id)).toEqual(['b', 'a'])
    expect(sortModels([a, b], 'downloads').map((m) => m.id)).toEqual(['a', 'b'])
    expect(sortModels([a, b], 'lastModified').map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('filterModels matches name/author/description/tags', () => {
    const m = mkModel({ id: 'Qwen/Qwen3', name: 'Qwen3', author: 'Qwen', description: 'chat model', tags: ['gguf'] })
    expect(filterModels([m], 'qwen')).toHaveLength(1)
    expect(filterModels([m], 'GGUF')).toHaveLength(1)
    expect(filterModels([m], 'nope')).toHaveLength(0)
    expect(filterModels([m], '')).toHaveLength(1)
  })
})

describe('modelDownloads filesystem helpers', () => {
  it('repoFolder flattens the repo id', () => {
    expect(repoFolder('Qwen/Qwen3-4B-GGUF')).toBe('Qwen__Qwen3-4B-GGUF')
  })

  it('defaultLibraryDir lives under userData', () => {
    expect(defaultLibraryDir('C:\\Users\\x\\AppData')).toBe(path.join('C:\\Users\\x\\AppData', 'models'))
  })

  it('confinePath blocks escape', () => {
    const root = path.join(os.tmpdir(), 'sovara-confine')
    expect(confinePath(root, 'a__b', 'f.gguf')).toBe(path.join(root, 'a__b', 'f.gguf'))
    expect(() => confinePath(root, '..', 'evil')).toThrowError(/escapes/)
    expect(() => confinePath(root, '..\\..\\evil')).toThrowError(/escapes/)
  })

  it('scanLibrary finds weight files with sizes, newest first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-lib-'))
    try {
      const repo = path.join(dir, 'Qwen__Qwen3')
      fs.mkdirSync(repo, { recursive: true })
      fs.writeFileSync(path.join(repo, 'a.gguf'), Buffer.alloc(10))
      fs.writeFileSync(path.join(repo, 'notes.txt'), 'nope')
      const found = scanLibrary(dir)
      expect(found).toHaveLength(1)
      expect(found[0]).toMatchObject({ name: 'Qwen__Qwen3', file: 'a.gguf', sizeBytes: 10 })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('scanLibrary on a missing dir returns empty', () => {
    expect(scanLibrary(path.join(os.tmpdir(), 'sovara-nope-xyz'))).toEqual([])
  })

  it('deleteLibraryEntry removes the file and prunes the empty folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-del-'))
    try {
      const repo = path.join(dir, 'Org__M')
      fs.mkdirSync(repo, { recursive: true })
      const file = path.join(repo, 'm.gguf')
      fs.writeFileSync(file, Buffer.alloc(5))
      deleteLibraryEntry(dir, file)
      expect(fs.existsSync(file)).toBe(false)
      expect(fs.existsSync(repo)).toBe(false)
      expect(() => deleteLibraryEntry(dir, path.join(dir, '..', 'evil.gguf'))).toThrowError(/escapes/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cancelDownload returns false when nothing is active', () => {
    expect(cancelDownload('nope', 'nope.gguf')).toBe(false)
  })
})
