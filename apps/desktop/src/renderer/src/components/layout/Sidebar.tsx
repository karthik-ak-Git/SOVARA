import { useEffect, useRef, useState } from 'react'
import {
  MessageSquare,
  Database,
  Bot,
  Sparkles,
  Library,
  Cpu,
  Settings,
  FolderOpen,
  Plus,
  Pencil,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  type LucideIcon,
} from 'lucide-react'

export type NavId = 'chat' | 'models' | 'agents' | 'skills' | 'library' | 'runtime' | 'settings'

interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  disabled?: boolean
}

const NAV: NavItem[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'models', label: 'Models', icon: Database },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Sparkles, disabled: true },
  { id: 'library', label: 'Library', icon: Library, disabled: true },
  { id: 'runtime', label: 'Runtime', icon: Cpu, disabled: true },
  { id: 'settings', label: 'Settings', icon: Settings },
]

interface ProjectItem {
  id: string
  name: string
  sessions: Array<{ id: string; title: string }>
}

interface ChatItem {
  id: string
  title: string
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
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const dotsRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        dotsRef.current && !dotsRef.current.contains(e.target as Node)
      ) setMenuOpen(false)
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
      // position:fixed — escapes the sidebar's overflow-x:hidden clipping
      const r = dotsRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, left: Math.max(8, r.right - 150) })
    }
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
            <button
              type="button"
              role="menuitem"
              className="nav-chat-menu-item danger"
              onClick={() => {
                setMenuOpen(false)
                if (window.confirm(`Delete "${chat.title}" permanently? Chat files are removed and cannot be recovered.`)) {
                  onDelete?.(chat.id)
                }
              }}
            >
              <Trash2 size={12} aria-hidden /> Delete
            </button>
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
  return (
    <nav className="sidebar" aria-label="Primary navigation">
      {/* Projects section — each project is an isolated scope: own folder access + own memory */}
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
        {projects.length === 0 ? (
          <div className="nav-empty-hint">
            <FolderOpen size={14} aria-hidden />
            <span className="nav-empty-text">No projects yet</span>
          </div>
        ) : (
          projects.map((project) => (
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

      {/* Chats section — normal (global) chats, separate from project chats */}
      <div className="nav-section">
        <div className="nav-label">
          <span>Chats</span>
          <button type="button" className="nav-label-action" aria-label="Chats menu">
            <ChevronDown size={12} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="nav-item"
          onClick={onNewChat}
        >
          <Pencil size={14} aria-hidden className="nav-icon" />
          <span className="nav-text">New Chat</span>
        </button>
        {recentChats.map((chat) => (
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

      {/* Settings at bottom */}
      <div className="sidebar-foot">
        <button
          type="button"
          className={`nav-item ${activeId === 'settings' ? 'active' : ''}`}
          aria-current={activeId === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={16} aria-hidden className="nav-icon" />
          <span className="nav-text">Settings</span>
        </button>
      </div>
    </nav>
  )
}

export const NAV_ITEMS = NAV
