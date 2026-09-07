import { describe, it, expect } from 'vitest'
import {
  defaultSearchOptions,
  formatSearchOutcome,
  mapSearchResponse,
  parseSearchQueries,
  runDeepSeekSearch,
  WebSearchError,
} from '../src/main/services/deepseekSearch'

const OPTS = { ...defaultSearchOptions(), apiKey: 'sk-test' }

function stubFetch(payload: unknown, ok = true, status = 200, capture?: { url?: string; init?: unknown }) {
  return async (url: string, init: Record<string, unknown>) => {
    if (capture) {
      capture.url = url
      capture.init = init
    }
    return { ok, status, json: async () => payload }
  }
}

const SEARCH_RESPONSE = {
  content: [
    {
      type: 'web_search_tool_result',
      content: [
        { type: 'web_search_result', url: 'https://a.example/x', title: 'A', page_age: '2026-09-01' },
        { type: 'web_search_result', url: 'https://b.example/y', title: '', page_age: '' },
        { type: 'web_search_result', url: 'https://a.example/x', title: 'A dup' },
      ],
    },
    {
      type: 'text',
      text: 'answer',
      citations: [{ url: 'https://a.example/x', cited_text: 'excerpt A' }],
    },
  ],
}

describe('mapSearchResponse', () => {
  it('joins snippets by URL and dedupes', () => {
    const out = mapSearchResponse(SEARCH_RESPONSE)
    expect(out.sources).toHaveLength(2)
    expect(out.sources[0]).toEqual({ url: 'https://a.example/x', title: 'A', snippet: 'excerpt A', publishedAt: '2026-09-01' })
    expect(out.sources[1]).toEqual({ url: 'https://b.example/y' })
  })

  it('throws when no result block is present', () => {
    expect(() => mapSearchResponse({ content: [{ type: 'text', text: 'hi' }] })).toThrowError(WebSearchError)
  })
})

describe('parseSearchQueries', () => {
  it('rejects empty, over-long, and blank queries and collapses dupes', () => {
    expect(() => parseSearchQueries([], 4)).toThrowError()
    expect(() => parseSearchQueries(['a', 'b', 'c', 'd', 'e'], 4)).toThrowError()
    expect(() => parseSearchQueries(['  '], 4)).toThrowError()
    expect(parseSearchQueries(['a', 'a', 'b'], 4)).toEqual(['a', 'b'])
  })
})

describe('formatSearchOutcome', () => {
  it('renders sources with the trust notice and cite instruction', () => {
    const text = formatSearchOutcome({ sources: [{ url: 'https://a.example/x', title: 'A' }], truncated: false })
    expect(text).toContain('untrusted data')
    expect(text).toContain('[A](https://a.example/x)')
    expect(text).toContain('Cite the relevant URLs')
  })

  it('renders No results found when empty', () => {
    expect(formatSearchOutcome({ sources: [], truncated: false })).toContain('No results found.')
  })
})

describe('runDeepSeekSearch', () => {
  it('posts to {base}/messages with both auth headers and no redirects', async () => {
    const capture: { url?: string; init?: unknown } = {}
    const out = await runDeepSeekSearch('q', OPTS, stubFetch(SEARCH_RESPONSE, true, 200, capture))
    expect(out.sources).toHaveLength(2)
    expect(capture.url).toBe('https://api.deepseek.com/anthropic/v1/messages')
    const headers = (capture.init as { headers: Record<string, string> }).headers
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['authorization']).toBe('Bearer sk-test')
    expect((capture.init as { redirect: string }).redirect).toBe('error')
    const body = JSON.parse((capture.init as { body: string }).body) as { tools: Array<{ type: string; name: string }> }
    expect(body.tools[0]).toMatchObject({ type: 'web_search_20250305', name: 'web_search' })
  })

  it('requires a key from options or env', async () => {
    const noKey = { ...OPTS, apiKey: undefined }
    const prev = process.env['DEEPSEEK_API_KEY']
    delete process.env['DEEPSEEK_API_KEY']
    try {
      await expect(runDeepSeekSearch('q', noKey, stubFetch({}))).rejects.toMatchObject({ code: 'WEB_CREDENTIAL_MISSING' })
    } finally {
      if (prev !== undefined) process.env['DEEPSEEK_API_KEY'] = prev
    }
  })

  it('falls back to DEEPSEEK_API_KEY env', async () => {
    process.env['DEEPSEEK_API_KEY'] = 'sk-env'
    try {
      const out = await runDeepSeekSearch('q', { ...OPTS, apiKey: undefined }, stubFetch(SEARCH_RESPONSE))
      expect(out.sources).toHaveLength(2)
    } finally {
      delete process.env['DEEPSEEK_API_KEY']
    }
  })

  it('rejects non-http endpoints and surfaces HTTP errors', async () => {
    await expect(runDeepSeekSearch('q', { ...OPTS, baseURL: 'ftp://x' }, stubFetch({}))).rejects.toThrowError()
    await expect(
      runDeepSeekSearch('q', OPTS, stubFetch({ error: { message: 'bad' } }, false, 401))
    ).rejects.toThrowError(/HTTP 401.*bad/)
  })
})
