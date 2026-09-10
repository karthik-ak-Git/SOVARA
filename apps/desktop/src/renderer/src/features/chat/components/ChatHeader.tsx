import type { ReactElement } from 'react'
import type { ActiveModelState } from '@shared/types/models'
import { Cpu } from 'lucide-react'

interface ChatHeaderProps {
  model: ActiveModelState
  onOpenModels?: () => void
}

/**
 * ChatHeader — model context per spec §15.
 * Consumes ActiveModelState without knowing runtime (llama.cpp/Ollama/LM Studio).
 */
export function ChatHeader({ model, onOpenModels }: ChatHeaderProps): ReactElement {
  const available = model.available && !!model.displayName
  return (
    <header className="chat-header" role="banner" aria-label="Chat header">
      <div className="chat-header-model">
        <span className="chat-header-label muted small">Model</span>
        {available ? (
          <span className="status-badge" role="status" aria-label={`Local model ${model.displayName}`}>
            <span aria-hidden>●</span> {model.displayName}{model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''} — Ready
          </span>
        ) : (
          <span className="status-badge status-badge--unavailable" role="status" aria-label="No local model selected">
            <Cpu size={12} aria-hidden /> No model available
          </span>
        )}
      </div>
      {!available && onOpenModels ? (
        <button type="button" className="btn btn-sm" onClick={onOpenModels} aria-label="Open Models">
          Open Models
        </button>
      ) : null}
    </header>
  )
}
