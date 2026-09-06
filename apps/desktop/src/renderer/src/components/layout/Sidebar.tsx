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
  recentChats?: ChatItem[]
  selectedChatId?: string | null
  onSelectChat?: (id: string) => void
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
  recentChats = [],
  selectedChatId,
  onSelectChat,
}: Props): React.JSX.Element {
  return (
    <nav className="sidebar" aria-label="Primary navigation">
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
        {projects.length === 0 ? (
          <div className="nav-empty-hint">
            <FolderOpen size={14} aria-hidden />
            <span className="nav-empty-text">No projects yet</span>
          </div>
        ) : (
          projects.map((project) => (
            <div key={project.id}>
              <button
                type="button"
                className={`nav-project-item ${selectedProjectId === project.id ? 'active' : ''}`}
                onClick={() => onSelectProject?.(project.id)}
              >
                <FolderOpen size={14} aria-hidden className="nav-icon" />
                <span className="nav-text">{project.name}</span>
              </button>
              {project.sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={`nav-session-item ${selectedSessionId === session.id ? 'active' : ''}`}
                  onClick={() => onSelectSession?.(session.id)}
                >
                  <span className="nav-text">{session.title}</span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Chats section */}
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
          <button
            key={chat.id}
            type="button"
            className={`nav-chat-item ${selectedChatId === chat.id ? 'active' : ''}`}
            onClick={() => onSelectChat?.(chat.id)}
          >
            <MessageSquare size={14} aria-hidden className="nav-icon" />
            <span className="nav-chat-item-text">{chat.title}</span>
          </button>
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
