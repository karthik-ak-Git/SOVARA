'use client'

import type { ReactElement } from 'react'
import { Button } from '../../components/ui/Button'

interface ConversationHeaderProps {
  sessionId?: string
  title: string
  onNewSession?: () => void
  onSwitchSession?: (id: string) => void
  sessions?: Array<{ id: string; title: string }>
  loading?: boolean
  /** Active local model line, e.g. "phi-4 on LM Studio". Null = none selected. */
  modelLabel?: string | null
  modelOk?: boolean
}

export function ConversationHeader({
  sessionId,
  title,
  onNewSession,
  onSwitchSession,
  sessions,
  loading = false,
  modelLabel = null,
  modelOk = false,
}: ConversationHeaderProps): ReactElement {
  const isSessionSelected = !!sessionId

  return (
    <header className="conversation-header" role="banner" aria-label="Conversation">
      <div className="header-top">
        <div className="header-info">
          <h1 className="header-title">{title}</h1>
          {isSessionSelected ? (
            <div className="header-meta">
              <span className="header-session-id">{sessionId?.slice(0, 8)}…</span>
              {modelLabel && modelOk ? (
                <span className="badge badge--success" role="status" aria-label={`Local model ${modelLabel} connected`}>
                  {modelLabel}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="header-actions">
          <Button
            onClick={onNewSession}
            disabled={loading}
            aria-label="Create new conversation"
            variant="ghost"
            className="btn-sm"
          >
            + New
          </Button>
          {sessions && sessions.length > 1 ? (
            <select
              value={sessionId ?? ''}
              onChange={(e) => {
                const val = e.target.value
                if (val && onSwitchSession) onSwitchSession(val)
              }}
              aria-label="Switch conversation"
              disabled={loading}
              className="header-session-select"
            >
              <option value="">Switch…</option>
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
        <div className="header-loading" aria-live="polite" role="status">
          <span className="pill pill--loading" aria-hidden>{'◆'}</span>
          Loading…
        </div>
      ) : null}
    </header>
  )
}
