const highlights = [
  {
    title: "Architecture",
    body: "Electron + React + AppBackend + local llama-server.",
  },
  {
    title: "Storage",
    body: "SQLite WAL + JSONL append-only audit log.",
  },
  {
    title: "Model Lifecycle",
    body: "Load → Active → Busy → Evict → Offline.",
  },
  {
    title: "Hardware Validation",
    body: "Detect → Profile → Estimate → Load → Infer → Measure → Validate.",
  },
  {
    title: "Security",
    body: "Sandbox + context isolation + Zod IPC + loopback inference.",
  },
  {
    title: "Testing",
    body: "101 automated tests.",
  },
]

export function DocsHighlights() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {highlights.map((item) => (
        <div key={item.title} className="rounded-lg border border-border/60 bg-card p-4">
          <h3 className="font-mono-tech text-xs font-semibold uppercase tracking-wide text-primary">
            {item.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground/85">{item.body}</p>
        </div>
      ))}
    </div>
  )
}
