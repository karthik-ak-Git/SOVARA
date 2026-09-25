export const docSections = [
  { id: "overview", label: "Overview" },
  { id: "architecture", label: "Architecture" },
  { id: "design-decisions", label: "Design Decisions" },
  { id: "core-components", label: "Core Components" },
  { id: "data-models", label: "Data Models" },
  { id: "integrations", label: "Integrations" },
  { id: "deployment", label: "Deployment" },
  { id: "performance", label: "Performance" },
  { id: "security", label: "Security" },
  { id: "sovereignty", label: "Sovereignty" },
  { id: "renderer-features", label: "Renderer Features" },
  { id: "hardware-profiling", label: "Hardware Profiling" },
  { id: "testing", label: "Testing" },
  { id: "setup-troubleshooting", label: "Setup & Troubleshooting" },
  { id: "operational-runbook", label: "Operational Runbook" },
]

export function DocsSidebar() {
  return (
    <nav aria-label="Documentation sections" className="hidden lg:block">
      <div className="sticky top-24 flex max-h-[calc(100vh-7rem)] flex-col gap-1 overflow-y-auto pr-4">
        <span className="mb-2 font-mono-tech text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Contents
        </span>
        {docSections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
          >
            {section.label}
          </a>
        ))}
      </div>
    </nav>
  )
}
