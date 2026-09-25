import { SectionHeading } from "@/components/site/section-heading"
import { FlowDiagram } from "@/components/site/flow-diagram"

const steps = [
  "USER",
  "REACT DESKTOP UI",
  "SECURE IPC",
  "APP BACKEND",
  "TASK CLASSIFIER",
  "HARDWARE PROFILE",
  "MODEL ROUTER",
  "LOCAL GGUF MODEL",
  "AGENT / TOOLS / MCP",
  "LOCAL OUTPUT + AUDIT LOG",
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Process" title="HOW SOVARA WORKS" />

        <div className="mt-12">
          <FlowDiagram steps={steps} emphasizeFirst emphasizeLast />
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
          Inference stays on the local machine. The local runtime communicates through loopback
          networking. Persistent session and audit data remain on disk.
        </p>
      </div>
    </section>
  )
}
