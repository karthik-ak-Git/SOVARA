import { useEffect, type ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer, type FileAttachment } from './Composer'
import type { SessionEventLike } from './conversation'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'
import type { ExecMode } from '../../components/ui/PermissionControl'
import { MessageSquare, Cpu, Loader2, Wrench, Brain, CheckCircle2, XCircle } from 'lucide-react'
import type { AgentExecutionState } from './useChatSession'

interface ChatViewProps {
  sessions: Array<{ id: string; title: string }>
  selectedId: string | null
  events: SessionEventLike[]
  draft: string
  setDraft: (value: string) => void
  busy: boolean
  phase?: ChatPhase
  execution?: AgentExecutionState
  streamingText?: string
  streamingReasoning?: string
  error: string | null
  model?: ActiveModelState
  onDismissError?: () => void
  onSend: (content: string, attachments?: FileAttachment[], opts?: { webSearch?: boolean; reasoning?: boolean }) => void
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
  execution,
  streamingText = '',
  streamingReasoning = '',
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
  const exec = execution ?? { taskKind: null, phase: phase as AgentExecutionState['phase'] }
  const isStreaming = busy && (phase === 'streaming' || exec.phase === 'streaming' || exec.phase === 'loading' || exec.phase === 'planning' || exec.phase === 'selecting' || exec.phase === 'ready' || exec.phase === 'tool')
  const streaming = isStreaming
  const hasConversation = !!selectedId
  const hasMessages = events.length > 0
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

  const getActionableError = (err: string | null): { title: string; hint: string; action?: 'models' | 'retry' } | null => {
    if (!err) return null
    const lower = err.toLowerCase()
    if (lower.includes('no active local model') || lower.includes('no-active-model') || lower.includes('no compatible model')) {
      return { title: 'No local model available', hint: 'No compatible model is available for this task. Open Models and select a model or download one.', action: 'models' }
    }
    if (lower.includes('runtime-unavailable') || lower.includes('runtime is unavailable')) {
      return { title: 'Model runtime unavailable', hint: 'The selected runtime is unavailable. Open Models and test its connection.', action: 'models' }
    }
    if (lower.includes('model could not be loaded') || lower.includes('model-load-failed') || lower.includes('failed')) {
      // Distinguish VRAM vs generic load fail
      if (lower.includes('vram') || lower.includes('memory')) return { title: 'Model could not be loaded', hint: 'The selected model requires more VRAM than is currently available. Choose another model or unload one.', action: 'models' }
      return { title: 'Model could not be loaded', hint: err, action: 'models' }
    }
    if (lower.includes('resource-pressure') || lower.includes('resource-blocked')) {
      return { title: 'Resource pressure', hint: 'The system is under memory pressure and refused the request. Close other models or lower context.', action: 'models' }
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

  // Honest execution status — only when orchestrator has emitted a real state
  const showExecution = exec.phase !== 'idle' && exec.phase !== 'done'
  const executionLabel = (() => {
    switch (exec.phase) {
      case 'planning': return exec.taskKind ? `Planning — task: ${exec.taskKind}` : 'Understanding task…'
      case 'selecting': return `Selecting model${exec.modelId ? ` — ${exec.modelId.split(':').pop()}` : ''}…`
      case 'loading': return exec.modelId ? `Loading ${exec.modelId.split(':').pop()?.split('/').pop() ?? exec.modelId}…` : 'Loading model…'
      case 'ready': return exec.modelId ? `${exec.modelId.split(':').pop()?.split('/').pop() ?? exec.modelId} — Ready` : 'Model ready'
      case 'tool': return exec.toolName ? `Running tool: ${exec.toolName}…` : 'Running tool…'
      case 'streaming': return exec.taskKind ? `Generating — task: ${exec.taskKind}` : 'Generating…'
      case 'error': return exec.error ?? 'Task failed'
      case 'cancelled': return 'Cancelled'
      default: return null
    }
  })()
  const showVramBar = exec.phase === 'loading' && typeof exec.vramTotalMB === 'number'
  // Show task kind badge when known
  const taskKindBadge = exec.taskKind ? exec.taskKind : null

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
              onCancel={onCancel}
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
              onOpenSettings={onOpenModels}
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
                {actionable.action === 'models' ? (
                  <>
                    <button type="button" className="btn btn-sm" onClick={onOpenModels} aria-label="Open Models">
                      Open Models
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={onOpenModels} aria-label="Choose another model">
                      Choose another model
                    </button>
                  </>
                ) : null}
                {onDismissError ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={onDismissError} aria-label="Dismiss error">
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Honest agent execution status — real backend events only */}
          {showExecution && executionLabel ? (
            <div className="chat-execution" role="status" aria-live="polite" aria-label="Agent execution">
              <div className="chat-execution-head">
                <span className="chat-execution-icon" aria-hidden>
                  {exec.phase === 'loading' ? <Loader2 size={14} className="spin" /> : exec.phase === 'tool' ? <Wrench size={14} /> : exec.phase === 'planning' || exec.phase === 'selecting' ? <Brain size={14} /> : exec.phase === 'error' ? <XCircle size={14} /> : exec.phase === 'ready' ? <CheckCircle2 size={14} /> : null}
                </span>
                <span className="chat-execution-label">{executionLabel}</span>
                {taskKindBadge ? <span className="badge badge--info chat-execution-task">{taskKindBadge}</span> : null}
                {exec.modelId ? <span className="muted small chat-execution-model">{exec.modelId.split(':').pop()}{exec.runtimeId ? ` on ${exec.runtimeId}` : ''}</span> : null}
              </div>
              {showVramBar ? (
                <div className="chat-execution-vram" aria-label="VRAM usage">
                  <div className="chat-execution-vram-bar">
                    <div
                      className="chat-execution-vram-fill"
                      style={{ width: `${Math.min(100, Math.round(((exec.vramUsedMB ?? 0) / (exec.vramTotalMB ?? 8192)) * 100))}%` }}
                    />
                  </div>
                  <span className="muted small chat-execution-vram-text">
                    VRAM {typeof exec.vramUsedMB === 'number' ? `${(exec.vramUsedMB / 1024).toFixed(1)}` : '0.0'} / {(exec.vramTotalMB ?? 8192) / 1024} GB
                  </span>
                </div>
              ) : null}
              {exec.detail ? <div className="muted small chat-execution-detail">{exec.detail}</div> : null}
              {exec.phase === 'loading' ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel} aria-label="Cancel model loading">
                  Cancel
                </button>
              ) : null}
              {/* Expandable execution details — not raw logs */}
              {exec.phase === 'ready' || exec.phase === 'streaming' ? (
                <details className="chat-execution-details">
                  <summary className="muted small">Execution details</summary>
                  <div className="chat-execution-details-body muted small">
                    <div>Task: {exec.taskKind ?? 'chat'}</div>
                    {exec.modelId ? <div>Model: {exec.modelId}</div> : null}
                    {exec.runtimeId ? <div>Runtime: {exec.runtimeId}</div> : null}
                    {typeof exec.stepIndex === 'number' ? <div>Step: {exec.stepIndex + 1}</div> : null}
                    {exec.detail ? <div>Detail: {exec.detail}</div> : null}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}

          <MessageList
            events={events}
            thinking={busy && streamingText === '' && streamingReasoning === '' && exec.phase === 'streaming'}
            streamingText={streamingText}
            streamingReasoning={streamingReasoning}
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
            {taskKindBadge && exec.phase !== 'idle' ? <span className="badge badge--info" aria-label={`Task ${taskKindBadge}`}>{taskKindBadge}</span> : null}
            {streaming ? <span className="streaming-indicator" aria-live="polite" aria-label="Generating">● Streaming…</span> : null}
            {exec.phase === 'loading' ? <span className="streaming-indicator" aria-live="polite">● Loading model…</span> : null}
            {exec.phase === 'tool' ? <span className="streaming-indicator" aria-live="polite">● Tool running…</span> : null}
          </div>

          <div className="composer-row">
            <div className="composer-main">
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={onSend}
                onCancel={onCancel}
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
                onOpenSettings={onOpenModels}
              />
            </div>
          </div>
        </>
      )}
    </section>
  )
}
