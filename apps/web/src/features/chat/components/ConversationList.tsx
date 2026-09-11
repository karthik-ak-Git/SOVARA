'use client'

import type { ReactElement } from 'react'

interface ConversationListProps {
  sessions: Array<{ id: string; title: string; lastActivity?: number }>
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
}

/**
 * ConversationList — sidebar list per spec §13.
 * Uses indexed SQLite sessions metadata only; does not load event logs.
 */
export function ConversationList({ sessions, activeId, onSelect, onCreate }: ConversationListProps): ReactElement {
  if (sessions.length === 0) {
    return (
      <div className="conversation-list-empty" role="status" aria-label="No conversations">
        <p className="muted small">No conversations yet.</p>
        <button type="button" className="btn btn-sm" onClick={onCreate} aria-label="New conversation">
          New conversation
        </button>
      </div>
    )
  }
  return (
    <nav className="conversation-list" aria-label="Conversations">
      <ul role="list">
        {sessions.map((s) => (
          <li key={s.id} role="listitem">
            <button
              type="button"
              className={`conversation-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => onSelect(s.id)}
              aria-current={s.id === activeId ? 'true' : undefined}
              aria-label={`Conversation ${s.title}`}
            >
              <span className="conversation-title">{s.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-sm" onClick={onCreate} aria-label="New conversation">
        New conversation
      </button>
    </nav>
  )
}
