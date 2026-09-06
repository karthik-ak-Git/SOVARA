import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { MessageBubble } from './MessageBubble'
import { deriveMessages, type SessionEventLike } from './conversation'

interface MessageListProps {
  events: SessionEventLike[]
  thinking?: boolean
  onRemove?: (eventSeq: number) => void
}

const STICK_THRESHOLD_PX = 80

export function MessageList({ events, thinking = false, onRemove }: MessageListProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const messages = deriveMessages(events)

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickRef.current = distance <= STICK_THRESHOLD_PX
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (stickRef.current) el.scrollTop = el.scrollHeight
  }, [messages.length, thinking])

  // First paint: start pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (messages.length === 0 && !thinking) {
    return (
      <div
        ref={scrollRef}
        className="message-list"
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
        onScroll={handleScroll}
        tabIndex={0}
      >
        <div
          className="message-list-empty"
          role="status"
          aria-label="Empty conversation"
        >
          <p className="empty-title">Start a local mock conversation</p>
          <p className="muted small">
            Type below and press Enter to send. The Phase 1 assistant is a
            deterministic local stub — no model, no network.
          </p>
          <p className="muted small">Shift+Enter inserts a newline.</p>
        </div>
      </div>
    )
  }

  let content: ReactNode = (
    <>
      {messages.map((m) => (
        <MessageBubble
          key={m.seq}
          id={m.seq.toString()}
          role={m.role}
          content={m.content}
          timestamp={m.time}
        />
      ))}
      {thinking ? (
        <MessageBubble id="thinking" role="assistant" content="" thinking />
      ) : null}
    </>
  )
  void onRemove
  return (
    <div
      ref={scrollRef}
      className="message-list"
      role="log"
      aria-label="Conversation messages"
      aria-live="polite"
      onScroll={handleScroll}
      tabIndex={0}
    >
      {content}
    </div>
  )
}