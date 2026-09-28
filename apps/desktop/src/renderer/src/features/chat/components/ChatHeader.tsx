import type { ReactElement } from 'react'
import type { ActiveModelState } from '@shared/types/models'
import { Cpu, Terminal, Loader2 } from 'lucide-react'
import { useRuntimeStatus } from '../../../hooks/useRuntimeStatus'

interface ChatHeaderProps {
  model: ActiveModelState
  onOpenModels?: () => void
}

/**
 * ChatHeader — model context per spec §15.
 * Consumes canonical runtime status from useRuntimeStatus hook.
 */
export function ChatHeader({ model, onOpenModels }: ChatHeaderProps): ReactElement {
  const { runtimeState } = useRuntimeStatus()
  const modelName = runtimeState.residentModelId || model.displayName || (model.selection?.modelId !== '__auto__' ? model.selection?.modelId : 'Local Model')
  const endpoint = runtimeState.residentEndpoint || '127.0.0.1:57039'
  const isAvailable = runtimeState.isAvailable || model.available

  const renderBadge = () => {
    if (runtimeState.status === 'MODEL_LOADING') {
      return (
        <span className="status-badge status-badge--loading" role="status" aria-label="Loading model">
          <Loader2 size={12} className="spin" aria-hidden /> Loading model — {modelName}
        </span>
      )
    }
    if (runtimeState.status === 'STREAMING') {
      return (
        <span className="status-badge status-badge--active" role="status" aria-label="Streaming completion">
          <span aria-hidden className="status-dot status-dot--active">●</span> Streaming — {modelName}
        </span>
      )
    }
    if (runtimeState.status === 'TOOL_EXECUTING') {
      return (
        <span className="status-badge status-badge--tool" role="status" aria-label="Executing tool">
          <Terminal size={12} aria-hidden /> Tool execution: {runtimeState.activeToolName || 'fs_read'} — {modelName}
        </span>
      )
    }
    if (isAvailable && modelName) {
      return (
        <span className="status-badge" role="status" aria-label={`Local model ${modelName} ready`}>
          <span aria-hidden className="status-dot status-dot--ready">●</span> Ready — {modelName} ({endpoint})
        </span>
      )
    }
    if (modelName) {
      return (
        <span className="status-badge status-badge--unavailable" role="status" aria-label={`Model ${modelName} offline`}>
          <span aria-hidden>●</span> {modelName} — Offline
        </span>
      )
    }
    return (
      <span className="status-badge status-badge--unavailable" role="status" aria-label="No local model selected">
        <Cpu size={12} aria-hidden /> No model available
      </span>
    )
  }

  return (
    <header className="chat-header" role="banner" aria-label="Chat header">
      <div className="chat-header-model">
        <span className="chat-header-label muted small">Model</span>
        {renderBadge()}
      </div>
      {!isAvailable && onOpenModels ? (
        <button type="button" className="btn btn-sm" onClick={onOpenModels} aria-label="Open Models">
          Open Models
        </button>
      ) : null}
    </header>
  )
}

