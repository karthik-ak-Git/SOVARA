import { ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

export function FlowDiagram({
  steps,
  className,
  emphasizeFirst,
  emphasizeLast,
}: {
  steps: string[]
  className?: string
  emphasizeFirst?: boolean
  emphasizeLast?: boolean
}) {
  return (
    <div className={cn("flex flex-col items-center gap-0", className)}>
      {steps.map((step, i) => (
        <div key={step} className="flex flex-col items-center">
          <div
            className={cn(
              "rounded-lg border px-5 py-3 text-center font-mono-tech text-xs font-medium tracking-wide sm:text-sm",
              (i === 0 && emphasizeFirst) || (i === steps.length - 1 && emphasizeLast)
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/60 bg-card text-foreground/85",
            )}
          >
            {step}
          </div>
          {i < steps.length - 1 ? (
            <ArrowDown className="my-1.5 size-4 text-muted-foreground" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </div>
  )
}
