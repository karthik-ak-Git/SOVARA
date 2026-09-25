import { SectionHeading } from "@/components/site/section-heading"
import {
  Cpu,
  Gauge,
  Compass,
  Library,
  Bot,
  Plug,
  ListChecks,
  ShieldCheck,
} from "lucide-react"

const features = [
  {
    icon: Cpu,
    title: "Local LLM Runtime",
    description: "GGUF models powered by bundled llama.cpp / llama-server.",
  },
  {
    icon: Gauge,
    title: "Hardware-Aware Routing",
    description: "Choose models using CPU, RAM, GPU and VRAM information.",
  },
  {
    icon: Compass,
    title: "Model Explorer",
    description: "Search and discover runnable GGUF models from Hugging Face.",
  },
  {
    icon: Library,
    title: "Model Library",
    description: "Download, resume, pause and manage local model files.",
  },
  {
    icon: Bot,
    title: "Agent Orchestration",
    description: "Task classification, model routing, streaming, tool loops and execution.",
  },
  {
    icon: Plug,
    title: "MCP Connections",
    description: "Connect supported external tools and services through MCP.",
  },
  {
    icon: ListChecks,
    title: "Local Audit Trail",
    description: "SQLite metadata plus append-only JSONL execution history.",
  },
  {
    icon: ShieldCheck,
    title: "Automatic Updates",
    description: "Receive verified Windows updates through the desktop release channel.",
  },
]

export function CoreFeatures() {
  return (
    <section id="features" className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Capabilities" title="CORE FEATURES" />

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 transition-colors hover:border-primary/40"
            >
              <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="text-sm font-semibold text-foreground">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
