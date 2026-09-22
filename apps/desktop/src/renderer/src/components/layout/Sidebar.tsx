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
  MoreVertical,
  Copy,
  Clock,
  Timer,
  Zap,
  Pin,
  Archive,
} from 'lucide-react'

export type NavId =
  | 'chat'
  | 'history'
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
  onArchiveChat?: (id: string) => void
  onPinChat?: (id: string) => void
  pinnedChatIds?: string[]
  recentChats?: ChatItem[]
  selectedChatId?: string | null
  onSelectChat?: (id: string) => void
  onToggleSidebar?: () => void
}

function ChatRow({
  chat,
  active,
  isPinned = false,
  onSelect,
  onPin,
  onArchive,
}: {
  chat: ChatItem
  active: boolean
  isPinned?: boolean
  onSelect: () => void
  onPin?: () => void
  onArchive?: () => void
}): React.JSX.Element {
  return (
    <div
      className={`nav-chat-row ${active ? 'active' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        borderRadius: 6,
        margin: '1px 0',
        background: active ? '#f1f5f9' : 'transparent',
      }}
    >
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
      <div className="nav-chat-menu-wrap" style={{ display: 'flex', alignItems: 'center', gap: 2, paddingRight: 4 }}>
        <button
          type="button"
          className="nav-chat-action-btn"
          aria-label={isPinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`}
          title={isPinned ? 'Unpin conversation' : 'Pin conversation'}
          onClick={(e) => {
            e.stopPropagation()
            onPin?.()
          }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '3px 4px',
            cursor: 'pointer',
            color: isPinned ? '#0284c7' : '#94a3b8',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Pin size={13} aria-hidden />
        </button>
        <button
          type="button"
          className="nav-chat-action-btn"
          aria-label={`Archive ${chat.title}`}
          title="Archive Conversation"
          onClick={(e) => {
            e.stopPropagation()
            onArchive?.()
          }}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '3px 4px',
            cursor: 'pointer',
            color: '#94a3b8',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Archive size={13} aria-hidden />
        </button>
      </div>
    </div>
  )
}

function ProjectItemRow({
  project,
  isSelected,
  isCollapsed,
  onSelect,
  onToggleCollapse,
  onNewChat,
  onOpenSettings,
}: {
  project: ProjectItem
  isSelected: boolean
  isCollapsed: boolean
  onSelect: () => void
  onToggleCollapse: () => void
  onNewChat?: (projectId: string) => void
  onOpenSettings?: () => void
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 8px',
          borderRadius: 6,
          background: isSelected ? '#f1f5f9' : 'transparent',
          cursor: 'pointer',
        }}
        onClick={() => {
          onSelect()
          onToggleCollapse()
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <Folder size={15} style={{ color: '#64748b', flexShrink: 0 }} aria-hidden />
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              color: '#0f172a',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {project.name}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
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
                marginRight: 4,
              }}
            >
              {project.durationBadge}
            </span>
          ) : null}

          <button
            type="button"
            aria-label={`Project options for ${project.name}`}
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 6,
              border: 'none',
              background: menuOpen ? '#e2e8f0' : 'transparent',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            <MoreVertical size={14} />
          </button>

          <button
            type="button"
            aria-label={`New chat in ${project.name}`}
            onClick={() => onNewChat?.(project.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            <Plus size={14} />
          </button>

          {isCollapsed ? (
            <ChevronRight size={14} style={{ color: '#94a3b8', marginLeft: 2 }} aria-hidden />
          ) : (
            <ChevronDown size={14} style={{ color: '#94a3b8', marginLeft: 2 }} aria-hidden />
          )}
        </div>
      </div>

      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            left: 24,
            marginTop: 2,
            width: 175,
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
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              void navigator.clipboard.writeText(project.name)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: 'transparent',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              color: '#334155',
            }}
          >
            <Copy size={13} />
            <span>Copy Project Name</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              onOpenSettings?.()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: 'transparent',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              color: '#334155',
            }}
          >
            <Settings size={13} />
            <span>Project Settings</span>
          </button>
        </div>
      ) : null}
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
  onArchiveChat,
  onPinChat,
  pinnedChatIds = [],
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
        id: '__global__',
        name: 'SOVARA Workspace',
        sessions: [],
      },
    ]
  }, [projects])

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
          className={`nav-item ${activeId === 'history' ? 'selected' : ''}`}
          onClick={() => onNavigate('history')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '7px 8px',
            borderRadius: 6,
            border: 'none',
            background: activeId === 'history' ? '#f1f5f9' : 'transparent',
            color: activeId === 'history' ? '#0f172a' : '#475569',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <Clock size={16} aria-hidden style={{ color: '#64748b' }} />
          <span>Conversation History</span>
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
                <ProjectItemRow
                  project={project}
                  isSelected={isSelectedProject}
                  isCollapsed={isCollapsed}
                  onSelect={() => onSelectProject?.(project.id)}
                  onToggleCollapse={() => toggleProjectCollapse(project.id)}
                  onNewChat={onNewProjectChat}
                  onOpenSettings={() => onNavigate('settings')}
                />

                {!isCollapsed && project.sessions.length > 0 ? (
                  <div style={{ paddingLeft: 16, marginTop: 2 }}>
                    {project.sessions.map((session) => (
                      <ChatRow
                        key={session.id}
                        chat={session}
                        active={selectedSessionId === session.id || selectedChatId === session.id}
                        isPinned={pinnedChatIds?.includes(session.id)}
                        onSelect={() => onSelectSession?.(session.id)}
                        onPin={() => onPinChat?.(session.id)}
                        onArchive={() => onArchiveChat?.(session.id)}
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
                isPinned={pinnedChatIds?.includes(chat.id)}
                onSelect={() => onSelectChat?.(chat.id)}
                onPin={() => onPinChat?.(chat.id)}
                onArchive={() => onArchiveChat?.(chat.id)}
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
