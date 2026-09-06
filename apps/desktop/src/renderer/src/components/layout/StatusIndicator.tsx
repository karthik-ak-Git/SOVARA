import { ShieldCheck, WifiOff } from 'lucide-react'

interface Props {
  offline?: boolean
  local?: boolean
}

export function StatusIndicator({ offline = true, local = true }: Props): React.JSX.Element {
  return (
    <div className="status-row" role="status" aria-live="polite">
      <span className="status-badge" title={local ? 'Local — data stays on this device (userData)' : 'Remote'}>
        <ShieldCheck size={14} aria-hidden />
        {local ? 'Local' : 'Remote'}
      </span>
      <span className="status-badge" title={offline ? 'Offline by default — no external fetch' : 'Online'}>
        <WifiOff size={14} aria-hidden />
        {offline ? 'Offline' : 'Online'}
      </span>
      <span className="pill">No telemetry</span>
    </div>
  )
}
