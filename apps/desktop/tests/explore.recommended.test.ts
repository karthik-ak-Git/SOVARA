import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listExplorerModels } from '../src/main/services/explorerCatalog'
import type { HardwareInfo } from '../src/shared/types/explore'

// 12 GB VRAM / 32 GB RAM machine.
const hw: HardwareInfo = {
  totalRamMB: 32 * 1024,
  freeRamMB: 24 * 1024,
  totalVramMB: 12 * 1024,
  freeVramMB: 10 * 1024,
  gpuAvailable: true,
}

function row(id: string, total: number | undefined, downloads: number): Record<string, unknown> {
  return {
    id,
    author: id.split('/')[0],
    likes: 1,
    downloads,
    tags: ['conversational'],
    pipeline_tag: 'text-generation',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastModified: '2026-02-01T00:00:00.000Z',
    cardData: {},
    ...(typeof total === 'number' ? { safetensors: { total } } : {}),
    siblings: [],
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (typeof url === 'string' && url.startsWith('https://huggingface.co/api/models?')) {
      return Response.json([
        row('org/huge-70b', 70e9, 99999), // too large for this machine despite downloads
        row('org/mid-27b', 27e9, 50000), // partial fit
        row('org/small-3b', 3e9, 1000), // full fit
        row('org/mystery', undefined, 77777), // params unverifiable → excluded
      ])
    }
    return new Response('not found', { status: 404 })
  }))
})

describe('hardware-aware Recommended (no hardcoded picks)', () => {
  it('shows full fits first, then partial, drops too-large and unverifiable', async () => {
    const models = await listExplorerModels({ query: '', sortBy: 'Recommended', limit: 10 }, hw)
    expect(models.map((m) => m.id)).toEqual(['org/small-3b', 'org/mid-27b'])
  })

  it('a smaller machine gets a smaller list, still honest', async () => {
    const tiny: HardwareInfo = { totalRamMB: 8 * 1024, freeRamMB: 6 * 1024, gpuAvailable: false }
    const models = await listExplorerModels({ query: '', sortBy: 'Recommended', limit: 10 }, tiny)
    expect(models.map((m) => m.id)).toEqual(['org/small-3b'])
  })
})
