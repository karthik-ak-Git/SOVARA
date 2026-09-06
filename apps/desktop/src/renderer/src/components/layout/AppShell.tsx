import type { ReactNode } from 'react'
import { TopBar } from './TopBar'
import { Sidebar, type NavId } from './Sidebar'

interface Props {
  activeNav: NavId
  onNavigate: (id: NavId) => void
  children: ReactNode
  footer?: ReactNode
  projects?: Array<{ id: string; name: string; sessions: Array<{ id: string; title: string }> }>
  selectedProjectId?: string | null
  selectedSessionId?: string | null
  onSelectProject?: (id: string) => void
  onSelectSession?: (id: string) => void
  onNewProject?: () => void
  onNewChat?: () => void
  recentChats?: Array<{ id: string; title: string }>
  selectedChatId?: string | null
  onSelectChat?: (id: string) => void
}

export function AppShell({
  activeNav,
  onNavigate,
  children,
  footer,
  projects = [],
  selectedProjectId = null,
  selectedSessionId = null,
  onSelectProject = () => {},
  onSelectSession = () => {},
  onNewProject = () => {},
  onNewChat = () => {},
  recentChats = [],
  selectedChatId = null,
  onSelectChat = () => {},
}: Props): React.JSX.Element {
  return (
    <div className="app">
      <TopBar />
      <div className="layout">
        <Sidebar
          activeId={activeNav}
          onNavigate={onNavigate}
          footer={footer}
          projects={projects}
          selectedProjectId={selectedProjectId}
          selectedSessionId={selectedSessionId}
          onSelectProject={onSelectProject}
          onSelectSession={onSelectSession}
          onNewProject={onNewProject}
          onNewChat={onNewChat}
          recentChats={recentChats}
          selectedChatId={selectedChatId}
          onSelectChat={onSelectChat}
        />
        <main className="main" role="main" tabIndex={-1} id="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}
