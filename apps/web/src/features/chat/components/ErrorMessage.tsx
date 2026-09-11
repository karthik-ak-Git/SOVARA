'use client'

import type { ReactElement } from 'react'

interface ErrorMessageProps {
  title: string
  hint: string
  onDismiss?: () => void
  onOpenModels?: () => void
  showOpenModels?: boolean
}

export function ErrorMessage({ title, hint, onDismiss, onOpenModels, showOpenModels = false }: ErrorMessageProps): ReactElement {
  return (
    <div className="chat-error chat-error--actionable" role="alert" aria-label="Chat error">
      <div className="chat-error-title">{title}</div>
      <div className="chat-error-hint muted small">{hint}</div>
      <div className="chat-error-actions">
        {showOpenModels && onOpenModels ? (
          <button type="button" className="btn btn-sm" onClick={onOpenModels} aria-label="Open Models">
            Open Models
          </button>
        ) : null}
        {onDismiss ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss} aria-label="Dismiss error">
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  )
}
