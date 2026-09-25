import type { ReactNode } from "react"
import { Separator } from "@/components/ui/separator"

export function DocSection({
  id,
  title,
  children,
  last,
}: {
  id: string
  title: string
  children: ReactNode
  last?: boolean
}) {
  return (
    <section id={id} className="scroll-mt-24 py-8 first:pt-0">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
      {!last ? <Separator className="mt-8" /> : null}
    </section>
  )
}
