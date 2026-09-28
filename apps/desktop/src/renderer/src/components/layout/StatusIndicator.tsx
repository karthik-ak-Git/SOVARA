import { ShieldCheck, WifiOff, Terminal, Loader2 } from 'lucide-react'
import { useRuntimeStatus } from '../../hooks/useRuntimeStatus'

interface Props {
  offline?: boolean
  local?: boolean
}

export function StatusIndicator({ offline = true, local = true }: Props): React.JSX.Element {
  const { runtimeState } = useRuntimeStatus()

  const renderStatusPill = () => {
    switch (runtimeState.status) {
      case 'MODEL_LOADING':
        return (
          <span className="status-badge status-badge--loading" title="Loading model into VRAM">
            <Loader2 size={12} className="spin" aria-hidden /> Loading model
          </span>
        )
      case 'STREAMING':
        return (
          <span className="status-badge status-badge--active" title="Active local inference streaming">
            <span aria-hidden className="status-dot status-dot--active">●</span> Streaming
          </span>
        )
      case 'TOOL_EXECUTING':
        return (
          <span className="status-badge status-badge--tool" title={`Executing tool: ${runtimeState.activeToolName}`}>
            <Terminal size={12} aria-hidden /> Tool: {runtimeState.activeToolName || 'fs_read'}
          </span>
        )
      case 'MODEL_READY':
      case 'READY':
        return (
          <span className="status-badge" title="Local GGUF model ready for inference">
            <span aria-hidden className="status-dot status-dot--ready">●</span> Ready
          </span>
        )
      case 'ERROR':
        return (
          <span className="status-badge status-badge--unavailable" title={runtimeState.lastError || 'Runtime error'}>
            ● Error
          </span>
        )
      default:
        return (
          <span className="status-badge" title="Connected">
            ● Ready
          </span>
        )
    }
  }

  return (
    <div className="status-row" role="status" aria-live="polite">
      {renderStatusPill()}
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

