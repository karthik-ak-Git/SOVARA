import type { ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { ConversationHeader } from './ConversationHeader'
import type { SessionEventLike } from './conversation'
import type { ActiveModelState } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'

interface ChatViewProps {
  sessions: Array<{ id: string; title: string }>
  selectedId: string | null
  events: SessionEventLike[]
  draft: string
  setDraft: (value: string) => void
  busy: boolean
  phase?: ChatPhase
  streamingText?: string
  error: string | null
  model?: ActiveModelState
  onDismissError?: () => void
  onSend: (content: string) => void
  onCancel?: () => void
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
  phase = 'idle',
  streamingText = '',
  error,
  model = { selection: null, available: false },
  onDismissError,
  onSend,
  onCancel = (): void => {},
  onCreateSession,
  onSwitchSession,
}: ChatViewProps): ReactElement {
  const active = sessions.find((s) => s.id === selectedId)
  const modelLabel =
    model.selection && model.available
      ? `${model.displayName ?? model.selection.modelId}${model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''}`
      : null
  const streaming = busy && phase === 'streaming'

  return (
    <section className="chat-view" aria-label="Chat">
      <ConversationHeader
        sessionId={selectedId || undefined}
        title={active ? active.title : 'Chat'}
        onNewSession={onCreateSession}
        onSwitchSession={onSwitchSession}
        sessions={sessions}
        loading={busy && events.length === 0 && streamingText === ''}
        modelLabel={modelLabel}
        modelOk={modelLabel !== null}
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

      <MessageList events={events} thinking={busy && streamingText === ''} streamingText={streamingText} />

      <div className="composer-row">
        <div className="composer-main">
          <Composer value={draft} onChange={setDraft} onSend={onSend} disabled={busy || !selectedId} />
        </div>
        {streaming ? (
          <button type="button" className="btn" onClick={onCancel} aria-label="Stop generating">
            Stop
          </button>
        ) : null}
      </div>
      {!selectedId ? (
        <p className="muted small chat-hint" role="status">
          Create a conversation to start chatting with the local model.
        </p>
      ) : null}
    </section>
  )
}
