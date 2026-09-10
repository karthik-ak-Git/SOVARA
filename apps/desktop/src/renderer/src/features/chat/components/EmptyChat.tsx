import type { ReactElement } from 'react'
import { MessageSquare } from 'lucide-react'

interface EmptyChatProps {
  hasModel: boolean
  onOpenModels?: () => void
}

export function EmptyChat({ hasModel, onOpenModels }: EmptyChatProps): ReactElement {
  return (
    <div className="chat-empty-state" role="status" aria-label="Start a conversation">
      <div className="chat-empty-hero">
        <div className="chat-empty-icon" aria-hidden>
          <MessageSquare size={40} strokeWidth={1.5} />
        </div>
        <h1 className="chat-empty-title">What can I help with?</h1>
        <p className="chat-empty-subtitle muted">
          {hasModel ? 'Ask anything — replies stream from your local model.' : 'No model runtime available — connect or load a local model from Models to start chatting.'}
        </p>
        {!hasModel && onOpenModels ? (
          <button type="button" className="btn" onClick={onOpenModels} aria-label="Open Models">
            Open Models
          </button>
        ) : null}
      </div>
    </div>
  )
}
