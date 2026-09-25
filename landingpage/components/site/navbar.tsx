"use client"

import Link from "next/link"
import { useState } from "react"
import { Menu, X, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"

const links = [
  { label: "Home", href: "/#home" },
  { label: "Features", href: "/#features" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Security", href: "/#security" },
  { label: "Architecture", href: "/#architecture" },
  { label: "Documentation", href: "/docs" },
  { label: "API Docs", href: "/api-docs" },
  { label: "Versions", href: "/versions" },
  { label: "Download", href: "/#download" },
]

export function Navbar() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/#home" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Shield className="size-4" aria-hidden="true" />
          </span>
          <span className="font-mono-tech text-sm font-semibold tracking-[0.2em] text-foreground">
            SOVARA
          </span>
        </Link>

        <ul className="hidden items-center gap-7 lg:flex">
          {links.map((link) => (
            <li key={link.label}>
              <Link
                href={link.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="hidden lg:block">
          <Button render={<Link href="/#download" />} nativeButton={false} size="sm">
            Download SOVARA
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-foreground lg:hidden"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label="Toggle navigation menu"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-border/60 bg-background px-4 py-4 lg:hidden">
          <ul className="flex flex-col gap-4">
            {links.map((link) => (
              <li key={link.label}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Button
            render={<Link href="/#download" />}
            nativeButton={false}
            size="sm"
            className="mt-4 w-full"
          >
            Download SOVARA
          </Button>
        </div>
      )}
    </header>
  )
}
