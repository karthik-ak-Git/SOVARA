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
  activeModelName?: string
  activeModelContext?: string
  onToggleArtifacts?: () => void
  artifactsOpen?: boolean
  onToggleSplit?: () => void
  splitOpen?: boolean
  onShare?: () => void
  hardwareStatus?: string
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
  activeModelName,
  activeModelContext,
  onToggleArtifacts,
  artifactsOpen = false,
  onToggleSplit,
  splitOpen = false,
  onShare,
  hardwareStatus,
}: Props): React.JSX.Element {
  const [modelOpen, setModelOpen] = useState(false)
  const [gpuOpen, setGpuOpen] = useState(false)
  const modelRef = useRef<HTMLDivElement>(null)
  const gpuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!modelOpen && !gpuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) setModelOpen(false)
      if (gpuRef.current && !gpuRef.current.contains(e.target as Node)) setGpuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [modelOpen, gpuOpen])

  return (
    <header className="topbar" role="banner">
      <div className="topbar-drag-region" />
      <div className="brand-group">
        <button
          type="button"
          className="topbar-icon-btn"
          aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={onToggleSidebar}
        >
          <Menu size={17} aria-hidden />
        </button>
        <img src="/logo.png" alt="Sovara" width={24} height={24} style={{ width: 24, height: 24, borderRadius: 7, objectFit: 'cover', flex: 'none', border: '1px solid #e7e3dc' } as React.CSSProperties} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display='none'; const m=document.createElement('div'); m.className='brand-mark'; m.textContent='S'; (e.currentTarget as HTMLImageElement).parentNode?.insertBefore(m, e.currentTarget) }} />
        <span className="brand-name">Sovara</span>
      </div>

      <div className="tabs" role="tablist" aria-label="Chats">
        {chats.length === 0 ? (
          <button
            type="button"
            className={`tab ${!selectedChatId ? 'active' : ''}`}
            role="tab"
            aria-selected={!selectedChatId}
            onClick={() => onNewChat?.()}
          >
            <span>New chat</span>
          </button>
        ) : (
          chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              role="tab"
              id={`tab-${chat.id}`}
              className={`tab ${selectedChatId === chat.id ? 'active' : ''}`}
              aria-selected={selectedChatId === chat.id}
              aria-controls="main-content"
              onClick={() => {
                onSelectChat?.(chat.id)
                onTabSelect?.(chat.id)
              }}
              title={chat.title}
            >
              <span>{chat.title}</span>
              <X
                size={13}
                aria-hidden
                style={{ flex: 'none', opacity: 0.7 }}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseChat?.(chat.id)
                }}
              />
            </button>
          ))
        )}
        <button
          type="button"
          className="topbar-icon-btn"
          style={{ width: 34, flex: 'none', borderRadius: 6 } as React.CSSProperties}
          onClick={onNewChat}
          title="New Chat Tab"
          aria-label="New Chat Tab"
        >
          <Plus size={16} aria-hidden />
        </button>
      </div>

      <div className="header-status">
        <div className="status-popover-wrap" ref={modelRef}>
          <button type="button" className="status-chip" onClick={() => setModelOpen((v) => !v)} aria-expanded={modelOpen} aria-haspopup="dialog">
            <span className="status-dot" aria-hidden />
            {activeModelName ?? 'No Model'}
            <span className="ready">{activeModelContext ?? (activeModelName ? 'Ready' : 'Offline')}</span>
            <ChevronDown size={13} aria-hidden />
          </button>
          {modelOpen ? (
            <div className="popover" role="dialog" aria-label="Local model">
              <div className="popover-title">Local model</div>
              <div className="info-row"><span>Model</span><strong>{activeModelName ?? 'No Model Selected'}</strong></div>
              <div className="info-row"><span>Format</span><strong>GGUF · Q4_K_M</strong></div>
              <div className="info-row"><span>Context</span><strong>32k tokens</strong></div>
              <div className="popover-actions">
                <button type="button" onClick={() => { setModelOpen(false); document.querySelector<HTMLElement>('[data-testid="model-pill"], .model-pill')?.focus(); (document.querySelector<HTMLElement>('.model-pill') as HTMLButtonElement | null)?.click() }}>Change Model</button>
                <button type="button" onClick={() => setModelOpen(false)}>Close</button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="status-popover-wrap" ref={gpuRef}>
          <button type="button" className="gpu-chip" onClick={() => setGpuOpen((v) => !v)} aria-expanded={gpuOpen} aria-haspopup="dialog">
            <Cpu size={14} aria-hidden />
            {hardwareStatus ?? 'Detecting...'}
          </button>
          {gpuOpen ? (
            <div className="popover" role="dialog" aria-label="GPU runtime">
              <div className="popover-title">GPU runtime</div>
              <div className="info-row"><span>GPU</span><strong>{hardwareStatus ?? 'Detecting...'}</strong></div>
              <div className="info-row"><span>Status</span><strong className="good">{activeModelContext ?? 'Idle'}</strong></div>
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
          >
            <FileCode2 size={16} aria-hidden />
            <span>Artifacts</span>
          </button>
        ) : null}
        {onToggleSplit ? (
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={onToggleSplit}
            aria-label="Toggle session context"
            aria-pressed={splitOpen}
          >
            <PanelRight size={16} aria-hidden />
          </button>
        ) : null}
      </div>

      {HAS_NATIVE_WINDOW ? (
        <div className="topbar-window-controls">
          <button type="button" className="topbar-win-btn" aria-label="Minimize" onClick={minimizeWindow}><Minus size={14} aria-hidden /></button>
          <button type="button" className="topbar-win-btn" aria-label="Maximize" onClick={maximizeWindow}><Square size={12} aria-hidden /></button>
          <button type="button" className="topbar-win-btn close" aria-label="Close" onClick={closeWindow}><X size={14} aria-hidden /></button>
        </div>
      ) : null}
    </header>
  )
}
