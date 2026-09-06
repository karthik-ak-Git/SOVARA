import {
  MessageSquare,
  Clock,
  Database,
  Bot,
  Sparkles,
  Library,
  Cpu,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export type NavId = 'chat' | 'sessions' | 'models' | 'agents' | 'skills' | 'library' | 'runtime' | 'settings'

interface NavItem {
  id: NavId
  label: string
  icon: LucideIcon
  disabled?: boolean
}

const NAV: NavItem[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'sessions', label: 'Sessions', icon: Clock },
  { id: 'models', label: 'Models', icon: Database },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Sparkles, disabled: true },
  { id: 'library', label: 'Library', icon: Library, disabled: true },
  { id: 'runtime', label: 'Runtime', icon: Cpu, disabled: true },
  { id: 'settings', label: 'Settings', icon: Settings },
]

const GROUPS: Array<{ label: string; ids: NavId[] }> = [
  { label: 'Workspace', ids: ['chat', 'sessions', 'models', 'agents'] },
  { label: 'Platform', ids: ['skills', 'library', 'runtime'] },
  { label: 'System', ids: ['settings'] },
]

interface Props {
  activeId: NavId
  onNavigate: (id: NavId) => void
  footer?: React.ReactNode
}

export function Sidebar({ activeId, onNavigate, footer }: Props): React.JSX.Element {
  return (
    <nav className="sidebar" aria-label="Primary navigation">
      {GROUPS.map((g) => (
        <div key={g.label} className="nav-section">
          <div className="nav-label">{g.label}</div>
          {g.ids.map((id) => {
            const item = NAV.find((n) => n.id === id)!
            const Icon = item.icon
            const isActive = activeId === id
            const isDisabled = Boolean(item.disabled)
            return (
              <button
                key={id}
                type="button"
                className={`nav-item ${isActive ? 'active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                aria-disabled={isDisabled ? 'true' : undefined}
                aria-label={isDisabled ? `${item.label} (coming soon)` : item.label}
                title={isDisabled ? `${item.label} — coming soon` : item.label}
                disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled) onNavigate(id)
                }}
              >
                <Icon size={16} aria-hidden className="nav-icon" />
                <span className="nav-text">{item.label}</span>
                {isDisabled ? <span className="nav-soon">soon</span> : null}
              </button>
            )
          })}
        </div>
      ))}

      {footer ? <div className="sidebar-foot">{footer}</div> : null}
    </nav>
  )
}

export const NAV_ITEMS = NAV
