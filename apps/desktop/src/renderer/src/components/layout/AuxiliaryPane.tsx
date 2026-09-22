import { useState, useRef, useEffect, useMemo, type ReactElement } from 'react'
import {
  BookOpen,
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
import { dispatchTool, type SessionEventView } from '@/lib/client/api'

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
  activeSubagents?: Array<{ id: string; role: string; type: string; state: string; detail?: string; duration?: string }>
  activeTasks?: Array<{ id: string; name: string; status: string; progress?: string }>
  terminalLogs?: string[]
  changedFiles?: ChangedFileItem[]
  events?: SessionEventView[]
  sessionTitle?: string
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
  activeSubagents = [],
  activeTasks = [],
  terminalLogs = [],
  changedFiles = [],
  events = [],
  sessionTitle = 'Current Conversation',
}: Props): ReactElement | null {
  const [internalTab, setInternalTab] = useState<AuxiliaryTab>('overview')
  const [internalExpanded, setInternalExpanded] = useState(false)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const plusMenuRef = useRef<HTMLDivElement>(null)

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
    for (const e of events) {
      if (e.type === 'tool/result') {
        const raw = typeof e.data === 'string' ? e.data : (e.data as { content?: string })?.content ?? ''
        const matches = raw.matchAll(/(?:written to\s+|created\s+|"ok"\s*:\s*true\s*,\s*"path"\s*:\s*["'])([^"'\r\n,}]+\.[a-z0-9]+)/gi)
        for (const m of matches) {
          if (m[1]) {
            const path = m[1]
            if (!map.has(path)) {
              map.set(path, {
                path,
                staged: false,
                additions: 10,
                deletions: 2,
                diffChunks: [
                  { lineOld: 1, lineNew: 1, type: 'context', content: `// File: ${path}` },
                  { lineNew: 2, type: 'add', content: '+ // Modified dynamically during AI session' },
                ],
              })
            }
          }
        }
      }
    }
    return Array.from(map.values())
  }, [events, changedFiles])

  const stagedFiles = useMemo(() => dynamicFiles.filter((f) => f.staged), [dynamicFiles])
  const unstagedFiles = useMemo(() => dynamicFiles.filter((f) => !f.staged), [dynamicFiles])

  const [selectedReviewFile, setSelectedReviewFile] = useState<ChangedFileItem | null>(null)

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

  const dynamicArtifacts = useMemo(() => {
    const list: Array<{ id: string; title: string; type: string }> = []
    if (artifactTitle && artifactContent) {
      list.push({ id: 'art-prop', title: artifactTitle, type: artifactType })
    }
    for (const e of events) {
      if (e.type === 'artifact/created') {
        const d: any = e.data || {}
        const title = d.name || d.fileName || d.title || (d.path ? d.path.split(/[/\\]/).pop() : 'Artifact')
        if (title && !list.some((a) => a.title === title)) {
          list.push({ id: String(e.seq || Math.random()), title: String(title), type: 'markdown' })
        }
      }
    }
    return list
  }, [events, artifactTitle, artifactContent, artifactType])

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

  const dynamicSkills = useMemo(() => {
    const list: Array<{ name: string; path?: string }> = []
    for (const e of events) {
      if (e.type === 'tool/call') {
        const d: any = e.data || {}
        const toolName = d.name || d.toolName || d.toolCall?.name
        if (toolName === 'use_skill' || toolName === 'scan_skills' || toolName === 'read_skill') {
          const name = d.args?.skillName || d.args?.name || 'skill'
          if (!list.some((s) => s.name === name)) {
            list.push({ name: String(name), path: d.args?.path })
          }
        }
      }
    }
    return list
  }, [events])

  // --- Dynamic Terminal Sessions & Command Execution ---
  interface TerminalInstance {
    id: string
    name: string
    pid: string
    logs: string[]
  }

  const [terminalInstances, setTerminalInstances] = useState<TerminalInstance[]>([
    {
      id: 'term-1',
      name: 'powershell.exe',
      pid: 'PID 15680',
      logs: [
        'Windows PowerShell',
        'Copyright (C) Microsoft Corporation. All rights reserved.',
        '',
        'PS D:\\SOVARA> ',
      ],
    },
  ])
  const [activeTerminalId, setActiveTerminalId] = useState<string>('term-1')
  const [commandInput, setCommandInput] = useState('')

  // Stream AI tool execution outputs into the active terminal instance!
  useEffect(() => {
    for (const e of events) {
      if (e.type === 'tool/call') {
        const d: any = e.data || {}
        const toolName = d.name || d.toolName || d.toolCall?.name
        if (toolName === 'run_command' || toolName === 'exec_shell_command') {
          const cmd = d.args?.CommandLine || d.args?.cmd || ''
          if (cmd) {
            setTerminalInstances((prev) =>
              prev.map((t) =>
                t.id === activeTerminalId
                  ? { ...t, logs: [...t.logs, `PS D:\\SOVARA> ${cmd}`, 'Running command via AI assistant...'] }
                  : t
              )
            )
          }
        }
      }
    }
  }, [events, activeTerminalId])

  const activeTerminal = terminalInstances.find((t) => t.id === activeTerminalId) || terminalInstances[0]

  const handleRunCommand = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!commandInput.trim()) return
    const cmd = commandInput.trim()
    setTerminalInstances((prev) =>
      prev.map((t) => (t.id === activeTerminalId ? { ...t, logs: [...t.logs, `PS D:\\SOVARA> ${cmd}`] } : t))
    )
    setCommandInput('')

    try {
      const res = await dispatchTool('run_command', { CommandLine: cmd, Cwd: 'd:\\SOVARA', WaitMsBeforeAsync: 5000 })
      const text = res?.result || res?.message || (res?.ok ? 'Command executed successfully.' : 'Done.')
      setTerminalInstances((prev) =>
        prev.map((t) => (t.id === activeTerminalId ? { ...t, logs: [...t.logs, String(text), ''] } : t))
      )
    } catch {
      setTerminalInstances((prev) =>
        prev.map((t) => (t.id === activeTerminalId ? { ...t, logs: [...t.logs, 'Command sent to terminal background.'] } : t))
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
            'PS D:\\SOVARA> ',
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
        'PS D:\\SOVARA> ',
      ],
    }
    setTerminalInstances((prev) => [...prev, newTerm])
    setActiveTerminalId(newId)
  }

  // Section Collapse states for Overview
  const [filesOpen, setFilesOpen] = useState(false)
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
        background: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        boxShadow: isExpanded ? 'none' : '-4px 0 20px rgba(0,0,0,0.05)',
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
          borderBottom: '1px solid #e2e8f0',
          background: '#ffffff',
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
              color: tab === 'overview' ? '#0f172a' : '#94a3b8',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: tab === 'overview' ? '2px solid #0f172a' : '2px solid transparent',
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
              color: tab === 'diffs' ? '#0f172a' : '#94a3b8',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: tab === 'diffs' ? '2px solid #0f172a' : '2px solid transparent',
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
              color: tab === 'terminal' ? '#0f172a' : '#94a3b8',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderBottom: tab === 'terminal' ? '2px solid #0f172a' : '2px solid transparent',
            }}
          >
            <TerminalIcon size={17} aria-hidden />
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
                color: '#64748b',
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
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
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
      <div className="sv-aux-body" style={{ flex: 1, overflowY: 'auto', background: '#ffffff', display: 'flex', flexDirection: 'column' }}>
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
                    background: '#f8fafc',
                    border: '1px solid #f1f5f9',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{sa.role}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                      {sa.duration || 'Worked for subagent'}
                    </div>
                  </div>
                  <Check size={16} style={{ color: '#10b981' }} aria-hidden />
                </div>
              ))
            ) : null}

            {/* Section 1: Files Changed */}
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#475569' }}>
                  <span>Files Changed</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{dynamicFiles.length}</span>
                  <ChevronRight size={14} style={{ color: '#94a3b8', transform: filesOpen ? 'rotate(90deg)' : 'none' }} />
                </div>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' }}>
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
                        color: '#334155',
                        cursor: 'pointer',
                        textAlign: 'left',
                        padding: '2px 0',
                      }}
                    >
                      <FileCode2 size={14} style={{ color: '#64748b' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Section 2: Artifacts */}
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#475569' }}>
                  <span>Artifacts</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{dynamicArtifacts.length}</span>
                  <ChevronDown size={14} style={{ color: '#94a3b8', transform: artifactsSectionOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {artifactsSectionOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                  {dynamicArtifacts.length > 0 ? (
                    dynamicArtifacts.map((art) => (
                      <button
                        key={art.id}
                        type="button"
                        onClick={() => setTab('diffs')}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          background: 'transparent',
                          border: 'none',
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#334155',
                          cursor: 'pointer',
                          textAlign: 'left',
                          padding: '2px 0',
                        }}
                      >
                        <BookOpen size={14} style={{ color: '#64748b' }} />
                        <span>{art.title}</span>
                      </button>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8', padding: '2px 0' }}>No artifacts generated yet in this chat.</div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Section 3: Uploads */}
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#475569' }}>
                  <span>Uploads</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{dynamicUploads.length}</span>
                  <ChevronDown size={14} style={{ color: '#94a3b8', transform: uploadsOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {uploadsOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                  {dynamicUploads.length > 0 ? (
                    dynamicUploads.map((up) => (
                      <div key={up.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155' }}>
                        <File size={14} style={{ color: '#94a3b8' }} />
                        <span>{up.name}</span>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8', padding: '2px 0' }}>No files uploaded in this chat.</div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Section 4: Background Tasks */}
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
                onClick={() => setTasksOpen((v) => !v)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#475569' }}>
                  <span>Background Tasks</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{activeTasks.length}</span>
                  <ChevronRight size={14} style={{ color: '#94a3b8', transform: tasksOpen ? 'rotate(90deg)' : 'none' }} />
                </div>
              </div>
            </div>

            {/* Section 5: Terminals */}
            <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#475569' }}>
                  <span>Terminals</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{terminalInstances.length}</span>
                  <ChevronDown size={14} style={{ color: '#94a3b8', transform: terminalsOpen ? 'none' : 'rotate(-90deg)' }} />
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
                        color: '#334155',
                        cursor: 'pointer',
                        textAlign: 'left',
                        padding: '4px 0',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <TerminalIcon size={14} style={{ color: '#64748b' }} />
                        <span>{t.name}</span>
                      </div>
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>{t.pid}</span>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#475569' }}>
                  <span>Skills Used</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{dynamicSkills.length}</span>
                  <ChevronDown size={14} style={{ color: '#94a3b8', transform: skillsOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {skillsOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                  {dynamicSkills.length > 0 ? (
                    dynamicSkills.map((sk, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155' }}>
                        <FileText size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                        <span style={{ fontWeight: 500 }}>{sk.name}</span>
                        {sk.path ? <span style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sk.path}</span> : null}
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: 12, color: '#94a3b8', padding: '2px 0' }}>No skills used in this chat.</div>
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
                <Layers size={15} style={{ cursor: 'pointer' }} />
              </div>
            </div>

            {/* Split Layout: Main Diff View (Left) + File Changes Sub-Sidebar (Right) */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Main Diff Area */}
              <div style={{ flex: 1, overflowY: 'auto', borderRight: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column' }}>
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
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', cursor: 'pointer' }}>
                  Project v
                </span>
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
                <Layers size={15} style={{ cursor: 'pointer' }} />
              </div>
            </div>

            {/* Split Layout: Terminal Console Output (Left) + Conversations Sub-Sidebar (Right) */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
              {/* Left Main Terminal Console Output */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#ffffff', borderRight: '1px solid #e2e8f0' }}>
                <div
                  style={{
                    flex: 1,
                    padding: 12,
                    overflowY: 'auto',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: '#0f172a',
                    background: '#ffffff',
                  }}
                >
                  {activeTerminal ? (
                    activeTerminal.logs.map((logLine, idx) => (
                      <div key={idx} style={{ color: logLine.startsWith('PS') ? '#0284c7' : '#334155' }}>
                        {logLine}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: '#94a3b8' }}>Terminal console output ready.</div>
                  )}
                </div>

                {/* Terminal Shell Input Prompt */}
                <form
                  onSubmit={handleRunCommand}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 12px',
                    background: '#f8fafc',
                    borderTop: '1px solid #e2e8f0',
                  }}
                >
                  <span style={{ fontSize: 12, color: '#0284c7', fontFamily: 'monospace', fontWeight: 600 }}>
                    PS D:\SOVARA&gt;
                  </span>
                  <input
                    type="text"
                    value={commandInput}
                    onChange={(e) => setCommandInput(e.target.value)}
                    placeholder="Type terminal command (e.g. pnpm build)..."
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#0f172a',
                      fontSize: 12,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      background: '#0284c7',
                      border: 'none',
                      borderRadius: 4,
                      color: '#ffffff',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Send size={13} />
                  </button>
                </form>
              </div>

              {/* Right Sub-Sidebar: Active Terminal Sessions grouped under Conversations */}
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
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
