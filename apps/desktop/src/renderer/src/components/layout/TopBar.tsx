'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Menu,
  Plus,
  X,
  ChevronDown,
  Cpu,
  FileCode2,
  PanelRight,
  Minus,
  Square,
  MoreVertical,
  Pencil,
  Pin,
  Archive,
  Columns,
  Copy,
  Terminal,
} from 'lucide-react'
import { minimizeWindow, maximizeWindow, closeWindow } from '@/lib/client/api'

const HAS_NATIVE_WINDOW =
  typeof window !== 'undefined' && 'sovara' in (window as unknown as Record<string, unknown>)

interface ChatTab {
  id: string
  title: string
}

interface Props {
  activeTab?: string
  onTabSelect?: (tabId: string) => void
  sidebarOpen?: boolean
  onToggleSidebar?: () => void
  chats?: ChatTab[]
  selectedChatId?: string | null
  onSelectChat?: (id: string) => void
  onCloseChat?: (id: string) => void
  onNewChat?: () => void
  onArchiveChat?: (id: string) => void
  onRenameChat?: (id: string, title: string) => void
  activeModelName?: string
  activeModelContext?: string
  onToggleArtifacts?: () => void
  artifactsOpen?: boolean
  onToggleSplit?: () => void
  splitOpen?: boolean
  onShare?: () => void
  hardwareStatus?: string
  activeProjectName?: string
}

export function TopBar({
  activeTab = 'session',
  onTabSelect,
  sidebarOpen = true,
  onToggleSidebar = () => {},
  chats = [],
  selectedChatId = null,
  onSelectChat,
  onCloseChat,
  onNewChat,
  onArchiveChat,
  onRenameChat,
  activeModelName,
  activeModelContext,
  onToggleArtifacts,
  artifactsOpen = false,
  onToggleSplit,
  splitOpen = false,
  onShare,
  hardwareStatus,
  activeProjectName = 'SOVARA',
}: Props): React.JSX.Element {
  const [modelOpen, setModelOpen] = useState(false)
  const [gpuOpen, setGpuOpen] = useState(false)
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)
  const gpuRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const activeChat = chats.find((c) => c.id === selectedChatId) ?? chats[0]
  const sessionTitle = activeChat?.title ?? 'New Conversation'

  useEffect(() => {
    if (!modelOpen && !gpuOpen && !sessionMenuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false)
      if (gpuRef.current && !gpuRef.current.contains(e.target as Node)) setGpuOpen(false)
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setSessionMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [modelOpen, gpuOpen, sessionMenuOpen])

  return (
    <header className="topbar" role="banner" style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', height: 48, padding: '0 12px' }}>
      <div className="topbar-drag-region" />
      
      <div className="brand-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          className="topbar-icon-btn"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={onToggleSidebar}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b' }}
        >
          <Menu size={16} aria-hidden />
        </button>
        
        <div className="sv-breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155', fontWeight: 500 }}>
          <span style={{ color: '#64748b' }}>{activeProjectName}</span>
          <span style={{ color: '#94a3b8' }}>/</span>
          <strong style={{ fontWeight: 600, color: '#0f172a' }}>{sessionTitle}</strong>
        </div>

        {selectedChatId ? (
          <div className="sv-session-menu-wrap" ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="topbar-icon-btn"
              aria-label="Session actions"
              onClick={() => setSessionMenuOpen((v) => !v)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}
            >
              <MoreVertical size={16} />
            </button>
            {sessionMenuOpen ? (
              <div className="sv-popover-menu" role="menu" style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, width: 170, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, padding: '4px 0' }}>
                <button type="button" role="menuitem" className="sv-menu-item" onClick={() => { setSessionMenuOpen(false); const t = prompt('Rename session:', sessionTitle); if (t && t.trim()) onRenameChat?.(selectedChatId, t.trim()) }}>
                  <Pencil size={13} /> Rename
                </button>
                <button type="button" role="menuitem" className="sv-menu-item" onClick={() => setSessionMenuOpen(false)}>
                  <Pin size={13} /> Pin
                </button>
                <button type="button" role="menuitem" className="sv-menu-item" onClick={() => { setSessionMenuOpen(false); onArchiveChat?.(selectedChatId) }}>
                  <Archive size={13} /> Archive
                </button>
                <div style={{ height: 1, background: '#e2e8f0', margin: '4px 0' }} />
                <button type="button" role="menuitem" className="sv-menu-item" onClick={() => { setSessionMenuOpen(false); onToggleSplit?.() }}>
                  <Columns size={13} /> Split
                </button>
                <button type="button" role="menuitem" className="sv-menu-item" onClick={() => { setSessionMenuOpen(false); void navigator.clipboard.writeText(sessionTitle) }}>
                  <Copy size={13} /> Copy
                </button>
                <button type="button" role="menuitem" className="sv-menu-item" onClick={() => setSessionMenuOpen(false)}>
                  <Terminal size={13} /> Terminal
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div style={{ flex: 1 }} />

      <div className="header-status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="status-popover-wrap" ref={modelRef}>
          <button type="button" className="status-chip" onClick={() => setModelOpen((v) => !v)} aria-expanded={modelOpen} aria-haspopup="dialog" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12, color: '#334155' }}>
            <span className="status-dot" aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
            {activeModelName ?? 'Qwen3 8B'}
            <ChevronDown size={12} aria-hidden />
          </button>
          {modelOpen ? (
            <div className="popover" role="dialog" aria-label="Local model" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, color: '#0f172a' }}>
              <div className="popover-title" style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Active Inference Model</div>
              <div className="info-row" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}><span>Model</span><strong>{activeModelName ?? 'Qwen3 8B'}</strong></div>
              <div className="info-row" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}><span>Status</span><strong style={{ color: '#10b981' }}>Ready</strong></div>
            </div>
          ) : null}
        </div>

        {onToggleArtifacts ? (
          <button
            type="button"
            className="header-action"
            title="Artifacts"
            aria-pressed={artifactsOpen}
            onClick={onToggleArtifacts}
            style={{ background: artifactsOpen ? '#e0f2fe' : '#f8fafc', border: '1px solid #e2e8f0', color: artifactsOpen ? '#0284c7' : '#334155', borderRadius: 6, padding: '4px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          >
            <FileCode2 size={14} aria-hidden />
            <span>Artifacts</span>
          </button>
        ) : null}
      </div>

      {HAS_NATIVE_WINDOW ? (
        <div className="topbar-window-controls" style={{ display: 'flex', alignItems: 'center', marginLeft: 12 }}>
          <button type="button" className="topbar-win-btn" aria-label="Minimize" onClick={minimizeWindow}><Minus size={13} aria-hidden /></button>
          <button type="button" className="topbar-win-btn" aria-label="Maximize" onClick={maximizeWindow}><Square size={11} aria-hidden /></button>
          <button type="button" className="topbar-win-btn close" aria-label="Close" onClick={closeWindow}><X size={13} aria-hidden /></button>
        </div>
      ) : null}
    </header>
  )
}

