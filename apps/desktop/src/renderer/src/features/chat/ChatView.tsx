import type { ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import type { SessionEventLike } from './conversation'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'
import { Sparkles } from 'lucide-react'

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
  /** Model workbench data — threaded from App to Composer */
  activeModel?: ActiveModelState
  runtimes?: ModelRuntimeEntry[]
  discoveredModels?: DiscoveredModel[]
  projectCount?: number
  onNewProject?: () => void
  execMode?: 'disabled' | 'ask' | 'policy' | 'automatic' | null
  execAvailable?: boolean
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
  activeModel = { selection: null, available: false },
  runtimes = [],
  discoveredModels = [],
  projectCount = 0,
  onNewProject = () => {},
  execMode = null,
  execAvailable = false,
}: ChatViewProps): ReactElement {
  const active = sessions.find((s) => s.id === selectedId)
  const streaming = busy && phase === 'streaming'
  const hasConversation = !!selectedId
  const hasMessages = events.length > 0
  const showEmpty = !hasConversation || !hasMessages

  return (
    <section className="chat-view" aria-label="Chat">
      {showEmpty ? (
        /* ── Empty state: Bionic-style centered workspace ── */
        <div className="chat-empty-state" role="status" aria-label="Start a conversation">
          <div className="chat-empty-hero">
            <div className="chat-empty-mascot" aria-hidden>
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Hard hat */}
                <ellipse cx="40" cy="28" rx="22" ry="8" fill="#FFD93D" />
                <rect x="22" y="20" width="36" height="12" rx="4" fill="#FFD93D" />
                <rect x="18" y="28" width="44" height="4" rx="2" fill="#FFC107" />
                {/* Face */}
                <rect x="24" y="32" width="32" height="28" rx="6" fill="#9B59B6" />
                {/* Eyes */}
                <circle cx="34" cy="42" r="4" fill="#1a1a2e" />
                <circle cx="46" cy="42" r="4" fill="#1a1a2e" />
                <circle cx="35" cy="41" r="1.5" fill="#ffffff" />
                <circle cx="47" cy="41" r="1.5" fill="#ffffff" />
                {/* Smile */}
                <path d="M34 50 Q40 56 46 50" stroke="#1a1a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
                {/* Toolbox */}
                <rect x="52" y="48" width="14" height="10" rx="2" fill="#EF4444" />
                <rect x="56" y="44" width="6" height="6" rx="1" fill="#EF4444" />
                <line x1="54" y1="53" x2="64" y2="53" stroke="#ffffff" strokeWidth="1.5" />
                {/* Hammer */}
                <rect x="60" y="36" width="3" height="14" rx="1" fill="#8B5CF6" />
                <rect x="57" y="34" width="9" height="5" rx="1.5" fill="#6B7280" />
              </svg>
            </div>
            <h1 className="chat-empty-title">What can I help with?</h1>
            <p className="chat-empty-subtitle muted">
              Ask anything — replies stream from your local model.
            </p>
          </div>

          <div className="chat-empty-composer">
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={onSend}
              disabled={busy}
              busy={busy}
              phase={phase}
              active={activeModel}
              runtimes={runtimes}
              models={discoveredModels}
              projectCount={projectCount}
              onNewProject={onNewProject}
              execMode={execMode}
              execAvailable={execAvailable}
            />
          </div>

          <div className="chat-empty-skills-card">
            <div className="chat-empty-skills-info">
              <span className="chat-empty-skills-title">Sovara now supports skills</span>
              <span className="chat-empty-skills-desc">Use, install, and create skills.</span>
            </div>
            <button type="button" className="chat-empty-skills-action">
              <Sparkles size={12} aria-hidden />
              Use skill
            </button>
          </div>

          <div className="chat-empty-hints">
            <span className="chat-empty-hint">Shift+Enter for newline</span>
            <span className="chat-empty-dot" aria-hidden>·</span>
            <span className="chat-empty-hint">No cloud, no network beyond localhost</span>
          </div>
        </div>
      ) : (
        /* ── Active conversation ── */
        <>
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

          <div className="chat-status-row">
            {model.available && model.displayName ? (
              <span className="status-badge" role="status" aria-label={`Local model ${model.displayName}${model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''}`}>
                LOCAL MODEL — {model.displayName}{model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''}
              </span>
            ) : (
              <span className="status-badge" role="status" aria-label="No local model selected">
                NO LOCAL MODEL
              </span>
            )}
          </div>

          <div className="composer-row">
            <div className="composer-main">
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={onSend}
                disabled={busy}
                busy={busy}
                phase={phase}
                active={activeModel}
                runtimes={runtimes}
                models={discoveredModels}
                projectCount={projectCount}
                onNewProject={onNewProject}
                execMode={execMode}
                execAvailable={execAvailable}
              />
            </div>
            {streaming ? (
              <button type="button" className="btn" onClick={onCancel} aria-label="Stop generating">
                Stop
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
