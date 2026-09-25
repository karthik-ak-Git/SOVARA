import { SectionHeading } from "@/components/site/section-heading"
import { FlowDiagram } from "@/components/site/flow-diagram"

const steps = [
  "User Request",
  "Task Classification",
  "Model Selection",
  "Resource Check",
  "Local Inference",
  "Tool / MCP Action",
  "Result",
  "Audit Event",
]

const labels = ["Planning", "Routing", "Tool Use", "Execution", "Streaming", "Auditability"]

export function AgentOrchestration() {
  return (
    <section className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-start">
          <div>
            <SectionHeading
              eyebrow="Agentic Execution"
              title="FROM CHAT TO CONTROLLED EXECUTION"
              align="left"
            />
            <div className="mt-8 flex flex-wrap gap-2.5">
              {labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-border/60 bg-card px-3.5 py-1.5 text-xs font-medium text-foreground/85"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          <FlowDiagram steps={steps} emphasizeFirst emphasizeLast className="lg:justify-self-center" />
        </div>
      </div>
    </section>
  )
}
