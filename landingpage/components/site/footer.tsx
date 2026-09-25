import Link from "next/link"
import { Shield } from "lucide-react"
import { Separator } from "@/components/ui/separator"

const columns = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "Download", href: "/#download" },
      { label: "Security", href: "/#security" },
      { label: "Architecture", href: "/#architecture" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "GitHub", href: "https://github.com/karthik-ak-Git/SOVARA.git" },
      { label: "System Requirements", href: "/#requirements" },
      { label: "Installation Guide", href: "/#install" },
    ],
  },
]

export function Footer() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-10 lg:flex-row lg:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                <Shield className="size-4" aria-hidden="true" />
              </span>
              <span className="font-mono-tech text-sm font-semibold tracking-[0.2em] text-foreground">
                SOVARA
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Sovereign AI Desktop Workbench
            </p>
            <p className="mt-6 text-sm text-muted-foreground">
              Local-first AI for confidential work.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:gap-16">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {col.title}
                </h3>
                <ul className="mt-4 flex flex-col gap-3">
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <Separator className="my-8" />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} SOVARA. Version 1.1.3.
          </p>
          <p className="text-xs text-muted-foreground">
            Offline by default &middot; No telemetry &middot; Local inference
          </p>
        </div>
      </div>
    </footer>
  )
}
