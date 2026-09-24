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
import { SmartNotificationDrawer } from '@/components/ui/SmartNotificationDrawer'

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
  onOpenExplorer?: () => void
  onOpenSettings?: (section?: string) => void
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
  onOpenExplorer,
  onOpenSettings,
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
    <header className="topbar" role="banner" style={{ background: 'var(--bg-elevated, #ffffff)', borderBottom: '1px solid var(--border, #e2e8f0)', height: 48, padding: '0 12px' }}>
      <div className="topbar-drag-region" />
      
      <div className="brand-group" style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, height: '100%' }}>
        <button
          type="button"
          className="topbar-icon-btn"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={onToggleSidebar}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted, #64748b)', padding: 4, flexShrink: 0 }}
        >
          <Menu size={16} aria-hidden />
        </button>

        {/* VS Code Style Tab Management Bar */}
        <div
          className="topbar-tabs-wrapper"
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 2,
            overflowX: 'auto',
            flex: 1,
            minWidth: 0,
            height: '100%',
            paddingLeft: 4,
            scrollbarWidth: 'none',
          }}
        >
          {(chats.length > 0 ? chats : (selectedChatId ? [{ id: selectedChatId, title: sessionTitle }] : [])).map((tab) => {
            const isSelected = tab.id === selectedChatId
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={isSelected}
                tabIndex={0}
                onClick={() => onSelectChat?.(tab.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelectChat?.(tab.id)
                  }
                }}
                className={`topbar-tab ${isSelected ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: '6px 6px 0 0',
                  background: isSelected ? 'var(--bg-elevated, #ffffff)' : 'var(--bg-soft, #f8fafc)',
                  border: isSelected ? '1px solid var(--border, #e2e8f0)' : '1px solid transparent',
                  borderBottom: isSelected ? '2px solid var(--accent, #0284c7)' : '1px solid transparent',
                  color: isSelected ? 'var(--text, #0f172a)' : 'var(--muted, #64748b)',
                  fontWeight: isSelected ? 600 : 400,
                  fontSize: 12,
                  cursor: 'pointer',
                  maxWidth: 180,
                  minWidth: 90,
                  userSelect: 'none',
                  height: 36,
                  boxShadow: isSelected ? 'var(--shadow-panel)' : 'none',
                  transition: 'background 120ms ease, color 120ms ease',
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                  title={tab.title}
                >
                  {tab.title}
                </span>
                {chats.length > 1 ? (
                  <button
                    type="button"
                    className="topbar-tab-close"
                    aria-label={`Close ${tab.title}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onCloseChat?.(tab.id)
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: '2px',
                      borderRadius: 3,
                      cursor: 'pointer',
                      color: isSelected ? '#64748b' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            )
          })}

          <button
            type="button"
            className="topbar-tab-add"
            aria-label="New tab"
            title="New Conversation"
            onClick={onNewChat}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '6px 8px',
              borderRadius: 4,
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              alignSelf: 'center',
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div className="header-status" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="status-popover-wrap" ref={modelRef}>
          <button type="button" className="status-chip" onClick={() => setModelOpen((v) => !v)} aria-expanded={modelOpen} aria-haspopup="dialog" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12, color: '#334155' }}>
            <span className="status-dot" aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: (activeModelContext ?? '').includes('Ready') ? '#10b981' : (activeModelName ? '#f59e0b' : '#cbd5e1') }} />
            {activeModelName ?? 'No model selected'}
            <ChevronDown size={12} aria-hidden />
          </button>
          {modelOpen ? (
            <div className="popover" role="dialog" aria-label="Local model" style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, color: '#0f172a' }}>
              <div className="popover-title" style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Active Inference Model</div>
              <div className="info-row" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}><span>Model</span><strong>{activeModelName ?? 'No model selected'}</strong></div>
              <div className="info-row" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', margin: '4px 0' }}><span>Status</span><strong style={{ color: (activeModelContext ?? '').includes('Ready') ? '#10b981' : '#94a3b8' }}>{(activeModelContext ?? 'Offline')}</strong></div>
            </div>
          ) : null}
        </div>

        <SmartNotificationDrawer onOpenExplorer={onOpenExplorer} onOpenSettings={onOpenSettings} />

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

