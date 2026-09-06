import type { ReactNode, ReactElement } from 'react'
import { Button } from '@renderer/components/ui/Button'

interface ConversationHeaderProps {
  sessionId?: string
  title: string
  onNewSession?: () => void
  onSwitchSession?: (id: string) => void
  sessions?: Array<{ id: string; title: string }>
  loading?: boolean
}

export function ConversationHeader({
  sessionId,
  title,
  onNewSession,
  onSwitchSession,
  sessions,
  loading = false,
}: ConversationHeaderProps): ReactElement {
  const isSessionSelected = !!sessionId

  return (
    <header className="conversation-header" role="banner" aria-label="Conversation">
      <div className="header-top">
        <div className="header-info">
          <h1 className="header-title">{title}</h1>
          {isSessionSelected ? (
            <div className="header-session">
              <span className="header-session-id">Session {sessionId?.slice(0, 8)}…</span>
            </div>
          ) : (
            <p className="header-subtle">Select or create a session</p>
          )}
        </div>

        <div className="header-actions">
          {loading ? (
            <span className="pill pill--loading" aria-hidden>{'◆'}</span>
          ) : (
            <Button
              onClick={onNewSession}
              aria-label="Create new session"
              style={{ marginRight: 8 }}
            >
              + New
            </Button>
          )}
          {isSessionSelected && sessions && sessions.length > 0 ? (
            <select
              onChange={(e) => {
                const val = e.target.value as string
                if (val && onSwitchSession) onSwitchSession(val!)
              }}
              aria-label="Switch session"
              style={{ marginLeft: 8 }}
            >
              <option value="">— Select session —</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="header-loading" aria-live="polite">
          <span className="pill pill--loading" aria-hidden>{'◆'}</span>
          Loading conversation…
        </div>
      ) : null}
    </header>
  )
}