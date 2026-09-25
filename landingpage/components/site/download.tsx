import Link from "next/link"
import { Download as DownloadIcon, FileText, Code2, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  FALLBACK_DOWNLOAD_URL,
  FALLBACK_FILE_NAME,
  type SovaraRelease,
} from "@/lib/releases"

const DOCUMENTATION_URL = "/docs"

/** The home page advertises only the two newest builds; /versions holds the rest. */
const FEATURED_RELEASE_COUNT = 2

function releaseDate(release: SovaraRelease): string {
  if (!release.published_at) return "Latest"
  const parsed = Date.parse(release.published_at)
  if (Number.isNaN(parsed)) return "Latest"
  return new Date(parsed).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export function DownloadSection({ releases }: { releases: SovaraRelease[] }) {
  // Prefer the newest release that actually ships an installer; otherwise the
  // newest release so the page still renders a sensible version string.
  const latestRelease = releases.find((release) => release.installer !== null) ?? releases[0] ?? null
  const latestExeAsset = latestRelease?.installer ?? null

  const downloadUrl = latestExeAsset?.browser_download_url ?? FALLBACK_DOWNLOAD_URL
  const versionStr = latestRelease?.version ?? "Latest"
  const fileName = latestExeAsset?.name ?? FALLBACK_FILE_NAME
  const fileSize = latestExeAsset?.size
    ? `${(latestExeAsset.size / (1024 * 1024)).toFixed(1)} MB`
    : "Available at release"

  const meta = [
    { label: "File", value: fileName },
    { label: "Size", value: fileSize },
    { label: "Release", value: versionStr },
    { label: "Date", value: latestRelease ? releaseDate(latestRelease) : "Latest" },
  ]

  const featured = releases.slice(0, FEATURED_RELEASE_COUNT)

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
              >
                <DownloadIcon data-icon="inline-start" />
                Download SOVARA .EXE
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

          {featured.length > 0 && (
            <>
              <Separator />
              <div className="px-6 py-8 sm:px-10">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Clock className="size-4" />
                  Latest Releases
                </h3>
                <div className="space-y-3">
                  {featured.map((release) => {
                    const exe = release.installer
                    const url = exe?.browser_download_url ?? release.html_url

                    return (
                      <div key={release.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-secondary/20 p-3">
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-foreground">
                            {release.name || release.version}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {releaseDate(release)}
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
                  <Link
                    href="/versions"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                  >
                    View all versions &rarr;
                  </Link>
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
