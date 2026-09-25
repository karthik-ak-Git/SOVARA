/**
 * Shared, server-side release data for the landing page.
 *
 * `cacheComponents` is not enabled in next.config.mjs, so this uses the
 * documented `fetch(..., { next: { revalidate } })` model rather than
 * `use cache` / `cacheLife`. A route segment can also set `export const
 * revalidate = 3600`; both are used for defence in depth.
 *
 * Every failure path returns an empty list instead of throwing: these pages are
 * prerendered at build time, and a GitHub outage or rate limit must degrade to a
 * friendly empty state rather than failing the whole build.
 */

const RELEASES_API = "https://api.github.com/repos/karthik-ak-Git/SOVARA/releases?per_page=30";

/** GitHub allows 60 unauthenticated requests/hour per IP. One hour revalidation keeps us well under. */
export const RELEASES_REVALIDATE_SECONDS = 3600;

export const FALLBACK_DOWNLOAD_URL = "https://github.com/karthik-ak-Git/SOVARA/releases/latest";
export const FALLBACK_FILE_NAME = "Sovara-Setup-1.1.4-x64.exe";

export interface SovaraAsset {
  name: string;
  size?: number;
  browser_download_url: string;
}

export interface SovaraRelease {
  id: number;
  name: string | null;
  tag_name: string | null;
  version: string;
  html_url: string;
  published_at: string | null;
  assets: SovaraAsset[];
  /** The Windows x64 installer for this release, when one is attached. */
  installer: SovaraAsset | null;
}

interface GitHubReleasePayload {
  id: number;
  name?: string | null;
  tag_name?: string | null;
  html_url: string;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name: string; size?: number; browser_download_url: string }>;
}

/**
 * Prefer the canonical `Sovara-Setup-<version>-x64.exe`, then any plausible
 * installer, then nothing. Blockmaps, updaters and helpers are never installable.
 */
export function selectWindowsInstaller(release: {
  assets?: SovaraAsset[];
}): SovaraAsset | null {
  const assets = release.assets ?? [];
  return (
    assets.find((asset) => /^Sovara-Setup-.*\.exe$/i.test(asset.name)) ??
    assets.find(
      (asset) =>
        /\.exe$/i.test(asset.name) &&
        !/(blockmap|debug|helper|update)/i.test(asset.name),
    ) ??
    null
  );
}

/**
 * Resolve a human version. `Sovara-versions` is a rolling release tag, so the
 * semver usually lives in the release name or the installer asset name rather
 * than the tag itself.
 */
export function releaseVersion(release: {
  name?: string | null;
  tag_name?: string | null;
  assets?: SovaraAsset[];
}): string {
  const haystack = [
    release.name ?? "",
    release.tag_name ?? "",
    ...(release.assets ?? []).map((asset) => asset.name),
  ].join(" ");
  return haystack.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? release.tag_name ?? "Latest";
}

function normalize(payload: GitHubReleasePayload): SovaraRelease {
  const installer = selectWindowsInstaller({ assets: payload.assets ?? [] });
  return {
    id: payload.id,
    name: payload.name ?? null,
    tag_name: payload.tag_name ?? null,
    version: releaseVersion({
      name: payload.name,
      tag_name: payload.tag_name,
      assets: payload.assets ?? [],
    }),
    html_url: payload.html_url,
    published_at: payload.published_at ?? null,
    assets: payload.assets ?? [],
    installer,
  };
}

/** GitHub returns releases newest-first, so ordering is preserved deliberately. */
function compareVersionsDesc(a: SovaraRelease, b: SovaraRelease): number {
  const left = a.published_at ? Date.parse(a.published_at) : 0;
  const right = b.published_at ? Date.parse(b.published_at) : 0;
  if (left !== right) return right - left;
  return b.id - a.id;
}

/**
 * All published, non-draft, non-prerelease releases, newest first.
 * Throws nothing: network and shape errors collapse to an empty list.
 */
export async function getReleases(): Promise<SovaraRelease[]> {
  try {
    const response = await fetch(RELEASES_API, {
      next: { revalidate: RELEASES_REVALIDATE_SECONDS, tags: ["releases"] },
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("GitHub returned an invalid release list");

    return (payload as GitHubReleasePayload[])
      .filter((release) => !release.draft && !release.prerelease)
      .map(normalize)
      .sort(compareVersionsDesc);
  } catch (error) {
    console.error("Failed to fetch Sovara releases:", error);
    return [];
  }
}

/** The newest release that actually ships a Windows installer. */
export async function getLatestReleaseWithInstaller(): Promise<SovaraRelease | null> {
  const releases = await getReleases();
  return releases.find((release) => release.installer !== null) ?? releases[0] ?? null;
}
