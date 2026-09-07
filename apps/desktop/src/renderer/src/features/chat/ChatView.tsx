import type { ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer, type FileAttachment } from './Composer'
import type { SessionEventLike } from './conversation'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'
import type { ExecMode } from '../../components/ui/PermissionControl'
import { MessageSquare } from 'lucide-react'

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
  onSend: (content: string, attachments?: FileAttachment[]) => void
  onCancel?: () => void
  onCreateSession: () => void
  onSwitchSession: (id: string) => void
  activeModel?: ActiveModelState
  runtimes?: ModelRuntimeEntry[]
  discoveredModels?: DiscoveredModel[]
  projectCount?: number
  onNewProject?: () => void
  execMode?: ExecMode
  onExecModeChange?: (mode: ExecMode) => void
  execAvailable?: boolean
  reasoningEnabled?: boolean
  onReasoningToggle?: (enabled: boolean) => void
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
  execMode = 'off',
  onExecModeChange = () => {},
  execAvailable = false,
  reasoningEnabled = false,
  onReasoningToggle = () => {},
}: ChatViewProps): ReactElement {
  const streaming = busy && phase === 'streaming'
  const hasConversation = !!selectedId
  const hasMessages = events.length > 0
  const showEmpty = !hasConversation || !hasMessages

  return (
    <section className="chat-view" aria-label="Chat">
      {showEmpty ? (
        <div className="chat-empty-state" role="status" aria-label="Start a conversation">
          <div className="chat-empty-hero">
            <div className="chat-empty-icon" aria-hidden>
              <MessageSquare size={40} strokeWidth={1.5} />
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
              onExecModeChange={onExecModeChange}
              execAvailable={execAvailable}
              reasoningEnabled={reasoningEnabled}
              onReasoningToggle={onReasoningToggle}
            />
          </div>

          <div className="chat-empty-hints">
            <span className="chat-empty-hint">Shift+Enter for newline</span>
            <span className="chat-empty-dot" aria-hidden>·</span>
            <span className="chat-empty-hint">No cloud, no network beyond localhost</span>
          </div>
        </div>
      ) : (
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
                onExecModeChange={onExecModeChange}
                execAvailable={execAvailable}
                reasoningEnabled={reasoningEnabled}
                onReasoningToggle={onReasoningToggle}
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
