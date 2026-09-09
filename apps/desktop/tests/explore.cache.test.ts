import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getExplorerModel, clearExplorerModelCache, clearLmCache } from '../src/main/services/explorerCatalog'

const VARIANT = `n\\"artifact\\":{\\"identifier\\":\\"o/m\\",\\"owner\\":\\"o\\",\\"name\\":\\"m\\",\\"description\\":\\"tiny test model\\",\\"downloadCount\\":5,\\"likeCount\\":1,\\"updatedAt\\":\\"2026-01-01T00:00:00.000Z\\"}n`
  + `paramsStrings:\\n - 7B\\n architectures:\\n - llama\\n compatibilityTypes:\\n - gguf\\n vision: false\\n reasoning: false\\n trainedForToolUse: false\\n`
  + `<a href="https://huggingface.co/o/r">o/r</a><span>x</span><p>GGUF</p>`

let calls = 0

function stubFetch(): void {
  calls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    calls++
    if (url.startsWith('https://lmstudio.ai/models/o/m')) {
      return new Response(VARIANT, { status: 200, headers: { 'content-type': 'text/html' } })
    }
    if (url === 'https://huggingface.co/api/models/o/r') {
      return Response.json({ siblings: [{ rfilename: 'm-Q4_K_M.gguf' }, { rfilename: 'README.md' }], downloads: 3 })
    }
    if (init?.method === 'HEAD') {
      return new Response(null, { status: 200, headers: { 'content-length': String(4 * 1024 ** 3) } })
    }
    return new Response('not found', { status: 404 })
  }))
}

beforeEach(() => {
  clearExplorerModelCache()
  clearLmCache()
  stubFetch()
})

describe('explorer detail caching', () => {
  it('builds once: repeat opens cost zero fetches', async () => {
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
    const variantCalls = (vi.mocked(fetch).mock.calls as unknown[][]).filter(
      (args) => typeof args[0] === 'string' && (args[0] as string).startsWith('https://lmstudio.ai/models/o/m'),
    )
    expect(variantCalls).toHaveLength(1)
  })
})
