'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import {
  Folder,
  Hash,
  Plus,
  Search,
  Settings,
  ChevronRight,
  ShieldCheck,
  Pencil,
  Trash2,
  MoreHorizontal,
  MessageSquare,
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
            if (e.key === 'Escape') { setDraft(chat.title); setEditing(false) }
          }}
          onBlur={commitRename}
        />
      </div>
    )
  }

  return (
    <div className={`nav-chat-row ${active ? 'active' : ''}`}>
      <button type="button" className={`nav-item ${active ? 'active-chat' : ''}`} onClick={onSelect} aria-label={`Open ${chat.title}`} style={{ flex: 1 }}>
        <Hash size={14} aria-hidden />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.title}</span>
      </button>
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
          <div className="nav-chat-menu nav-chat-menu-fixed" role="menu" ref={menuRef} style={{ top: `${menuPos.top}px`, left: `${menuPos.left}px` }}>
            <button type="button" role="menuitem" className="nav-chat-menu-item" onClick={() => { setDraft(chat.title); setEditing(true); setMenuOpen(false) }}>
              <Pencil size={12} aria-hidden /> Rename
            </button>
            {confirmingDelete ? (
              <div className="nav-chat-confirm" role="group">
                <span className="nav-chat-confirm-text">Delete permanently? Files cannot be recovered.</span>
                <div className="nav-chat-confirm-actions">
                  <button type="button" className="nav-chat-confirm-cancel" onClick={() => setConfirmingDelete(false)}>Keep</button>
                  <button type="button" className="nav-chat-confirm-delete" onClick={() => { setMenuOpen(false); setConfirmingDelete(false); onDelete?.(chat.id) }}>Delete</button>
                </div>
              </div>
            ) : (
              <button type="button" role="menuitem" className="nav-chat-menu-item danger" onClick={() => setConfirmingDelete(true)}>
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
  const [searchOpen, setSearchOpen] = useState(false)
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

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const q = searchQuery.toLowerCase()
    return projects.filter((p) => p.name.toLowerCase().includes(q) || p.sessions.some((s) => s.title.toLowerCase().includes(q)))
  }, [projects, searchQuery])

  const filteredRecentChats = useMemo(() => {
    if (!searchQuery.trim()) return recentChats
    const q = searchQuery.toLowerCase()
    return recentChats.filter((c) => c.title.toLowerCase().includes(q))
  }, [recentChats, searchQuery])

  return (
    <nav className="sidebar" aria-label="Primary navigation" style={{ width: 232, padding: '18px 10px 12px', background: 'var(--bg-soft, #fbfaf7)', borderRight: '1px solid var(--border)' } as React.CSSProperties}>
      <div className="sidebar-scroll" style={{ flex: 1, overflow: 'auto' }}>
        <div className="side-section" style={{ marginBottom: 25 }}>
          <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 9px 8px', color: 'var(--muted-2)', fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' } as React.CSSProperties}>
            <span>Projects</span>
            <button type="button" className="tiny-button" aria-label="New Project" onClick={onNewProject} style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 6, background: 'transparent', color: 'var(--muted)', border: 'none', cursor: 'pointer' }}>
              <Plus size={14} aria-hidden />
            </button>
          </div>
          {filteredProjects.length === 0 ? (
            <div style={{ padding: '6px 10px', color: 'var(--muted-2)', fontSize: 12 }}>No projects yet</div>
          ) : (
            filteredProjects.map((project) => (
              <div key={project.id} style={{ marginBottom: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    className={`nav-item ${selectedProjectId === project.id ? 'selected' : ''}`}
                    onClick={() => onSelectProject?.(project.id)}
                    aria-label={`Open project ${project.name}`}
                    style={{ flex: 1 }}
                  >
                    <Folder size={15} aria-hidden />
                    <span>{project.name}</span>
                    {selectedProjectId === project.id ? <ChevronRight size={13} style={{ marginLeft: 'auto' } as React.CSSProperties} aria-hidden /> : null}
                  </button>
                  <button
                    type="button"
                    className="tiny-button"
                    aria-label={`New chat in ${project.name}`}
                    title={`New chat in ${project.name}`}
                    onClick={() => onNewProjectChat?.(project.id)}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                </div>
                {project.sessions.map((session) => (
                  <div key={session.id} style={{ paddingLeft: 16 }}>
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

        <div className="side-section chat-section" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 18 }}>
          <div className="section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 9px 8px', color: 'var(--muted-2)', fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' } as React.CSSProperties}>
            <span>Chats</span>
            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <button
                type="button"
                className="tiny-button"
                aria-label="New Chat"
                title="New Chat"
                onClick={() => onNewChat?.()}
              >
                <Plus size={14} aria-hidden />
              </button>
              <button
                type="button"
                className="tiny-button"
                aria-label="Search chats"
                onClick={() => setSearchOpen((v) => !v)}
              >
                <Search size={14} aria-hidden />
              </button>
            </div>
          </div>
          {searchOpen ? (
            <div style={{ padding: '0 9px 8px' }}>
              <input
                ref={searchInputRef}
                type="search"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search chats and projects"
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12 }}
              />
            </div>
          ) : null}
          {filteredRecentChats.length === 0 ? (
            <div style={{ padding: '6px 10px', color: 'var(--muted-2)', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <MessageSquare size={14} aria-hidden /> No recent chats
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
      </div>

      <div className="sidebar-bottom" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <button
          type="button"
          className={`nav-item ${activeId === 'settings' ? 'selected' : ''}`}
          aria-current={activeId === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={16} aria-hidden />
          <span>Settings</span>
        </button>
        <div className="local-badge" style={{ display: 'flex', gap: 8, margin: '12px 8px 0', padding: 10, border: '1px solid #e0e9df', borderRadius: 6, background: '#f5faf4', color: '#5d8d68' }}>
          <ShieldCheck size={15} aria-hidden style={{ flex: 'none', marginTop: 1 } as React.CSSProperties} />
          <div>
            <strong style={{ display: 'block', fontSize: 10, lineHeight: 1.2 }}>Local processing</strong>
            <span style={{ display: 'block', fontSize: 10, color: '#8b9f8b', marginTop: 2 }}>Private by default</span>
          </div>
        </div>
        {footer ? <div style={{ marginTop: 10 }}>{footer}</div> : null}
      </div>
    </nav>
  )
}
