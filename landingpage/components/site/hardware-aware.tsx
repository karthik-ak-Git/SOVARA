import { SectionHeading } from "@/components/site/section-heading"
import { ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"

const models = [
  {
    name: "Model A",
    quant: "Q4_K_M",
    size: "7B",
    fit: "Likely fit",
    tone: "secure" as const,
  },
  {
    name: "Model B",
    quant: "Q8",
    size: "14B",
    fit: "Possible / higher memory",
    tone: "primary" as const,
  },
  {
    name: "Model C",
    quant: "FP16",
    size: "32B",
    fit: "Unlikely",
    tone: "muted" as const,
  },
]

const pipeline = ["Detect", "Estimate", "Validate", "Load", "Infer", "Measure"]

const toneClasses: Record<string, string> = {
  secure: "border-secure/40 bg-secure/10 text-secure",
  primary: "border-primary/40 bg-primary/10 text-primary",
  muted: "border-border/60 bg-secondary text-muted-foreground",
}

export function HardwareAware() {
  return (
    <section className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Hardware-Aware Intelligence"
          title="THE RIGHT MODEL FOR THE MACHINE YOU HAVE"
          description="SOVARA profiles CPU, RAM, GPU and VRAM to estimate whether a given model is likely to run well on your machine before it ever loads."
        />

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {models.map((model) => (
            <div
              key={model.name}
              className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">{model.name}</span>
                <Badge variant="outline" className="font-mono-tech text-[10px]">
                  {model.size}
                </Badge>
              </div>
              <span className="font-mono-tech text-xs text-muted-foreground">{model.quant}</span>
              <span
                className={`w-fit rounded-full border px-2.5 py-1 text-xs font-medium ${toneClasses[model.tone]}`}
              >
                {model.fit}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-center gap-3">
          {pipeline.map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <span className="rounded-full border border-border/60 bg-card px-4 py-1.5 font-mono-tech text-xs font-medium text-foreground">
                {step}
              </span>
              {i < pipeline.length - 1 ? (
                <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
