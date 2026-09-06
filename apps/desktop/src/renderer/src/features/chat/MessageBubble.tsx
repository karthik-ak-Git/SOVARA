import type { ReactNode, ReactElement } from 'react'

interface MessageBubbleProps {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  loading?: boolean
  thinking?: boolean
}

export function MessageBubble({
  id,
  role,
  content,
  timestamp,
  loading = false,
  thinking = false,
}: MessageBubbleProps): ReactElement {
  const isUser = role === 'user'
  const bubbles = isUser ? 'user-bubble' : 'assistant-bubble'

  if (loading) {
    return (
      <div
        key={id}
        data-testid="assistant-typing"
        data-role="assistant"
        className={`bubble ${bubbles} bubble--loading`}
        aria-live="polite"
        aria-label="Assistant is typing"
      >
        <div className="pill" aria-hidden>{'◆'}</div>
        <div className="empty empty--loading" aria-hidden />
      </div>
    )
  }

  if (thinking) {
    return (
      <div
        key={id}
        data-testid="assistant-thinking"
        data-role="assistant"
        className={`bubble ${bubbles} bubble--thinking`}
        aria-live="polite"
        aria-label="Assistant is thinking"
      >
        <div className="pill" aria-hidden>{'◆'}</div>
        <svg
          className="thinking-svg"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth={2}>
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="1.5s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      </div>
    )
  }

  return (
    <article
      key={id}
      data-testid={isUser ? 'message-user' : 'message-assistant'}
      data-role={role}
      className={`bubble ${bubbles}`}
      aria-label={isUser ? 'Your message' : 'Assistant response'}
    >
      <p className="bubble-text">{content}</p>
      <span className="bubble-meta muted small">
        {typeof timestamp === 'number' && Number.isFinite(timestamp) ? (
          <time dateTime={new Date(timestamp).toISOString()}>
            {new Date(timestamp).toLocaleTimeString()}
          </time>
        ) : (
          ''
        )}
      </span>
    </article>
  )
}