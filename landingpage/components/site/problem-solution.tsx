import { SectionHeading } from "@/components/site/section-heading"
import { Plus, ArrowDown } from "lucide-react"

const problems = [
  "Sensitive industrial knowledge",
  "Cloud dependency",
  "Unpredictable model choice",
  "Hardware mismatch",
  "Fragmented AI tools",
  "Weak auditability",
]

const solutionParts = [
  "Local Models",
  "Hardware Profiling",
  "Task Routing",
  "Agent Orchestration",
  "MCP / Tools",
  "Local Persistence",
]

export function ProblemSolution() {
  return (
    <section className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading title="AI SHOULD NOT REQUIRE SENDING YOUR DATA TO THE CLOUD." />

        <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {problems.map((problem) => (
            <div
              key={problem}
              className="rounded-lg border border-border/60 bg-card px-4 py-3.5 text-sm text-foreground/85"
            >
              {problem}
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-center gap-6">
          <ArrowDown className="size-5 text-muted-foreground" aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-center gap-3">
            {solutionParts.map((part, i) => (
              <div key={part} className="flex items-center gap-3">
                <span className="rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 font-mono-tech text-xs font-medium text-primary">
                  {part}
                </span>
                {i < solutionParts.length - 1 ? (
                  <Plus className="size-3.5 text-muted-foreground" aria-hidden="true" />
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground">
            into one desktop workbench.
          </p>
        </div>
      </div>
    </section>
  )
}
