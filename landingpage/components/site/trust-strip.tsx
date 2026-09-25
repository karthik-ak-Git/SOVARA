import { Cpu, Gauge, Bot, Lock, ListChecks } from "lucide-react"

const items = [
  {
    icon: Cpu,
    title: "Local Inference",
    description: "Run GGUF models through local llama.cpp.",
  },
  {
    icon: Gauge,
    title: "Hardware Aware",
    description: "CPU, RAM, GPU and VRAM-aware compatibility.",
  },
  {
    icon: Bot,
    title: "Agentic",
    description: "Plan, route, execute and use tools.",
  },
  {
    icon: Lock,
    title: "Private",
    description: "No telemetry and no automatic cloud inference.",
  },
  {
    icon: ListChecks,
    title: "Auditable",
    description: "SQLite + append-only JSONL event history.",
  },
]

export function TrustStrip() {
  return (
    <section className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {items.map((item) => (
            <div key={item.title} className="flex flex-col gap-2">
              <item.icon className="size-5 text-primary" aria-hidden="true" />
              <h3 className="font-mono-tech text-xs font-semibold uppercase tracking-wide text-foreground">
                {item.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
