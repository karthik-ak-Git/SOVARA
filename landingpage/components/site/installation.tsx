import { SectionHeading } from "@/components/site/section-heading"
import { Download, PlayCircle, Cpu } from "lucide-react"

const steps = [
  {
    icon: Download,
    title: "Download the Windows .exe",
    description: "Download the latest Sovara-Setup Windows .exe from the panel above.",
  },
  {
    icon: PlayCircle,
    title: "Install / launch SOVARA",
    description: "Run the installer, then launch the desktop workbench.",
  },
  {
    icon: Cpu,
    title: "Select or download a local GGUF model",
    description: "Choose an installed model or discover one through the Model Explorer.",
  },
]

export function Installation() {
  return (
    <section id="install" className="border-b border-border/60 bg-secondary/20">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Getting Started" title="INSTALLATION GUIDE" />

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {steps.map((step, i) => (
            <div
              key={step.title}
              className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono-tech text-sm font-semibold text-primary">
                  {i + 1}
                </span>
                <step.icon className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.description}</p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-10 flex max-w-3xl flex-col gap-4 rounded-xl border border-border/60 bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground">Fast Installation Alternatives</h3>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs text-muted-foreground">1-Line PowerShell Install:</p>
              <pre className="overflow-x-auto rounded-lg border border-border/50 bg-secondary/50 p-3 font-mono-tech text-xs leading-relaxed text-foreground/85 text-secure">
                iwr -useb https://raw.githubusercontent.com/karthik-ak-Git/SOVARA/main/install.ps1 | iex
              </pre>
            </div>
            <div>
              <p className="mb-2 text-xs text-muted-foreground">Node.js / NPM Install:</p>
              <pre className="overflow-x-auto rounded-lg border border-border/50 bg-secondary/50 p-3 font-mono-tech text-xs leading-relaxed text-foreground/85 text-secure">
                npx --yes sovara@latest
              </pre>
            </div>
          </div>
        </div>

        <div className="mx-auto mt-10 flex max-w-2xl flex-col gap-3 rounded-xl border border-border/60 bg-card p-5">
          <p className="text-sm leading-relaxed text-foreground/85">
            Optional NVIDIA GPU improves local GPU inference and enables VRAM-aware profiling.
            CPU-only operation is supported.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            For first-run runtime setup: SOVARA may provision its pinned local llama.cpp runtime
            once, then operate offline. Model downloads from Hugging Face require network access.
          </p>
        </div>
      </div>
    </section>
  )
}
