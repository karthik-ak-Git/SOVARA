import { describe, it, expect } from 'vitest'
import { ToolStubAdapter, type WebRuntime } from '../src/main/backend/ports/ToolStubAdapter'
import {
  formatSearchOutcome,
  parseDuckHtml,
  parseSearchQueries,
  resolveResultUrl,
  WebSearchError,
} from '../src/main/services/webSearch'

const OUTCOME = {
  sources: [
    { url: 'https://a.example/x', title: 'A', snippet: 'excerpt A' },
    { url: 'https://b.example/y', title: 'B' },
  ],
  truncated: false,
}

function stubRuntime(overrides?: Partial<WebRuntime>): WebRuntime {
  return {
    enabled: true,
    search: async () => OUTCOME,
    crawl: async (urls: string[]) => urls.map((url) => ({ url, title: 'T', markdown: `# ${url}\n\nbody text` })),
    ...overrides,
  }
}

describe('parseSearchQueries', () => {
  it('rejects empty, over-long, and blank queries and collapses dupes', () => {
    expect(() => parseSearchQueries([], 4)).toThrowError(WebSearchError)
    expect(() => parseSearchQueries(['a', 'b', 'c', 'd', 'e'], 4)).toThrowError(WebSearchError)
    expect(() => parseSearchQueries(['  '], 4)).toThrowError(WebSearchError)
    expect(parseSearchQueries(['a', 'a', 'b'], 4)).toEqual(['a', 'b'])
  })
})

describe('resolveResultUrl', () => {
  it('unwraps DDG redirect links and passes direct URLs', () => {
    expect(resolveResultUrl('/l/?uddg=https%3A%2F%2Fa.example%2Fx&rut=abc')).toBe('https://a.example/x')
    expect(resolveResultUrl('https://a.example/x')).toBe('https://a.example/x')
    expect(resolveResultUrl('//a.example/x')).toBe('https://a.example/x')
    expect(resolveResultUrl('/l/?rut=abc')).toBeNull()
    expect(resolveResultUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('parseDuckHtml', () => {
  const HTML = `
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fx&rut=1">Alpha <b>page</b></a>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example%2Fx&rut=1">First <em>snippet</em> here.</a>
    <a rel="nofollow" class="result__a" href="https://b.example/y">Beta</a>
  `
  it('extracts links, titles, and snippets paired by position', () => {
    const out = parseDuckHtml(HTML)
    expect(out.sources).toHaveLength(2)
    expect(out.sources[0]).toEqual({ url: 'https://a.example/x', title: 'Alpha page', snippet: 'First snippet here.' })
    expect(out.sources[1]).toEqual({ url: 'https://b.example/y', title: 'Beta' })
  })

  it('returns empty sources for markup without results', () => {
    expect(parseDuckHtml('<html><body>nothing</body></html>').sources).toEqual([])
  })
})

describe('formatSearchOutcome', () => {
  it('renders sources with the trust notice and cite instruction', () => {
    const text = formatSearchOutcome(OUTCOME)
    expect(text).toContain('untrusted data')
    expect(text).toContain('[A](https://a.example/x)')
    expect(text).toContain('Cite the relevant URLs')
  })

  it('renders No results found when empty', () => {
    expect(formatSearchOutcome({ sources: [], truncated: false })).toContain('No results found.')
  })
})

describe('ToolStubAdapter web tools', () => {
  it('lists web_search and web_fetch', () => {
    expect(new ToolStubAdapter(stubRuntime()).list().map((d) => d.name)).toEqual(['web_search', 'web_fetch'])
  })

  it('refuses everything while disabled', async () => {
    const tools = new ToolStubAdapter()
    expect(JSON.parse(await tools.dispatch('web_search', { queries: ['x'] })).error).toMatch(/disabled/)
    expect(JSON.parse(await tools.dispatch('web_fetch', { urls: ['https://a.example'] })).error).toMatch(/disabled/)
    expect(JSON.parse(await tools.dispatch('nope', {})).error).toMatch(/unavailable/)
  })

  it('dispatches web_search and formats stub sources', async () => {
    const raw = await new ToolStubAdapter(stubRuntime()).dispatch('web_search', { queries: ['q'] })
    expect(raw).toContain('[A](https://a.example/x)')
  })

  it('dispatches web_fetch and renders markdown blocks', async () => {
    const raw = await new ToolStubAdapter(stubRuntime()).dispatch('web_fetch', { urls: ['https://a.example/x'] })
    expect(raw).toContain('body text')
    expect(raw).toContain('untrusted data')
  })

  it('rejects bad web_fetch args without touching the runtime', async () => {
    let called = false
    const rt = stubRuntime({ crawl: async () => { called = true; return [] } })
    const bad = JSON.parse(await new ToolStubAdapter(rt).dispatch('web_fetch', { urls: [] }))
    expect(bad.error).toMatch(/1-5/)
    expect(called).toBe(false)
  })

  it('surfaces runtime failures as error JSON, never throwing', async () => {
    const rt = stubRuntime({ search: async () => { throw new Error('sidecar down') } })
    const bad = JSON.parse(await new ToolStubAdapter(rt).dispatch('web_search', { queries: ['q'] }))
    expect(bad.error).toMatch(/sidecar down/)
  })
})
