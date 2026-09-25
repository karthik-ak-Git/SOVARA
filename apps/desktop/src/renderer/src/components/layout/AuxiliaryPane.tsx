import { useState, useRef, useEffect, useMemo, type ReactElement } from 'react'
import {
  BookOpen,
  Code2,
  FileCode2,
  Terminal as TerminalIcon,
  Plus,
  Maximize2,
  Minimize2,
  PanelRight,
  Folder,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Search,
  Layers,
  Trash2,
  Send,
  FileText,
  File,
  X,
  RefreshCw,
} from 'lucide-react'
import { dispatchTool, openArtifact, getGitStatus, getGitDiff, type SessionEventView } from '@/lib/client/api'
import { preparePreviewHtml, isVisualArtifact, isBinaryArtifact } from '../../utils/previewBundler'
import type { AgentExecutionState } from '../../features/chat/useChatSession'

export type AuxiliaryTab = 'overview' | 'diffs' | 'terminal' | 'artifacts' | 'subagents'

export interface ChangedFileItem {
  path: string
  staged?: boolean
  additions?: number
  deletions?: number
  diffChunks?: Array<{
    lineOld?: number
    lineNew?: number
    type: 'add' | 'del' | 'context'
    content: string
  }>
}

interface Props {
  isOpen: boolean
  onClose: () => void
  isExpanded?: boolean
  onToggleExpand?: () => void
  activeTab?: AuxiliaryTab
  onTabChange?: (tab: AuxiliaryTab) => void
  artifactContent?: string
  artifactTitle?: string
  artifactType?: 'html' | 'markdown' | 'svg' | 'code'
  /** Artifact opened from chat (Split View / Preview) — rendered by the Artifact Viewer tab. */
  activeArtifact?: { title: string; language: string; code: string } | null
  onOpenArtifactFile?: (path: string) => void
  activeSubagents?: Array<{ id: string; role: string; type: string; state: string; detail?: string; duration?: string }>
  activeTasks?: Array<{ id: string; name: string; status: string; progress?: string }>
  terminalLogs?: string[]
  changedFiles?: ChangedFileItem[]
  events?: SessionEventView[]
  sessionTitle?: string
  sessionId?: string
  workspaceRoot?: string | null
  /** Live chat execution — synced to right rail for full intent visibility */
  execution?: AgentExecutionState | null
  busy?: boolean
  streamingReasoning?: string
  streamingText?: string
}

export function AuxiliaryPane({
  isOpen,
  onClose,
  isExpanded: controlledIsExpanded,
  onToggleExpand,
  activeTab: controlledTab,
  onTabChange,
  artifactContent = '',
  artifactTitle = 'Implementation Plan',
  artifactType = 'html',
  activeArtifact = null,
  onOpenArtifactFile,
  activeSubagents = [],
  changedFiles = [],
  events = [],
  sessionTitle = 'Current Conversation',
  sessionId,
  workspaceRoot,
  execution = null,
  busy = false,
  streamingReasoning = '',
  streamingText = '',
}: Props): ReactElement | null {
  const [internalTab, setInternalTab] = useState<AuxiliaryTab>('overview')
  const [internalExpanded, setInternalExpanded] = useState(false)
  const [subSidebarOpen, setSubSidebarOpen] = useState(true)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const terminalContainerRef = useRef<HTMLDivElement>(null)
  const terminalInputRef = useRef<HTMLInputElement>(null)

  const isExpanded = controlledIsExpanded ?? internalExpanded
  const handleToggleExpand = (): void => {
    if (onToggleExpand) onToggleExpand()
    else setInternalExpanded((v) => !v)
  }

  const tab = controlledTab ?? internalTab

  const setTab = (t: AuxiliaryTab): void => {
    setInternalTab(t)
    onTabChange?.(t)
  }

  useEffect(() => {
    if (!plusMenuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setPlusMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [plusMenuOpen])

  // --- Dynamic + Git-backed Files Changed (full sync, not synthetic) ---
  const [gitFilesState, setGitFilesState] = useState<ChangedFileItem[]>([])
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    getGitStatus(workspaceRoot ?? undefined).then((res) => {
      if (cancelled || !res.ok) return
      const mapped: ChangedFileItem[] = res.files.map((f) => ({
        path: f.path,
        staged: f.staged,
        additions: 0,
        deletions: 0,
        diffChunks: [],
      }))
      setGitFilesState(mapped)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [isOpen, workspaceRoot, events.length])

  const dynamicFiles = useMemo(() => {
    if (changedFiles.length > 0) return changedFiles
    // Prefer real git files; fall back to event-derived paths
    if (gitFilesState.length > 0) return gitFilesState
    const map = new Map<string, ChangedFileItem>()
    const registerPath = (p: string) => {
      const clean = p.replace(/\\/g, '/').trim()
      if (!clean || clean === '.' || clean === './' || clean.startsWith('http') || clean.length < 2) return
      if (!map.has(clean)) {
        map.set(clean, { path: clean, staged: false, additions: 0, deletions: 0, diffChunks: [] })
      }
    }
    for (const e of events) {
      if (e.type === 'tool/call') {
        const d = (e.data ?? {}) as Record<string, unknown>
        const toolName = (d['name'] || d['toolName'] || (d['toolCall'] as any)?.name) as string
        if (toolName === 'fs_write' || toolName === 'fs_patch') {
          const args = (d['args'] ?? (d['toolCall'] as any)?.args ?? {}) as Record<string, unknown>
          if (typeof args['path'] === 'string') registerPath(args['path'])
        }
      } else if (e.type === 'artifact/created') {
        const d: any = e.data || {}
        if (typeof d.path === 'string') registerPath(d.path)
      } else if (e.type === 'tool/result') {
        const d = (e.data ?? {}) as Record<string, unknown>
        if (typeof d === 'object' && d !== null) {
          if (typeof d['path'] === 'string') registerPath(d['path'])
          if (typeof d['file'] === 'string') registerPath(d['file'])
        }
        const raw = typeof e.data === 'string' ? e.data : (e.data as { content?: string })?.content ?? JSON.stringify(e.data ?? {})
        const matches = raw.matchAll(/"path"\s*:\s*["']([^"'\r\n,]+)["']/gi)
        for (const m of matches) if (m[1]) registerPath(m[1])
        const fileMatches = raw.matchAll(/(?:written to\s+|created\s+)([a-zA-Z0-9_./\\-]+)/gi)
        for (const m of fileMatches) if (m[1]) registerPath(m[1])
      }
    }
    return Array.from(map.values())
  }, [events, changedFiles, gitFilesState])

  const stagedFiles = useMemo(() => dynamicFiles.filter((f) => f.staged), [dynamicFiles])
  const unstagedFiles = useMemo(() => dynamicFiles.filter((f) => !f.staged), [dynamicFiles])

  const [selectedReviewFile, setSelectedReviewFile] = useState<ChangedFileItem | null>(null)
  const [fileRenderMode, setFileRenderMode] = useState<'diff' | 'preview' | 'markdown' | 'code' | 'image'>('diff')
  const [fileDiffData, setFileDiffData] = useState<import('@/lib/client/api').GitDiffResult | null>(null)
  const [fileDiffLoading, setFileDiffLoading] = useState(false)

  // Auto-fetch real git diff + file content when a review file is selected
  useEffect(() => {
    if (!selectedReviewFile) { setFileDiffData(null); return }
    let cancelled = false
    setFileDiffLoading(true)
    getGitDiff(selectedReviewFile.path, workspaceRoot ?? undefined).then((res) => {
      if (cancelled) return
      setFileDiffData(res as unknown as import('@/lib/client/api').GitDiffResult)
      // Auto-switch render mode based on file type
      if (res.ok) {
        if ((res as any).isImage && (res as any).imageDataUrl) setFileRenderMode('image')
        else if (res.isMarkdown) setFileRenderMode('markdown')
        else if (res.isHtml) setFileRenderMode('preview')
        else if (res.diff && res.diff.includes('@@')) setFileRenderMode('diff')
        else setFileRenderMode('code')
      }
      setFileDiffLoading(false)
    }).catch(() => { if (!cancelled) setFileDiffLoading(false) })
    return () => { cancelled = true }
  }, [selectedReviewFile?.path, workspaceRoot])

  // Lightweight markdown → html for README rendering (no extra dep, handles headings/links/code)
  const renderMarkdown = (src: string): string => {
    const esc = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    let html = esc(src)
    html = html.replace(/^###\s+(.*)$/gm, '<h3 style="font-size:15px;font-weight:700;margin:14px 0 6px;color:#0f172a">$1</h3>')
    html = html.replace(/^##\s+(.*)$/gm, '<h2 style="font-size:17px;font-weight:700;margin:16px 0 8px;color:#0f172a">$1</h2>')
    html = html.replace(/^#\s+(.*)$/gm, '<h1 style="font-size:20px;font-weight:800;margin:18px 0 10px;color:#0f172a">$1</h1>')
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
    html = html.replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 6px;border-radius:4px;font:12px ui-monospace">$1</code>')
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:#0284c7;text-decoration:underline">$1</a>')
    html = html.replace(/```([a-z]*)\n([\s\S]*?)```/g, '<pre style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow:auto;font:12px ui-monospace;white-space:pre-wrap">$2</pre>')
    html = html.replace(/\n\n/g, '<br/><br/>').replace(/\n/g, '<br/>')
    return `<div style="font:13px/1.65 system-ui;color:#334155;max-width:100%;word-break:break-word">${html}</div>`
  }

  // Parse unified diff into line objects for old/new side-by-side rendering
  const parsedDiff = useMemo(() => {
    if (!fileDiffData?.diff) return null
    const lines = fileDiffData.diff.split('\n')
    const chunks: Array<{ oldN?: number; newN?: number; type: 'add'|'del'|'context'|'hunk'; text: string }> = []
    let oldN = 0, newN = 0
    for (const l of lines) {
      if (l.startsWith('@@')) {
        const m = /@@ -(\d+),?\d* \+(\d+),?\d* @@/.exec(l)
        if (m) { oldN = parseInt(m[1],10); newN = parseInt(m[2],10) }
        chunks.push({ type:'hunk', text:l })
        continue
      }
      if (l.startsWith('+++')||l.startsWith('---')||l.startsWith('diff')||l.startsWith('index')) { chunks.push({type:'hunk',text:l}); continue }
      if (l.startsWith('+')) { chunks.push({ oldN: undefined, newN: newN++, type:'add', text:l.slice(1) }) }
      else if (l.startsWith('-')) { chunks.push({ oldN: oldN++, newN: undefined, type:'del', text:l.slice(1) }) }
      else { chunks.push({ oldN: oldN++, newN: newN++, type:'context', text: l.slice(1) }) }
    }
    return chunks
  }, [fileDiffData])

  // Artifact Viewer tab state — mirrors the artifact opened from chat.
  // viewerOverride lets a sidebar selection render in the viewer; it clears when
  // chat opens a new artifact so chat stays the source of truth.
  const [viewerTab, setViewerTab] = useState<'code' | 'preview'>('code')
  const [viewerHtml, setViewerHtml] = useState('')
  const [viewerOverride, setViewerOverride] = useState<{ title: string; language: string; code: string } | null>(null)
  const viewerArtifact = viewerOverride ?? activeArtifact

  useEffect(() => {
    if (activeArtifact) {
      // Chat opened a (new) artifact — clear any sidebar override and show the viewer
      setViewerOverride(null)
      setTab('artifacts')
    }
  }, [activeArtifact])

  useEffect(() => {
    if (viewerArtifact) {
      setViewerTab(isVisualArtifact(viewerArtifact.code, viewerArtifact.language.toLowerCase()) ? 'preview' : 'code')
    }
  }, [viewerArtifact])

  const viewerCanPreview = !!viewerArtifact && isVisualArtifact(viewerArtifact.code, viewerArtifact.language.toLowerCase()) && !isBinaryArtifact(viewerArtifact.code, viewerArtifact.language.toLowerCase())

  useEffect(() => {
    if (!viewerArtifact || viewerTab !== 'preview' || !viewerCanPreview) {
      setViewerHtml('')
      return
    }
    let isCancelled = false
    preparePreviewHtml(viewerArtifact.code, events as never, sessionId, viewerArtifact.language.toLowerCase()).then((res) => {
      if (!isCancelled) setViewerHtml(res)
    })
    return () => {
      isCancelled = true
    }
  }, [viewerArtifact, viewerTab, viewerCanPreview, events, sessionId])

  const dynamicSubagents = useMemo(() => {
    if (activeSubagents.length > 0) return activeSubagents
    const list: Array<{ id: string; role: string; type: string; state: string; duration?: string; detail?: string }> = []
    // Live execution sync: what chat will do / is doing (phase, tool, thinking)
    if (execution && execution.phase !== 'idle' && execution.phase !== 'done') {
      const phaseLabel = execution.phase === 'thinking' ? 'Thinking — reasoning' : execution.phase === 'planning' ? `Planning (${execution.taskKind ?? 'task'})` : execution.phase === 'tool' ? `Running ${execution.toolName ?? 'tool'}` : execution.phase === 'reading' ? `Reading ${execution.fileName ?? 'files'}` : execution.phase
      list.push({ id: 'live-exec', role: phaseLabel, type: 'live', state: execution.phase, detail: execution.detail || streamingReasoning?.slice(0,120) || streamingText?.slice(0,120), duration: busy ? 'Running…' : 'Queued' })
    }
    for (const e of events) {
      if (e.type === 'tool/call') {
        const d: any = e.data || {}
        const toolName = d.name || d.toolName || d.toolCall?.name
        if (toolName === 'invoke_subagent' || toolName === 'define_subagent') {
          const callId = String(d.toolCallId || e.seq || Math.random())
          const args = d.args || {}
          // Prefer the actual task text; fall back to the role so the card is
          // never a content-free "Subagent Task" placeholder.
          const description = typeof args.description === 'string' ? args.description.trim() : ''
          const role = args.role || args.Role || 'general'
          const label = description || String(role)
          // A tool/call only proves the subagent STARTED. Correlate the matching
          // tool/result so the card reports the real outcome instead of assuming
          // success — a failed or cancelled subagent must not read as completed.
          const result = events.find((r) => {
            if (r.type !== 'tool/result') return false
            const rd: any = r.data || {}
            const sameName = (rd.name || rd.toolName) === toolName
            return sameName && (!rd.toolCallId || String(rd.toolCallId) === callId || String(e.seq) === callId)
          })
          let state = 'running'
          let detail: string | undefined = description ? undefined : `Role: ${String(role)}`
          if (result) {
            const rd: any = result.data || {}
            const ok = rd.ok !== false && !rd.error
            state = ok ? 'completed' : 'failed'
            detail = ok ? description || undefined : (rd.error || 'Subagent did not complete')
          }
          list.push({ id: callId, role: label, type: String(toolName), state, detail })
        }
      }
    }
    return list
  }, [events, activeSubagents, execution, busy, streamingReasoning, streamingText])

  // Sidebar mirrors the chat: code blocks parsed from assistant messages are the source
  // of truth, plus backend artifact/created files. The artifact currently open in the
  // viewer (Split View / Preview in chat) is listed first so both panes stay in sync.
  const dynamicArtifacts = useMemo(() => {
    const list: Array<{ id: string; title: string; type: string; language: string; code: string }> = []
    const push = (title: string, language: string, code: string, id: string): void => {
      if (!code || !code.trim()) return
      if (!list.some((a) => a.title === title && a.code === code)) {
        list.push({ id, title, type: isVisualArtifact(code, language) ? 'preview' : 'code', language, code })
      }
    }
    if (activeArtifact) push(activeArtifact.title, activeArtifact.language, activeArtifact.code, 'art-active')
    for (const e of events) {
      if (e.type === 'artifact/created') {
        const d: any = e.data || {}
        const title = d.name || d.fileName || d.title || (d.path ? d.path.split(/[/\\]/).pop() : 'Artifact')
        if (title && !list.some((a) => a.title === title)) {
          list.push({ id: String(e.seq || Math.random()), title: String(title), type: 'file', language: String(d.kind || 'file'), code: String(d.path || '') })
        }
      }
    }
    // Assistant code fences are not materialized files. Do not mirror them as
    // artifacts here; the user can explicitly open code from the message, while
    // generated files arrive through verified artifact/created events above.
    return list
  }, [events, activeArtifact])

  const dynamicUploads = useMemo(() => {
    const list: Array<{ id: string; name: string; date: string }> = []
    for (const e of events) {
      if (e.type === 'attachment/added') {
        const files = (e.data as { files?: Array<{ name: string }> })?.files
        if (Array.isArray(files)) {
          for (const f of files) {
            if (f?.name) {
              list.push({ id: String(Math.random()), name: f.name, date: 'Today' })
            }
          }
        }
      }
    }
    return list
  }, [events])

  // Skills/Tools — fully in sync with what AI actually did (every tool/call/result)
  // Counts every shell_exec/fs_* call so the count matches the runtime logs the user compared.
  const dynamicSkills = useMemo(() => {
    const counts = new Map<string, { count: number; sampleArgs: string; isSkill: boolean }>()
    const skillDetails = new Map<string, string>()
    for (const e of events) {
      if (e.type !== 'tool/call' && e.type !== 'tool/result') continue
      const d: any = e.data || {}
      const toolName: string | undefined = d.name || d.toolName || d.toolCall?.name || d.tool_name
      if (!toolName) continue
      const args = (d.args ?? d.toolCall?.args ?? {}) as Record<string, unknown>
      const isSkill = toolName === 'search_skills' || toolName === 'read_skill' || toolName === 'use_skill'
      if (e.type === 'tool/call') {
        const key = String(toolName)
        const prev = counts.get(key) || { count: 0, sampleArgs: '', isSkill }
        prev.count += 1
        // keep first args preview for context (e.g. command:"python --version")
        if (!prev.sampleArgs && args) {
          const preview = args['command'] ? `command: ${String(args['command']).slice(0,40)}` : args['path'] ? `path: ${String(args['path']).slice(0,40)}` : JSON.stringify(args).slice(0, 80)
          prev.sampleArgs = preview
        }
        prev.isSkill = prev.isSkill || isSkill
        counts.set(key, prev)
        if (isSkill) {
          const skillName = String(args['skill_name'] || args['skillName'] || args['query'] || args['name'] || '').trim()
          if (skillName) skillDetails.set(skillName, String(args['path'] || ''))
        }
      }
    }
    // Prefer real skill names when present, otherwise list tool names with counts
    const out: Array<{ name: string; path?: string; source?: string }> = []
    if (skillDetails.size > 0) {
      for (const [k, p] of skillDetails.entries()) out.push({ name: k, path: p || undefined, source: 'skill' })
    }
    // Always append tool usage so shell_exec ×4 etc is visible and matches the logs
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count)
    for (const [tool, info] of sorted) {
      const label = info.count > 1 ? `${tool} ×${info.count}` : tool
      // avoid duplicating a skill name already listed
      if (!out.some((o) => o.name === tool || o.name === label)) {
        out.push({ name: label, path: info.sampleArgs || undefined, source: info.isSkill ? 'skill' : 'tool' })
      }
    }
    return out.slice(0, 12)
  }, [events])

  // --- Real persistent terminal sessions (backend-backed, pipes-based) ---
  // Instances come ONLY from the main-process shell host via terminal:* IPC:
  // id, shell, exe name, cwd, pid and status are all live backend values.
  // Nothing is seeded, synthesized, or read from localStorage.
  type RealTerminalShell = 'powershell' | 'cmd' | 'bash' | 'python' | 'node'
  type RealTerminalStatus = 'alive' | 'exited'
  interface TerminalInstance {
    id: string
    name: string
    shell: RealTerminalShell
    cwd: string | null
    pid: number | null
    status: RealTerminalStatus
    exitCode: number | null
    logs: string[]
  }
  interface TerminalCreateResult {
    id: string
    shell: RealTerminalShell
    name: string
    pid: number | null
    cwd: string
    status: RealTerminalStatus
    exitCode: number | null
    pty?: boolean
  }
  interface SovaraBridge {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  }
  const getSovaraBridge = (): SovaraBridge | null => {
    try {
      const w = window as unknown as { sovara?: SovaraBridge }
      if (!w.sovara || typeof w.sovara.invoke !== 'function') return null
      return w.sovara
    } catch {
      return null
    }
  }

  const [terminalInstances, setTerminalInstances] = useState<TerminalInstance[]>([])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [terminalBackend, setTerminalBackend] = useState<'live' | 'offline' | 'unknown'>('unknown')
  const [terminalError, setTerminalError] = useState<string | null>(null)
  /** AI one-shot shell output that arrived with no live shell to attach to. */
  const [orphanShellLogs, setOrphanShellLogs] = useState<string[]>([])
  const terminalBootAttempted = useRef(false)

  const createRealTerminal = async (shell: RealTerminalShell): Promise<TerminalInstance | null> => {
    const bridge = getSovaraBridge()
    if (!bridge) {
      setTerminalBackend('offline')
      setTerminalError('IPC bridge unavailable (window.sovara missing)')
      return null
    }
    try {
      const res = (await bridge.invoke('terminal:create', {
        shell,
        ...(workspaceRoot ? { cwd: workspaceRoot } : {}),
      })) as TerminalCreateResult
      if (!res || typeof res.id !== 'string') throw new Error('malformed terminal:create response')
      setTerminalBackend('live')
      setTerminalError(null)
      const inst: TerminalInstance = {
        id: res.id,
        name: typeof res.name === 'string' && res.name ? res.name : res.shell,
        shell: res.shell,
        cwd: typeof res.cwd === 'string' ? res.cwd : null,
        pid: typeof res.pid === 'number' ? res.pid : null,
        status: res.status === 'exited' ? 'exited' : 'alive',
        exitCode: typeof res.exitCode === 'number' ? res.exitCode : null,
        logs: [
          `connected: ${typeof res.name === 'string' && res.name ? res.name : res.shell} · pid ${typeof res.pid === 'number' ? res.pid : 'unknown'} · ${typeof res.cwd === 'string' ? res.cwd : 'cwd unknown'} · ${res.pty === false ? 'one-shot pipes shell (no PTY available)' : 'real PTY (ConPTY) — fully interactive'}`,
        ],
      }
      setTerminalInstances((prev) => (prev.some((t) => t.id === inst.id) ? prev : [...prev, inst]))
      setActiveTerminalId(inst.id)
      return inst
    } catch (err: unknown) {
      setTerminalBackend('offline')
      setTerminalError(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  // Boot one real shell when the pane first opens. Never fabricates one.
  useEffect(() => {
    if (!isOpen || terminalBootAttempted.current) return
    terminalBootAttempted.current = true
    void createRealTerminal('powershell')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Stream backend stdout/stderr + process exit into the matching instance.
  useEffect(() => {
    const bridge = getSovaraBridge()
    if (!bridge || typeof bridge.on !== 'function') return
    const offOut = bridge.on('terminal:output', (...args: unknown[]) => {
      const p = args[0] as { id?: unknown; data?: unknown } | undefined
      if (!p || typeof p.id !== 'string' || typeof p.data !== 'string') return
      const lines = p.data.split('\n')
      setTerminalBackend('live')
      setTerminalInstances((prev) =>
        prev.map((t) => (t.id === p.id ? { ...t, logs: [...t.logs, ...lines].slice(-2000) } : t))
      )
    })
    const offExit = bridge.on('terminal:exit', (...args: unknown[]) => {
      const p = args[0] as { id?: unknown; exitCode?: unknown } | undefined
      if (!p || typeof p.id !== 'string') return
      const code = typeof p.exitCode === 'number' ? p.exitCode : null
      setTerminalInstances((prev) =>
        prev.map((t) =>
          t.id === p.id
            ? { ...t, status: 'exited', exitCode: code, logs: [...t.logs, `process exited (code ${code ?? 'unknown'})`] }
            : t
        )
      )
    })
    return () => {
      offOut()
      offExit()
    }
  }, [])

  const historyKey = useMemo(
    () => `sovara_cmd_history_${sessionTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    [sessionTitle]
  )

  const [cmdHistory, setCmdHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(historyKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed)) return parsed
      }
    } catch {}
    return []
  })

  const [historyIdx, setHistoryIdx] = useState<number>(-1)
  const [draftInput, setDraftInput] = useState<string>('')

  useEffect(() => {
    try {
      localStorage.setItem(historyKey, JSON.stringify(cmdHistory))
    } catch {}
  }, [cmdHistory, historyKey])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (cmdHistory.length === 0) return
      if (historyIdx === -1) {
        setDraftInput(commandInput)
        const newIdx = cmdHistory.length - 1
        setHistoryIdx(newIdx)
        setCommandInput(cmdHistory[newIdx])
      } else if (historyIdx > 0) {
        const newIdx = historyIdx - 1
        setHistoryIdx(newIdx)
        setCommandInput(cmdHistory[newIdx])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIdx === -1) return
      if (historyIdx < cmdHistory.length - 1) {
        const newIdx = historyIdx + 1
        setHistoryIdx(newIdx)
        setCommandInput(cmdHistory[newIdx])
      } else {
        setHistoryIdx(-1)
        setCommandInput(draftInput)
      }
    }
  }

  const [commandInput, setCommandInput] = useState('')

  const activeTerminal = terminalInstances.find((t) => t.id === activeTerminalId) ?? null

  // Prompt path is the live backend cwd when known, else the workspace root
  // when known, else no path at all. Never a hardcoded fallback path.
  const promptPrefix = useMemo(() => {
    const st = activeTerminal?.shell || 'powershell'
    const cwd = activeTerminal?.cwd ?? workspaceRoot ?? null
    if (st === 'cmd') return cwd ? `${cwd}>` : '>'
    if (st === 'bash') return cwd ? `user@sovara:${cwd}$` : 'user@sovara:$'
    if (st === 'python') return '>>>'
    if (st === 'node') return '>'
    return cwd ? `PS ${cwd}>` : 'PS>'
  }, [activeTerminal?.shell, activeTerminal?.cwd, workspaceRoot])

  // Track which events we have already processed into the terminal logs — keyed by seq+type so call/result are distinct
  const processedEvents = useRef<Set<string>>(new Set())

  // Stream AI tool execution outputs into the live shell when one exists,
  // otherwise into the session shell-activity buffer — fully in sync with
  // [SOVARA][TOOL] CALL/RESULT logs. cwd is shown only when actually known.
  useEffect(() => {
    let changed = false
    const newLogs: string[] = []
    for (const e of events) {
      const eAny: any = e as any
      const seqKey = `${e.type}:${String(e.seq ?? eAny.id ?? Math.random())}`
      if (processedEvents.current.has(seqKey)) continue
      if (e.type !== 'tool/call' && e.type !== 'tool/result') continue
      const d: any = e.data || {}
      const toolName: string | undefined = d.name || d.toolName || d.toolCall?.name || d.tool_name
      if (!toolName) continue
      // Shell aliases and programmatic shell execution belong in the live
      // terminal stream. Keeping this list aligned with ToolStubAdapter avoids
      // silent black holes where a tool executed but its output disappeared.
      const isShell = ['shell_exec', 'run_command', 'exec_shell_command', 'bash', 'cmd', 'powershell', 'terminal_exec'].includes(toolName)
      const isRunCode = toolName === 'run_code'
      if (!isShell && !isRunCode) continue

      if (e.type === 'tool/call') {
        if (isRunCode) {
          const code = String(d.args?.code ?? '').trim()
          if (code) {
            const preview = code.length > 180 ? `${code.slice(0, 180)}…` : code
            newLogs.push(`${promptPrefix} run_code ${preview}`)
            newLogs.push('↳ dispatched → awaiting tool result…')
            changed = true
          }
        } else {
          const cmd: string = d.args?.CommandLine || d.args?.cmd || d.args?.command || String(d.args?.command || '')
          if (cmd.trim()) {
            const rawCwd: unknown = d.args?.cwd
            const cwd: string | null = typeof rawCwd === 'string' && rawCwd ? rawCwd : (workspaceRoot ?? null)
            newLogs.push(cwd ? `${promptPrefix} ${cmd.trim()}  [cwd: ${cwd}]` : `${promptPrefix} ${cmd.trim()}`)
            newLogs.push('↳ dispatched → awaiting tool result…')
            changed = true
          }
        }
        processedEvents.current.add(seqKey)
      } else {
        // tool/result — parse the preview JSON the tools port returns (matches [SOVARA][TOOL] RESULT preview)
        const raw: unknown = d.content ?? d.result ?? d.preview ?? d.data ?? d
        let preview: any = raw
        if (typeof raw === 'string') {
          try { preview = JSON.parse(raw) } catch { preview = { stdout: String(raw) } }
        }
        if (preview && typeof preview === 'object') {
          const exitCode: number | null = typeof preview.exitCode === 'number' ? preview.exitCode : null
          const stdout: string = typeof preview.stdout === 'string' ? preview.stdout : ''
          const stderr: string = typeof preview.stderr === 'string' ? preview.stderr : ''
          const error: string = typeof preview.error === 'string' ? preview.error : ''
          const hint: string = typeof preview.hint === 'string' ? preview.hint : ''
          const truncated: boolean = !!preview.truncated
          const workdir: string = typeof preview.workdir === 'string' ? preview.workdir : typeof preview.cwd === 'string' ? preview.cwd : ''
          const port = typeof preview.port === 'number' ? preview.port : typeof preview.server_port === 'number' ? preview.server_port : null
          const url = typeof preview.url === 'string' ? preview.url : typeof preview.server_url === 'string' ? preview.server_url : null
          if (url || port) newLogs.push(`↳ App running at ${url || `http://localhost:${port}`}`)
          // Outcome line — mirrors [SOVARA][RUNTIME] OK/ERR
          if (error) {
            newLogs.push(`✖ ERROR: ${error}`)
            if (hint) newLogs.push(`  hint: ${hint}`)
            // Special help for bare python — surface the exact hint from the tool so user understands the failure mode
            if (/bare python repl would hang/i.test(error)) {
              newLogs.push('  → The shell blocked "python" without args to avoid a hang. Use "python --version" or "python script.py".')
            }
            if (stderr) newLogs.push(stderr.trim())
            if (preview.latencyMs) newLogs.push(`  latency=${preview.latencyMs}ms`)
          } else {
            const out = (stdout || stderr || String(preview.message || preview.output || '')).trim()
            if (out) {
              // Preserve line breaks for Python version string which includes \\r\\n
              for (const line of out.split('\n')) newLogs.push(line.replace('\r','').trimEnd())
            } else {
              newLogs.push('(no output)')
            }
            if (exitCode !== null) newLogs.push(`  ↳ exitCode=${exitCode}${truncated ? ' (truncated)' : ''}${workdir ? ` workdir=${workdir}` : ''}`)
          }
        } else {
          newLogs.push(String(preview ?? '(empty result)'))
        }
        processedEvents.current.add(seqKey)
        changed = true
      }
    }
    if (changed && newLogs.length > 0) {
      if (activeTerminal) {
        const targetId = activeTerminal.id
        setTerminalInstances((prev) =>
          prev.map((t) => (t.id === targetId ? { ...t, logs: [...t.logs, ...newLogs].slice(-2000) } : t))
        )
      } else {
        setOrphanShellLogs((prev) => [...prev, ...newLogs].slice(-2000))
      }
    }
  }, [events, activeTerminalId, promptPrefix, workspaceRoot])

  useEffect(() => {
    if (tab === 'terminal' && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight
    }
  }, [tab, terminalInstances, activeTerminalId, orphanShellLogs])

  const appendToActiveShell = (lines: string[]): void => {
    if (lines.length === 0) return
    if (activeTerminal) {
      const targetId = activeTerminal.id
      setTerminalInstances((prev) =>
        prev.map((t) => (t.id === targetId ? { ...t, logs: [...t.logs, ...lines].slice(-2000) } : t))
      )
    } else {
      setOrphanShellLogs((prev) => [...prev, ...lines].slice(-2000))
    }
  }

  const handleRunCommand = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!commandInput.trim()) return
    const cmd = commandInput.trim()

    // Save to command history for Up/Down arrow navigation
    setCmdHistory((prev) => (prev[prev.length - 1] === cmd ? prev : [...prev, cmd]))
    setHistoryIdx(-1)
    setDraftInput('')

    // Support native cls and clear commands
    if (cmd.toLowerCase() === 'cls' || cmd.toLowerCase() === 'clear') {
      if (activeTerminal) {
        const targetId = activeTerminal.id
        setTerminalInstances((prev) =>
          prev.map((t) => (t.id === targetId ? { ...t, logs: [] } : t))
        )
      } else {
        setOrphanShellLogs([])
      }
      setCommandInput('')
      return
    }

    appendToActiveShell([`${promptPrefix} ${cmd}`])
    setCommandInput('')

    // Prefer the persistent shell: stdin write, output streams back via terminal:output.
    if (activeTerminal && activeTerminal.status === 'alive') {
      const bridge = getSovaraBridge()
      if (bridge) {
        try {
          const res = (await bridge.invoke('terminal:write', { id: activeTerminal.id, data: `${cmd}\n` })) as { ok?: boolean; error?: string }
          if (res && res.ok) return
          appendToActiveShell([`↳ persistent-shell write failed (${typeof res?.error === 'string' ? res.error : 'unknown error'}) — falling back to one-shot shell_exec`])
        } catch (err: unknown) {
          setTerminalBackend('offline')
          setTerminalError(err instanceof Error ? err.message : String(err))
          appendToActiveShell(['↳ persistent shell unreachable — falling back to one-shot shell_exec'])
        }
      }
    }

    try {
      const effectiveCwd = workspaceRoot || undefined
      const res: any = await dispatchTool('shell_exec', {
        command: cmd,
        ...(effectiveCwd ? { workdir: effectiveCwd } : {}),
        _forceApprove: true,
        ...(sessionId ? { sessionId } : {}),
      })

      let text = ''
      const raw = res?.result || res?.message || res
      if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            if (parsed.error && String(parsed.error).includes('timeout')) {
              const out = (parsed.stdout || parsed.stderr || '').trim()
              text = out
                ? `${out.slice(0, 1000)}\n[Command timed out after 20s]`
                : '[Command timed out (process requires interactive input or terminated)]'
            } else {
              const stdout = (parsed.stdout || '').trim()
              const stderr = (parsed.stderr || '').trim()
              if (stdout && stderr) {
                text = `${stdout}\n${stderr}`
              } else {
                text = stdout || stderr || parsed.message || parsed.error || raw
              }
            }
          } else {
            text = raw
          }
        } catch {
          text = raw
        }
      } else if (raw && typeof raw === 'object') {
        text = raw.stdout || raw.stderr || raw.message || raw.error || JSON.stringify(raw)
      } else {
        text = 'Done.'
      }

      const formatted = String(text).trim()
      appendToActiveShell(formatted ? [formatted] : [])
    } catch (err: any) {
      appendToActiveShell([String(err?.message || err)])
    }
  }

  const handleKillTerminal = (id: string): void => {
    const bridge = getSovaraBridge()
    if (bridge) {
      bridge.invoke('terminal:kill', { id }).catch(() => {})
    }
    setTerminalInstances((prev) => {
      const filtered = prev.filter((t) => t.id !== id)
      if (activeTerminalId === id) {
        setActiveTerminalId(filtered[0]?.id ?? null)
      }
      return filtered
    })
  }

  const handleAddNewTerminal = (): void => {
    const shell = activeTerminal?.shell ?? 'powershell'
    void createRealTerminal(shell).then((inst) => {
      if (!inst) {
        setOrphanShellLogs((prev) =>
          [...prev, `✖ cannot create ${shell} shell: terminal backend offline${terminalError ? ` (${terminalError})` : ''}`].slice(-2000)
        )
      }
    })
  }

  // Section Collapse states for Overview
  const [filesOpen, setFilesOpen] = useState(true)
  const [artifactsSectionOpen, setArtifactsSectionOpen] = useState(true)
  const [uploadsOpen, setUploadsOpen] = useState(true)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [terminalsOpen, setTerminalsOpen] = useState(true)
  const [skillsOpen, setSkillsOpen] = useState(true)

  // Background Tasks — derived from persisted/live session events the same way
  // ContextPanel derives daemon bgTasks: daemon run_command/exec_shell_command
  // tool calls. Never from props (the shell never passes activeTasks).
  const dynamicBgTasks = useMemo(() => {
    const calls: Array<{ seq: number; command: string; cwd: string | null }> = []
    for (const e of events) {
      if (e.type !== 'tool/call') continue
      const d: any = e.data || {}
      const toolName: string | undefined = d.name || d.toolName || d.toolCall?.name || d.tool_name
      if (toolName !== 'run_command' && toolName !== 'exec_shell_command') continue
      const args = (d.args ?? d.toolCall?.args ?? {}) as Record<string, unknown>
      let daemon = false
      try {
        const argsStr = JSON.stringify(args)
        daemon = argsStr.includes('"IsDaemon":true') || argsStr.includes('"isDaemon":true')
      } catch {
        daemon = args['IsDaemon'] === true || args['isDaemon'] === true
      }
      if (!daemon) continue
      const command = String(args['CommandLine'] ?? args['command'] ?? args['cmd'] ?? toolName)
      const cwd = typeof args['cwd'] === 'string' && args['cwd'] ? (args['cwd'] as string) : null
      calls.push({ seq: e.seq, command, cwd })
    }
    return calls.map((c, i) => {
      const done = events.some((e) => e.type === 'tool/result' && e.seq > c.seq)
      return {
        id: `bg-${c.seq}-${i}`,
        name: c.command.slice(0, 80) || 'background command',
        status: done ? 'done' : 'running',
        progress: c.cwd,
      }
    })
  }, [events])

  if (!isOpen) return null

  return (
    <aside
      className="sv-aux-pane"
      aria-label="Auxiliary Workspace Pane"
      style={{
        flex: isExpanded ? 1 : 'none',
        width: isExpanded ? '100%' : 460,
        height: '100%',
        background: 'var(--bg, #ffffff)',
        borderLeft: '1px solid var(--border, #e2e8f0)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        boxShadow: isExpanded ? 'none' : 'var(--shadow-panel)',
        userSelect: 'none',
        transition: 'width 220ms cubic-bezier(0.32,0.72,0,1), flex 220ms ease',
        animation: 'auxSlideIn 220ms cubic-bezier(0.32,0.72,0,1)',
        overflow: 'hidden',
      } as React.CSSProperties}
    >
      <style>{`@keyframes auxSlideIn{from{transform:translateX(12px);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
      {/* Shared Top Bar Header with 3 Tab Icons */}
      <header
        className="sv-aux-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          height: 44,
          borderBottom: '1px solid var(--border, #e2e8f0)',
          background: 'var(--bg-elevated, #ffffff)',
          position: 'relative',
        }}
      >
        {/* Left 3 Icon Tabs: Overview, Review, Terminal */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            aria-label="Overview"
            title="Overview"
            onClick={() => setTab('overview')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: tab === 'overview' ? 'var(--text, #0f172a)' : 'var(--muted-2, #94a3b8)',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: tab === 'overview' ? '2px solid var(--text, #0f172a)' : '2px solid transparent',
            }}
          >
            <BookOpen size={17} aria-hidden />
          </button>

          <button
            type="button"
            aria-label="Review File Changes"
            title="Review File Changes"
            onClick={() => setTab('diffs')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: tab === 'diffs' ? 'var(--text, #0f172a)' : 'var(--muted-2, #94a3b8)',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: tab === 'diffs' ? '2px solid var(--text, #0f172a)' : '2px solid transparent',
            }}
          >
            <FileCode2 size={17} aria-hidden />
          </button>

          <button
            type="button"
            aria-label="Terminal"
            title="Terminal"
            onClick={() => setTab('terminal')}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: tab === 'terminal' ? 'var(--text, #0f172a)' : 'var(--muted-2, #94a3b8)',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: tab === 'terminal' ? '2px solid var(--text, #0f172a)' : '2px solid transparent',
            }}
          >
            <TerminalIcon size={17} aria-hidden />
          </button>

          <button
            type="button"
            aria-label="Artifact Viewer"
            title={viewerArtifact ? 'Artifact Viewer' : 'Artifact Viewer (open an artifact from chat first)'}
            onClick={() => setTab('artifacts')}
            disabled={!viewerArtifact}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: viewerArtifact ? 'pointer' : 'default',
              color: tab === 'artifacts' ? 'var(--text, #0f172a)' : viewerArtifact ? 'var(--muted-2, #94a3b8)' : '#cbd5e1',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: tab === 'artifacts' ? '2px solid var(--text, #0f172a)' : '2px solid transparent',
              opacity: viewerArtifact ? 1 : 0.45,
            }}
          >
            <Code2 size={17} aria-hidden />
          </button>
        </div>

        {/* Right Side Header Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              aria-label="Quick Actions"
              title="Add File / New Terminal"
              onClick={() => setPlusMenuOpen((v) => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 4,
                cursor: 'pointer',
                color: 'var(--muted, #64748b)',
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Plus size={17} />
            </button>

            {plusMenuOpen ? (
              <div
                ref={plusMenuRef}
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: 4,
                  width: 170,
                  background: 'var(--bg-elevated, #ffffff)',
                  border: '1px solid var(--border, #e2e8f0)',
                  borderRadius: 8,
                  boxShadow: 'var(--shadow-panel)',
                  zIndex: 999,
                  padding: '4px 0',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false)
                    setTab('diffs')
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '7px 12px',
                    border: 'none',
                    background: 'transparent',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Folder size={15} style={{ color: '#64748b' }} />
                    <span>Open File</span>
                  </div>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>Ctrl+P</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPlusMenuOpen(false)
                    handleAddNewTerminal()
                    setTab('terminal')
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '7px 12px',
                    border: 'none',
                    background: 'transparent',
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TerminalIcon size={15} style={{ color: '#64748b' }} />
                    <span>New Terminal</span>
                  </div>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>Ctrl+T</span>
                </button>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            aria-label={isExpanded ? 'Minimize Pane' : 'Maximize Pane'}
            title={isExpanded ? 'Minimize Pane' : 'Maximize Pane'}
            onClick={handleToggleExpand}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: '#64748b',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>

          <button
            type="button"
            aria-label="Toggle Side Pane"
            title="Toggle Side Pane"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: '#64748b',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PanelRight size={16} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="sv-aux-body" style={{ flex: 1, overflowY: 'auto', background: 'var(--bg, #ffffff)', display: 'flex', flexDirection: 'column' }}>
        {/* VIEW 1: OVERVIEW TAB */}
        {tab === 'overview' ? (
          <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Active Subagent Cards (if any) */}
            {busy || execution?.phase === 'thinking' || execution?.phase === 'tool' ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, background:'#fef3c7', border:'1px solid #fde68a', fontSize:12, color:'#92400e' }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:'#f59e0b', display:'inline-block', animation:'pulse 1s infinite' }} />
                <span style={{ fontWeight:600 }}>
                  {execution?.phase === 'thinking' ? 'Thinking — analysing your request…' : execution?.phase === 'tool' ? `Executing: ${execution.toolName ?? 'tool'}…` : execution?.phase === 'planning' ? 'Planning next steps…' : busy ? 'Chat is streaming…' : 'Working…'}
                </span>
                <span style={{ marginLeft:'auto', width:14, height:14, border:'2px solid #f59e0b', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.6s linear infinite' }} />
                <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.45}}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
              </div>
            ) : null}
            {dynamicSubagents.length > 0 ? (
              dynamicSubagents.map((sa) => (
                <div
                  key={sa.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: sa.type==='live' ? '#fffbeb' : 'var(--panel, #f8fafc)',
                    border: `1px solid ${sa.type==='live' ? '#fde68a' : 'var(--border-soft, #f1f5f9)'}`,
                    animation: sa.type==='live' ? 'pulse 1.2s ease-in-out infinite' : undefined,
                  }}
                >
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text, #0f172a)', display:'flex', alignItems:'center', gap:6 }}>
                      {sa.type==='live' || sa.state==='running' ? <span style={{ width:7, height:7, borderRadius:'50%', background:'#f59e0b', animation:'pulse 1s infinite', display:'inline-block' }} /> : null}
                      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{sa.role}</span>
                    </div>
                    <div style={{ fontSize: 11, color: sa.state==='failed' ? '#b91c1c' : 'var(--muted, #64748b)', marginTop: 2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {sa.detail || sa.duration || (sa.state==='failed' ? 'Subagent did not complete' : 'Delegated task')}
                    </div>
                  </div>
                  {sa.type==='live' || sa.state==='running'
                    ? <div style={{ width:14, height:14, border:'2px solid #f59e0b', borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.6s linear infinite', flexShrink:0 }} aria-label="Subagent running" />
                    : sa.state==='failed'
                      ? <span style={{ color:'#dc2626', fontSize:16, fontWeight:700, lineHeight:1, flexShrink:0 }} aria-label="Subagent failed">&times;</span>
                      : <Check size={16} style={{ color: '#10b981', flexShrink:0 }} aria-label="Subagent completed" />}
                </div>
              ))
            ) : null}

            {/* Section 1: Files Changed */}
            <div style={{ borderBottom: '1px solid var(--border-soft, #f1f5f9)', paddingBottom: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  marginBottom: filesOpen ? 8 : 0,
                }}
                onClick={() => setFilesOpen((v) => !v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text, #475569)' }}>
                  <span>Files Changed</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>{dynamicFiles.length}</span>
                  <ChevronRight size={14} style={{ color: 'var(--muted-2, #94a3b8)', transform: filesOpen ? 'rotate(90deg)' : 'none' }} />
                </div>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'var(--panel, #f1f5f9)', color: 'var(--text, #475569)', border: '1px solid var(--border, #e2e8f0)' }}>
                  Uncommitted v
                </span>
              </div>

              {filesOpen && dynamicFiles.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                  {dynamicFiles.map((f, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelectedReviewFile(f)
                        setTab('diffs')
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'transparent',
                        border: 'none',
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--text, #334155)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        padding: '2px 0',
                      }}
                    >
                      <FileCode2 size={14} style={{ color: 'var(--muted, #64748b)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Section 2: Artifacts */}
            <div style={{ borderBottom: '1px solid var(--border-soft, #f1f5f9)', paddingBottom: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  marginBottom: artifactsSectionOpen ? 8 : 0,
                }}
                onClick={() => setArtifactsSectionOpen((v) => !v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text, #475569)' }}>
                  <span>Artifacts</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>{dynamicArtifacts.length}</span>
                  <ChevronDown size={14} style={{ color: 'var(--muted-2, #94a3b8)', transform: artifactsSectionOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {artifactsSectionOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                  {dynamicArtifacts.length > 0 ? (
                    dynamicArtifacts.map((art) => (
                      <button
                        key={art.id}
                        type="button"
                        onClick={() => {
                          if (art.type === 'file') {
                            if (art.code) onOpenArtifactFile?.(art.code)
                          } else {
                            setViewerOverride(art)
                            setViewerTab(art.type === 'preview' ? 'preview' : 'code')
                            setTab('artifacts')
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background: 'transparent',
                          border: 'none',
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--text, #334155)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          padding: '2px 0',
                        }}
                      >
                        <BookOpen size={14} style={{ color: 'var(--muted, #64748b)' }} />
                        <span>{art.title}</span>
                      </button>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)', padding: '2px 0' }}>No artifacts generated yet in this chat.</div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Section 3: Uploads */}
            <div style={{ borderBottom: '1px solid var(--border-soft, #f1f5f9)', paddingBottom: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  marginBottom: uploadsOpen ? 8 : 0,
                }}
                onClick={() => setUploadsOpen((v) => !v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text, #475569)' }}>
                  <span>Uploads</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>{dynamicUploads.length}</span>
                  <ChevronDown size={14} style={{ color: 'var(--muted-2, #94a3b8)', transform: uploadsOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {uploadsOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                  {dynamicUploads.length > 0 ? (
                    dynamicUploads.map((up) => (
                      <div key={up.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text, #334155)' }}>
                        <File size={14} style={{ color: 'var(--muted-2, #94a3b8)' }} />
                        <span>{up.name}</span>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)', padding: '2px 0' }}>No files uploaded in this chat.</div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Section 4: Background Tasks — now in sync with execution / tool log */}
            <div style={{ borderBottom: '1px solid var(--border-soft, #f1f5f9)', paddingBottom: 10 }}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: tasksOpen ? 6 : 0 }}
                onClick={() => setTasksOpen((v) => !v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text, #475569)' }}>
                  <span>Background Tasks</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>{dynamicBgTasks.length || (busy ? 1 : 0)}</span>
                  <ChevronRight size={14} style={{ color: 'var(--muted-2, #94a3b8)', transform: tasksOpen ? 'rotate(90deg)' : 'none' }} />
                </div>
                {busy ? <span style={{ width:7, height:7, borderRadius:'50%', background:'#f59e0b', animation:'pulse 1s infinite' }} /> : null}
              </div>
              {tasksOpen ? (
                <div style={{ display:'flex', flexDirection:'column', gap:6, paddingLeft:4 }}>
                  {busy && execution ? (
                    <div style={{ fontSize:12, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:6, padding:'6px 8px' }}>
                      <div style={{ fontWeight:600 }}>
                        {execution.phase==='tool' ? `Tool: ${execution.toolName ?? 'shell_exec'}` : execution.phase==='thinking' ? 'Thinking…' : execution.phase==='planning' ? 'Planning…' : execution.phase}
                      </div>
                      {execution.detail ? <div style={{ opacity:0.8, marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{String(execution.detail).slice(0,80)}</div> : null}
                    </div>
                  ) : null}
                  {dynamicBgTasks.length>0 ? dynamicBgTasks.map((t)=>(
                    <div key={t.id} style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--text, #334155)', background:'var(--panel, #f8fafc)', border:'1px solid var(--border, #e2e8f0)', borderRadius:6, padding:'5px 8px' }}>
                      <span style={{ width:7, height:7, borderRadius:'50%', background: t.status==='running' ? '#f59e0b' : '#10b981', flexShrink:0 }} />
                      <span style={{ fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</span><span style={{ color:'var(--muted, #64748b)', flexShrink:0 }}>{t.status}</span>{t.progress ? <span style={{ marginLeft:'auto', fontSize:10, color:'#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.progress}</span> : null}
                    </div>
                  )) : !busy ? <div style={{ fontSize:12, color:'var(--muted-2, #94a3b8)', padding:'2px 0' }}>No background tasks in this chat.</div> : null}
                </div>
              ) : null}
            </div>

            {/* Section 5: Terminals */}
            <div style={{ borderBottom: '1px solid var(--border-soft, #f1f5f9)', paddingBottom: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  marginBottom: terminalsOpen ? 8 : 0,
                }}
                onClick={() => setTerminalsOpen((v) => !v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text, #475569)' }}>
                  <span>Terminals</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>{terminalInstances.length}</span>
                  <ChevronDown size={14} style={{ color: 'var(--muted-2, #94a3b8)', transform: terminalsOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {terminalsOpen ? (
                <div style={{ paddingLeft: 4 }}>
                  {terminalInstances.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)', padding: '2px 0' }}>
                      {terminalBackend === 'offline' ? 'Shell backend offline — no live terminals.' : 'No live terminals.'}
                    </div>
                  ) : null}
                  {terminalInstances.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setActiveTerminalId(t.id)
                        setTab('terminal')
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: '100%',
                        background: 'transparent',
                        border: 'none',
                        fontSize: 13,
                        color: 'var(--text, #334155)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        padding: '4px 0',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ width:7, height:7, borderRadius:'50%', background: t.status==='alive' ? '#10b981' : '#94a3b8', flexShrink:0 }} />
                        <TerminalIcon size={14} style={{ color: 'var(--muted, #64748b)', flexShrink: 0 }} />
                        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.name}</span>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--muted-2, #94a3b8)', flexShrink: 0 }}>
                        {t.pid !== null ? `pid ${t.pid} · ` : ''}{t.status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Section 6: Skills Used (100% Dynamic, 0 hardcoded) */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  marginBottom: skillsOpen ? 8 : 0,
                }}
                onClick={() => setSkillsOpen((v) => !v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text, #475569)' }}>
                  <span>Skills Used</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>{dynamicSkills.length}</span>
                  <ChevronDown size={14} style={{ color: 'var(--muted-2, #94a3b8)', transform: skillsOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {skillsOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                  {dynamicSkills.length > 0 ? (
                    dynamicSkills.map((sk, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          if (sk.path) {
                            openArtifact(sk.path + (sk.path.endsWith('SKILL.md') ? '' : '/SKILL.md'))
                          }
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 12,
                          color: 'var(--text, #334155)',
                          background: 'transparent',
                          border: 'none',
                          cursor: sk.path ? 'pointer' : 'default',
                          textAlign: 'left',
                          padding: '2px 0',
                          width: '100%',
                        }}
                      >
                        <FileText size={14} style={{ color: 'var(--muted-2, #94a3b8)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 500 }}>{sk.name}</span>
                        {sk.path ? <span style={{ fontSize: 10, color: 'var(--muted-2, #94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sk.path}</span> : null}
                      </button>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)', padding: '2px 0' }}>No skills used in this chat.</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* VIEW 2: REVIEW TAB (Matches Image 1 media_1790049747410.png) */}
        {tab === 'diffs' ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Review Sub-Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderBottom: '1px solid #e2e8f0',
                background: '#ffffff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Review</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                  Uncommitted v
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b' }}>
                <MoreHorizontal size={15} style={{ cursor: 'pointer' }} />
                <Search size={15} style={{ cursor: 'pointer' }} />
                <button
                  type="button"
                  aria-label="Toggle Sub-sidebar"
                  title="Toggle Sub-sidebar"
                  onClick={() => setSubSidebarOpen((v) => !v)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 2,
                    cursor: 'pointer',
                    color: subSidebarOpen ? '#0f172a' : '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Layers size={15} />
                </button>
              </div>
            </div>

            {/* Split Layout: Main Diff View (Left) + File Changes Sub-Sidebar (Right) */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Main Diff Area */}
              <div style={{ flex: 1, overflowY: 'auto', borderRight: subSidebarOpen ? '1px solid #e2e8f0' : 'none', background: '#ffffff', display: 'flex', flexDirection: 'column' }}>
                {selectedReviewFile ? (
                  <>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 12px', background:'#f1f5f9', borderBottom:'1px solid #e2e8f0', gap:8 }}>
                      <span style={{ fontSize:11, color:'#64748b', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{selectedReviewFile.path}</span>
                      <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                        {[
                          {k:'diff',l:'Diff'},
                          {k:'code',l:'Code'},
                          ...(fileDiffData?.isMarkdown ? [{k:'markdown',l:'README'} as const] : []),
                          ...(fileDiffData?.isHtml ? [{k:'preview',l:'Browser'} as const] : []),
                          ...((fileDiffData as any)?.isImage ? [{k:'image',l:'Image'} as const] : []),
                        ].map(t => (
                          <button key={t.k} onClick={()=>setFileRenderMode(t.k as never)} style={{ padding:'2px 8px', borderRadius:999, border:'1px solid '+(fileRenderMode===t.k?'#0f172a':'#e2e8f0'), background:fileRenderMode===t.k?'#0f172a':'#fff', color:fileRenderMode===t.k?'#fff':'#475569', fontSize:10, fontWeight:600, cursor:'pointer' }}>{t.l}</button>
                        ))}
                      </div>
                    </div>
                    {fileDiffLoading ? (
                      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8, color:'#64748b', fontSize:12 }}><div style={{ width:16, height:16, border:'2px solid #e2e8f0', borderTopColor:'#0284c7', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/> Loading diff…<style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>
                    ) : fileRenderMode==='image' && (fileDiffData as any)?.imageDataUrl ? (
                      <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'#f8fafc', padding:16, gap:10 }}>
                        <img src={(fileDiffData as any).imageDataUrl} alt={selectedReviewFile.path} style={{ maxWidth:'100%', maxHeight:420, borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,0.14)', background:'#fff' }} />
                        <span style={{ fontSize:11, color:'#64748b' }}>{selectedReviewFile.path} — image preview</span>
                      </div>
                    ) : fileRenderMode==='markdown' && fileDiffData?.content ? (
                      <div style={{ padding:16, overflow:'auto' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(fileDiffData.content) }} />
                    ) : fileRenderMode==='preview' && fileDiffData?.content ? (
                      <iframe srcDoc={fileDiffData.content} sandbox="allow-scripts allow-same-origin" style={{ flex:1, width:'100%', minHeight:400, border:'none', background:'#fff' }} title="Browser preview" />
                    ) : fileRenderMode==='code' && fileDiffData?.content ? (
                      <pre style={{ margin:0, padding:12, fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize:12, lineHeight:1.6, whiteSpace:'pre-wrap', wordBreak:'break-all', color:'#0f172a', background:'#ffffff' }}>{fileDiffData.content.slice(0,12000)}</pre>
                    ) : parsedDiff && parsedDiff.length > 0 ? (
                      <div style={{ fontFamily:'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize:12, lineHeight:1.6 }}>
                        {parsedDiff.map((chunk, i) => (
                          <div key={i} style={{ display:'flex', background: chunk.type==='add'?'#f0fdf4':chunk.type==='del'?'#fef2f2':chunk.type==='hunk'?'#f8fafc':'transparent', color: chunk.type==='add'?'#166534':chunk.type==='del'?'#991b1b':chunk.type==='hunk'?'#64748b':'#334155', borderLeft: chunk.type==='add'?'3px solid #22c55e':chunk.type==='del'?'3px solid #ef4444':'3px solid transparent', padding:'1px 8px', fontWeight: chunk.type==='hunk'?600:400 }}>
                            <span style={{ width:36, color:'#94a3b8', userSelect:'none', flexShrink:0 }}>{chunk.oldN ?? ''}</span>
                            <span style={{ width:36, color:'#94a3b8', userSelect:'none', flexShrink:0 }}>{chunk.newN ?? ''}</span>
                            <pre style={{ margin:0, whiteSpace:'pre-wrap', wordBreak:'break-all', flex:1 }}>{chunk.type==='hunk'?chunk.text:chunk.text}</pre>
                          </div>
                        ))}
                      </div>
                    ) : fileDiffData?.diff ? (
                      <pre style={{ margin:0, padding:12, fontFamily:'ui-monospace', fontSize:12, whiteSpace:'pre-wrap', background:'#fff', color:'#334155' }}>{fileDiffData.diff.slice(0,8000)}</pre>
                    ) : (
                      <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:13 }}>No diff available — file may be untracked</div>
                    )}
                  </>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
                    <span>Select a file to see old → new diff, README or browser preview</span>
                  </div>
                )}
              </div>

              {/* Right Sub-Sidebar: Staged Changes & Changes */}
              {subSidebarOpen ? (
                <div style={{ width: 170, padding: '12px 10px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Staged Changes</div>
                    {stagedFiles.length > 0 ? (
                      stagedFiles.map((f, i) => (
                        <div key={i} onClick={() => setSelectedReviewFile(f)} style={{ fontSize: 12, color: '#0f172a', cursor: 'pointer', padding: '2px 0' }}>
                          {f.path.split(/[/\\]/).pop()}
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>No file changes</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>Changes</div>
                    {unstagedFiles.length > 0 ? (
                      unstagedFiles.map((f, i) => (
                        <div key={i} onClick={() => setSelectedReviewFile(f)} style={{ fontSize: 12, color: '#0f172a', cursor: 'pointer', padding: '2px 0' }}>
                          {f.path.split(/[/\\]/).pop()}
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>No file changes</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* VIEW 3: TERMINALS TAB (Matches Image 2 media_1790049777848.png) */}
        {tab === 'terminal' ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Terminals Sub-Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderBottom: '1px solid #e2e8f0',
                background: '#ffffff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>Terminals</span>
                <span
                  title={terminalBackend === 'live' ? 'Persistent shell backend connected' : terminalBackend === 'offline' ? `Persistent shell backend offline${terminalError ? `: ${terminalError}` : ''}` : 'Connecting to persistent shell backend…'}
                  style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:10, color:'#64748b', fontWeight:500 }}
                >
                  <span style={{ width:7, height:7, borderRadius:'50%', background: terminalBackend==='live' ? '#10b981' : terminalBackend==='offline' ? '#ef4444' : '#f59e0b' }} />
                  {terminalBackend === 'live' ? 'persistent shell · real PTY (ConPTY)' : terminalBackend === 'offline' ? 'backend offline · one-shot mode' : 'connecting…'}
                </span>
                <select
                  aria-label="New Persistent Shell"
                  title="Spawn a new persistent shell"
                  value={activeTerminal?.shell || 'powershell'}
                  onChange={(e) => {
                    const val = e.target.value as 'powershell' | 'cmd' | 'bash' | 'python' | 'node'
                    void createRealTerminal(val).then((inst) => {
                      if (!inst) {
                        setOrphanShellLogs((prev) =>
                          [...prev, `✖ cannot spawn ${val} shell: terminal backend offline${terminalError ? ` (${terminalError})` : ''}`].slice(-2000)
                        )
                      }
                    })
                  }}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: '#f1f5f9',
                    color: '#475569',
                    border: '1px solid #e2e8f0',
                    cursor: 'pointer',
                    outline: 'none',
                    fontWeight: 500,
                  }}
                >
                  <option value="powershell">PowerShell</option>
                  <option value="cmd">Command Prompt (cmd)</option>
                  <option value="bash">WSL / Bash</option>
                  <option value="python">Python REPL</option>
                  <option value="node">Node.js REPL</option>
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b' }}>
                <button
                  type="button"
                  aria-label="New Terminal"
                  title="New Terminal"
                  onClick={handleAddNewTerminal}
                  style={{ background: 'transparent', border: 'none', padding: 2, cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
                >
                  <Plus size={15} />
                </button>
                <button
                  type="button"
                  aria-label="Toggle Sub-sidebar"
                  title="Toggle Sub-sidebar"
                  onClick={() => setSubSidebarOpen((v) => !v)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 2,
                    cursor: 'pointer',
                    color: subSidebarOpen ? '#0f172a' : '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <Layers size={15} />
                </button>
              </div>
            </div>

            {/* Split Layout: Terminal Console Output (Left) + Conversations Sub-Sidebar (Right) */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Left Main Terminal Console Output */}
              <div
                style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#ffffff', borderRight: subSidebarOpen ? '1px solid #e2e8f0' : 'none' }}
                onClick={() => terminalInputRef.current?.focus()}
              >
                <div
                  ref={terminalContainerRef}
                  style={{
                    flex: 1,
                    padding: 12,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: '#0f172a',
                    background: '#ffffff',
                    cursor: 'text',
                    wordBreak: 'break-all',
                    overflowWrap: 'anywhere',
                    userSelect: 'text',
                  }}
                >
                  {activeTerminal ? (
                    activeTerminal.logs.map((logLine, idx) => {
                      const isPrompt = logLine.startsWith('PS') || logLine.startsWith('D:') || logLine.startsWith('user@') || logLine.startsWith('>')
                      const isError = logLine.startsWith('✖') || logLine.includes('ERROR') || logLine.startsWith('  hint:')
                      const isHint = logLine.startsWith('  hint:') || logLine.startsWith('  →')
                      return (
                      <div
                        key={idx}
                        style={{
                          color: isError ? (isHint ? '#d97706' : '#dc2626') : isPrompt ? '#0284c7' : '#334155',
                          background: isError && !isHint ? '#fef2f2' : undefined,
                          borderLeft: isError && !isHint ? '2px solid #fecaca' : undefined,
                          paddingLeft: isError && !isHint ? 6 : 0,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          overflowWrap: 'anywhere',
                          userSelect: 'text',
                        }}
                      >
                        {logLine}
                      </div>
                    )})
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      {orphanShellLogs.length > 0 ? (
                        orphanShellLogs.map((logLine, idx) => (
                          <div key={idx} style={{ color:'#334155', whiteSpace:'pre-wrap', wordBreak:'break-all', overflowWrap:'anywhere', userSelect:'text' }}>
                            {logLine}
                          </div>
                        ))
                      ) : null}
                      <div style={{ fontSize:12, color:'#94a3b8', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'10px 12px' }}>
                        <div style={{ fontWeight:700, color:'#475569', marginBottom:4 }}>
                          {terminalBackend === 'offline' ? 'Persistent shell backend offline' : 'No live shell'}
                        </div>
                        <div>
                          {terminalBackend === 'offline'
                            ? `Typed commands still run as one-shot shell_exec below. AI shell activity streams here. Persistent shell backend reported: ${terminalError ?? 'unknown error'} — check the main-process log.`
                            : 'Spawning the persistent shell… typed commands run as one-shot shell_exec until it connects.'}
                        </div>
                        {terminalBackend === 'offline' ? (
                          <button
                            type="button"
                            onClick={() => { void createRealTerminal('powershell') }}
                            style={{ marginTop:8, padding:'4px 12px', borderRadius:6, border:'1px solid #cbd5e1', background:'#ffffff', color:'#0f172a', fontSize:12, fontWeight:600, cursor:'pointer' }}
                          >
                            Retry shell connection
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {/* Terminal Shell Input Prompt - Integrated directly inside console stream */}
                  <form
                    onSubmit={handleRunCommand}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      marginTop: 2,
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#0284c7', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontWeight: 600, flexShrink: 0, marginRight: 6 }}>
                      {promptPrefix}
                    </span>
                    <input
                      ref={terminalInputRef}
                      type="text"
                      value={commandInput}
                      onChange={(e) => {
                        setCommandInput(e.target.value)
                        if (historyIdx !== -1) setHistoryIdx(-1)
                      }}
                      onKeyDown={handleKeyDown}
                      autoFocus
                      className="focus:outline-none focus:ring-0 focus:border-none focus:shadow-none shadow-none outline-none border-none"
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        boxShadow: 'none',
                        WebkitAppearance: 'none',
                        color: '#0f172a',
                        fontSize: 12,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        padding: 0,
                        margin: 0,
                      }}
                    />
                  </form>
                </div>
              </div>

              {/* Right Sub-Sidebar: Active Terminal Sessions grouped under Conversations */}
              {subSidebarOpen ? (
                <div style={{ width: 170, padding: '12px 10px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Conversations</div>

                  <div style={{ fontSize: 12, fontWeight: 500, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sessionTitle}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {terminalInstances.map((t) => {
                      const isSel = t.id === activeTerminalId
                      return (
                        <div
                          key={t.id}
                          onClick={() => setActiveTerminalId(t.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '4px 6px',
                            borderRadius: 6,
                            background: isSel ? '#e2e8f0' : 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                            <TerminalIcon size={14} style={{ color: '#64748b', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.name.split('.')[0]}
                            </span>
                          </div>
                          <button
                            type="button"
                            aria-label={`Kill ${t.name}`}
                            title="Kill Terminal Session"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleKillTerminal(t.id)
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: 2,
                              cursor: 'pointer',
                              color: '#94a3b8',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* VIEW 4: ARTIFACT VIEWER TAB — renders the artifact opened from chat */}
        {tab === 'artifacts' ? (
          viewerArtifact ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderBottom: '1px solid #e2e8f0',
                  background: '#ffffff',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Code2 size={15} style={{ color: '#64748b', flexShrink: 0 }} aria-hidden />
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewerArtifact.title}</span>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 6, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', flexShrink: 0 }}>{viewerArtifact.language}</span>
                </div>
                {viewerCanPreview ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} role="tablist" aria-label="Artifact view">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewerTab === 'code'}
                      onClick={() => setViewerTab('code')}
                      style={{
                        padding: '3px 12px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 999,
                        border: '1px solid ' + (viewerTab === 'code' ? '#0f172a' : '#e2e8f0'),
                        background: viewerTab === 'code' ? '#0f172a' : '#ffffff',
                        color: viewerTab === 'code' ? '#ffffff' : '#475569',
                        cursor: 'pointer',
                      }}
                    >
                      Code
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewerTab === 'preview'}
                      onClick={() => setViewerTab('preview')}
                      style={{
                        padding: '3px 12px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 999,
                        border: '1px solid ' + (viewerTab === 'preview' ? '#0f172a' : '#e2e8f0'),
                        background: viewerTab === 'preview' ? '#0f172a' : '#ffffff',
                        color: viewerTab === 'preview' ? '#ffffff' : '#475569',
                        cursor: 'pointer',
                        opacity: viewerCanPreview ? 1 : 0.5,
                      }}
                    >
                      Preview
                    </button>
                </div>
                ) : null}
              </div>
              {viewerTab === 'preview' && viewerCanPreview ? (
                <div style={{ flex: 1, minHeight: 0, background: '#090d16', display: 'flex' }}>
                  {viewerHtml ? (
                    <iframe
                      srcDoc={viewerHtml}
                      title={viewerArtifact.title}
                      sandbox="allow-scripts allow-modals"
                      style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: '#090d16' }}
                    />
                    ) : (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#475569', fontSize: 13 }}>
                      <div style={{ width: 28, height: 28, border: '2px solid #334155', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      <span>Preparing preview…</span>
                      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                    </div>
                  )}
                </div>
              ) : (
                <pre
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflow: 'auto',
                    margin: 0,
                    padding: 14,
                    background: '#fffefa',
                    color: '#1A1614',
                    font: '12px/1.6 ui-monospace, Menlo, monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    userSelect: 'text',
                  }}
                >
                  <code>{viewerArtifact.code}</code>
                </pre>
              )}
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
              Open an artifact from chat (Split View / Preview) and it renders here.
            </div>
          )
        ) : null}
      </div>
    </aside>
  )
}
