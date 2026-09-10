import { useState, type ReactElement } from 'react'
import { MessageActions } from './components/MessageActions'

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
  /** Action handlers — provided by MessageList/ChatView */
  onCopy?: (content: string) => void
  onRegenerate?: () => void
  onEditAndResend?: (newContent: string) => void
  /** Whether regenerate is allowed (only latest assistant) */
  canRegenerate?: boolean
  /** Disable actions while streaming/sending */
  busy?: boolean
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
  onCopy,
  onRegenerate,
  onEditAndResend,
  canRegenerate = false,
  busy = false,
}: MessageBubbleProps): ReactElement {
  const isUser = role === 'user'
  const bubbles = isUser ? 'user-bubble' : 'assistant-bubble'
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(content)

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

  // Edit mode for user messages — inline resend without destroying history (append-only)
  if (isEditing && isUser && onEditAndResend) {
    return (
      <article
        key={id}
        data-testid="message-user-editing"
        data-role={role}
        className={`bubble ${bubbles} bubble--editing`}
        aria-label="Edit your message"
      >
        <textarea
          className="bubble-edit-input"
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value.slice(0, 32_000))}
          rows={3}
          autoFocus
          aria-label="Edit message"
          data-testid="edit-input"
        />
        <div className="bubble-edit-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const next = editDraft.trim()
              if (!next) return
              onEditAndResend(next)
              setIsEditing(false)
            }}
            disabled={!editDraft.trim() || busy}
            aria-label="Send edited message"
          >
            Send
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setEditDraft(content)
              setIsEditing(false)
            }}
            aria-label="Cancel edit"
          >
            Cancel
          </button>
        </div>
      </article>
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
      {!streaming && !thinking && !loading ? (
        <MessageActions
          role={role}
          content={content}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
          onEdit={isUser && onEditAndResend ? () => setIsEditing(true) : undefined}
          canRegenerate={canRegenerate}
          busy={busy}
        />
      ) : null}
    </article>
  )
}