'use client'

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { MessageBubble, type ArtifactInfo } from './MessageBubble'
import { deriveMessages, type SessionEventLike } from './conversation'

interface MessageListProps {
  events: SessionEventLike[]
  thinking?: boolean
  streamingText?: string
  streamingReasoning?: string
  streamingModelBadge?: string
  streamingThoughtLabel?: string
  onRemove?: (eventSeq: number) => void
  onCopy?: (content: string) => void
  onRegenerate?: () => void
  onEditAndResend?: (content: string) => void
  busy?: boolean
  onOpenArtifact?: (artifact: ArtifactInfo) => void
}

const STICK_THRESHOLD_PX = 80

/**
 * MessageList — SOVARA chat stream (commit 257ec52 style).
 * Centered column, auto-stick to bottom while streaming,
 * scroll-to-bottom FAB when scrolled up.
 */
export function MessageList({
  events,
  thinking = false,
  streamingText = '',
  streamingReasoning = '',
  streamingModelBadge,
  streamingThoughtLabel,
  onRemove: _onRemove,
  onCopy,
  onRegenerate,
  onEditAndResend,
  busy = false,
  onOpenArtifact,
}: MessageListProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)
  const messages = deriveMessages(events)

  const handleScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickRef.current = distance <= STICK_THRESHOLD_PX
  }

  const scrollToBottom = (): void => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    if (stickRef.current) scrollToBottom()
  }, [messages.length, thinking, streamingText, streamingReasoning])

  useEffect(() => {
    scrollToBottom()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (messages.length === 0 && !thinking && streamingText === '' && streamingReasoning === '') {
    return (
      <div
        ref={scrollRef}
        className="sv-message-list"
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
        onScroll={handleScroll}
        tabIndex={0}
      />
    )
  }

  const lastAssistantIdx = [...messages].reverse().findIndex((m) => m.role === 'assistant' && !m.cancelled)
  const lastAssistantSeq = lastAssistantIdx >= 0 ? messages[messages.length - 1 - lastAssistantIdx]?.seq : null

  const content: ReactNode = (
    <>
      {messages.map((m) => (
        <MessageBubble
          key={m.seq}
          id={m.seq.toString()}
          role={m.role}
          content={m.content}
          timestamp={m.time}
          cancelled={m.cancelled}
          reasoning={m.reasoning}
          onCopy={onCopy}
          onRegenerate={m.role === 'assistant' && m.seq === lastAssistantSeq ? onRegenerate : undefined}
          canRegenerate={m.role === 'assistant' && m.seq === lastAssistantSeq}
          onEditAndResend={m.role === 'user' ? onEditAndResend : undefined}
          busy={busy}
          onOpenArtifact={onOpenArtifact}
        />
      ))}
      {streamingReasoning !== '' || streamingText !== '' ? (
        <MessageBubble
          id="streaming"
          role="assistant"
          content={streamingText}
          reasoning={streamingReasoning || undefined}
          reasoningStreaming={streamingReasoning !== '' && streamingText === ''}
          streaming={streamingText !== '' || streamingReasoning !== ''}
          modelBadge={streamingModelBadge}
          thoughtLabel={streamingThoughtLabel}
          busy={busy}
          onOpenArtifact={onOpenArtifact}
        />
      ) : thinking ? (
        <MessageBubble id="thinking" role="assistant" content="" thinking />
      ) : null}
    </>
  )

  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div
        ref={scrollRef}
        className="sv-message-list"
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
        onScroll={handleScroll}
        tabIndex={0}
      >
        {content}
      </div>
      {!stickRef.current ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to bottom"
          style={{
            position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
            width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--stitch-border, #E8E4DE)',
            background: '#FFFFFF', boxShadow: '0 2px 8px rgba(60,50,40,0.12)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--stitch-muted, #8A8279)', zIndex: 10,
          }}
        >
          <ChevronDown size={16} />
        </button>
      ) : null}
    </div>
  )
}
