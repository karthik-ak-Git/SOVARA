'use client'

import { useEffect, useState, useCallback, type ReactElement } from 'react'
import { MessageList } from './MessageList'
import { Composer, type FileAttachment } from './Composer'
import type { SessionEventLike } from './conversation'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'
import type { ExecMode } from '../../components/ui/PermissionControl'
import type { ArtifactInfo } from './MessageBubble'
import {
  MessageSquare,
  Loader2,
  Wrench,
  Brain,
  CheckCircle2,
  XCircle,
  Code2,
  Plus,
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
  projectName?: string | null
  artifactsPanelOpen?: boolean
  onToggleArtifacts?: (open: boolean) => void
  projects?: Array<{ id: string; name: string }>
  onSelectProject?: (id: string) => void
  onOpenArtifactFile?: (path: string) => void
}

/**
 * ChatView — SOVARA chat view (commit 257ec52 visual style).
 * sv-chat-main layout with workspace controls in a clean header row.
 */
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
  onOpenArtifactFile = (): void => {},
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
  const hasConversation = !!selectedId
  const hasMessages = events.length > 0
  const showEmpty = !hasConversation || !hasMessages

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
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }
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
            const title = lang.toLowerCase().includes('tsx') ? 'Component.tsx'
              : lang.toLowerCase().includes('ts') ? 'script.ts'
              : lang.toLowerCase().includes('py') ? 'script.py'
              : lang.toLowerCase().includes('html') ? 'index.html'
              : `${lang}-snippet`
            setActiveArtifact({ title, language: lang, code })
            return
          }
        }
      }
    }
  }, [events])

  const handleOpenArtifactInPanel = useCallback((art: ArtifactInfo) => { setActiveArtifact(art); setArtifactsPanelOpen(true) }, [])

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
    if (lower.includes('no active local model') || lower.includes('no-active-model') || lower.includes('no compatible model'))
      return { title: 'No local model available', hint: 'No compatible model is available for this task. Open Models and select a model or download one.', action: 'models' }
    if (lower.includes('runtime-unavailable') || lower.includes('runtime is unavailable'))
      return { title: 'Model runtime unavailable', hint: 'The selected runtime is unavailable. Open Models and test its connection.', action: 'models' }
    if (lower.includes('model could not be loaded') || lower.includes('model-load-failed') || lower.includes('failed')) {
      if (lower.includes('vram') || lower.includes('memory')) return { title: 'Model could not be loaded', hint: 'The selected model requires more VRAM than is currently available. Choose another model or unload one.', action: 'models' }
      return { title: 'Model could not be loaded', hint: err, action: 'models' }
    }
    if (lower.includes('resource-pressure') || lower.includes('resource-blocked'))
      return { title: 'Resource pressure', hint: 'The system is under memory pressure and refused the request. Close other models or lower context.', action: 'models' }
    if (lower.includes('already-generating'))
      return { title: 'Already generating', hint: 'Wait for the current reply to finish or press Stop.' }
    if (lower.includes('persistence-failed') || lower.includes('could not persist'))
      return { title: 'Could not save message', hint: 'The session file may be locked or the disk full. Try again.' }
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
  // Send-stage stepper — honest pipeline position derived from backend events.
  const STAGE_ORDER: Array<{ key: string; label: string }> = [
    { key: 'reading', label: 'Reading' },
    { key: 'planning', label: 'Planning' },
    { key: 'prompting', label: 'Prompting' },
    { key: 'selecting', label: 'Routing' },
    { key: 'loading', label: 'Loading' },
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

  const activeModelDisplay = activeModel.selection
    ? discoveredModels.find((m) => m.modelId === activeModel.selection!.modelId && m.runtimeId === activeModel.selection!.runtimeId)?.displayName ?? activeModel.displayName ?? activeModel.selection.modelId
    : 'No Model Selected'

  return (
    <section className="sv-chat-main" aria-label="Chat">
      {/* Main chat area */}
      {showEmpty ? (
        <div className="sv-empty-state" role="status" aria-label="Start a conversation">
          <div className="sv-empty-hero">
            <div className="sv-empty-icon" aria-hidden>
              <MessageSquare size={28} strokeWidth={1.5} />
            </div>
            <h1 className="sv-empty-title">What can I help with?</h1>
            <p className="sv-empty-sub">
              {model.available
                ? 'Ask anything — replies stream from your local model directly on your hardware.'
                : 'No model runtime available — connect or load a local model from Models to start chatting.'}
            </p>
            {!model.available ? (
              <button type="button" className="sv-btn sv-btn-primary" onClick={onOpenModels} aria-label="Open Models to load a model">
                Open Models
              </button>
            ) : null}
          </div>
          <div className="sv-composer">
            <Composer value={draft} onChange={setDraft} onSend={onSend} onCancel={onCancel} disabled={busy} busy={busy} phase={phase}
              active={activeModel} runtimes={runtimes} models={discoveredModels} projectCount={projectCount} onNewProject={onNewProject}
              execMode={execMode} onExecModeChange={onExecModeChange} execAvailable={execAvailable} reasoningEnabled={reasoningEnabled}
              onReasoningToggle={onReasoningToggle} onSelectModel={onSelectModel} onOpenSettings={onOpenModels} />
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--stitch-muted, #8A8279)', display: 'flex', gap: 6 }}>
            <span>Shift+Enter for newline • Enter to send • Esc to stop</span>
            <span aria-hidden>·</span>
            <span>Sovereign &amp; Private • No cloud telemetry</span>
          </div>
        </div>
      ) : (
        <div className="sv-chat-active-wrap">
          <SessionBadge label={`TODAY • ${projectName ? `Project ${projectName}` : 'Sovora Sovereign Workspace'}`} />

          {actionable ? (
            <div style={{ margin: '12px 24px', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--stitch-danger, #C04040)', background: 'var(--stitch-danger-bg, #FFF5F5)' }} role="alert">
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--stitch-danger, #C04040)' }}>{actionable.title}</div>
              <div style={{ fontSize: 12, color: 'var(--stitch-muted, #8A8279)', marginTop: 2 }}>{actionable.hint}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {actionable.action === 'models' ? (
                  <>
                    <button type="button" className="sv-btn sv-btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onOpenModels}>Open Models</button>
                    <button type="button" className="sv-btn sv-btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onOpenModels}>Choose another model</button>
                  </>
                ) : null}
                {onDismissError ? (
                  <button type="button" className="sv-btn sv-btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={onDismissError}>Dismiss</button>
                ) : null}
              </div>
            </div>
          ) : null}

          {showExecution && executionLabel ? (
            <div style={{ padding: '10px 24px', fontSize: 12, color: 'var(--stitch-muted, #8A8279)', borderBottom: '1px solid var(--stitch-border, #E8E4DE)', display: 'flex', flexDirection: 'column', gap: 6 }} role="status" aria-live="polite">
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
                {taskKindBadge ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--stitch-terracotta-bg, #FDF1ED)', color: 'var(--stitch-terracotta, #C65D3B)' }}>{taskKindBadge}</span> : null}
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
              {showVramBar ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'var(--stitch-border, #E8E4DE)' }}>
                    <div style={{ height: '100%', borderRadius: 2, background: 'var(--stitch-terracotta, #C65D3B)',
                      width: `${Math.min(100, Math.round(((exec.vramUsedMB ?? 0) / (exec.vramTotalMB ?? 8192)) * 100))}%` }} />
                  </div>
                  <span>VRAM {typeof exec.vramUsedMB === 'number' ? `${(exec.vramUsedMB / 1024).toFixed(1)}` : '0.0'} / {(exec.vramTotalMB ?? 8192) / 1024} GB</span>
                </div>
              ) : null}
              {exec.detail ? <div>{exec.detail}</div> : null}
              {exec.phase === 'loading' ? (
                <button type="button" className="sv-btn sv-btn-ghost" style={{ fontSize: 12, padding: '4px 8px', width: 'fit-content' }} onClick={onCancel}>Cancel</button>
              ) : null}
            </div>
          ) : null}

          {generatedFiles.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 24px' }} aria-label="Generated files">
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

          <div className="sv-status-bar" style={{ display: 'flex', gap: 8, padding: '6px 24px', fontSize: 11, color: '#8A8279', borderTop: '1px solid var(--stitch-border, #E8E4DE)' }}>
            {model.available && model.displayName ? (
              <span>LOCAL MODEL — {model.displayName}{model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''}</span>
            ) : (
              <span>NO LOCAL MODEL</span>
            )}
            {streaming ? <span style={{ color: '#D97757' }}>● Streaming…</span> : null}
            {exec.phase === 'reading' ? <span style={{ color: '#D97757' }}>● Reading file…</span> : null}
            {exec.phase === 'prompting' ? <span style={{ color: '#D97757' }}>● Prompting…</span> : null}
            {exec.phase === 'selecting' ? <span style={{ color: '#D97757' }}>● Routing model…</span> : null}
            {exec.phase === 'loading' ? <span style={{ color: '#D97757' }}>● Loading model…</span> : null}
            {exec.phase === 'thinking' ? <span style={{ color: '#D97757' }}>● Thinking…</span> : null}
            {exec.phase === 'tool' ? <span style={{ color: '#D97757' }}>● Tool running…</span> : null}
            {exec.phase === 'artifact' ? <span style={{ color: '#D97757' }}>● Generating file…</span> : null}
          </div>

          <div className="sv-composer">
            <Composer value={draft} onChange={setDraft} onSend={onSend} onCancel={onCancel} disabled={busy} busy={busy} phase={phase}
              active={activeModel} runtimes={runtimes} models={discoveredModels} projectCount={projectCount} onNewProject={onNewProject}
              execMode={execMode} onExecModeChange={onExecModeChange} execAvailable={execAvailable} reasoningEnabled={reasoningEnabled}
              onReasoningToggle={onReasoningToggle} onSelectModel={onSelectModel} onOpenSettings={onOpenModels} />
          </div>
        </div>
      )}

      {/* Artifact Side Panel */}
      {artifactsPanelOpen ? (
        <aside className="sv-artifact-panel" aria-label="Artifacts output panel">
          <div className="sv-artifact-header">
            <Code2 size={16} style={{ color: 'var(--stitch-terracotta, #C65D3B)' }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--stitch-ink, #1A1614)' }}>{activeArtifact?.title ?? 'Artifacts Canvas'}</span>
            {activeArtifact ? <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--stitch-terracotta-bg, #FDF1ED)', color: 'var(--stitch-terracotta, #C65D3B)', fontFamily: 'ui-monospace, Menlo, monospace' }}>{activeArtifact.language}</span> : null}
            <div style={{ flex: 1 }} />
            {activeArtifact ? (
              <div style={{ display: 'flex', gap: 2, marginRight: 4 }}>
                <button type="button" className={`sv-artifact-tab${artifactTab === 'code' ? ' sv-artifact-tab--active' : ''}`} onClick={() => setArtifactTab('code')}>Code</button>
                <button type="button" className={`sv-artifact-tab${artifactTab === 'preview' ? ' sv-artifact-tab--active' : ''}`} onClick={() => setArtifactTab('preview')}>Preview</button>
                <button type="button" className="sv-btn sv-btn-ghost" style={{ width: 28, height: 28, padding: 0 }} onClick={handleCopyArtifact} title="Copy artifact code" aria-label="Copy artifact code">
                  {copiedArtifact ? <Check size={14} style={{ color: 'var(--stitch-success, #5A8F5A)' }} /> : <Copy size={14} />}
                </button>
              </div>
            ) : null}
            <button type="button" className="sv-btn sv-btn-ghost" style={{ width: 28, height: 28, padding: 0 }}
              onClick={() => setArtifactsPanelOpen(false)} title="Close Artifact panel" aria-label="Close Artifact panel">
              <X size={14} />
            </button>
          </div>
          <div className="sv-artifact-body">
            {activeArtifact ? (
              artifactTab === 'preview' ? (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  {activeArtifact.language.toLowerCase() === 'html' || activeArtifact.language.toLowerCase() === 'svg' ? (
                    <iframe srcDoc={activeArtifact.code} title={activeArtifact.title} sandbox="allow-scripts"
                      style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
                  ) : (
                    <div style={{ padding: 16, fontSize: 13, color: 'var(--stitch-muted, #8A8279)' }}>
                      <div>Interactive render of <strong>{activeArtifact.title}</strong></div>
                      <div style={{ marginTop: 6, fontSize: 12 }}>Lines: {activeArtifact.code.split('\n').length} · Size: {activeArtifact.code.length} bytes</div>
                      <pre style={{ marginTop: 10, padding: 12, borderRadius: 8, background: 'var(--stitch-surface-container, #F0EDE8)', fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', overflow: 'auto' }}>
                        <code>{activeArtifact.code.slice(0, 500)}...</code>
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <pre className="sv-artifact-code"><code>{activeArtifact.code}</code></pre>
              )
            ) : (
              <div className="sv-artifact-empty">
                <Code2 size={32} style={{ color: 'var(--stitch-muted, #8A8279)', opacity: 0.5 }} />
                <h3 style={{ fontSize: 14, color: 'var(--stitch-ink, #1A1614)' }}>No Artifact Generated Yet</h3>
                <p style={{ fontSize: 12, color: 'var(--stitch-muted, #8A8279)', textAlign: 'center', lineHeight: 1.5 }}>
                  When your local model generates code, visual components, or structured files, they will appear here in live preview and full code view.
                </p>
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </section>
  )
}
