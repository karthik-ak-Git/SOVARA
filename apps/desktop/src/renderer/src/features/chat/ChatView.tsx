import { useEffect, useState, useMemo, useCallback, useRef, type ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer, type FileAttachment } from './Composer'
import type { SessionEventLike } from './conversation'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'
import type { ExecMode } from '../../components/ui/PermissionControl'
import type { ArtifactInfo } from './MessageBubble'
import {
  MessageSquare,
  Cpu,
  Loader2,
  Wrench,
  Brain,
  CheckCircle2,
  XCircle,
  Code2,
  Columns,
  Share2,
  FolderPlus,
  FolderOpen,
  Plus,
  MoreVertical,
  Check,
  Copy,
  X,
  Search,
  Zap,
} from 'lucide-react'
import type { AgentExecutionState } from './useChatSession'
import { ModelPill } from '../../components/ui/ModelPill'
import { ThinkingPill } from '../../components/ui/ThinkingPill'
import { SessionBadge } from '../../components/ui/SessionBadge'

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
  onOpenExplorer?: () => void
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
  projectName?: string | null
  artifactsPanelOpen?: boolean
  onToggleArtifacts?: (open: boolean) => void
  projects?: Array<{ id: string; name: string }>
  onSelectProject?: (id: string) => void
}

export function ChatView({
  sessions: _sessions,
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
  onCreateSession: _onCreateSession,
  onSwitchSession: _onSwitchSession,
  onOpenModels = (): void => {},
  onOpenExplorer = (): void => {},
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
  projectName = null,
  artifactsPanelOpen: propArtifactsPanelOpen,
  onToggleArtifacts: propOnToggleArtifacts,
  projects = [],
  onSelectProject,
}: ChatViewProps): ReactElement {
  const exec = execution ?? { taskKind: null, phase: phase as AgentExecutionState['phase'] }
  const isStreaming =
    busy &&
    (phase === 'streaming' ||
      exec.phase === 'streaming' ||
      exec.phase === 'loading' ||
      exec.phase === 'planning' ||
      exec.phase === 'selecting' ||
      exec.phase === 'ready' ||
      exec.phase === 'tool')
  const streaming = isStreaming
  const hasConversation = !!selectedId
  const hasMessages = events.length > 0
  const showEmpty = !hasConversation || !hasMessages

  // Model & project dropdown states in workspace sub-bar
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const projectDropdownRef = useRef<HTMLDivElement>(null)

  // Artifact side panel / split view state
  const [internalArtifactsOpen, setInternalArtifactsOpen] = useState(false)
  const artifactsPanelOpen = propArtifactsPanelOpen !== undefined ? propArtifactsPanelOpen : internalArtifactsOpen
  const setArtifactsPanelOpen = useCallback(
    (val: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof val === 'function' ? val(artifactsPanelOpen) : val
      setInternalArtifactsOpen(next)
      propOnToggleArtifacts?.(next)
    },
    [artifactsPanelOpen, propOnToggleArtifacts]
  )

  const [activeArtifact, setActiveArtifact] = useState<ArtifactInfo | null>(null)
  const [artifactTab, setArtifactTab] = useState<'code' | 'preview'>('code')
  const [copiedArtifact, setCopiedArtifact] = useState(false)
  const [copiedShare, setCopiedShare] = useState(false)

  // Close dropdowns on outside click or escape
  useEffect(() => {
    if (!modelDropdownOpen && !projectDropdownOpen) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setProjectDropdownOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setModelDropdownOpen(false)
        setProjectDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [modelDropdownOpen, projectDropdownOpen])

  // Escape to cancel generation
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

  // Automatically detect the latest code block in events as the active artifact
  useEffect(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e && e.type === 'assistant/message' && e.data) {
        const c = typeof e.data === 'string' ? e.data : (e.data as { content?: string }).content
        if (c && typeof c === 'string' && c.includes('```')) {
          const match = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/.exec(c)
          if (match) {
            const lang = match[1]?.trim() || 'code'
            const code = match[2]?.trimEnd() ?? ''
            const title = lang.toLowerCase().includes('tsx')
              ? 'Component.tsx'
              : lang.toLowerCase().includes('ts')
                ? 'script.ts'
                : lang.toLowerCase().includes('py')
                  ? 'script.py'
                  : lang.toLowerCase().includes('html')
                    ? 'index.html'
                    : `${lang}-snippet`
            setActiveArtifact({ title, language: lang, code })
            return
          }
        }
      }
    }
  }, [events])

  const handleOpenArtifactInPanel = useCallback((art: ArtifactInfo) => {
    setActiveArtifact(art)
    setArtifactsPanelOpen(true)
  }, [])

  const handleCopyArtifact = useCallback(() => {
    if (activeArtifact && navigator.clipboard) {
      void navigator.clipboard.writeText(activeArtifact.code)
      setCopiedArtifact(true)
      setTimeout(() => setCopiedArtifact(false), 2000)
    }
  }, [activeArtifact])

  const handleShareSession = useCallback(() => {
    const transcript = events
      .filter((e) => e.type === 'user/message' || e.type === 'assistant/message')
      .map((e) => {
        const role = e.type === 'user/message' ? 'User' : 'Assistant'
        const c = typeof e.data === 'string' ? e.data : (e.data as { content?: string }).content ?? ''
        return `### ${role}\n\n${c}\n`
      })
      .join('\n---\n\n')

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(transcript || 'Empty session.')
      setCopiedShare(true)
      setTimeout(() => setCopiedShare(false), 2000)
    }
  }, [events])

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

  const activeModelDisplay = activeModel.selection
    ? discoveredModels.find(
        (m) =>
          m.modelId === activeModel.selection!.modelId && m.runtimeId === activeModel.selection!.runtimeId
      )?.displayName ?? activeModel.displayName ?? activeModel.selection.modelId
    : 'No Model Selected'

  const filteredDropdownModels = useMemo(() => {
    if (!modelFilter) return discoveredModels
    const q = modelFilter.toLowerCase()
    return discoveredModels.filter(
      (m) => m.displayName.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q)
    )
  }, [discoveredModels, modelFilter])

  return (
    <section className="chat-view" aria-label="Chat">
      {/* Retain chat-header for accessibility and existing test contract */}
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

      {/* Workspace Sub-bar — Stitch layout with dynamic Sovora model controls */}
      <header className="workspace-subbar" aria-label="Workspace controls">
        <div className="workspace-subbar-left">
          {/* Dynamic Model Dropdown Pill — local-only source, Stitch visuals */}
          <div className="workspace-model-dropdown-wrap" ref={modelDropdownRef}>
            <ModelPill
              displayName={activeModelDisplay}
              available={!!activeModel.available}
              contextLabel="Local GPU"
              expanded={modelDropdownOpen}
              onToggle={() => setModelDropdownOpen((v) => !v)}
            />

            {modelDropdownOpen ? (
              <div
                className="workspace-model-dropdown-menu"
                role="listbox"
                aria-label="Select Intelligence Engine"
              >
                <div className="workspace-model-dropdown-header">
                  <span>Available Local Models</span>
                  <input
                    type="search"
                    className="input workspace-model-dropdown-search"
                    placeholder="Search models…"
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="workspace-model-dropdown-list">
                  {filteredDropdownModels.length === 0 ? (
                    <div className="workspace-model-dropdown-empty">
                      <span>No models discovered.</span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setModelDropdownOpen(false)
                          onOpenModels()
                        }}
                      >
                        Add Local Runtime
                      </button>
                    </div>
                  ) : (
                    filteredDropdownModels.map((m) => {
                      const isActive =
                        activeModel.selection?.modelId === m.modelId &&
                        activeModel.selection?.runtimeId === m.runtimeId
                      return (
                        <button
                          key={`${m.runtimeId}-${m.modelId}`}
                          type="button"
                          className={`workspace-model-item ${isActive ? 'active' : ''}`}
                          onClick={() => {
                            setModelDropdownOpen(false)
                            onSelectModel?.(m.runtimeId, m.modelId)
                          }}
                          role="option"
                          aria-selected={isActive}
                        >
                          <div className="workspace-model-item-icon">
                            <Cpu size={14} />
                          </div>
                          <div className="workspace-model-item-content">
                            <div className="workspace-model-item-top">
                              <span className="workspace-model-item-name">{m.displayName}</span>
                              {isActive ? (
                                <span className="workspace-model-item-active-chip">Active</span>
                              ) : null}
                            </div>
                            <span className="workspace-model-item-meta muted small">
                              {m.runtimeId === 'local' ? 'Sovora Local Engine' : m.runtimeId} · Local
                            </span>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>

                <div className="workspace-model-dropdown-footer">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setModelDropdownOpen(false)
                      onOpenExplorer()
                    }}
                  >
                    <Search size={13} /> Explore HuggingFace Models
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setModelDropdownOpen(false)
                      onOpenModels()
                    }}
                  >
                    <Wrench size={13} /> Manage Runtimes
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* Reasoning / Thinking toggle pill — toggles reasoningEnabled only */}
          <ThinkingPill enabled={!!reasoningEnabled} onToggle={(next) => onReasoningToggle?.(next)} />
        </div>

        {/* Sub-bar right action controls */}
        <div className="workspace-subbar-right">
          <button
            type="button"
            className={`workspace-subbar-btn ${artifactsPanelOpen ? 'active' : ''}`}
            onClick={() => setArtifactsPanelOpen((v) => !v)}
            title="Toggle Artifacts Split View"
            aria-label="Toggle Artifacts Split View"
          >
            <Code2 size={15} className="text-primary" />
            <span className="hidden-sm">Artifacts</span>
            {activeArtifact ? <span className="workspace-subbar-pulse" /> : null}
          </button>

          <div className="workspace-project-dropdown-wrap" ref={projectDropdownRef}>
            <button
              type="button"
              className={`workspace-subbar-btn ${projectName ? 'active' : ''}`}
              onClick={() => {
                if (projects && projects.length > 0) {
                  setProjectDropdownOpen((v) => !v)
                } else {
                  onNewProject()
                }
              }}
              title={projectName ? `Current Project: ${projectName}` : 'Assign session to a project'}
              aria-label="Project options"
            >
              <FolderPlus size={15} />
              <span className="hidden-sm">{projectName ? projectName : 'Project'}</span>
            </button>

            {projectDropdownOpen ? (
              <div className="workspace-project-dropdown-menu" role="menu" aria-label="Project Selection">
                <div className="workspace-project-dropdown-header">
                  <span>Projects</span>
                </div>
                <div className="workspace-project-dropdown-list">
                  {projects.map((p) => {
                    const isCurrent = projectName === p.name
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`workspace-project-dropdown-item ${isCurrent ? 'active' : ''}`}
                        onClick={() => {
                          setProjectDropdownOpen(false)
                          onSelectProject?.(p.id)
                        }}
                      >
                        <FolderOpen size={13} className="text-primary" />
                        <span className="workspace-project-dropdown-item-name">{p.name}</span>
                        {isCurrent ? <span className="workspace-project-dropdown-active-chip">Active</span> : null}
                      </button>
                    )
                  })}
                </div>
                <div className="workspace-project-dropdown-footer">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => {
                      setProjectDropdownOpen(false)
                      onNewProject()
                    }}
                  >
                    <Plus size={13} /> New Project…
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className="workspace-subbar-btn"
            onClick={handleShareSession}
            title={copiedShare ? 'Copied transcript!' : 'Export / Copy session transcript'}
            aria-label="Share session"
          >
            {copiedShare ? <Check size={14} className="text-success" /> : <Share2 size={15} />}
            <span className="hidden-sm">{copiedShare ? 'Copied' : 'Share'}</span>
          </button>
        </div>
      </header>

      {/* Main chat layout: Chat stream + optional Artifact Split Canvas */}
      <div className={`chat-layout-split ${artifactsPanelOpen ? 'has-split' : ''}`}>
        <div className="chat-main-column">
          {showEmpty ? (
            <div className="chat-empty-state" role="status" aria-label="Start a conversation">
              <div className="chat-empty-hero">
                <div className="chat-empty-icon" aria-hidden>
                  <MessageSquare size={40} strokeWidth={1.5} />
                </div>
                <h1 className="chat-empty-title">What can I help with?</h1>
                <p className="chat-empty-subtitle muted">
                  {model.available
                    ? 'Ask anything — replies stream from your local model directly on your hardware.'
                    : 'No model runtime available — connect or load a local model from Models to start chatting.'}
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
                <span className="chat-empty-hint">Sovereign &amp; Private • No cloud telemetry</span>
              </div>
            </div>
          ) : (
            <>
              {/* Session Context Header — Stitch centered badge, same text */}
              <div className="chat-session-badge-row">
                <SessionBadge
                  label={`TODAY • ${projectName ? `Project ${projectName}` : 'Sovora Sovereign Workspace'}`}
                />
              </div>

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

              {/* Honest agent execution status */}
              {showExecution && executionLabel ? (
                <div className="chat-execution" role="status" aria-live="polite" aria-label="Agent execution">
                  <div className="chat-execution-head">
                    <span className="chat-execution-icon" aria-hidden>
                      {exec.phase === 'loading' ? (
                        <Loader2 size={14} className="spin" />
                      ) : exec.phase === 'tool' ? (
                        <Wrench size={14} />
                      ) : exec.phase === 'planning' || exec.phase === 'selecting' ? (
                        <Brain size={14} />
                      ) : exec.phase === 'error' ? (
                        <XCircle size={14} />
                      ) : exec.phase === 'ready' ? (
                        <CheckCircle2 size={14} />
                      ) : null}
                    </span>
                    <span className="chat-execution-label">{executionLabel}</span>
                    {taskKindBadge ? <span className="badge badge--info chat-execution-task">{taskKindBadge}</span> : null}
                    {exec.modelId ? (
                      <span className="muted small chat-execution-model">
                        {exec.modelId.split(':').pop()}
                        {exec.runtimeId ? ` on ${exec.runtimeId}` : ''}
                      </span>
                    ) : null}
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
                onOpenArtifact={handleOpenArtifactInPanel}
              />

              <div className="chat-status-row">
                {model.available && model.displayName ? (
                  <span
                    className="status-badge"
                    role="status"
                    aria-label={`Local model ${model.displayName}${model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''}`}
                  >
                    LOCAL MODEL — {model.displayName}
                    {model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''}
                  </span>
                ) : (
                  <span className="status-badge" role="status" aria-label="No local model selected">
                    NO LOCAL MODEL
                  </span>
                )}
                {taskKindBadge && exec.phase !== 'idle' ? (
                  <span className="badge badge--info" aria-label={`Task ${taskKindBadge}`}>
                    {taskKindBadge}
                  </span>
                ) : null}
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
        </div>

        {/* Artifact Side Panel / Split Canvas */}
        {artifactsPanelOpen ? (
          <aside className="chat-artifact-panel" aria-label="Artifacts output panel">
            <div className="artifact-panel-header">
              <div className="artifact-panel-title-wrap">
                <Code2 size={16} className="text-primary" />
                <span className="artifact-panel-title">
                  {activeArtifact?.title ?? 'Artifacts Canvas'}
                </span>
                {activeArtifact ? (
                  <span className="badge badge--info font-mono text-[11px]">{activeArtifact.language}</span>
                ) : null}
              </div>
              <div className="artifact-panel-actions">
                {activeArtifact ? (
                  <>
                    <div className="artifact-panel-tabs">
                      <button
                        type="button"
                        className={`artifact-panel-tab ${artifactTab === 'code' ? 'active' : ''}`}
                        onClick={() => setArtifactTab('code')}
                      >
                        Code
                      </button>
                      <button
                        type="button"
                        className={`artifact-panel-tab ${artifactTab === 'preview' ? 'active' : ''}`}
                        onClick={() => setArtifactTab('preview')}
                      >
                        Preview
                      </button>
                    </div>
                    <button
                      type="button"
                      className="artifact-panel-btn"
                      onClick={handleCopyArtifact}
                      title="Copy artifact code"
                      aria-label="Copy artifact code"
                    >
                      {copiedArtifact ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="artifact-panel-btn"
                  onClick={() => setArtifactsPanelOpen(false)}
                  title="Close Artifact panel"
                  aria-label="Close Artifact panel"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="artifact-panel-body">
              {activeArtifact ? (
                artifactTab === 'preview' ? (
                  <div className="artifact-panel-preview">
                    {activeArtifact.language.toLowerCase() === 'html' ||
                    activeArtifact.language.toLowerCase() === 'svg' ? (
                      <iframe
                        srcDoc={activeArtifact.code}
                        title={activeArtifact.title}
                        sandbox="allow-scripts"
                        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                      />
                    ) : (
                      <div className="artifact-panel-simulated-preview">
                        <div className="artifact-preview-notice muted small">
                          Interactive render of <strong>{activeArtifact.title}</strong>
                        </div>
                        <div className="artifact-preview-code-summary">
                          <span className="muted small">Lines: {activeArtifact.code.split('\n').length}</span>
                          <span className="muted small">Size: {activeArtifact.code.length} bytes</span>
                        </div>
                        <pre className="artifact-preview-snippet">
                          <code>{activeArtifact.code.slice(0, 500)}...</code>
                        </pre>
                      </div>
                    )}
                  </div>
                ) : (
                  <pre className="artifact-panel-code">
                    <code>{activeArtifact.code}</code>
                  </pre>
                )
              ) : (
                <div className="artifact-panel-empty">
                  <Code2 size={32} className="muted" />
                  <h3>No Artifact Generated Yet</h3>
                  <p className="muted small">
                    When your local model generates code, visual components, or structured files, they will appear here in live preview and full code view.
                  </p>
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  )
}
