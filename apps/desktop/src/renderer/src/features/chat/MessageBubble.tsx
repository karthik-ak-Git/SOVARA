import type { ReactNode, ReactElement } from 'react'

interface MessageBubbleProps {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  loading?: boolean
  thinking?: boolean
  /** Live in-progress reply (transient, not yet persisted). */
  streaming?: boolean
  /** Stopped generation marker (durable `assistant/cancelled` event). */
  cancelled?: boolean
}

export function MessageBubble({
  id,
  role,
  content,
  timestamp,
  loading = false,
  thinking = false,
  streaming = false,
  cancelled = false,
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
      data-testid={streaming ? 'message-streaming' : isUser ? 'message-user' : 'message-assistant'}
      data-role={role}
      className={`bubble ${bubbles}${streaming ? ' bubble--streaming' : ''}${cancelled ? ' bubble--cancelled' : ''}`}
      aria-label={streaming ? 'Assistant response in progress' : cancelled ? 'Cancelled generation' : isUser ? 'Your message' : 'Assistant response'}
      aria-live={streaming ? 'polite' : undefined}
    >
      <p className="bubble-text">
        {content}
        {streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
      </p>
      {cancelled ? <span className="bubble-meta muted small">Stopped — no reply was generated.</span> : null}
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