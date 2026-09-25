import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/site/navbar";
import { Footer } from "@/components/site/footer";
import {
  FALLBACK_DOWNLOAD_URL,
  getReleases,
  type SovaraRelease,
} from "@/lib/releases";

export const metadata: Metadata = {
  title: "All Versions — SOVARA",
  description:
    "Every published SOVARA release for Windows x64, with direct installer downloads and release dates.",
};

/**
 * Same cadence as lib/releases.ts; the fetch already revalidates on its own.
 * Next requires segment config to be a static literal, not an imported binding.
 */
export const revalidate = 3600;

function formatDate(value: string | null): string {
  if (!value) return "Undated";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "Undated";
  return new Date(parsed).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isRollingTag(release: SovaraRelease): boolean {
  return !/^v?\d+\.\d+\.\d+$/.test(release.tag_name ?? "");
}

function VersionRow({ release, featured }: { release: SovaraRelease; featured: boolean }) {
  const installer = release.installer;
  const downloadHref = installer?.browser_download_url ?? release.html_url;
  const size = installer?.size
    ? `${(installer.size / (1024 * 1024)).toFixed(1)} MB`
    : null;

  return (
    <li
      className={
        featured
          ? "rounded-xl border border-primary/40 bg-primary/5 p-5"
          : "rounded-xl border border-border/60 bg-card p-5"
      }
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono-tech text-base font-semibold text-foreground">
              {release.version}
            </h2>
            {featured ? (
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 font-mono-tech text-[10px] uppercase tracking-wider text-primary">
                Latest
              </span>
            ) : null}
            {isRollingTag(release) ? (
              <span className="rounded-full border border-border/60 px-2.5 py-0.5 font-mono-tech text-[10px] uppercase tracking-wider text-muted-foreground">
                Rolling release
              </span>
            ) : null}
            {installer ? null : (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-mono-tech text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Notes only
              </span>
            )}
          </div>

          {release.name && release.name !== release.version ? (
            <p className="mt-1 text-sm text-foreground/80">{release.name}</p>
          ) : null}

          <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono-tech text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Published</dt>
              <dd>{formatDate(release.published_at)}</dd>
            </div>
            {size ? (
              <div className="flex items-center gap-1.5">
                <dt>Size</dt>
                <dd>{size}</dd>
              </div>
            ) : null}
            {release.tag_name ? (
              <div className="flex items-center gap-1.5">
                <dt>Tag</dt>
                <dd>{release.tag_name}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <a
            href={downloadHref}
            className="rounded-lg bg-primary/10 px-4 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
            target={installer ? undefined : "_blank"}
            rel={installer ? undefined : "noopener noreferrer"}
            download={installer ? true : undefined}
          >
            {installer ? "Download .EXE" : "Release Notes"}
          </a>
          <a
            href={release.html_url}
            className="rounded-lg border border-border/60 px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </li>
  );
}

export default async function VersionsPage() {
  const releases = await getReleases();
  // The home page advertises the newest two, so the full history starts here.
  const [featured, ...rest] = releases;

  return (
    <main className="flex min-h-screen flex-col">
      <Navbar />

      <section className="border-b border-border/60 bg-grid">
        <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8">
          <span className="font-mono-tech text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Release Archive
          </span>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            All SOVARA Versions
          </h1>
          <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
            Every published Windows x64 release of SOVARA, newest first. The home page
            highlights the two most recent builds; the full history is kept here.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-4xl flex-1 px-4 py-14 sm:px-6 lg:px-8">
        {releases.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card p-10 text-center">
            <h2 className="text-lg font-semibold text-foreground">
              Release list unavailable
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              GitHub&apos;s release API could not be reached right now. The latest
              installer is always available directly from the release page.
            </p>
            <a
              href={FALLBACK_DOWNLOAD_URL}
              className="mt-6 inline-block rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Open the release page
            </a>
          </div>
        ) : (
          <ul className="space-y-4">
            {featured ? <VersionRow release={featured} featured /> : null}
            {rest.map((release) => (
              <VersionRow key={release.id} release={release} featured={false} />
            ))}
          </ul>
        )}

        <div className="mt-12 text-center">
          <Link
            href="/"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            &larr; Back to Sovara
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}
