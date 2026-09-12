import { useEffect, useState, useCallback, type ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer, type FileAttachment } from './Composer'
import type { SessionEventLike } from './conversation'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'
import type { ExecMode } from '../../components/ui/PermissionControl'
import type { ArtifactInfo } from './MessageBubble'
import {
  Loader2,
  Wrench,
  Brain,
  CheckCircle2,
  XCircle,
  Code2,
  FolderOpen,
  Check,
  Copy,
  X,
  FileSearch,
  Route,
  ListChecks,
  FileDown,
  FileText,
} from 'lucide-react'
import type { AgentExecutionState } from './useChatSession'
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
  /** Open a generated artifact file with the OS default app. */
  onOpenArtifactFile?: (path: string) => void
  projectName?: string | null
  artifactsPanelOpen?: boolean
  onToggleArtifacts?: (open: boolean) => void
  projects?: Array<{ id: string; name: string }>
  onSelectProject?: (id: string) => void
}

export function ChatView({
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
  onOpenArtifactFile = (): void => {},
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
      exec.phase === 'reading' ||
      exec.phase === 'prompting' ||
      exec.phase === 'thinking' ||
      exec.phase === 'selecting' ||
      exec.phase === 'ready' ||
      exec.phase === 'artifact' ||
      exec.phase === 'tool')
  const streaming = isStreaming
  const hasConversation = true
  const hasMessages = events.length > 0
  const showEmpty = !hasMessages

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

  useEffect(() => {
    if (!streaming) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [streaming, onCancel])

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

  const getActionableError = (err: string | null): { title: string; hint: string; action?: 'models' | 'retry' } | null => {
    if (!err) return null
    const lower = err.toLowerCase()
    if (lower.includes('no active local model') || lower.includes('no-active-model') || lower.includes('no compatible model')) {
      return { title: 'No local model available', hint: 'No compatible model is available for this task. Open Models and select a model or download one.', action: 'models' }
    }
    if (lower.includes('runtime-unavailable') || lower.includes('runtime is unavailable')) {
      return { title: 'Model runtime unavailable', hint: 'The selected runtime is unavailable. Open Models and test its connection.', action: 'models' }
    }
    if (lower.includes('invalid-response') || lower.includes('runtime answered 500') || lower.includes('runtime answered 502') || lower.includes('runtime answered 503')) {
      return { title: 'Model failed to generate', hint: `${err} — The local server returned an error. This often means the GGUF is incompatible with this llama.cpp build, context is too large, or the model file is corrupted. Try a different quant (e.g. Q4_K_M) or lower context to 2048, then reload the model.`, action: 'models' }
    }
    if (lower.includes('model could not be loaded') || lower.includes('model-load-failed') || lower.includes('failed')) {
      if (lower.includes('vram') || lower.includes('memory')) return { title: 'Model could not be loaded', hint: 'The selected model requires more VRAM than is currently available. Choose another model or unload one.', action: 'models' }
      return { title: 'Model could not be loaded', hint: err, action: 'models' }
    }
    if (lower.includes('resource-pressure') || lower.includes('resource-blocked')) {
      // Show real reason (e.g. waiting for previous load) not generic runtime error
      return { title: 'Model busy — please wait', hint: err.replace('resource-pressure:', '').trim() || 'A model is still loading. Wait a few seconds or unload the previous model.', action: 'models' }
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
      case 'reading': return exec.fileName ? `Reading ${exec.fileName}…` : 'Reading attachments…'
      case 'planning': return exec.taskKind ? `Planning — task: ${exec.taskKind}` : 'Understanding task…'
      case 'prompting': return 'Assembling prompt…'
      case 'selecting': return `Routing to best model${exec.modelId ? ` — ${exec.modelId.split(':').pop()}` : ''}…`
      case 'loading': return exec.modelId ? `Loading ${exec.modelId.split(':').pop()?.split('/').pop() ?? exec.modelId}…` : 'Loading model…'
      case 'ready': return exec.modelId ? `${exec.modelId.split(':').pop()?.split('/').pop() ?? exec.modelId} — Ready` : 'Model ready'
      case 'thinking': return 'Thinking…'
      case 'tool': return exec.toolName ? `Running tool: ${exec.toolName}…` : 'Running tool…'
      case 'artifact': return exec.artifactPath ? `Saved ${exec.fileName ?? 'file'}` : `Generating ${exec.fileName ?? 'file'}…`
      case 'streaming': return exec.taskKind ? `Generating — task: ${exec.taskKind}` : 'Generating…'
      case 'error': return exec.error ?? 'Task failed'
      case 'cancelled': return 'Cancelled'
      default: return null
    }
  })()
  // Orchestration flow: select (no load) -> send -> loading (real) -> prompting -> thinking(optional) -> generating
  // Model only loads on send, not on select — theme preserved. Order shows loading before prompting.
  const STAGE_ORDER: Array<{ key: string; label: string }> = [
    { key: 'reading', label: 'Reading' },
    { key: 'planning', label: 'Planning' },
    { key: 'selecting', label: 'Routing' },
    { key: 'loading', label: 'Loading' },
    { key: 'prompting', label: 'Prompting' },
    { key: 'thinking', label: 'Thinking' },
    { key: 'streaming', label: 'Generating' },
    { key: 'tool', label: 'Tool' },
    { key: 'artifact', label: 'File' },
  ]
  const stageIndexFor = (p: string): number => {
    if (p === 'ready') return 5
    const i = STAGE_ORDER.findIndex((s) => s.key === p)
    return i
  }
  const activeStage = stageIndexFor(exec.phase)
  // Generated files persist in the timeline (artifact/created session events).
  const generatedFiles: Array<{ fileName: string; path: string; kind: string; bytes?: number }> = []
  for (const e of events) {
    if (e && e.type === 'artifact/created' && e.data && typeof e.data === 'object') {
      const d = e.data as Record<string, unknown>
      if (typeof d['path'] === 'string' && typeof d['fileName'] === 'string') {
        generatedFiles.push({
          fileName: d['fileName'],
          path: d['path'],
          kind: typeof d['kind'] === 'string' ? d['kind'] : 'file',
          bytes: typeof d['bytes'] === 'number' ? d['bytes'] : undefined,
        })
      }
    }
  }
  const showVramBar = exec.phase === 'loading' && typeof exec.vramTotalMB === 'number'
  const taskKindBadge = exec.taskKind ? exec.taskKind : null

  const composerProps = {
    value: draft,
    onChange: setDraft,
    onSend,
    onCancel,
    disabled: busy,
    busy,
    phase,
    active: activeModel,
    runtimes,
    models: discoveredModels,
    projectCount,
    onNewProject,
    execMode,
    onExecModeChange,
    execAvailable,
    reasoningEnabled,
    onReasoningToggle,
    onSelectModel,
    onOpenSettings: onOpenModels,
  }

  return (
    <div className="sv-chat" style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Main chat column — empty centered, active bottom-anchored */}
      <div className="sv-chat-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {showEmpty ? (
          <div className="chat-empty-state" role="status" aria-label="Start a conversation" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '32px 24px', gap: 20 }}>
            <div className="sv-empty-art" aria-hidden>
              <svg width="88" height="88" viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="52" width="18" height="12" rx="2" fill="#D97757" stroke="#C46A4A" strokeWidth="1.2"/>
                <rect x="13" y="55" width="4" height="4" rx="0.5" fill="#fff" opacity="0.9"/>
                <rect x="19" y="55" width="4" height="4" rx="0.5" fill="#fff" opacity="0.9"/>
                <path d="M14 52 V48 H24 V52" stroke="#5C3A21" strokeWidth="1.4" fill="none"/>
                <path d="M42 68 L28 58 L30 38 L44 28 L62 30 L66 44 L62 62 L48 68 Z" fill="#D97757" stroke="#C46A4A" strokeWidth="1.2"/>
                <path d="M30 32 C30 18 42 10 56 14 L60 18 L34 28 Z" fill="#F0EDE8" stroke="#D8D2CB" strokeWidth="1.2"/>
                <rect x="28" y="28" width="34" height="4" rx="2" fill="#F0EDE8" stroke="#D8D2CB" strokeWidth="1"/>
                <rect x="46" y="10" width="8" height="6" rx="1.5" fill="#F0EDE8" stroke="#D8D2CB" strokeWidth="1"/>
                <rect x="38" y="44" width="8" height="10" rx="2" fill="#2C2825"/>
                <rect x="52" y="44" width="8" height="10" rx="2" fill="#2C2825"/>
                <circle cx="41.5" cy="48.5" r="1.5" fill="#fff"/>
                <circle cx="55.5" cy="48.5" r="1.5" fill="#fff"/>
                <rect x="44" y="58" width="8" height="2" rx="1" fill="#2C2825"/>
                <path d="M62 52 L74 46 L78 48 L66 54 Z" fill="#9CA3AF" stroke="#6B7280" strokeWidth="1"/>
                <rect x="60" y="50" width="14" height="3" rx="1" fill="#6B7280" transform="rotate(-28 62 51)"/>
              </svg>
            </div>
            <h2 className="sv-empty-title">What can I help with?</h2>
            {actionable ? (
              <div className="sv-error" role="alert" aria-label="Chat error" style={{ maxWidth: 560, width: '100%', marginTop: 8 }}>
                <div style={{ fontWeight: 600 }}>{actionable.title}</div>
                <div style={{ fontSize: 13, opacity: 0.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{actionable.hint}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {actionable.action === 'models' ? (
                    <button type="button" className="sv-btn sv-btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onOpenModels}>Open Models</button>
                  ) : null}
                  {onDismissError ? (
                    <button type="button" className="sv-btn sv-btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onDismissError}>Dismiss</button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {showExecution && executionLabel ? (
              <div style={{ padding: '8px 0', fontSize: 12, color: '#8A8279', display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 560, width: '100%' }} role="status" aria-live="polite">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span aria-hidden>
                    {exec.phase === 'loading' || exec.phase === 'planning' ? <Loader2 size={14} className="spin" /> :
                     exec.phase === 'tool' ? <Wrench size={14} /> :
                     exec.phase === 'reading' ? <FileSearch size={14} /> :
                     exec.phase === 'prompting' ? <ListChecks size={14} /> :
                     exec.phase === 'selecting' ? <Route size={14} /> :
                     exec.phase === 'thinking' || exec.phase === 'streaming' ? <Brain size={14} /> :
                     exec.phase === 'artifact' ? <FileDown size={14} /> :
                     exec.phase === 'error' ? <XCircle size={14} /> :
                     exec.phase === 'ready' ? <CheckCircle2 size={14} /> : null}
                  </span>
                  <span>{executionLabel}</span>
                </div>
              </div>
            ) : null}
            <Composer {...composerProps} />
          </div>
        ) : (
          <div className="sv-chat-active" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div className="sv-chat-stream" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                <div className="sv-session-header" style={{ padding: '8px 0' }}>
                  <SessionBadge label={`TODAY • ${projectName ? `Project ${projectName}` : 'Sovora Sovereign Workspace'}`} />
                </div>

                {actionable ? (
                  <div className="sv-error" role="alert" aria-label="Chat error">
                    <div style={{ fontWeight: 600 }}>{actionable.title}</div>
                    <div style={{ fontSize: 13, opacity: 0.7 }}>{actionable.hint}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      {actionable.action === 'models' ? (
                        <button type="button" className="sv-btn sv-btn-primary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onOpenModels}>Open Models</button>
                      ) : null}
                      {onDismissError ? (
                        <button type="button" className="sv-btn sv-btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={onDismissError}>Dismiss</button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {showExecution && executionLabel ? (
                  <div style={{ padding: '6px 0', fontSize: 12, color: '#8A8279', display: 'flex', flexDirection: 'column', gap: 6 }} role="status" aria-live="polite" aria-label="Agent execution">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span aria-hidden>
                        {exec.phase === 'loading' || exec.phase === 'planning' ? <Loader2 size={14} className="spin" /> :
                         exec.phase === 'tool' ? <Wrench size={14} /> :
                         exec.phase === 'reading' ? <FileSearch size={14} /> :
                         exec.phase === 'prompting' ? <ListChecks size={14} /> :
                         exec.phase === 'selecting' ? <Route size={14} /> :
                         exec.phase === 'thinking' || exec.phase === 'streaming' ? <Brain size={14} /> :
                         exec.phase === 'artifact' ? <FileDown size={14} /> :
                         exec.phase === 'error' ? <XCircle size={14} /> :
                         exec.phase === 'ready' ? <CheckCircle2 size={14} /> : null}
                      </span>
                      <span>{executionLabel}</span>
                      {taskKindBadge ? <span style={{ padding: '1px 6px', borderRadius: 6, background: 'var(--stitch-parchment, #F0EDE8)', fontSize: 11 }}>{taskKindBadge}</span> : null}
                      {exec.phase === 'artifact' && exec.artifactPath ? (
                        <button type="button" className="sv-btn sv-btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => onOpenArtifactFile(exec.artifactPath as string)}>Open file</button>
                      ) : null}
                    </div>
                    {activeStage >= 0 ? (
                      <div className="sovara-stages" aria-hidden>
                        {STAGE_ORDER.map((s, i) => (
                          <span key={s.key} className={`sovara-stage${i < activeStage ? ' is-done' : ''}${i === activeStage ? ' is-active' : ''}`} title={s.label}>
                            <span className="sovara-stage-dot" />
                            <span className="sovara-stage-label">{s.label}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {generatedFiles.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0' }} aria-label="Generated files">
                    {generatedFiles.map((f) => (
                      <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--stitch-parchment, #F7F5F2)', fontSize: 12 }}>
                        <FileText size={14} aria-hidden />
                        <span style={{ fontWeight: 600 }}>{f.fileName}</span>
                        <span style={{ opacity: 0.55 }}>{f.kind}{typeof f.bytes === 'number' ? ` • ${(f.bytes / 1024).toFixed(1)}KB` : ''}</span>
                        <button type="button" className="sv-btn sv-btn-ghost" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }} onClick={() => onOpenArtifactFile(f.path)}>Open</button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <MessageList
                  events={events}
                  thinking={busy && streamingText === '' && streamingReasoning === '' && (exec.phase === 'streaming' || exec.phase === 'thinking')}
                  streamingText={streamingText}
                  streamingReasoning={streamingReasoning}
                  streamingModelBadge={activeModel.displayName ?? undefined}
                  streamingThoughtLabel={streaming ? 'Thinking…' : undefined}
                  onCopy={onCopy}
                  onRegenerate={onRegenerate}
                  onEditAndResend={onEditAndResend}
                  busy={busy}
                  onOpenArtifact={handleOpenArtifactInPanel}
                />
              </div>
            </div>

            <div className="sv-chat-bottom">
              <div className="sv-status-bar">
                {model.available && model.displayName ? (
                  <span style={{ fontSize: 11, color: '#8A8279' }}>
                    LOCAL MODEL — {model.displayName}
                    {model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#8A8279' }}>NO LOCAL MODEL</span>
                )}
                {streaming ? <span style={{ fontSize: 11, color: '#D97757' }}>● Streaming…</span> : null}
                {exec.phase === 'reading' ? <span style={{ fontSize: 11, color: '#D97757' }}>● Reading file…</span> : null}
                {exec.phase === 'prompting' ? <span style={{ fontSize: 11, color: '#D97757' }}>● Prompting…</span> : null}
                {exec.phase === 'selecting' ? <span style={{ fontSize: 11, color: '#D97757' }}>● Routing model…</span> : null}
                {exec.phase === 'loading' ? <span style={{ fontSize: 11, color: '#D97757' }}>● Loading model…</span> : null}
                {exec.phase === 'thinking' ? <span style={{ fontSize: 11, color: '#D97757' }}>● Thinking…</span> : null}
                {exec.phase === 'tool' ? <span style={{ fontSize: 11, color: '#D97757' }}>● Tool running…</span> : null}
                {exec.phase === 'artifact' ? <span style={{ fontSize: 11, color: '#D97757' }}>● Generating file…</span> : null}
              </div>
              <Composer {...composerProps} />
            </div>
          </div>
        )}
      </div>

      {/* Artifact side panel */}
      {artifactsPanelOpen ? (
        <div className="sv-artifact-panel" aria-label="Artifacts output panel">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--stitch-border, #E8E3DD)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Code2 size={14} style={{ color: '#D97757' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{activeArtifact?.title ?? 'Artifacts'}</span>
              {activeArtifact ? <span style={{ fontSize: 10, opacity: 0.5 }}>{activeArtifact.language}</span> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {activeArtifact ? (
                <>
                  <button type="button" className="sv-tab" style={{ opacity: artifactTab === 'code' ? 1 : 0.5 }} onClick={() => setArtifactTab('code')}>Code</button>
                  <button type="button" className="sv-tab" style={{ opacity: artifactTab === 'preview' ? 1 : 0.5 }} onClick={() => setArtifactTab('preview')}>Preview</button>
                  <button type="button" className="sv-icon-btn" onClick={handleCopyArtifact} title="Copy code" aria-label="Copy artifact code">
                    {copiedArtifact ? <Check size={14} style={{ color: '#D97757' }} /> : <Copy size={14} />}
                  </button>
                </>
              ) : null}
              <button type="button" className="sv-icon-btn" onClick={() => setArtifactsPanelOpen(false)} title="Close" aria-label="Close Artifact panel">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="sv-artifact-body">
            {activeArtifact ? (
              artifactTab === 'preview' ? (
                activeArtifact.language.toLowerCase() === 'html' || activeArtifact.language.toLowerCase() === 'svg' ? (
                  <iframe srcDoc={activeArtifact.code} title={activeArtifact.title} sandbox="allow-scripts" style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
                ) : (
                  <div style={{ padding: 12 }}>
                    <p style={{ fontSize: 12, color: '#8A8279' }}>Preview of <strong>{activeArtifact.title}</strong></p>
                    <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginTop: 8 }}>{activeArtifact.code.slice(0, 500)}...</pre>
                  </div>
                )
              ) : (
                <pre className="sv-code-block"><code>{activeArtifact.code}</code></pre>
              )
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, opacity: 0.5 }}>
                <Code2 size={28} />
                <p style={{ fontSize: 13 }}>No artifact yet</p>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
