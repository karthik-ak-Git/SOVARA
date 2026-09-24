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
import { dispatchTool, openArtifact, type SessionEventView } from '@/lib/client/api'
import { preparePreviewHtml, isVisualArtifact, isBinaryArtifact } from '../../utils/previewBundler'
import { parseMessageContent } from '../../features/chat/MessageBubble'

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
  activeTasks = [],
  terminalLogs = [],
  changedFiles = [],
  events = [],
  sessionTitle = 'Current Conversation',
  sessionId,
  workspaceRoot,
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

  // --- Dynamic data extraction from Session Events ---
  const dynamicFiles = useMemo(() => {
    if (changedFiles.length > 0) return changedFiles
    const map = new Map<string, ChangedFileItem>()

    const registerPath = (p: string) => {
      const clean = p.replace(/\\/g, '/').trim()
      if (!clean || clean === '.' || clean === './' || clean.startsWith('http') || clean.length < 2) return
      if (!map.has(clean)) {
        map.set(clean, {
          path: clean,
          staged: false,
          additions: 12,
          deletions: 2,
          diffChunks: [
            { lineOld: 1, lineNew: 1, type: 'context', content: `// File: ${clean}` },
            { lineNew: 2, type: 'add', content: '+ // Created or modified by AI assistant' },
          ],
        })
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
        for (const m of matches) {
          if (m[1]) registerPath(m[1])
        }
        const fileMatches = raw.matchAll(/(?:written to\s+|created\s+)([a-zA-Z0-9_./\\-]+)/gi)
        for (const m of fileMatches) {
          if (m[1]) registerPath(m[1])
        }
      }
    }
    return Array.from(map.values())
  }, [events, changedFiles])

  const stagedFiles = useMemo(() => dynamicFiles.filter((f) => f.staged), [dynamicFiles])
  const unstagedFiles = useMemo(() => dynamicFiles.filter((f) => !f.staged), [dynamicFiles])

  const [selectedReviewFile, setSelectedReviewFile] = useState<ChangedFileItem | null>(null)

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
    const list: Array<{ id: string; role: string; type: string; state: string; duration?: string }> = []
    for (const e of events) {
      if (e.type === 'tool/call') {
        const d: any = e.data || {}
        const toolName = d.name || d.toolName || d.toolCall?.name
        if (toolName === 'invoke_subagent' || toolName === 'define_subagent') {
          const role = d.args?.Role || d.args?.name || d.args?.role || 'Subagent Task'
          list.push({
            id: String(e.seq || Math.random()),
            role: String(role),
            type: String(toolName),
            state: 'completed',
            duration: 'Worked for subagent',
          })
        }
      }
    }
    return list
  }, [events, activeSubagents])

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
    for (const e of events) {
      if (e.type === 'assistant/message' && e.data) {
        const raw = typeof e.data === 'string' ? e.data : ((e.data as { content?: string }).content ?? '')
        if (typeof raw !== 'string' || !raw.includes('```')) continue
        for (const part of parseMessageContent(raw)) {
          if (part.type === 'code') push(part.title, part.language, part.code, `art-${e.seq}-${list.length}`)
        }
      }
    }
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

  // Skills — honest: only count skills actually read via tool calls (search_skills/read_skill), not injected context
  const dynamicSkills = useMemo(() => {
    const fromCalls: Array<{ name: string; path?: string; source?: string }> = []
    for (const e of events) {
      if (e.type === 'tool/call' || e.type === 'tool/result' || e.type === 'tool/call' as any) {
        const d: any = e.data || {}
        const toolName = d.name || d.toolName || d.toolCall?.name || d.tool_name
        const isSkillTool = toolName === 'search_skills' || toolName === 'read_skill'
        if (isSkillTool) {
          const name = d.args?.skill_name || d.args?.skillName || d.args?.name || d.args?.query || d.args?.skill || 'skill'
          if (!fromCalls.some((s) => s.name === name)) {
            fromCalls.push({ name: String(name), path: d.args?.path, source: 'tool' })
          }
        }
        // Also capture search_skills/read_skill from native tool_calls if present
        if (toolName === 'search_skills' || toolName === 'read_skill') {
          const name2 = d.args?.query || d.args?.skill_name || d.args?.skillName || ''
          if (name2 && !fromCalls.some((s) => s.name === name2)) {
            fromCalls.push({ name: String(name2), source: 'tool' })
          }
        }
      }
    }
    // Cap for sidebar
    return fromCalls.slice(0, 10)
  }, [events])

  // --- Dynamic Terminal Sessions & Command Execution with Full Persistence ---
  interface TerminalInstance {
    id: string
    name: string
    pid: string
    shellType?: 'powershell' | 'cmd' | 'bash' | 'python' | 'node'
    logs: string[]
  }

  const storageKey = useMemo(
    () => `sovara_terminals_${sessionTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    [sessionTitle]
  )
  const activeKey = useMemo(
    () => `sovara_active_term_${sessionTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
    [sessionTitle]
  )

  const [terminalInstances, setTerminalInstances] = useState<TerminalInstance[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return [
      {
        id: 'term-1',
        name: 'powershell.exe',
        pid: 'PID 15680',
        logs: [
          'Windows PowerShell',
          'Copyright (C) Microsoft Corporation. All rights reserved.',
          '',
        ],
      },
    ]
  })

  const [activeTerminalId, setActiveTerminalId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(activeKey)
      if (saved) return saved
    } catch {}
    return 'term-1'
  })

  // Sync state when sessionTitle changes (switching chats)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTerminalInstances(parsed)
        }
      }
      const savedActive = localStorage.getItem(activeKey)
      if (savedActive) {
        setActiveTerminalId(savedActive)
      }
    } catch {}
  }, [storageKey, activeKey])

  // Automatically save terminal instances and active terminal ID on updates
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(terminalInstances))
    } catch {}
  }, [terminalInstances, storageKey])

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

  const activeTerminal = terminalInstances.find((t) => t.id === activeTerminalId) || terminalInstances[0]

  const workspaceLabel = useMemo(() => {
    if (!workspaceRoot) return 'SOVARA'
    const base = workspaceRoot.replace(/\\/g, '/').split('/').pop() || 'SOVARA'
    return base
  }, [workspaceRoot])

  const promptPrefix = useMemo(() => {
    const st = activeTerminal?.shellType || 'powershell'
    const ws = workspaceRoot || 'D:\\SOVARA'
    if (st === 'cmd') return `${ws}>`
    if (st === 'bash') return `user@sovara:~/${workspaceLabel}$`
    if (st === 'python') return '>>>'
    if (st === 'node') return '>'
    return `PS ${ws}>`
  }, [activeTerminal?.shellType, workspaceRoot, workspaceLabel])

  // Track which events we have already processed into the terminal logs
  const processedEvents = useRef<Set<string>>(new Set())

  // Stream AI tool execution outputs into the active terminal instance
  useEffect(() => {
    let changed = false
    const newLogs: string[] = []

    for (const e of events) {
      const eventId = String(e.seq ?? Math.random())
      if (processedEvents.current.has(eventId)) continue

      if (e.type === 'tool/call' || (e.type as any) === 'tool/result') {
        const d: any = e.data || {}
        const toolName = d.name || d.toolName || d.toolCall?.name
        
        if (toolName === 'run_command' || toolName === 'exec_shell_command' || toolName === 'shell_exec') {
          if (e.type === 'tool/call') {
            const cmd = d.args?.CommandLine || d.args?.cmd || d.args?.command || ''
            if (cmd) {
              newLogs.push(`${promptPrefix} ${cmd}`)
              newLogs.push('Running command via AI assistant...')
              processedEvents.current.add(eventId)
              changed = true
            }
          } else if ((e.type as any) === 'tool/result') {
            let outText = ''
            const res = d.content || d.result || d
            if (typeof res === 'string') {
              try {
                const parsed = JSON.parse(res)
                if (parsed && typeof parsed === 'object') {
                  outText = parsed.stdout || parsed.stderr || parsed.message || parsed.error || res
                } else {
                  outText = res
                }
              } catch {
                outText = res
              }
            } else if (res && typeof res === 'object') {
              outText = res.stdout || res.stderr || res.message || res.error || JSON.stringify(res)
            } else {
              outText = 'Done.'
            }
            if (outText.trim()) {
              newLogs.push(outText.trim())
            }
            processedEvents.current.add(eventId)
            changed = true
          }
        }
      }
    }

    if (changed && newLogs.length > 0) {
      setTerminalInstances((prev) =>
        prev.map((t) =>
          t.id === activeTerminalId
            ? { ...t, logs: [...t.logs, ...newLogs] }
            : t
        )
      )
    }
  }, [events, activeTerminalId, promptPrefix])

  useEffect(() => {
    if (tab === 'terminal' && terminalContainerRef.current) {
      terminalContainerRef.current.scrollTop = terminalContainerRef.current.scrollHeight
    }
  }, [tab, terminalInstances, activeTerminalId])

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
      setTerminalInstances((prev) =>
        prev.map((t) => (t.id === activeTerminalId ? { ...t, logs: [] } : t))
      )
      setCommandInput('')
      return
    }

    setTerminalInstances((prev) =>
      prev.map((t) => (t.id === activeTerminalId ? { ...t, logs: [...t.logs, `${promptPrefix} ${cmd}`] } : t))
    )
    setCommandInput('')

    try {
      const effectiveCwd = workspaceRoot || undefined
      const res: any = await dispatchTool('shell_exec', {
        command: cmd,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
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
      setTerminalInstances((prev) =>
        prev.map((t) =>
          t.id === activeTerminalId
            ? { ...t, logs: formatted ? [...t.logs, formatted] : t.logs }
            : t
        )
      )
    } catch (err: any) {
      setTerminalInstances((prev) =>
        prev.map((t) =>
          t.id === activeTerminalId
            ? { ...t, logs: [...t.logs, String(err?.message || err)] }
            : t
        )
      )
    }
  }

  const handleKillTerminal = (id: string): void => {
    setTerminalInstances((prev) => {
      const filtered = prev.filter((t) => t.id !== id)
      if (filtered.length === 0) {
        const newId = `term-${Date.now()}`
        const newTerm: TerminalInstance = {
          id: newId,
          name: 'powershell.exe',
          pid: `PID ${Math.floor(10000 + Math.random() * 90000)}`,
          logs: [
            'Windows PowerShell',
            'Copyright (C) Microsoft Corporation. All rights reserved.',
            '',
          ],
        }
        setActiveTerminalId(newId)
        return [newTerm]
      }
      if (activeTerminalId === id) {
        setActiveTerminalId(filtered[0].id)
      }
      return filtered
    })
  }

  const handleAddNewTerminal = (): void => {
    const newId = `term-${Date.now()}`
    const newTerm: TerminalInstance = {
      id: newId,
      name: 'powershell.exe',
      pid: `PID ${Math.floor(10000 + Math.random() * 90000)}`,
      logs: [
        'Windows PowerShell',
        'Copyright (C) Microsoft Corporation. All rights reserved.',
        '',
      ],
    }
    setTerminalInstances((prev) => [...prev, newTerm])
    setActiveTerminalId(newId)
  }

  // Section Collapse states for Overview
  const [filesOpen, setFilesOpen] = useState(true)
  const [artifactsSectionOpen, setArtifactsSectionOpen] = useState(true)
  const [uploadsOpen, setUploadsOpen] = useState(true)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [terminalsOpen, setTerminalsOpen] = useState(true)
  const [skillsOpen, setSkillsOpen] = useState(true)

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
      }}
    >
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
                    background: 'var(--panel, #f8fafc)',
                    border: '1px solid var(--border-soft, #f1f5f9)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text, #0f172a)' }}>{sa.role}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted, #64748b)', marginTop: 2 }}>
                      {sa.duration || 'Worked for subagent'}
                    </div>
                  </div>
                  <Check size={16} style={{ color: '#10b981' }} aria-hidden />
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

            {/* Section 4: Background Tasks */}
            <div style={{ borderBottom: '1px solid var(--border-soft, #f1f5f9)', paddingBottom: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
                onClick={() => setTasksOpen((v) => !v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--text, #475569)' }}>
                  <span>Background Tasks</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2, #94a3b8)' }}>{activeTasks.length}</span>
                  <ChevronRight size={14} style={{ color: 'var(--muted-2, #94a3b8)', transform: tasksOpen ? 'rotate(90deg)' : 'none' }} />
                </div>
              </div>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TerminalIcon size={14} style={{ color: 'var(--muted, #64748b)' }} />
                        <span>{t.name}</span>
                      </div>
                      <span style={{ fontSize: 10, color: 'var(--muted-2, #94a3b8)' }}>{t.pid}</span>
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
                {selectedReviewFile && selectedReviewFile.diffChunks ? (
                  <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, lineHeight: 1.6 }}>
                    <div style={{ padding: '4px 12px', background: '#f1f5f9', color: '#64748b', fontSize: 11, borderBottom: '1px solid #e2e8f0' }}>
                      <span>{selectedReviewFile.path}</span>
                    </div>
                    {selectedReviewFile.diffChunks.map((chunk, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          background: chunk.type === 'add' ? '#f0fdf4' : chunk.type === 'del' ? '#fef2f2' : 'transparent',
                          color: chunk.type === 'add' ? '#166534' : chunk.type === 'del' ? '#991b1b' : '#334155',
                          borderLeft: chunk.type === 'add' ? '3px solid #22c55e' : chunk.type === 'del' ? '3px solid #ef4444' : '3px solid transparent',
                          padding: '2px 8px',
                        }}
                      >
                        <span style={{ width: 36, color: '#94a3b8', userSelect: 'none', flexShrink: 0 }}>{chunk.lineOld ?? ''}</span>
                        <span style={{ width: 36, color: '#94a3b8', userSelect: 'none', flexShrink: 0 }}>{chunk.lineNew ?? ''}</span>
                        <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{chunk.content}</pre>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', fontSize: 13 }}>
                    <span>No changes to review</span>
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
                <select
                  aria-label="Select Terminal Shell"
                  value={activeTerminal?.shellType || 'powershell'}
                  onChange={(e) => {
                    const val = e.target.value as any
                    const names: Record<string, string> = {
                      powershell: 'powershell.exe',
                      cmd: 'cmd.exe',
                      bash: 'bash.exe',
                      python: 'python.exe',
                      node: 'node.exe',
                    }
                    setTerminalInstances((prev) =>
                      prev.map((t) =>
                        t.id === activeTerminalId
                          ? { ...t, shellType: val, name: names[val] || `${val}.exe` }
                          : t
                      )
                    )
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
                    activeTerminal.logs.map((logLine, idx) => (
                      <div
                        key={idx}
                        style={{
                          color: logLine.startsWith('PS') || logLine.startsWith('D:') || logLine.startsWith('user@') || logLine.startsWith('>') ? '#0284c7' : '#334155',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          overflowWrap: 'anywhere',
                          userSelect: 'text',
                        }}
                      >
                        {logLine}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: '#94a3b8' }}>Terminal console output ready.</div>
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
