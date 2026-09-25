import { SectionHeading } from "@/components/site/section-heading"

const stack = [
  "Electron 35",
  "React 18",
  "Vite",
  "TypeScript",
  "Zod",
  "Zustand",
  "llama.cpp",
  "GGUF",
  "SQLite",
  "JSONL",
  "MCP",
  "electron-updater",
  "Hugging Face",
]

export function TechStack() {
  return (
    <section className="border-b border-border/60 bg-secondary/20">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeading eyebrow="Stack" title="TECHNOLOGY STACK" />

        <div className="mt-10 flex flex-wrap justify-center gap-2.5">
          {stack.map((tech) => (
            <span
              key={tech}
              className="rounded-full border border-border/60 bg-card px-4 py-1.5 font-mono-tech text-xs text-foreground/85"
            >
              {tech}
            </span>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-xl text-center text-xs text-muted-foreground">
          Not every technology listed is required for every installation.
        </p>
      </div>
    </section>
  )
}
