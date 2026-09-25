import { SectionHeading } from "@/components/site/section-heading"

const categories = [
  "Security",
  "Sovereignty",
  "IPC",
  "Persistence",
  "Model lifecycle",
  "Routing",
  "Agents",
  "Explore",
  "Downloads",
  "Renderer",
  "Updates",
]

export function Testing() {
  return (
    <section className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Quality" title="BUILT WITH TESTABILITY IN MIND" />

        <div className="mt-10 flex flex-col items-center gap-2">
          <span className="font-mono-tech text-4xl font-semibold text-primary sm:text-5xl">
            101
          </span>
          <span className="text-sm text-muted-foreground">automated tests</span>
        </div>

        <div className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-2.5">
          {categories.map((cat) => (
            <span
              key={cat}
              className="rounded-full border border-border/60 bg-card px-3.5 py-1.5 text-xs text-foreground/85"
            >
              {cat}
            </span>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
          CI-equivalent local gates protect the offline and security invariants before packaging.
        </p>
      </div>
    </section>
  )
}
