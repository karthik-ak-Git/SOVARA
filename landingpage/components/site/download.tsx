"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Download as DownloadIcon, FileText, Code2, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

const DOCUMENTATION_URL = "/docs"
const RELEASES_API = "https://api.github.com/repos/karthik-ak-Git/SOVARA/releases?per_page=10"
const FALLBACK_DOWNLOAD_URL = "https://github.com/karthik-ak-Git/SOVARA/releases/latest"
const FALLBACK_FILE_NAME = "Sovara-Setup-1.1.4-x64.exe"

interface GitHubAsset {
  name: string
  size?: number
  browser_download_url: string
}

interface GitHubRelease {
  id: number
  name?: string | null
  tag_name?: string | null
  html_url: string
  published_at?: string | null
  draft?: boolean
  prerelease?: boolean
  assets?: GitHubAsset[]
}

function selectWindowsInstaller(release: GitHubRelease): GitHubAsset | null {
  const assets = release.assets ?? []
  return assets.find((asset) => /^Sovara-Setup-.*\.exe$/i.test(asset.name))
    ?? assets.find((asset) => /\.exe$/i.test(asset.name) && !/(blockmap|debug|helper|update)/i.test(asset.name))
    ?? null
}

function releaseVersion(release: GitHubRelease | null): string {
  if (!release) return "Latest"
  const text = `${release.name ?? ""} ${release.tag_name ?? ""}`
  return text.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? release.tag_name ?? "Latest"
}

export function DownloadSection() {
  const [releases, setReleases] = useState<GitHubRelease[]>([])
  const [latestRelease, setLatestRelease] = useState<GitHubRelease | null>(null)
  const [latestExeAsset, setLatestExeAsset] = useState<GitHubAsset | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function fetchReleases(): Promise<void> {
      try {
        const response = await fetch(RELEASES_API, {
          cache: "no-store",
          headers: { Accept: "application/vnd.github+json" },
        })
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
        const payload: unknown = await response.json()
        if (!Array.isArray(payload)) throw new Error("GitHub returned an invalid release list")

        const data = payload as GitHubRelease[]
        const published = data.filter((release) => !release.draft && !release.prerelease)
        setReleases(published)
        const found = published.find((release) => selectWindowsInstaller(release) !== null)
        setLatestRelease(found ?? published[0] ?? null)
        setLatestExeAsset(found ? selectWindowsInstaller(found) : null)
      } catch (error) {
        console.error("Failed to fetch Sovara releases:", error)
      } finally {
        setIsLoading(false)
      }
    }

    void fetchReleases()
  }, [])

  const downloadUrl = latestExeAsset?.browser_download_url ?? FALLBACK_DOWNLOAD_URL
  const versionStr = releaseVersion(latestRelease)
  const fileName = latestExeAsset?.name ?? FALLBACK_FILE_NAME
  const fileSize = latestExeAsset?.size
    ? `${(latestExeAsset.size / (1024 * 1024)).toFixed(1)} MB`
    : "Available at release"

  const meta = [
    { label: "File", value: fileName },
    { label: "Size", value: fileSize },
    { label: "Release", value: versionStr },
    { label: "Date", value: latestRelease?.published_at ? new Date(latestRelease.published_at).toLocaleDateString() : "Latest" },
  ]

  return (
    <section id="download" className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-primary/30 bg-card">
          <div className="bg-grid border-b border-border/60 bg-primary/5 px-6 py-10 text-center sm:px-10">
            <span className="font-mono-tech text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Windows Download
            </span>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              DOWNLOAD SOVARA FOR WINDOWS
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              SOVARA {versionStr} &middot; Desktop-only &middot; CUDA runtime &middot; Windows 10/11 x64
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button
                render={<a href={downloadUrl} target={!latestExeAsset ? "_blank" : undefined} rel={!latestExeAsset ? "noopener noreferrer" : undefined} download={!!latestExeAsset} />}
                nativeButton={false}
                size="lg"
                disabled={isLoading && !latestExeAsset}
              >
                <DownloadIcon data-icon="inline-start" />
                {isLoading && !latestExeAsset ? "Loading release…" : "Download SOVARA .EXE"}
              </Button>
              <Button
                render={<Link href={DOCUMENTATION_URL} />}
                nativeButton={false}
                size="lg"
                variant="outline"
              >
                <FileText data-icon="inline-start" />
                View Documentation
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 px-6 py-8 sm:grid-cols-2 sm:px-10">
            {meta.map((row) => (
              <div key={row.label} className="flex flex-col gap-1">
                <span className="font-mono-tech text-[10px] uppercase tracking-wide text-muted-foreground">
                  {row.label}
                </span>
                <span className="font-mono-tech text-sm text-foreground/85">{row.value}</span>
              </div>
            ))}
          </div>

          {releases.length > 0 && (
            <>
              <Separator />
              <div className="px-6 py-8 sm:px-10">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Clock className="size-4" />
                  Version History
                </h3>
                <div className="space-y-3">
                  {releases.slice(0, 5).map((release) => {
                    const exe = selectWindowsInstaller(release)
                    const url = exe?.browser_download_url ?? release.html_url

                    return (
                      <div key={release.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-foreground">
                            {release.name || release.tag_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {release.published_at ? new Date(release.published_at).toLocaleDateString() : "Latest"}
                          </span>
                        </div>
                        <a
                          href={url}
                          className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                          target={!exe ? "_blank" : undefined}
                          rel={!exe ? "noopener noreferrer" : undefined}
                          download={!!exe}
                        >
                          <DownloadIcon className="size-3" />
                          {exe ? "Download .EXE" : "Release Notes"}
                        </a>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4 text-center">
                  <a
                    href="https://github.com/karthik-ak-Git/SOVARA/releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground transition-colors hover:text-primary"
                  >
                    View all releases on GitHub &rarr;
                  </a>
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="flex flex-col gap-3 px-6 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-10">
            <Link
              href={DOCUMENTATION_URL}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Download documentation
            </Link>
            <Link
              href="https://github.com/karthik-ak-Git/SOVARA"
              className="flex items-center gap-2 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <Code2 className="size-4" aria-hidden="true" />
              View source
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}
