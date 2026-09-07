import { useEffect, useState, useCallback } from 'react'
import { AppShell } from './components/layout/AppShell'
import type { NavId } from './components/layout/Sidebar'
import { useChatSession } from './features/chat/useChatSession'
import { useModelWorkbench } from './features/models/useModelWorkbench'
import { ChatView } from './features/chat/ChatView'
import type { FileAttachment } from './features/chat/Composer'
import { CreateProjectModal } from './components/modals/CreateProjectModal'
import type { ExecMode } from './components/ui/PermissionControl'
import { ModelsPage } from './features/models/ModelsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { Settings, Cpu, Sparkles, Library, Bot } from 'lucide-react'
import { Card } from './components/ui/Card'
import { EmptyState } from './components/ui/EmptyState'
import { createProject, listProjects, pickFolder, type ProjectView } from './lib/ipc'

interface Info {
  name: string
  version: string
  electron: string
  node: string
  platform: string
  arch: string
}

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<NavId>('chat')
  const [activeTab, setActiveTab] = useState('session')
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [execMode, setExecMode] = useState<ExecMode>('ask')
  const [reasoningEnabled, setReasoningEnabled] = useState(false)
  const [projectModalOpen, setProjectModalOpen] = useState(false)

  const chat = useChatSession()
  const workbench = useModelWorkbench()

  useEffect(() => {
    if (window.sovara) {
      window.sovara.invoke('app:getInfo').then((v) => setInfo(v as Info)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      listProjects().then(setProjects).catch(() => {})
    }
  }, [])

  const refreshProjects = useCallback((): void => {
    listProjects().then(setProjects).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const handleCreateProject = useCallback(async (name: string, _rootPath: string): Promise<void> => {
    // Folder access is real: always pick the project folder from disk.
    const picked = await pickFolder()
    if (picked.canceled || !picked.filePath) return
    try {
      const p = await createProject(name, picked.filePath)
      refreshProjects()
      setSelectedProjectId(p.id)
      setProjectModalOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [refreshProjects])

  const handleNewSession = useCallback((): void => {
    void chat.handleCreate(null)
    setSelectedProjectId(null)
    setActiveTab('session')
  }, [chat])

  const handleNewProjectChat = useCallback((projectId: string): void => {
    setSelectedProjectId(projectId)
    void chat.handleCreate(projectId)
    setActiveTab('session')
  }, [chat])

  const handleTabSelect = useCallback((tabId: string): void => {
    setActiveTab(tabId)
    chat.switchSession(tabId)
  }, [chat])

  const handleSend = useCallback((content: string, attachments?: FileAttachment[]): void => {
    let enrichedContent = content
    if (attachments && attachments.length > 0) {
      const fileSummary = attachments.map((a) => `[Attached: ${a.name} (${a.type})]`).join(' ')
      enrichedContent = `${fileSummary}\n\n${content}`
    }
    chat.handleSend(enrichedContent)
  }, [chat])

  const projectChats = (projectId: string): Array<{ id: string; title: string }> =>
    chat.projectSessions(projectId).map((s) => ({ id: s.id, title: s.title }))

  return (
    <>
      <AppShell
        activeNav={activeNav}
        onNavigate={setActiveNav}
        activeTab={activeTab}
        onTabSelect={handleTabSelect}
        onNewSession={handleNewSession}
        footer={null}
        projects={projects.map((p) => ({ id: p.id, name: p.name, sessions: projectChats(p.id) }))}
        selectedProjectId={selectedProjectId}
        selectedSessionId={chat.selectedId}
        onSelectProject={setSelectedProjectId}
        onSelectSession={(id) => {
          const sess = chat.sessions.find((s) => s.id === id)
          setSelectedProjectId(sess?.projectId ?? null)
          chat.switchSession(id)
          setActiveTab('session')
        }}
        onNewProject={() => setProjectModalOpen(true)}
        onNewChat={() => {
          setSelectedProjectId(null)
          void chat.handleCreate(null)
          setActiveTab('session')
        }}
        onNewProjectChat={handleNewProjectChat}
        onRenameChat={(id, title) => void chat.handleRename(id, title)}
        onDeleteChat={(id) => void chat.handleDelete(id)}
        recentChats={chat.globalSessions.map((s) => ({ id: s.id, title: s.title }))}
        selectedChatId={chat.selectedId}
        onSelectChat={(id) => {
          setSelectedProjectId(null)
          chat.switchSession(id)
          setActiveTab('session')
        }}
        onCloseChat={(id) => {
          const target = chat.sessions.find((s) => s.id === id)
          if (window.confirm(`Close "${target?.title ?? 'chat'}" permanently? Chat files are removed and cannot be recovered.`)) {
            void chat.handleDelete(id)
          }
        }}
      >
        {activeNav === 'chat' ? (
          <ChatView
            sessions={chat.sessions.map((s) => ({ id: s.id, title: s.title }))}
            selectedId={chat.selectedId}
            events={chat.events}
            draft={chat.draft}
            setDraft={chat.setDraft}
            busy={chat.busy}
            phase={chat.phase}
            streamingText={chat.streamingText}
            error={chat.error}
            model={chat.model}
            onDismissError={chat.dismissError}
            onSend={handleSend}
            onCancel={chat.handleCancel}
            onCreateSession={handleNewSession}
            onSwitchSession={chat.switchSession}
            activeModel={workbench.active}
            runtimes={workbench.runtimes}
            discoveredModels={workbench.models}
            projectCount={selectedProjectId ? projectChats(selectedProjectId).length : 0}
            onNewProject={() => setProjectModalOpen(true)}
            execMode={execMode}
            onExecModeChange={setExecMode}
            execAvailable={execMode !== 'off'}
            reasoningEnabled={reasoningEnabled}
            onReasoningToggle={setReasoningEnabled}
          />
        ) : null}

        {activeNav === 'models' ? <ModelsPage /> : null}

        {activeNav === 'settings' ? <SettingsPage /> : null}

        {activeNav === 'agents' ? (
          <Card>
            <div className="panel-head">
              <div className="panel-title">
                <Bot size={16} aria-hidden />
                <span>Agents</span>
              </div>
              <div className="panel-hint muted small">Coming soon</div>
            </div>
            <EmptyState title="Agents" description="Agent presets and composition — stubs in Phase 1, adapters in Phase 2." icon={<Bot size={20} aria-hidden />} />
          </Card>
        ) : null}

        {activeNav === 'skills' ? (
          <Card>
            <div className="panel-head">
              <div className="panel-title">
                <Sparkles size={16} aria-hidden />
                <span>Skills</span>
              </div>
              <div className="panel-hint muted small">Coming soon</div>
            </div>
            <EmptyState title="Skills" description="Skill library and curated memory — reserved for Phase 2." icon={<Sparkles size={20} aria-hidden />} />
          </Card>
        ) : null}

        {activeNav === 'library' ? (
          <Card>
            <div className="panel-head">
              <div className="panel-title">
                <Library size={16} aria-hidden />
                <span>Library</span>
              </div>
              <div className="panel-hint muted small">Coming soon</div>
            </div>
            <EmptyState title="Library" description="Knowledge / RAG documents — KnowledgePort stub, ingestion in Phase 2." icon={<Library size={20} aria-hidden />} />
          </Card>
        ) : null}

        {activeNav === 'runtime' ? (
          <Card>
            <div className="panel-head">
              <div className="panel-title">
                <Cpu size={16} aria-hidden />
                <span>Runtime</span>
              </div>
              <div className="panel-hint muted small">Coming soon</div>
            </div>
            <EmptyState
              title="Runtime & resources"
              description="CPU / RAM / GPU / VRAM / disk and model instances — contract + stub in Phase 1, real probes in Phase 2."
              icon={<Cpu size={20} aria-hidden />}
            />
          </Card>
        ) : null}

        <CreateProjectModal
          open={projectModalOpen}
          onClose={() => setProjectModalOpen(false)}
          onCreate={handleCreateProject}
        />
      </AppShell>
    </>
  )
}
