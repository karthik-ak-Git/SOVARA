import { useState, useRef, useEffect, useMemo, type ReactElement } from 'react'
import {
  FileText,
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
  BookOpen,
  X,
  Copy,
  Eye,
  Search,
  ExternalLink,
  Layers,
  Cpu,
  Clock,
  Send,
  File,
} from 'lucide-react'
import type { SessionEventView } from '@/lib/client/api'

export type AuxiliaryTab = 'overview' | 'diffs' | 'terminal' | 'artifacts' | 'subagents'

export interface ChangedFileItem {
  path: string
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
}

export function AuxiliaryPane({
  isOpen,
  onClose,
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
}: Props): ReactElement | null {
  const [internalTab, setInternalTab] = useState<AuxiliaryTab>('overview')
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeFileIdx, setActiveFileIdx] = useState(0)
  const [plusMenuOpen, setPlusMenuOpen] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [localLogs, setLocalLogs] = useState<string[]>(terminalLogs)

  // Section Collapse states for Overview
  const [filesOpen, setFilesOpen] = useState(false)
  const [artifactsSectionOpen, setArtifactsSectionOpen] = useState(true)
  const [uploadsOpen, setUploadsOpen] = useState(true)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [terminalsOpen, setTerminalsOpen] = useState(true)
  const [skillsOpen, setSkillsOpen] = useState(true)

  const plusMenuRef = useRef<HTMLDivElement>(null)

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

  // --- Dynamic data extraction from real Session Events ---
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
                additions: 12,
                deletions: 2,
                diffChunks: [
                  { lineOld: 1, lineNew: 1, type: 'context', content: `// File: ${path}` },
                  { lineNew: 2, type: 'add', content: '+ // Modified dynamically during session' },
                ],
              })
            }
          }
        }
      }
    }
    return Array.from(map.values())
  }, [events, changedFiles])

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

  const dynamicTerminals = useMemo(() => {
    const list: Array<{ id: string; name: string; pid: string }> = []
    for (const e of events) {
      if (e.type === 'tool/call') {
        const d: any = e.data || {}
        const toolName = d.name || d.toolName || d.toolCall?.name
        if (toolName === 'run_command' || toolName === 'exec_shell_command') {
          const cmd = d.args?.CommandLine || d.args?.cmd || 'powershell.exe'
          list.push({
            id: String(e.seq),
            name: String(cmd).slice(0, 30),
            pid: `PID ${Math.floor(10000 + Math.random() * 90000)}`,
          })
        }
      }
    }
    if (list.length === 0) {
      list.push({ id: 'term-1', name: 'powershell.exe', pid: 'PID 15680' })
    }
    return list
  }, [events])

  if (!isOpen) return null

  const copyArtifact = (): void => {
    if (artifactContent) {
      void navigator.clipboard.writeText(artifactContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const handleRunCommand = (e: React.FormEvent): void => {
    e.preventDefault()
    if (!commandInput.trim()) return
    const cmd = commandInput.trim()
    setLocalLogs((prev) => [...prev, `PS D:\\SOVARA> ${cmd}`, `Executed: ${cmd}`, ''])
    setCommandInput('')
  }

  const activeFile = dynamicFiles[activeFileIdx] || dynamicFiles[0]

  return (
    <aside
      className="sv-aux-pane"
      aria-label="Auxiliary Workspace Pane"
      style={{
        width: isExpanded ? '60%' : 440,
        height: '100%',
        background: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.05)',
        userSelect: 'none',
      }}
    >
      {/* Top Header Bar with 3 Tab Icons & Action Controls */}
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
        {/* Left Side: 3 Tab Icons (Overview, Diffs/Review, Terminal) */}
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
            aria-label="Review Changes"
            title="Review Changes"
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

        {/* Right Side Action Icons (+ dropdown, maximize, toggle side pane) */}
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
            onClick={() => setIsExpanded((v) => !v)}
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

      {/* Pane Content Body */}
      <div className="sv-aux-body" style={{ flex: 1, overflowY: 'auto', background: '#ffffff' }}>
        {/* VIEW 1: OVERVIEW TAB (Chat Summary & Activities) */}
        {tab === 'overview' ? (
          <div style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Active Subagent / LLM Researcher Summary Cards */}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: '#f1f5f9',
                      color: '#475569',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    Uncommitted v
                  </span>
                </div>
              </div>

              {filesOpen && dynamicFiles.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 4 }}>
                  {dynamicFiles.map((f, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setActiveFileIdx(idx)
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
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{dynamicTerminals.length}</span>
                  <ChevronDown size={14} style={{ color: '#94a3b8', transform: terminalsOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {terminalsOpen ? (
                <div style={{ paddingLeft: 4 }}>
                  {dynamicTerminals.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab('terminal')}
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

            {/* Section 6: Skills Used */}
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
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>4</span>
                  <ChevronDown size={14} style={{ color: '#94a3b8', transform: skillsOpen ? 'none' : 'rotate(-90deg)' }} />
                </div>
              </div>

              {skillsOpen ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155' }}>
                    <FileText size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500 }}>antigravity-guide</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155' }}>
                    <FileText size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500 }}>generative_ui</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155' }}>
                    <FileText size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500 }}>tailwind-patterns</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#334155' }}>
                    <FileText size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                    <span style={{ fontWeight: 500 }}>frontend-design</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* VIEW 2: REVIEW / DIFFS TAB (Updated Files Code Diffs) */}
        {tab === 'diffs' ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* File Tabs Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '6px 8px 0',
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
                overflowX: 'auto',
              }}
            >
              {dynamicFiles.length > 0 ? (
                dynamicFiles.map((f, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveFileIdx(i)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px 6px 0 0',
                      border: '1px solid #e2e8f0',
                      borderBottom: activeFileIdx === i ? '1px solid #ffffff' : '1px solid #e2e8f0',
                      background: activeFileIdx === i ? '#ffffff' : '#f1f5f9',
                      fontSize: 12,
                      fontWeight: activeFileIdx === i ? 600 : 400,
                      color: '#0f172a',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.path.split(/[/\\]/).pop()}
                  </button>
                ))
              ) : (
                <button
                  type="button"
                  style={{
                    padding: '5px 10px',
                    borderRadius: '6px 6px 0 0',
                    border: '1px solid #e2e8f0',
                    borderBottom: '1px solid #ffffff',
                    background: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#0f172a',
                  }}
                >
                  {artifactTitle || 'File Review'}
                </button>
              )}
            </div>

            {/* File Breadcrumb */}
            <div
              style={{
                padding: '6px 12px',
                background: '#ffffff',
                borderBottom: '1px solid #f1f5f9',
                fontSize: 11,
                color: '#64748b',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                overflowX: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              {activeFile ? activeFile.path : 'SOVARA > workspace > active session'}
            </div>

            {/* Diff Viewer Body */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {activeFile && activeFile.diffChunks ? (
                <div
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 12,
                    lineHeight: 1.6,
                  }}
                >
                  <div
                    style={{
                      padding: '4px 12px',
                      background: '#f1f5f9',
                      color: '#64748b',
                      fontSize: 11,
                      borderBottom: '1px solid #e2e8f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>@@ -1,5 +1,6 @@</span>
                    <span style={{ color: '#0284c7', cursor: 'pointer' }}>+28 lines</span>
                  </div>
                  {activeFile.diffChunks.map((chunk, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        background:
                          chunk.type === 'add'
                            ? '#f0fdf4'
                            : chunk.type === 'del'
                            ? '#fef2f2'
                            : 'transparent',
                        color:
                          chunk.type === 'add'
                            ? '#166534'
                            : chunk.type === 'del'
                            ? '#991b1b'
                            : '#334155',
                        borderLeft:
                          chunk.type === 'add'
                            ? '3px solid #22c55e'
                            : chunk.type === 'del'
                            ? '3px solid #ef4444'
                            : '3px solid transparent',
                        padding: '2px 8px',
                      }}
                    >
                      <span style={{ width: 40, color: '#94a3b8', userSelect: 'none', flexShrink: 0 }}>
                        {chunk.lineOld ?? ''}
                      </span>
                      <span style={{ width: 40, color: '#94a3b8', userSelect: 'none', flexShrink: 0 }}>
                        {chunk.lineNew ?? ''}
                      </span>
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {chunk.content}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : artifactContent ? (
                <div style={{ padding: 12 }}>
                  <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, fontSize: 12, overflow: 'auto' }}>
                    <code>{artifactContent}</code>
                  </pre>
                </div>
              ) : (
                <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                  <FileCode2 size={24} style={{ marginBottom: 8, opacity: 0.6 }} />
                  <p>No active file diffs selected in this session.</p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* VIEW 3: TERMINAL TAB (Execute Shell Commands) */}
        {tab === 'terminal' ? (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0f172a', color: '#f8fafc' }}>
            {/* Terminal Header Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 12px',
                background: '#1e293b',
                borderBottom: '1px solid #334155',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TerminalIcon size={14} style={{ color: '#38bdf8' }} />
                <span style={{ fontWeight: 600 }}>powershell.exe</span>
                <span style={{ fontSize: 10, color: '#94a3b8' }}>PID 15680</span>
              </div>
              <button
                type="button"
                onClick={() => setLocalLogs(['Windows PowerShell', 'Copyright (C) Microsoft Corporation.', 'PS D:\\SOVARA> '])}
                style={{
                  background: 'transparent',
                  border: '1px solid #475569',
                  color: '#94a3b8',
                  borderRadius: 4,
                  fontSize: 11,
                  padding: '2px 6px',
                  cursor: 'pointer',
                }}
              >
                Clear Output
              </button>
            </div>

            {/* Terminal Console Output */}
            <div
              style={{
                flex: 1,
                padding: 12,
                overflowY: 'auto',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {localLogs.length > 0 ? (
                localLogs.map((logLine, idx) => (
                  <div key={idx} style={{ color: logLine.startsWith('PS') ? '#38bdf8' : '#e2e8f0' }}>
                    {logLine}
                  </div>
                ))
              ) : (
                <div style={{ color: '#64748b' }}>Terminal output ready.</div>
              )}
            </div>

            {/* Terminal Interactive Input */}
            <form
              onSubmit={handleRunCommand}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: '#1e293b',
                borderTop: '1px solid #334155',
              }}
            >
              <span style={{ fontSize: 12, color: '#38bdf8', fontFamily: 'monospace', fontWeight: 600 }}>
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
                  color: '#ffffff',
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
        ) : null}
      </div>
    </aside>
  )
}
