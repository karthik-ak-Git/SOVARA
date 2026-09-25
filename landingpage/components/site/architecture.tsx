import { SectionHeading } from "@/components/site/section-heading"

const layers = [
  {
    name: "Renderer",
    items: ["React 18", "Vite", "Zustand"],
  },
  {
    name: "Secure Bridge",
    items: ["contextBridge", "Zod"],
  },
  {
    name: "Main Process",
    items: ["Electron", "Node.js"],
  },
  {
    name: "Backend",
    items: ["AppBackend", "ChatService", "AgentOrchestrator", "ModelWorkbench", "ModelRouter"],
  },
  {
    name: "Runtime",
    items: ["llama-server", "GGUF", "CUDA"],
  },
  {
    name: "Storage",
    items: ["SQLite", "JSONL"],
  },
  {
    name: "Integrations",
    items: ["Hugging Face", "MCP", "Web/Search", "Updates"],
  },
]

export function Architecture() {
  return (
    <section id="architecture" className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="System Design" title="TECHNICAL ARCHITECTURE" />

        <div className="mt-12 flex flex-col gap-3">
          {layers.map((layer) => (
            <div
              key={layer.name}
              className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5 sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="w-full shrink-0 font-mono-tech text-xs font-semibold uppercase tracking-wide text-primary sm:w-40">
                {layer.name}
              </span>
              <div className="flex flex-wrap gap-2">
                {layer.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-md border border-border/60 bg-secondary/50 px-2.5 py-1 font-mono-tech text-xs text-foreground/85"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
