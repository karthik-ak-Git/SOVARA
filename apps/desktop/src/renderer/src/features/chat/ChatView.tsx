import type { ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { ConversationHeader } from './ConversationHeader'
import type { SessionEventLike } from './conversation'

interface ChatViewProps {
  sessions: Array<{ id: string; title: string }>
  selectedId: string | null
  events: SessionEventLike[]
  draft: string
  setDraft: (value: string) => void
  busy: boolean
  error: string | null
  onDismissError?: () => void
  onSend: (content: string) => void
  onCreateSession: () => void
  onSwitchSession: (id: string) => void
}

export function ChatView({
  sessions,
  selectedId,
  events,
  draft,
  setDraft,
  busy,
  error,
  onDismissError,
  onSend,
  onCreateSession,
  onSwitchSession,
}: ChatViewProps): ReactElement {
  const active = sessions.find((s) => s.id === selectedId)
  return (
    <section className="chat-view" aria-label="Chat">
      <ConversationHeader
        sessionId={selectedId || undefined}
        title={active ? active.title : 'Chat'}
        onNewSession={onCreateSession}
        onSwitchSession={onSwitchSession}
        sessions={sessions}
        loading={busy && events.length === 0}
      />

      {error ? (
        <div className="chat-error" role="alert" aria-label="Chat error">
          <span>{error}</span>
          {onDismissError ? (
            <button type="button" className="btn btn-sm" onClick={onDismissError} aria-label="Dismiss error">
              Dismiss
            </button>
          ) : null}
        </div>
      ) : null}

      <MessageList events={events} thinking={busy} />

      <Composer value={draft} onChange={setDraft} onSend={onSend} disabled={busy || !selectedId} />
      {!selectedId ? (
        <p className="muted small chat-hint" role="status">
          Create a conversation to start chatting with the local mock assistant.
        </p>
      ) : null}
    </section>
  )
}