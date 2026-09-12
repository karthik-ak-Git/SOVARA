import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getExplorerModel, clearExplorerModelCache } from '../src/main/services/explorerCatalog'

const ROW = {
  id: 'o/m',
  author: 'o',
  likes: 11,
  downloads: 22,
  tags: ['conversational'],
  pipeline_tag: 'text-generation',
  createdAt: '2026-01-01T00:00:00.000Z',
  lastModified: '2026-02-01T00:00:00.000Z',
  cardData: {},
  siblings: [{ rfilename: 'm-Q4_K_M.gguf' }, { rfilename: 'README.md' }],
}

let calls = 0

function stubFetch(): void {
  calls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    calls++
    if (url === 'https://huggingface.co/api/models/o/m') {
      return Response.json(ROW)
    }
    if (init?.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-length': String(4 * 1024 ** 3) } })
    }
    return new Response('not found', { status: 404 })
  }))
}

beforeEach(() => {
  clearExplorerModelCache()
  stubFetch()
})

describe('explorer detail caching', () => {
  it('builds once: repeat opens cost zero fetches, GGUF only', async () => {
    const first = await getExplorerModel('o/m')
    expect(first.files.map((f) => f.rfilename)).toEqual(['m-Q4_K_M.gguf'])
    const afterFirst = calls
    expect(afterFirst).toBeGreaterThan(0)
    const second = await getExplorerModel('o/m')
    expect(second).toEqual(first)
    expect(calls).toBe(afterFirst)
  })

  it('coalesces concurrent requests into a single build', async () => {
    const [a, b, c] = await Promise.all([getExplorerModel('o/m'), getExplorerModel('o/m'), getExplorerModel('o/m')])
    expect(a).toEqual(b)
    expect(b).toEqual(c)
    const rowCalls = (vi.mocked(fetch).mock.calls as unknown[][]).filter((args) => args[0] === 'https://huggingface.co/api/models/o/m')
    expect(rowCalls).toHaveLength(1)
  })
})
