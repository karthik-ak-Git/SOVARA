import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sovara',
  description: 'Sovara — Sovereign AI Workbench',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" data-sidebar="solid" data-diff="unified">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
