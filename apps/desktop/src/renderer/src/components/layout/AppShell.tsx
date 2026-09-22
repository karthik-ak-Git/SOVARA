import { useState, type ReactNode } from 'react'
import { TopBar } from './TopBar'
import { Sidebar, type NavId } from './Sidebar'
import { AuxiliaryPane } from './AuxiliaryPane'

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
  onArchiveChat?: (id: string) => void
  onPinChat?: (id: string) => void
  pinnedChatIds?: string[]
  recentChats?: Array<{ id: string; title: string }>
  selectedChatId?: string | null
  onSelectChat?: (id: string) => void
  onCloseChat?: (id: string) => void
  tabs?: Array<{ id: string; title: string }>
  hideSidebar?: boolean
  activeModelName?: string
  activeModelContext?: string
  onToggleArtifacts?: () => void
  artifactsOpen?: boolean
  onToggleSplit?: () => void
  splitOpen?: boolean
  onShare?: () => void
  hardwareStatus?: string
  contextPanel?: ReactNode
  artifactContent?: string
  artifactTitle?: string
  events?: import('@/lib/client/api').SessionEventView[]
  onOpenSettings?: (section?: string, projectId?: string) => void
  workspaceRoot?: string | null
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
  onArchiveChat,
  onPinChat,
  pinnedChatIds = [],
  recentChats = [],
  selectedChatId = null,
  onSelectChat = () => {},
  onCloseChat = () => {},
  tabs,
  hideSidebar = false,
  activeModelName,
  activeModelContext,
  onToggleArtifacts,
  artifactsOpen = false,
  onToggleSplit,
  splitOpen = false,
  onShare,
  hardwareStatus,
  contextPanel,
  artifactContent,
  artifactTitle,
  events = [],
  onOpenSettings,
  workspaceRoot,
}: Props): React.JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isAuxExpanded, setIsAuxExpanded] = useState(false)
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
        onNewChat={onNewChat}
        activeModelName={activeModelName}
        activeModelContext={activeModelContext}
        onToggleArtifacts={onToggleArtifacts}
        artifactsOpen={artifactsOpen}
        onToggleSplit={onToggleSplit}
        splitOpen={splitOpen}
        onShare={onShare}
        hardwareStatus={hardwareStatus}
        onOpenExplorer={() => (onOpenSettings ? onOpenSettings('explore') : onNavigate('explore'))}
        onOpenSettings={onOpenSettings}
      />
      <div className="layout" style={{ minHeight: 0, flex: 1, display: 'flex' } as React.CSSProperties}>
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
            onArchiveChat={onArchiveChat}
            onPinChat={onPinChat}
            pinnedChatIds={pinnedChatIds}
            recentChats={recentChats}
            selectedChatId={selectedChatId}
            onSelectChat={onSelectChat}
            onOpenSettings={onOpenSettings}
          />
        ) : null}
        <main
          className="main"
          role="main"
          aria-labelledby={`tab-${activeTab}`}
          tabIndex={-1}
          id="main-content"
          style={{
            flex: 1,
            minWidth: 0,
            display: artifactsOpen && isAuxExpanded ? 'none' : 'flex',
            flexDirection: 'column',
          } as React.CSSProperties}
        >
          {children}
        </main>
        {artifactsOpen ? (
          <AuxiliaryPane
            isOpen={artifactsOpen}
            onClose={() => onToggleArtifacts?.()}
            isExpanded={isAuxExpanded}
            onToggleExpand={() => setIsAuxExpanded((v) => !v)}
            artifactContent={artifactContent}
            artifactTitle={artifactTitle}
            events={events}
            sessionId={selectedSessionId || selectedChatId || undefined}
            workspaceRoot={workspaceRoot}
          />
        ) : (
          contextPanel ?? null
        )}
      </div>
    </div>
  )
}

