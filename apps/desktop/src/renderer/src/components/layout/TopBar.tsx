import { Shield, HardDrive } from 'lucide-react'

interface Props {
  appName?: string
  phaseLabel?: string
}

export function TopBar({ appName = 'Sovara', phaseLabel = 'Phase 1 — Foundation' }: Props): React.JSX.Element {
  return (
    <header className="topbar" role="banner">
      <div className="brand" aria-label={`${appName} brand`}>
        <span className="brand-mark" aria-hidden>
          ◆
        </span>
        <span className="brand-name">{appName}</span>
        <span className="brand-phase">{phaseLabel}</span>
      </div>

      <div className="topbar-center" aria-hidden>
        <span className="topbar-divider" />
      </div>

      <div className="topbar-right" role="status" aria-live="polite">
        <span className="status-indicator" title="Local and offline by default — no telemetry. Verified via HttpClient allowlist and verify-no-bare-fetch.">
          <Shield size={14} aria-hidden />
          <span>Local</span>
        </span>
        <span className="status-indicator" title="Offline by default — external network requires explicit allow flag.">
          <HardDrive size={14} aria-hidden />
          <span>Offline</span>
        </span>
        <span className="pill" title="No telemetry — no analytics SDK is bundled; verify via build output.">
          No telemetry
        </span>
      </div>
    </header>
  )
}
