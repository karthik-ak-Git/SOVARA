import { useState, type ReactNode } from 'react'
import { TopBar } from './TopBar'
import { Sidebar, type NavId } from './Sidebar'

interface Props {
  activeNav: NavId
  onNavigate: (id: NavId) => void
  children: ReactNode
  footer?: ReactNode
  activeTab?: string
  onTabSelect?: (tabId: string) => void
  onNewSession?: () => void
  projects?: Array<{ id: string; name: string; sessions: Array<{ id: string; title: string }> }>
  selectedProjectId?: string | null
  selectedSessionId?: string | null
  onSelectProject?: (id: string) => void
  onSelectSession?: (id: string) => void
  onNewProject?: () => void
  onNewChat?: () => void
  onNewProjectChat?: (projectId: string) => void
  onRenameChat?: (id: string, title: string) => void
  onDeleteChat?: (id: string) => void
  recentChats?: Array<{ id: string; title: string }>
  selectedChatId?: string | null
  onSelectChat?: (id: string) => void
  onCloseChat?: (id: string) => void
  /** Open header tabs — defaults to recentChats. Closed tabs hide without deleting. */
  tabs?: Array<{ id: string; title: string }>
  /** Hide the app sidebar (e.g. full-page settings). */
  hideSidebar?: boolean
}

export function AppShell({
  activeNav,
  onNavigate,
  children,
  footer,
  activeTab,
  onTabSelect,
  onNewSession,
  projects = [],
  selectedProjectId = null,
  selectedSessionId = null,
  onSelectProject = () => {},
  onSelectSession = () => {},
  onNewProject = () => {},
  onNewChat = () => {},
  onNewProjectChat = () => {},
  onRenameChat = () => {},
  onDeleteChat = () => {},
  recentChats = [],
  selectedChatId = null,
  onSelectChat = () => {},
  onCloseChat = () => {},
  tabs,
  hideSidebar = false,
}: Props): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  return (
    <div className="app">
      <TopBar
        activeTab={activeTab}
        onTabSelect={onTabSelect}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        chats={tabs ?? recentChats}
        selectedChatId={selectedChatId}
        onSelectChat={onSelectChat}
        onCloseChat={onCloseChat}
      />
      <div className="layout">
        {sidebarOpen && !hideSidebar ? (
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
          onNewProjectChat={onNewProjectChat}
          onRenameChat={onRenameChat}
          onDeleteChat={onDeleteChat}
          recentChats={recentChats}
          selectedChatId={selectedChatId}
          onSelectChat={onSelectChat}
        />
        ) : null}
        <main className="main" role="main" aria-labelledby={`tab-${activeTab}`} tabIndex={-1} id="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}
