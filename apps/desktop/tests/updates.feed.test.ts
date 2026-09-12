import { describe, it, expect } from 'vitest'
import { checkForUpdates, compareVersions } from '../src/main/services/updateFeed'

function stubFetch(payload: unknown, ok = true, status = 200) {
  return async () => ({ ok, status, json: async () => payload })
}

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.0.9', '0.1.0')).toBeLessThan(0)
  })
})

describe('checkForUpdates', () => {
  it('reports no-feed when no URL is configured', async () => {
    const r = await checkForUpdates('', '0.1.0')
    expect(r.status).toBe('no-feed')
    expect(r.latest).toBeNull()
  })

  it('rejects invalid and non-http feed URLs', async () => {
    expect((await checkForUpdates('not a url', '0.1.0')).status).toBe('error')
    expect((await checkForUpdates('ftp://x/y.json', '0.1.0')).status).toBe('error')
  })

  it('detects an available update from {version} JSON', async () => {
    const r = await checkForUpdates('https://x/y.json', '0.1.0', stubFetch({ version: '0.2.0' }))
    expect(r.status).toBe('available')
    expect(r.latest).toBe('0.2.0')
  })

  it('reports current when the feed matches', async () => {
    const r = await checkForUpdates('https://x/y.json', '0.2.0', stubFetch({ version: 'v0.2.0' }))
    expect(r.status).toBe('current')
  })

  it('reads GitHub releases arrays via tag_name', async () => {
    const r = await checkForUpdates('https://api.github.com/repos/a/b/releases', '1.0.0', stubFetch([{ tag_name: 'v1.1.0' }]))
    expect(r.status).toBe('available')
    expect(r.latest).toBe('1.1.0')
  })

  it('errors on HTTP failures and version-less payloads', async () => {
    expect((await checkForUpdates('https://x/y.json', '1.0.0', stubFetch({}, false, 500))).status).toBe('error')
    expect((await checkForUpdates('https://x/y.json', '1.0.0', stubFetch({ nope: 1 }))).status).toBe('error')
  })

  it('sends a User-Agent (GitHub rejects header-less requests with 403)', async () => {
    let seen: Record<string, string> = {}
    const capture = async (_url: string, init?: { headers?: Record<string, string> }) => {
      seen = init?.headers ?? {}
      return { ok: true, status: 200, json: async () => ({ version: '1.0.0' }) }
    }
    await checkForUpdates('https://api.github.com/repos/a/b/releases', '1.0.0', capture)
    expect(seen['user-agent']).toMatch(/sovara/)
  })

  it('explains GitHub 403 as rate limiting', async () => {
    const r = await checkForUpdates('https://api.github.com/repos/a/b/releases', '1.0.0', stubFetch({}, false, 403))
    expect(r.status).toBe('error')
    expect(r.message).toMatch(/rate limiting/)
  })

  it('errors when the feed is unreachable', async () => {
    const r = await checkForUpdates('https://x/y.json', '1.0.0', async () => { throw new Error('down') })
    expect(r.status).toBe('error')
  })
})
