import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listExplorerModels, usageScore } from '../src/main/services/explorerCatalog'

function row(id: string, downloads: number, likes: number, trendingScore: number): Record<string, unknown> {
  return {
    id,
    author: id.split('/')[0],
    likes,
    downloads,
    trendingScore,
    tags: ['conversational'],
    pipeline_tag: 'text-generation',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-02-01T00:00:00.000Z',
    cardData: {},
    siblings: [],
  }
}

const WORKHORSE = row('org/workhorse-8b', 1000000, 100, 5)
const FLASH = row('org/flash-8b', 1000, 5000, 900)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('https://huggingface.co/api/models?')) {
      // Every sweep returns the same two rows; rank must come from blending.
      return Response.json([FLASH, WORKHORSE])
    }
    return new Response('not found', { status: 404 })
  }))
})

describe('trending = what developers actually use', () => {
  it('scores downloads heaviest, likes next, momentum last', () => {
    expect(usageScore(1000000, 100, 5)).toBeGreaterThan(usageScore(1000, 5000, 900))
    expect(usageScore(0, 0, 0)).toBe(0)
  })

  it('ranks the million-download workhorse above the flash newcomer', async () => {
    const models = await listExplorerModels({ query: '', sortBy: 'trending', limit: 10 })
    expect(models.map((m) => m.id)).toEqual(['org/workhorse-8b', 'org/flash-8b'])
  })

  it('dedupes across the three sweeps', async () => {
    const models = await listExplorerModels({ query: '', sortBy: 'trending', limit: 10 })
    expect(new Set(models.map((m) => m.id)).size).toBe(models.length)
  })
})
