'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  Folder,
  Hash,
  Plus,
  Search,
  Settings,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Pencil,
  Trash2,
  MoreHorizontal,
  Clock,
  Timer,
  Zap,
} from 'lucide-react'

export type NavId =
  | 'chat'
  | 'models'
  | 'explore'
  | 'library'
  | 'runtime'
  | 'agents'
  | 'skills'
  | 'connections'
  | 'settings'

interface ProjectItem {
  id: string
  name: string
  durationBadge?: string
  sessions: Array<{ id: string; title: string }>
}

interface ChatItem {
  id: string
  title: string
  updatedAt?: number
}

interface Props {
  activeId: NavId
  onNavigate: (id: NavId) => void
  footer?: React.ReactNode
  projects?: ProjectItem[]
  selectedProjectId?: string | null
  selectedSessionId?: string | null
  onSelectProject?: (id: string) => void
  onSelectSession?: (id: string) => void
  onNewProject?: () => void
  onNewChat?: () => void
  onNewProjectChat?: (projectId: string) => void
  onRenameChat?: (id: string, title: string) => void
  onDeleteChat?: (id: string) => void
  recentChats?: ChatItem[]
  selectedChatId?: string | null
  onSelectChat?: (id: string) => void
  onToggleSidebar?: () => void
}

function ChatRow({
  chat,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  chat: ChatItem
  active: boolean
  onSelect: () => void
  onRename?: (id: string, title: string) => void
  onDelete?: (id: string) => void
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chat.title)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const dotsRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        dotsRef.current &&
        !dotsRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false)
      }
    }
    const onScroll = (): void => setMenuOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menuOpen])

  const toggleMenu = (): void => {
    if (!menuOpen && dotsRef.current) {
      const r = dotsRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, left: Math.max(8, r.right - 160) })
    }
    setConfirmingDelete(false)
    setMenuOpen((v) => !v)
  }

  const commitRename = (): void => {
    const clean = draft.trim()
    setEditing(false)
    setMenuOpen(false)
    if (clean && clean !== chat.title) onRename?.(chat.id, clean)
    else setDraft(chat.title)
  }

  if (editing) {
    return (
      <div className={`nav-chat-row ${active ? 'active' : ''}`} style={{ padding: '2px 0' }}>
        <input
          className="nav-chat-rename"
          value={draft}
          autoFocus
          maxLength={120}
          aria-label="Rename chat"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') {
              setDraft(chat.title)
              setEditing(false)
            }
          }}
          onBlur={commitRename}
          style={{ width: '100%', padding: '4px 8px', borderRadius: 6, border: '1px solid #0284c7', fontSize: 12 }}
        />
      </div>
    )
  }

  return (
    <div className={`nav-chat-row ${active ? 'active' : ''}`} style={{ display: 'flex', alignItems: 'center', borderRadius: 6, margin: '1px 0', background: active ? '#f1f5f9' : 'transparent' }}>
      <button
        type="button"
        className={`nav-item ${active ? 'active-chat' : ''}`}
        onClick={onSelect}
        aria-label={`Open ${chat.title}`}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          border: 'none',
          background: 'transparent',
          color: active ? '#0f172a' : '#334155',
          fontWeight: active ? 600 : 400,
          fontSize: 12,
          cursor: 'pointer',
          textAlign: 'left',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.title}</span>
      </button>
      <div className="nav-chat-menu-wrap" style={{ display: 'flex', alignItems: 'center' }}>
        <button
          ref={dotsRef}
          type="button"
          className="nav-chat-dots"
          aria-label={`Chat options for ${chat.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
          style={{ background: 'transparent', border: 'none', padding: '2px 4px', cursor: 'pointer', color: '#94a3b8' }}
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
        {menuOpen ? (
          <div
            className="nav-chat-menu nav-chat-menu-fixed"
            role="menu"
            ref={menuRef}
            style={{
              position: 'fixed',
              top: `${menuPos.top}px`,
              left: `${menuPos.left}px`,
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              zIndex: 999,
              padding: '4px 0',
              width: 140,
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="nav-chat-menu-item"
              onClick={() => {
                setDraft(chat.title)
                setEditing(true)
                setMenuOpen(false)
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', color: '#334155' }}
            >
              <Pencil size={12} aria-hidden /> Rename
            </button>
            {confirmingDelete ? (
              <div className="nav-chat-confirm" role="group" style={{ padding: 8 }}>
                <span className="nav-chat-confirm-text" style={{ fontSize: 11, color: '#ef4444', display: 'block', marginBottom: 6 }}>Delete session?</span>
                <div className="nav-chat-confirm-actions" style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="nav-chat-confirm-cancel" onClick={() => setConfirmingDelete(false)} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 4, border: '1px solid #e2e8f0' }}>Keep</button>
                  <button type="button" className="nav-chat-confirm-delete" onClick={() => { setMenuOpen(false); setConfirmingDelete(false); onDelete?.(chat.id) }} style={{ padding: '2px 6px', fontSize: 11, borderRadius: 4, background: '#ef4444', color: '#fff', border: 'none' }}>Delete</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="nav-chat-menu-item danger"
                onClick={() => setConfirmingDelete(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '6px 12px', border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', color: '#ef4444' }}
              >
                <Trash2 size={12} aria-hidden /> Delete
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function Sidebar({
  activeId,
  onNavigate,
  footer,
  projects = [],
  selectedProjectId,
  selectedSessionId,
  onSelectProject,
  onSelectSession,
  onNewProject,
  onNewChat,
  onNewProjectChat,
  onRenameChat,
  onDeleteChat,
  recentChats = [],
  selectedChatId,
  onSelectChat,
  onToggleSidebar,
}: Props): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({})
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const defaultProjects: ProjectItem[] = useMemo(() => {
    if (projects.length > 0) return projects
    return [
      {
        id: 'sovara-main',
        name: 'SOVARA',
        durationBadge: '13m',
        sessions: selectedSessionId || selectedChatId
          ? [{ id: selectedSessionId || selectedChatId || 's1', title: 'Fixing App Generator UI Skills' }]
          : [{ id: 's1', title: 'Fixing App Generator UI Skills' }],
      },
      {
        id: 'sovara-landingpage',
        name: 'sovara-landingpage',
        sessions: [],
      },
    ]
  }, [projects, selectedSessionId, selectedChatId])

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return defaultProjects
    const q = searchQuery.toLowerCase()
    return defaultProjects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sessions.some((s) => s.title.toLowerCase().includes(q))
    )
  }, [defaultProjects, searchQuery])

  const filteredRecentChats = useMemo(() => {
    if (!searchQuery.trim()) return recentChats
    const q = searchQuery.toLowerCase()
    return recentChats.filter((c) => c.title.toLowerCase().includes(q))
  }, [recentChats, searchQuery])

  const toggleProjectCollapse = (id: string): void => {
    setCollapsedProjects((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <nav
      className="sidebar"
      aria-label="Primary navigation"
      style={{
        width: 240,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 10px',
        background: '#ffffff',
        borderRight: '1px solid #e2e8f0',
        userSelect: 'none',
      }}
    >
      {/* Top Header: Logo Mark + Nav Arrows */}
      <div
        className="sidebar-brand-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 6px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: '#0f172a',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            S
          </div>
          <span style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', letterSpacing: '-0.02em' }}>
            SOVARA
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button
            type="button"
            className="topbar-icon-btn"
            aria-label="Back"
            title="Back"
            onClick={onToggleSidebar}
            style={{ background: 'transparent', border: 'none', padding: 4, cursor: 'pointer', color: '#64748b', borderRadius: 4 }}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="topbar-icon-btn"
            aria-label="Forward"
            title="Forward"
            style={{ background: 'transparent', border: 'none', padding: 4, cursor: 'pointer', color: '#94a3b8', borderRadius: 4 }}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      </div>

      {/* Primary CTA: + New Conversation */}
      <div style={{ padding: '0 2px 12px' }}>
        <button
          type="button"
          className="sv-new-chat-btn"
          onClick={() => onNewChat?.()}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            height: 36,
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            color: '#0f172a',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            transition: 'background 150ms ease, border-color 150ms ease',
          }}
        >
          <Plus size={16} aria-hidden />
          <span>New Conversation</span>
        </button>
      </div>

      {/* Quick Navigation Items */}
      <div className="sidebar-quick-nav" style={{ padding: '4px 0 12px', borderBottom: '1px solid #f1f5f9' }}>
        <button
          type="button"
          className={`nav-item ${activeId === 'chat' ? 'selected' : ''}`}
          onClick={() => onNavigate('chat')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '7px 8px',
            borderRadius: 6,
            border: 'none',
            background: activeId === 'chat' ? '#f1f5f9' : 'transparent',
            color: activeId === 'chat' ? '#0f172a' : '#475569',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Clock size={16} aria-hidden style={{ color: '#64748b' }} />
          <span>Conversation History</span>
        </button>
        <button
          type="button"
          className="nav-item"
          onClick={() => onNavigate('chat')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '7px 8px',
            borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: '#475569',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Timer size={16} aria-hidden style={{ color: '#64748b' }} />
          <span>Scheduled Tasks</span>
        </button>
      </div>

      {/* Projects Accordion Section */}
      <div className="sidebar-scroll" style={{ flex: 1, overflowY: 'auto', paddingTop: 12 }}>
        <div className="side-section" style={{ marginBottom: 16 }}>
          <div
            className="section-label"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 8px 6px',
              color: '#64748b',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <span>Projects</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className="tiny-button"
                aria-label="Search"
                onClick={() => setSearchOpen((v) => !v)}
                style={{ background: 'transparent', border: 'none', padding: 2, cursor: 'pointer', color: '#64748b' }}
              >
                <Search size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="tiny-button"
                aria-label="New Project"
                onClick={onNewProject}
                style={{ background: 'transparent', border: 'none', padding: 2, cursor: 'pointer', color: '#64748b' }}
              >
                <Plus size={14} aria-hidden />
              </button>
            </div>
          </div>

          {searchOpen ? (
            <div style={{ padding: '0 8px 8px' }}>
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search projects"
                style={{
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  color: '#0f172a',
                  fontSize: 12,
                }}
              />
            </div>
          ) : null}

          {filteredProjects.map((project) => {
            const isCollapsed = Boolean(collapsedProjects[project.id])
            const isSelectedProject = selectedProjectId === project.id
            return (
              <div key={project.id} style={{ marginBottom: 4 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: isSelectedProject ? '#f1f5f9' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    onSelectProject?.(project.id)
                    toggleProjectCollapse(project.id)
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    <Folder size={15} style={{ color: '#64748b', flexShrink: 0 }} aria-hidden />
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {project.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {project.durationBadge ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 999,
                          background: '#f1f5f9',
                          color: '#64748b',
                          border: '1px solid #e2e8f0',
                        }}
                      >
                        {project.durationBadge}
                      </span>
                    ) : null}
                    {isCollapsed ? (
                      <ChevronRight size={14} style={{ color: '#94a3b8' }} aria-hidden />
                    ) : (
                      <ChevronDown size={14} style={{ color: '#94a3b8' }} aria-hidden />
                    )}
                  </div>
                </div>

                {!isCollapsed && project.sessions.length > 0 ? (
                  <div style={{ paddingLeft: 16, marginTop: 2 }}>
                    {project.sessions.map((session) => (
                      <ChatRow
                        key={session.id}
                        chat={session}
                        active={selectedSessionId === session.id || selectedChatId === session.id}
                        onSelect={() => onSelectSession?.(session.id)}
                        onRename={onRenameChat}
                        onDelete={onDeleteChat}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {/* Non-project recent chats if any */}
        {filteredRecentChats.length > 0 ? (
          <div className="side-section chat-section" style={{ borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
            <div className="section-label" style={{ padding: '0 8px 6px', color: '#64748b', fontSize: 12, fontWeight: 600 }}>
              <span>Recent Chats</span>
            </div>
            {filteredRecentChats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={selectedChatId === chat.id}
                onSelect={() => onSelectChat?.(chat.id)}
                onRename={onRenameChat}
                onDelete={onDeleteChat}
              />
            ))}
          </div>
        ) : null}
      </div>

      {/* Bottom Footer: Settings Gear */}
      <div className="sidebar-bottom" style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, marginTop: 'auto' }}>
        <button
          type="button"
          className={`nav-item ${activeId === 'settings' ? 'selected' : ''}`}
          aria-current={activeId === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '8px 10px',
            borderRadius: 6,
            border: 'none',
            background: activeId === 'settings' ? '#f1f5f9' : 'transparent',
            color: activeId === 'settings' ? '#0f172a' : '#475569',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Settings size={16} aria-hidden style={{ color: '#64748b' }} />
          <span>Settings</span>
        </button>
        {footer ? <div style={{ marginTop: 8 }}>{footer}</div> : null}
      </div>
    </nav>
  )
}
