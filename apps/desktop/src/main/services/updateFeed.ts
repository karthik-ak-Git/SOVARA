/**
 * Update-feed check — the "Check for updates" behind Settings → General.
 *
 * No update server is bundled with the app: the feed URL is user-configured
 * (empty by default). When set, it must return JSON — either
 * `{ "version": "1.2.3" }` or a GitHub Releases array with `tag_name`
 * entries. The check compares semver numerically and never downloads or
 * installs anything; it only reports current / available / error.
 */

export type UpdateCheckStatus = 'current' | 'available' | 'no-feed' | 'error'

export interface UpdateCheckResult {
  status: UpdateCheckStatus
  current: string
  latest: string | null
  message: string
}

type FetchFn = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

/** GitHub's API rejects requests without a User-Agent (HTTP 403). */
const FEED_USER_AGENT = 'sovara-desktop/0.1.0'

function normalizeVersion(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim().replace(/^[vV=]/, '').match(/^\d+(?:\.\d+){0,3}/)
  return m ? m[0] : null
}

/** Numeric semver compare: >0 when a is newer, <0 when older, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10))
  const pb = b.split('.').map((n) => parseInt(n, 10))
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  return 0
}

function extractLatest(payload: unknown): string | null {
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    return normalizeVersion((payload as Record<string, unknown>)['version'])
  }
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      if (entry !== null && typeof entry === 'object') {
        const v = normalizeVersion((entry as Record<string, unknown>)['tag_name'])
        if (v) return v
      }
    }
  }
  return null
}

export async function checkForUpdates(
  feedUrl: string,
  currentVersion: string,
  fetchFn: FetchFn = fetch as unknown as FetchFn,
  timeoutMs = 10000
): Promise<UpdateCheckResult> {
  const feed = feedUrl.trim()
  if (!feed) {
    return {
      status: 'no-feed',
      current: currentVersion,
      latest: null,
      message: 'No update feed configured — set one below to enable checks.',
    }
  }
  let url: URL
  try {
    url = new URL(feed)
  } catch {
    return { status: 'error', current: currentVersion, latest: null, message: 'Update feed URL is not valid.' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { status: 'error', current: currentVersion, latest: null, message: 'Update feed must be an http(s) URL.' }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url.toString(), {
      signal: ctrl.signal,
      headers: {
        'user-agent': FEED_USER_AGENT,
        accept: 'application/vnd.github+json, application/json',
      },
    })
    if (!res.ok) {
      if (res.status === 403 && url.hostname === 'api.github.com') {
        return { status: 'error', current: currentVersion, latest: null, message: 'GitHub refused the request (HTTP 403) — usually API rate limiting. Try again in a few minutes.' }
      }
      return { status: 'error', current: currentVersion, latest: null, message: `Feed returned HTTP ${res.status}.` }
    }
    const latest = extractLatest(await res.json())
    if (!latest) {
      return { status: 'error', current: currentVersion, latest: null, message: 'Feed did not contain a version.' }
    }
    if (compareVersions(latest, currentVersion) > 0) {
      return { status: 'available', current: currentVersion, latest, message: `Update available: ${latest}.` }
    }
    return { status: 'current', current: currentVersion, latest, message: `You're up to date (${currentVersion}).` }
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError' ? 'timed out' : 'unreachable'
    return { status: 'error', current: currentVersion, latest: null, message: `Could not reach the update feed (${reason}).` }
  } finally {
    clearTimeout(timer)
  }
}
