import type { ReactNode, ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { ConversationHeader } from './ConversationHeader'
import { TypingIndicator } from './TypingIndicator'
import { ThinkingIndicator } from './ThinkingIndicator'

interface ChatViewProps {
  sessions: Array<{ id: string; title: string }>
  selectedId: string | null
  events: Array<{ seq: number; time: number; type: string; data: unknown }>
  draft: string
  setDraft: React.Dispatch<React.SetStateAction<string>>
  busy: boolean
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
  onSend: (content: string) => void
  onNewline: () => void
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
  setBusy,
  onSend,
  onNewline,
  onCreateSession,
  onSwitchSession,
}: ChatViewProps): ReactElement {
  return (
    <section className="chat-view" aria-label="Chat">
      <ConversationHeader
        sessionId={selectedId || undefined}
        title='Chat'
        onNewSession={onCreateSession}
        onSwitchSession={onSwitchSession}
        sessions={sessions}
        loading={busy}
      />

      <MessageList events={events} />

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={onSend}
        onNewline={onNewline}
        disabled={busy}
      />

      { /* Thinking/Typing state rendering */ }
      {busy && (
        <TypingIndicator />
      )}
    </section>
  )
}