'use client'

import { useEffect, useState, useCallback, type ReactElement, type ReactNode } from 'react'
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
  Sparkles,
  MoreHorizontal,
  Shield,
} from 'lucide-react'
import type { AgentExecutionState } from './useChatSession'
import { SessionBadge } from '../../components/ui/SessionBadge'
import { ProjectSelector } from './ProjectSelector'
import { preparePreviewHtml, isVisualArtifact, isBinaryArtifact, bundleBinaryPreview } from '../../utils/previewBundler'
import { ArtifactCard } from '../../components/ui/ArtifactCard'

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
  onApproveTool?: (toolCallId: string, approved: boolean, modifiedArgs?: any) => void
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
  selectedProjectId?: string | null
  onSelectProject?: (id: string) => void
  onOpenArtifactFile?: (path: string) => void
  /** Notifies the shell (right-rail sidebar) which artifact is currently open in chat. */
  onActiveArtifactChange?: (artifact: { title: string; language: string; code: string } | null) => void
}

import { PermissionApprovalCard } from './components/PermissionApprovalCard'
import { ClarifyWizardCard } from './components/ClarifyWizardCard'
import { createPortal } from 'react-dom'

/** Fixed centered overlay (portal to body so no ancestor transform clips it). */
function CenteredOverlay({ children }: { children: ReactNode }) {
  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 950,
        background: 'rgba(2,6,23,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>{children}</div>
    </div>,
    document.body
  )
}

function PermissionApprovalWrapper({ execution, onApproveTool }: { execution: AgentExecutionState; onApproveTool?: (id: string, approved: boolean, args?: any) => void }) {
  if (!execution.toolCallId || !onApproveTool) return null

  // clarify tool → guided multi-step question wizard (centered)
  if (execution.clarifyQuestions && execution.clarifyQuestions.length > 0) {
    return (
      <ClarifyWizardCard
        questions={execution.clarifyQuestions}
        onResolve={(answers) => onApproveTool(execution.toolCallId!, true, { answers })}
        onSkip={() => onApproveTool(execution.toolCallId!, false)}
      />
    )
  }

  // permission card — centered overlay instead of left-aligned inline
  return (
    <CenteredOverlay>
      <PermissionApprovalCard
        toolCallId={execution.toolCallId}
        toolName={execution.toolName ?? 'command'}
        args={execution.args ?? {}}
        onApprove={(optionIndex, feedback) => {
          if (optionIndex === 5) {
            onApproveTool(execution.toolCallId!, false, feedback ? { feedback } : undefined)
          } else {
            const modifiedArgs = {
              ...(execution.args ?? {}),
              _forceApprove: true,
              _permissionScope: optionIndex === 2 ? 'conversation' : optionIndex === 3 ? 'project' : optionIndex === 4 ? 'global' : 'once',
            }
            onApproveTool(execution.toolCallId!, true, modifiedArgs)
          }
        }}
        onSkip={() => onApproveTool(execution.toolCallId!, false)}
      />
    </CenteredOverlay>
  )
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
  onApproveTool,
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
  selectedProjectId,
  onSelectProject,
  onOpenArtifactFile = (): void => {},
  onActiveArtifactChange,
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
  const [bundledHtml, setBundledHtml] = useState<string>('')

  useEffect(() => {
    if (!activeArtifact) {
      setBundledHtml('')
      return
    }
    const lang = activeArtifact.language.toLowerCase()
    if (isVisualArtifact(activeArtifact.code, lang)) {
      let isCancelled = false
      preparePreviewHtml(activeArtifact.code, events as never, selectedId ?? undefined, lang).then((res) => {
        if (!isCancelled) setBundledHtml(res)
      })
      return () => {
        isCancelled = true
      }
    } else {
      setBundledHtml('')
    }
  }, [activeArtifact, events, selectedId])

  useEffect(() => {
    if (!streaming) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); onCancel() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [streaming, onCancel])

  // Assistant code fences are content, not proof that a file was materialized.
  // Do not auto-open the first fence as an artifact; only explicit artifact/file
  // actions and verified structured responses should open the viewer.


  const handleOpenArtifactInPanel = useCallback((art: ArtifactInfo) => {
    setActiveArtifact(art)
    if (isVisualArtifact(art.code, art.language)) {
      setArtifactTab('preview')
    }
    setArtifactsPanelOpen(true)
  }, [])

  // Keep the right-rail sidebar's Artifact Viewer in sync with chat's active artifact
  useEffect(() => {
    onActiveArtifactChange?.(activeArtifact)
  }, [activeArtifact, onActiveArtifactChange])

  const handleOpenArtifactFileWithPanel = useCallback(async (filePath: string) => {
    onOpenArtifactFile(filePath)
    try {
      const { dispatchTool } = await import('../../lib/client/api')
      const raw = await dispatchTool('fs_read', { path: filePath }).catch(() => '')
      const code = typeof raw === 'string' ? raw : (raw as { output?: string })?.output ?? ''
      const ext = filePath.split('.').pop()?.toLowerCase() ?? 'text'
      const lang = ext === 'html' ? 'html' : ext === 'css' ? 'css' : ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx' ? 'javascript' : ext
      setActiveArtifact({ title: filePath, language: lang, code: code || `File: ${filePath}` })
      setArtifactsPanelOpen(true)
    } catch {
      setActiveArtifact({ title: filePath, language: 'code', code: `File: ${filePath}` })
      setArtifactsPanelOpen(true)
    }
  }, [onOpenArtifactFile])

  const handleCopyArtifact = useCallback(() => {
    if (activeArtifact) {
      void window.sovara.invoke('clipboard:write', { text: activeArtifact.code }).then(() => {
        setCopiedArtifact(true)
        setTimeout(() => setCopiedArtifact(false), 2000)
      })
    }
  }, [activeArtifact])

  const getActionableError = (err: string | null): { title: string; hint: string; action?: 'models' | 'retry' } | null => {
    if (!err) return null
    const lower = err.toLowerCase()
    if (lower.includes('no active local model') || lower.includes('no-active-model') || lower.includes('no compatible model'))
      return { title: 'No local model available', hint: 'No compatible model is available for this task. Open Models and select a model or download one.', action: 'models' }
    if (lower.includes('invalid-response') || lower.includes('runtime answered 500') || lower.includes('runtime answered 502') || lower.includes('runtime answered 503')) {
      // Suppressed — server auto-compacts and retries; no scary banner. Check logs if persists.
      // Must precede the runtime-unavailable check: handlers wrap 400s as
      // "runtime-unavailable: invalid-response: ..." and the generic branch
      // would otherwise swallow the suppression.
      return null
    }
    // Narrow model-load check MUST precede the broad runtime-unavailable check:
    // handlers now prefix model-load-failed separately, but pre-existing messages
    // or inner throws may still carry both substrings — model load wins.
    if (lower.includes('model-load-failed') || lower.includes('invalid-model') || lower.includes('unknown model architecture') || lower.includes('architecture') && lower.includes('not supported'))
      return { title: 'Model could not be loaded', hint: err.replace(/^(model-load-failed|invalid-model):\s*/i, ''), action: 'models' }
    if (lower.includes('runtime-unavailable') || lower.includes('runtime is unavailable'))
      return { title: 'Model runtime unavailable', hint: 'The selected runtime is unavailable. Open Models and test its connection.', action: 'models' }
    if (lower.includes('model could not be loaded') || lower.includes('failed')) {
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

  const showExecution = exec.phase !== 'idle' && exec.phase !== 'done' && exec.phase !== 'error' && streaming
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

  const activeTitle = selectedId ? _sessions.find((s) => s.id === selectedId)?.title ?? 'New chat' : 'New chat'
  const eyebrowProject = projectName ?? 'SOVARA'
  return (
    <section className={`sv-chat-main ${artifactsPanelOpen ? 'sv-chat-main--with-panel' : ''}`} aria-label="Chat">
      <div className="sv-chat-content">
      {/* Main chat area */}
      {showEmpty ? (
        <div
          className="sv-empty-state"
          role="status"
          aria-label="Start a conversation"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            padding: 24,
            width: '100%',
          }}
        >
          <ProjectSelector
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={(id) => { if (onSelectProject) onSelectProject(id ?? '__global__') }}
            onNewProject={onNewProject}
            currentProjectName={projectName}
          />
          <div className="sv-composer" style={{ width: '100%', maxWidth: 720 }}>
            {execution?.toolCallId && onApproveTool ? <PermissionApprovalWrapper execution={execution} onApproveTool={onApproveTool} /> : null}
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={onSend}
              onCancel={onCancel}
              disabled={busy && !execution?.toolCallId}
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
              projectName={projectName}
            />
          </div>
        </div>
      ) : (
        <div className="sv-chat-active-wrap">
          <div className="conversation-top">
            <div>
              <div className="eyebrow">WORKSPACE / {eyebrowProject}</div>
              <h1>{activeTitle}</h1>
            </div>
          </div>
          <div style={{ padding: '8px 44px 0' }}>
            <SessionBadge label={`TODAY • ${projectName ? `Project ${projectName}` : 'Sovora Sovereign Workspace'}`} />
          </div>

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

          {generatedFiles.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 24px' }} aria-label="Generated files">
              {generatedFiles.map((f) => (
                <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--stitch-parchment, #F7F5F2)', fontSize: 12, cursor: 'pointer' }} onClick={() => handleOpenArtifactFileWithPanel(f.path)}>
                  <FileText size={14} aria-hidden />
                  <span style={{ fontWeight: 600, textDecoration: 'underline' }}>{f.fileName}</span>
                  <span style={{ opacity: 0.55 }}>{f.kind}{typeof f.bytes === 'number' ? ` • ${(f.bytes / 1024).toFixed(1)}KB` : ''}</span>
                  <button type="button" className="sv-btn sv-btn-ghost" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 11 }} onClick={(e) => { e.stopPropagation(); void window.sovara.invoke('shell:showItemInFolder', { path: f.path }) }}>Open Folder</button>
                </div>
              ))}
            </div>
          ) : null}

          <MessageList
            events={events}
            thinking={busy && streamingText === '' && streamingReasoning === '' && (exec.phase === 'streaming' || exec.phase === 'thinking' || exec.phase === 'planning' || exec.phase === 'loading' || exec.phase === 'reading' || exec.phase === 'prompting' || exec.phase === 'selecting')}
            execPhase={exec.phase}
            execLabel={executionLabel}
            execDetail={exec.detail}
            streamingText={streamingText}
            streamingReasoning={streamingReasoning || (busy && (exec.phase === 'thinking' || exec.phase === 'planning') && exec.detail ? exec.detail : '')}
            streamingModelBadge={activeModel.displayName ?? undefined}
            streamingThoughtLabel={streaming ? 'Thinking…' : exec.phase === 'thinking' ? 'Thinking…' : exec.phase === 'loading' ? 'Loading…' : undefined}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
            onEditAndResend={onEditAndResend}
            busy={busy}
            onOpenArtifact={handleOpenArtifactInPanel}
          />

          {activeArtifact && artifactsPanelOpen ? (
            <div style={{ padding: '4px 44px 8px' }} aria-label="Active artifact">
              {(() => {
                const lang = activeArtifact.language.toLowerCase()
                const isBinary = isBinaryArtifact(activeArtifact.code, lang) || /\.(pptx|xlsx|docx|pdf)$/i.test(activeArtifact.title)
                if (isBinary) {
                  return (
                    <iframe
                      srcDoc={bundleBinaryPreview(activeArtifact.title, lang)}
                      title={activeArtifact.title}
                      sandbox="allow-scripts allow-modals"
                      style={{ width: '100%', height: 360, border: '1px solid var(--stitch-border, #E8E4DE)', borderRadius: 8, display: 'block', background: '#f8fafc' }}
                    />
                  )
                }
                return (
                  <ArtifactCard
                    title={activeArtifact.title}
                    language={activeArtifact.language}
                    code={activeArtifact.code}
                    onOpenSplit={undefined}
                  />
                )
              })()}
            </div>
          ) : null}

          <div className="sv-status-bar" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 24px', fontSize: 11, color: 'var(--muted, #8A8279)', borderTop: '1px solid var(--stitch-border, #E8E4DE)' }}>
            {model.available && model.displayName ? (
              <span role="status" aria-label={`Local model ${model.displayName}`}>LOCAL MODEL — {model.displayName}{model.runtimeDisplayName ? ` on ${model.runtimeDisplayName}` : ''}</span>
            ) : (
              <span role="status" aria-label="No local model selected">NO LOCAL MODEL</span>
            )}
            {exec.phase === 'reading' ? (
              <span style={{ color: '#D97757', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-live-dot" /> Reading attachments…
              </span>
            ) : exec.phase === 'prompting' ? (
              <span style={{ color: '#D97757', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-live-dot" /> Assembling prompt…
              </span>
            ) : exec.phase === 'selecting' ? (
              <span style={{ color: '#D97757', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-live-dot" /> Routing to model…
              </span>
            ) : exec.phase === 'loading' ? (
              <span style={{ color: '#D97757', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-live-dot" /> Loading model weights…
              </span>
            ) : exec.phase === 'thinking' ? (
              <span style={{ color: '#D97757', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-live-dot" /> Reasoning &amp; thinking…
              </span>
            ) : exec.phase === 'tool' ? (
              <span style={{ color: '#D97757', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-live-dot" /> Executing tool: {exec.toolName ?? 'command'}…
              </span>
            ) : exec.phase === 'artifact' ? (
              <span style={{ color: '#D97757', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-live-dot" /> Generating file…
              </span>
            ) : streaming ? (
              <span style={{ color: '#D97757', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span className="status-live-dot" /> Streaming tokens…
              </span>
            ) : null}
          </div>

          <div className="sv-composer">
            {execution?.toolCallId && onApproveTool ? <PermissionApprovalWrapper execution={execution} onApproveTool={onApproveTool} /> : null}
            <Composer value={draft} onChange={setDraft} onSend={onSend} onCancel={onCancel} disabled={busy && !execution?.toolCallId} busy={busy} phase={phase}
              active={activeModel} runtimes={runtimes} models={discoveredModels} projectCount={projectCount} onNewProject={onNewProject}
              execMode={execMode} onExecModeChange={onExecModeChange} execAvailable={execAvailable} reasoningEnabled={reasoningEnabled}
              onReasoningToggle={onReasoningToggle} onSelectModel={onSelectModel} onOpenSettings={onOpenModels} projectName={projectName} />
          </div>
        </div>
      )}
      </div>

    </section>
  )
}
