import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { MessageBubble } from './MessageBubble'
import { deriveMessages, type SessionEventLike } from './conversation'

interface MessageListProps {
  events: SessionEventLike[]
  thinking?: boolean
  /** Transient in-progress assistant text (never persisted). */
  streamingText?: string
  onRemove?: (eventSeq: number) => void
  onCopy?: (content: string) => void
  onRegenerate?: () => void
  onEditAndResend?: (content: string) => void
  busy?: boolean
}

const STICK_THRESHOLD_PX = 80

export function MessageList({ events, thinking = false, streamingText = '', onRemove, onCopy, onRegenerate, onEditAndResend, busy = false }: MessageListProps): ReactElement {
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
  }, [messages.length, thinking, streamingText])

  // First paint: start pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (messages.length === 0 && !thinking && streamingText === '') {
    return (
      <div
        ref={scrollRef}
        className="message-list"
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
        onScroll={handleScroll}
        tabIndex={0}
      />
    )
  }

  // Latest assistant eligible for regenerate (not cancelled, not streaming)
  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === 'assistant' && !m.cancelled)
  const lastAssistantSeq = lastAssistantIdx >= 0 ? messages[messages.length - 1 - lastAssistantIdx]?.seq : null

  let content: ReactNode = (
    <>
      {messages.map((m) => (
        <MessageBubble
          key={m.seq}
          id={m.seq.toString()}
          role={m.role}
          content={m.content}
          timestamp={m.time}
          cancelled={m.cancelled}
          onCopy={onCopy}
          onRegenerate={m.role === 'assistant' && m.seq === lastAssistantSeq ? onRegenerate : undefined}
          canRegenerate={m.role === 'assistant' && m.seq === lastAssistantSeq}
          onEditAndResend={m.role === 'user' ? onEditAndResend : undefined}
          busy={busy}
        />
      ))}
      {streamingText !== '' ? (
        <MessageBubble id="streaming" role="assistant" content={streamingText} streaming busy={busy} />
      ) : thinking ? (
        <MessageBubble id="thinking" role="assistant" content="" thinking />
      ) : null}
    </>
  )
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