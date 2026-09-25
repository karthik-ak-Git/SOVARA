import { SectionHeading } from "@/components/site/section-heading"

const requirements = [
  { label: "OS", value: "Windows 10 / 11 x64" },
  { label: "CPU", value: "Standard modern Windows-compatible CPU" },
  { label: "RAM", value: "Required by the selected model" },
  { label: "GPU", value: "Optional NVIDIA GPU" },
  { label: "VRAM", value: "Depends on selected model / quantization" },
  { label: "Driver", value: "NVIDIA driver with nvidia-smi for GPU/VRAM profiling" },
  {
    label: "Admin",
    value:
      "No admin privileges are required for normal use, except normal filesystem write access to the SOVARA data directory.",
  },
]

export function SystemRequirements() {
  return (
    <section id="requirements" className="border-b border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Requirements" title="SYSTEM REQUIREMENTS" />

        <div className="mx-auto mt-12 max-w-3xl divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
          {requirements.map((req) => (
            <div
              key={req.label}
              className="grid grid-cols-1 gap-1.5 px-5 py-4 sm:grid-cols-[7rem_1fr] sm:gap-6"
            >
              <span className="font-mono-tech text-xs font-semibold uppercase tracking-wide text-primary">
                {req.label}
              </span>
              <span className="text-sm text-foreground/85">{req.value}</span>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-muted-foreground">
          Exact minimum RAM and VRAM values depend on the model and quantization you choose.
        </p>
      </div>
    </section>
  )
}
