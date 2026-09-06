import type { ReactNode, ReactElement } from 'react'
import { MessageBubble } from './MessageBubble'

interface MessageListProps {
  events: Array<{ seq: number; time: number; type: string; data: unknown }>
  onRemove?: (eventSeq: number) => void
}

export function MessageList({
  events,
}: MessageListProps): ReactElement {
  const rendered = events
    .filter((e) => e.type === 'user/message' || e.type === 'assistant/message')
    .map((e) => {
      const content =
        (e.data as { content: string })?.content ?? JSON.stringify(e.data)
      const role = e.type === 'user/message' ? 'user' : 'assistant'
      const timestamp = e.time
      return (
        <MessageBubble
          key={e.seq}
          id={e.seq.toString()}
          role={role}
          content={content}
          timestamp={timestamp}
        />
      )
    })

  if (rendered.length === 0) {
    return (
      <div
        className="message-list-empty"
        role="status"
        aria-label="No messages yet — send a mock message."
      >
        No messages yet — send a mock message.
      </div>
    )
  }

  return <>{rendered}</>
}