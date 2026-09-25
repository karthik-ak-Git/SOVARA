import Link from "next/link"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

export function StickyMobileCta() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 p-3 backdrop-blur-md sm:hidden">
      <Button render={<Link href="/#download" />} nativeButton={false} className="w-full">
        <Download data-icon="inline-start" />
        Download SOVARA
      </Button>
    </div>
  )
}
