import { useEffect, type ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer, type FileAttachment } from './Composer'
import type { SessionEventLike } from './conversation'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'
import type { ExecMode } from '../../components/ui/PermissionControl'
import { MessageSquare, Cpu } from 'lucide-react'

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
  onSend: (content: string, attachments?: FileAttachment[], opts?: { webSearch: boolean }) => void
  onCancel?: () => void
  onRegenerate?: () => void
  onEditAndResend?: (content: string) => void
  onCopy?: (content: string) => void
  onCreateSession: () => void
  onSwitchSession: (id: string) => void
  onOpenModels?: () => void
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
  onSelectModel?: (runtimeId: string, modelId: string) => void
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
  onRegenerate = (): void => {},
  onEditAndResend = (): void => {},
  onCopy = (): void => {},
  onCreateSession,
  onSwitchSession,
  onOpenModels = (): void => {},
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
  onSelectModel,
}: ChatViewProps): ReactElement {
  const streaming = busy && phase === 'streaming'
  const hasConversation = !!selectedId
  // Show conversation as soon as a send starts (busy/streaming) so streamingText/thinking
  // is visible even before events are refreshed with the new user message. Without this
  // the first message from the empty hero state never shows the AI response.
  const hasMessages = events.length > 0 || streaming || streamingText !== ''
  const showEmpty = !hasConversation || !hasMessages

  // Escape to cancel generation — accessibility requirement
  useEffect(() => {
    if (!streaming) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [streaming, onCancel])

  const getActionableError = (err: string | null): { title: string; hint: string } | null => {
    if (!err) return null
    const lower = err.toLowerCase()
    if (lower.includes('no active local model') || lower.includes('no-active-model')) {
      return { title: 'No local model selected', hint: 'Open Models and select a model to start chatting.' }
    }
    if (lower.includes('runtime-unavailable') || lower.includes('runtime is unavailable')) {
      return { title: 'Model runtime unavailable', hint: 'The selected runtime is unavailable. Open Models and test its connection.' }
    }
    if (lower.includes('resource-pressure')) {
      return { title: 'Resource pressure', hint: 'The system is under memory pressure and refused the request. Close other models or lower context.' }
    }
    if (lower.includes('already-generating')) {
      return { title: 'Already generating', hint: 'Wait for the current reply to finish or press Stop.' }
    }
    if (lower.includes('persistence-failed') || lower.includes('could not persist')) {
      return { title: 'Could not save message', hint: 'The session file may be locked or the disk full. Try again.' }
    }
    return { title: 'Generation failed', hint: err }
  }
  const actionable = getActionableError(error)

  const modelHeader = model.available && model.displayName ? (
    <span className="status-badge" aria-label={`Model header ${model.displayName}`}>
      <span className="status-dot" aria-hidden>●</span> {model.displayName}{model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''} — Ready
    </span>
  ) : (
    <span className="status-badge status-badge--unavailable" aria-label="Model header unavailable">
      <Cpu size={12} aria-hidden /> No model available
    </span>
  )

  return (
    <section className="chat-view" aria-label="Chat">
      {/* Chat header — model context, always visible when a conversation exists or when empty */}
      <div className="chat-header" role="banner" aria-label="Chat header">
        <div className="chat-header-model">
          <span className="chat-header-label muted small">Model</span>
          {modelHeader}
        </div>
        {!model.available ? (
          <div className="chat-header-unavailable" role="status" aria-label="Model unavailable">
            <span className="muted small">No model runtime is currently available.</span>
            <button type="button" className="btn btn-sm" onClick={onOpenModels} aria-label="Open Models">
              Open Models
            </button>
          </div>
        ) : null}
      </div>

      {showEmpty ? (
        <div className="chat-empty-state" role="status" aria-label="Start a conversation">
          <div className="chat-empty-hero">
            <div className="chat-empty-icon" aria-hidden>
              <MessageSquare size={40} strokeWidth={1.5} />
            </div>
            <h1 className="chat-empty-title">What can I help with?</h1>
            <p className="chat-empty-subtitle muted">
              {model.available ? 'Ask anything — replies stream from your local model.' : 'No model runtime available — connect or load a local model from Models to start chatting.'}
            </p>
            {!model.available ? (
              <button type="button" className="btn" onClick={onOpenModels} aria-label="Open Models to load a model">
                Open Models
              </button>
            ) : null}
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
              onSelectModel={onSelectModel}
            />
          </div>

          <div className="chat-empty-hints">
            <span className="chat-empty-hint">Shift+Enter for newline • Enter to send • Esc to stop</span>
            <span className="chat-empty-dot" aria-hidden>·</span>
            <span className="chat-empty-hint">No cloud, no network beyond localhost</span>
          </div>
        </div>
      ) : (
        <>
          {actionable ? (
            <div className="chat-error chat-error--actionable" role="alert" aria-label="Chat error">
              <div className="chat-error-title">{actionable.title}</div>
              <div className="chat-error-hint muted small">{actionable.hint}</div>
              <div className="chat-error-actions">
                {(actionable.title.includes('model') || actionable.title.includes('Model')) ? (
                  <button type="button" className="btn btn-sm" onClick={onOpenModels} aria-label="Open Models">
                    Open Models
                  </button>
                ) : null}
                {onDismissError ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={onDismissError} aria-label="Dismiss error">
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <MessageList
            events={events}
            thinking={busy && streamingText === ''}
            streamingText={streamingText}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
            onEditAndResend={onEditAndResend}
            busy={busy}
          />

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
            {streaming ? <span className="streaming-indicator" aria-live="polite" aria-label="Generating">● Streaming…</span> : null}
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
                onSelectModel={onSelectModel}
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
