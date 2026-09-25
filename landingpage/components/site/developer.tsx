import Link from "next/link"
import { Code2 } from "lucide-react"
import { SectionHeading } from "@/components/site/section-heading"

const commands = [
  "git clone https://github.com/karthik-ak-Git/SOVARA.git",
  "cd SOVARA",
  "pnpm install",
  "pnpm dev",
]

export function Developer() {
  return (
    <section className="border-b border-border/60 bg-secondary/20">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Open Source" title="BUILT FOR DEVELOPERS AND REVIEWERS" />

        <div className="mx-auto mt-10 flex max-w-2xl justify-center">
          <Link
            href="https://github.com/karthik-ak-Git/SOVARA.git"
            className="flex items-center gap-2 rounded-full border border-border/60 bg-card px-4 py-2 text-sm text-foreground/85 transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Code2 className="size-4" aria-hidden="true" />
            github.com/karthik-ak-Git/SOVARA
          </Link>
        </div>

        <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-border/60 bg-card p-5">
          <pre className="overflow-x-auto font-mono-tech text-xs leading-relaxed text-foreground/85">
            {commands.map((cmd) => (
              <div key={cmd}>
                <span className="text-secure">$</span> {cmd}
              </div>
            ))}
          </pre>
        </div>

        <div className="mx-auto mt-6 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
          <InfoTile label="Build" value="pnpm build:win" />
          <InfoTile label="Tests" value="pnpm --filter @sovara/desktop test" />
          <InfoTile label="Typecheck" value="pnpm --filter @sovara/desktop typecheck" />
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-muted-foreground">
          Requires Node &gt;= 22 and pnpm 11.17.0.
        </p>
      </div>
    </section>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3.5">
      <p className="font-mono-tech text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-mono-tech text-xs text-foreground/85">{value}</p>
    </div>
  )
}
