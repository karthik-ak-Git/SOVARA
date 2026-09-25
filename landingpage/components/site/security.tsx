import { Check, X } from "lucide-react"
import { SectionHeading } from "@/components/site/section-heading"

const claims = [
  "Offline by default",
  "No telemetry",
  "No analytics SDK",
  "No automatic cloud inference",
  "Local SQLite storage",
  "Append-only JSONL events",
  "Loopback-only local inference",
  "Hardened Electron renderer",
  "Zod-validated IPC",
]

const localStack = ["React", "Electron", "AppBackend", "llama-server", "SQLite", "JSONL"]

export function Security() {
  return (
    <section id="security" className="border-b border-border/60 bg-secondary/20">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Sovereignty" title="YOUR DATA STAYS IN YOUR WORKSPACE" />

        <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {claims.map((claim) => (
              <div
                key={claim}
                className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3.5 py-3"
              >
                <Check className="size-4 shrink-0 text-secure" aria-hidden="true" />
                <span className="text-sm text-foreground/85">{claim}</span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border/60 bg-card p-6">
            <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
              <span className="font-mono-tech text-sm text-foreground">Internet</span>
              <X className="size-4 text-destructive" aria-hidden="true" />
              <span className="font-mono-tech text-sm text-muted-foreground">SOVARA inference</span>
            </div>

            <p className="mt-6 font-mono-tech text-xs uppercase tracking-wide text-muted-foreground">
              Local Machine
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {localStack.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 rounded-lg border border-secure/30 bg-secure/10 px-3 py-2"
                >
                  <Check className="size-3.5 shrink-0 text-secure" aria-hidden="true" />
                  <span className="font-mono-tech text-xs text-foreground/85">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
          Network access is available only for explicit supported functions such as model
          discovery/download, MCP connections and update checks.
        </p>
      </div>
    </section>
  )
}
