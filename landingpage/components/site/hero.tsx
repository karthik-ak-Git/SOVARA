import Link from "next/link"
import { Download, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AppMockup } from "@/components/site/app-mockup"

const statusRow = [
  "Windows 10/11 x64",
  "Version 1.1.5",
  "Offline by default",
  "Local inference",
]

export function Hero() {
  return (
    <section id="home" className="relative overflow-hidden border-b border-border/60">
      <div
        aria-hidden="true"
        className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]"
      />
      <div
        aria-hidden="true"
        className="absolute -top-32 left-1/2 h-96 w-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative mx-auto grid max-w-7xl gap-14 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-10 lg:px-8 lg:py-28">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-secondary/50 px-3 py-1 font-mono-tech text-xs text-muted-foreground">
            Desktop-only · CUDA runtime
          </span>

          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            PRIVATE AI.
            <br />
            RUN LOCALLY.
            <br />
            CONTROL EVERYTHING.
          </h1>

          <p className="max-w-xl text-balance text-lg leading-relaxed text-muted-foreground">
            SOVARA is a sovereign, offline-first AI desktop workbench for running open-weight
            models on your own hardware.
          </p>

          <ul className="flex flex-col gap-2 text-sm text-foreground/85">
            <li>Keep inference local.</li>
            <li>Choose models based on your hardware.</li>
            <li>Run controlled AI agents.</li>
            <li>Connect tools through MCP.</li>
            <li>Keep sessions and audit data on your machine.</li>
          </ul>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button render={<Link href="/#download" />} nativeButton={false} size="lg">
              <Download data-icon="inline-start" />
              Download for Windows
            </Button>
            <Button render={<Link href="/docs" />} nativeButton={false} size="lg" variant="outline">
              <FileText data-icon="inline-start" />
              Explore Documentation
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-border/60 pt-5">
            {statusRow.map((item) => (
              <span
                key={item}
                className="font-mono-tech text-xs text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          <AppMockup />
        </div>
      </div>
    </section>
  )
}
