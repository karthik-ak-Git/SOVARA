import { cn } from "@/lib/utils"
import {
  MessageSquare,
  Cpu,
  Compass,
  Library,
  Bot,
  Plug,
  Settings,
  CircleDot,
} from "lucide-react"

const navItems = [
  { icon: MessageSquare, label: "Chat", active: true },
  { icon: Cpu, label: "Models" },
  { icon: Compass, label: "Explore" },
  { icon: Library, label: "Library" },
  { icon: Bot, label: "Agents" },
  { icon: Plug, label: "Connections" },
  { icon: Settings, label: "Settings" },
]

export function AppMockup({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl shadow-black/40",
        className,
      )}
    >
      {/* title bar */}
      <div className="flex items-center justify-between border-b border-border/60 bg-secondary/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full bg-destructive/70" />
          <span className="size-2.5 rounded-full bg-chart-3/70" />
          <span className="size-2.5 rounded-full bg-secure/70" />
        </div>
        <span className="font-mono-tech text-[11px] tracking-wide text-muted-foreground">
          SOVARA · v1.1.3
        </span>
        <div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 py-1">
          <CircleDot className="size-3 text-secure" />
          <span className="font-mono-tech text-[10px] text-muted-foreground">127.0.0.1</span>
        </div>
      </div>

      <div className="flex">
        {/* sidebar */}
        <div className="flex w-14 flex-col items-center gap-1 border-r border-border/60 bg-sidebar py-3 sm:w-16">
          {navItems.map((item) => (
            <div
              key={item.label}
              className={cn(
                "flex size-9 flex-col items-center justify-center rounded-lg text-[9px]",
                item.active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground",
              )}
            >
              <item.icon className="size-4" />
            </div>
          ))}
        </div>

        {/* main panel */}
        <div className="flex-1 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-secure/15 px-2.5 py-1 font-mono-tech text-[10px] font-medium text-secure">
                ● ACTIVE · llama-3.1-8b.Q4_K_M
              </span>
              <span className="rounded-full bg-secondary px-2.5 py-1 font-mono-tech text-[10px] text-muted-foreground">
                GPU · CUDA
              </span>
            </div>
            <span className="font-mono-tech text-[10px] text-muted-foreground">Session #0417</span>
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            <div className="max-w-[80%] rounded-lg rounded-tl-sm bg-secondary px-3 py-2 text-xs text-foreground/90">
              Summarize this quarter's incident reports and flag repeat root causes.
            </div>
            <div className="max-w-[85%] self-end rounded-lg rounded-tr-sm bg-primary/15 px-3 py-2 text-xs text-foreground/90">
              Routing to local-summarizer &middot; classified as document-analysis. Streaming
              response from loopback inference&hellip;
            </div>
            <div className="flex items-center gap-1.5 self-end pr-1">
              <span className="size-1.5 animate-pulse rounded-full bg-primary" />
              <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
              <span className="size-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <MetricTile label="VRAM" value="6.1 / 12 GB" />
            <MetricTile label="Tokens/session" value="4,208" />
            <MetricTile label="Tool calls" value="3 audited" />
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
      <p className="font-mono-tech text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono-tech text-xs text-foreground">{value}</p>
    </div>
  )
}
