import Link from "next/link"
import { FileDown } from "lucide-react"
import { Button } from "@/components/ui/button"

const downloads = [
  { label: "Download Architecture", href: "https://github.com/karthik-ak-Git/SOVARA/blob/main/docs/ARCHITECTURE_DESKTOP.md" },
  { label: "Download Hardware Matrix", href: "https://github.com/karthik-ak-Git/SOVARA/blob/main/docs/HARDWARE_COMPATIBILITY_MATRIX.md" },
  { label: "Download Release Verification", href: "https://github.com/karthik-ak-Git/SOVARA/blob/main/docs/VERIFICATION_RELEASE.md" },
]

export function DocsDownloads() {
  return (
    <div className="flex flex-wrap gap-3">
      {downloads.map((item) => (
        <Button
          key={item.label}
          render={<Link href={item.href} />}
          nativeButton={false}
          variant="outline"
          size="sm"
        >
          <FileDown data-icon="inline-start" />
          {item.label}
        </Button>
      ))}
    </div>
  )
}
