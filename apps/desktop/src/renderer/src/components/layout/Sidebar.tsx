import { useEffect, useRef, useState, useMemo } from 'react'
import {
  MessageSquare,
  Cpu,
  Settings,
  FolderOpen,
  Plus,
  Pencil,
  Search,
  MoreHorizontal,
  Trash2,
  Shield,
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

  return (
    <div className={`nav-chat-row ${active ? 'active' : ''}`}>
      {editing ? (
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
        />
      ) : (
        <button type="button" className="nav-chat-item" onClick={onSelect} aria-label={`Open ${chat.title}`}>
          <MessageSquare size={14} aria-hidden className="nav-icon" />
          <span className="nav-chat-item-text">{chat.title}</span>
        </button>
      )}
      <div className="nav-chat-menu-wrap">
        <button
          ref={dotsRef}
          type="button"
          className="nav-chat-dots"
          aria-label={`Chat options for ${chat.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
        {menuOpen ? (
          <div
            className="nav-chat-menu nav-chat-menu-fixed"
            role="menu"
            ref={menuRef}
            style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}
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
            >
              <Pencil size={12} aria-hidden /> Rename
            </button>
            {confirmingDelete ? (
              <div className="nav-chat-confirm" role="group" aria-label={`Delete ${chat.title} permanently?`}>
                <span className="nav-chat-confirm-text">Delete permanently? Files cannot be recovered.</span>
                <div className="nav-chat-confirm-actions">
                  <button
                    type="button"
                    className="nav-chat-confirm-cancel"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className="nav-chat-confirm-delete"
                    onClick={() => {
                      setMenuOpen(false)
                      setConfirmingDelete(false)
                      onDelete?.(chat.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="nav-chat-menu-item danger"
                onClick={() => setConfirmingDelete(true)}
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
}: Props): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Quick keyboard shortcut "/" to focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase()
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sessions.some((s) => s.title.toLowerCase().includes(q))
    )
  }, [projects, searchQuery])

  const filteredRecentChats = useMemo(() => {
    if (!searchQuery.trim()) return recentChats
    const q = searchQuery.toLowerCase()
    return recentChats.filter((c) => c.title.toLowerCase().includes(q))
  }, [recentChats, searchQuery])

  return (
    <nav className="sidebar" aria-label="Primary navigation">
      {/* Workspace Brand Header */}
      <div className="sidebar-workspace-header">
        <div className="sidebar-workspace-info">
          <div className="sidebar-workspace-avatar">
            <Shield size={16} className="text-primary" />
          </div>
          <div className="sidebar-workspace-meta">
            <span className="sidebar-workspace-name">Sovora Workspace</span>
            <span className="sidebar-workspace-status">
              <span className="status-dot" aria-hidden>●</span> Sovereign Local AI
            </span>
          </div>
        </div>
      </div>

      {/* Quick Action: Start New Chat */}
      <div className="sidebar-action-wrap">
        <button
          type="button"
          className="sidebar-new-chat-btn"
          aria-label="New Chat"
          onClick={onNewChat}
        >
          <div className="sidebar-new-chat-label">
            <Plus size={16} aria-hidden />
            <span>New Chat</span>
          </div>
          <span className="sidebar-shortcut-badge">⌘K</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="sidebar-search-wrap">
        <Search size={14} className="sidebar-search-icon" aria-hidden />
        <input
          ref={searchInputRef}
          type="search"
          className="sidebar-search-input"
          placeholder="Search chats & docs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search chats and projects"
        />
        <span className="sidebar-search-key">/</span>
      </div>

      <div className="sidebar-divider" />

      {/* Projects section */}
      <div className="nav-section">
        <div className="nav-label">
          <span>Projects</span>
          <button
            type="button"
            className="nav-label-action"
            aria-label="New Project"
            onClick={onNewProject}
          >
            <Plus size={12} aria-hidden />
            New Project
          </button>
        </div>
        {filteredProjects.length === 0 ? (
          <div className="nav-empty-hint">
            <FolderOpen size={14} aria-hidden />
            <span className="nav-empty-text">{searchQuery ? 'No matching projects' : 'No projects yet'}</span>
          </div>
        ) : (
          filteredProjects.map((project) => (
            <div key={project.id} className="nav-project-block">
              <div className="nav-project-row">
                <button
                  type="button"
                  className={`nav-project-item ${selectedProjectId === project.id ? 'active' : ''}`}
                  onClick={() => onSelectProject?.(project.id)}
                  aria-label={`Open project ${project.name}`}
                >
                  <FolderOpen size={14} aria-hidden className="nav-icon" />
                  <span className="nav-text">{project.name}</span>
                </button>
                <button
                  type="button"
                  className="nav-project-add"
                  aria-label={`New chat in ${project.name}`}
                  title={`New chat in ${project.name}`}
                  onClick={() => onNewProjectChat?.(project.id)}
                >
                  <Plus size={14} aria-hidden />
                </button>
              </div>
              {project.sessions.map((session) => (
                <div key={session.id} className="nav-session-indent">
                  <ChatRow
                    chat={session}
                    active={selectedSessionId === session.id || selectedChatId === session.id}
                    onSelect={() => onSelectSession?.(session.id)}
                    onRename={onRenameChat}
                    onDelete={onDeleteChat}
                  />
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Chats section */}
      <div className="nav-section">
        <div className="nav-label">
          <span>Chats</span>
        </div>
        {filteredRecentChats.length === 0 ? (
          <div className="nav-empty-hint">
            <MessageSquare size={14} aria-hidden />
            <span className="nav-empty-text">{searchQuery ? 'No matching chats' : 'No recent chats'}</span>
          </div>
        ) : (
          filteredRecentChats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={selectedChatId === chat.id}
              onSelect={() => onSelectChat?.(chat.id)}
              onRename={onRenameChat}
              onDelete={onDeleteChat}
            />
          ))
        )}
      </div>

      {/* Footer: User profile & Settings */}
      <div className="sidebar-foot">
        <div className="sidebar-operator-info">
          <div className="sidebar-operator-avatar">
            <Cpu size={14} />
          </div>
          <div className="sidebar-operator-meta">
            <span className="sidebar-operator-name">Local Operator</span>
            <span className="sidebar-operator-tag">Sovora Desktop</span>
          </div>
        </div>
        <button
          type="button"
          className={`nav-item sidebar-settings-btn ${activeId === 'settings' ? 'active' : ''}`}
          aria-current={activeId === 'settings' ? 'page' : undefined}
          aria-label="Settings"
          title="Settings"
          onClick={() => onNavigate('settings')}
        >
          <Settings size={16} aria-hidden className="nav-icon" />
          <span className="nav-text">Settings</span>
        </button>
        {footer}
      </div>
    </nav>
  )
}


