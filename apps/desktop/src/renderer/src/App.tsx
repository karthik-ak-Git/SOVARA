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

interface Info {
  name: string
  version: string
  electron: string
  node: string
  platform: string
  arch: string
}

interface Project {
  id: string
  name: string
  rootPath: string
  sessions: Array<{ id: string; title: string }>
}

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<NavId>('chat')
  const [activeTab, setActiveTab] = useState('new-tab')
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [execMode, setExecMode] = useState<ExecMode>('ask')
  const [reasoningEnabled, setReasoningEnabled] = useState(false)
  const [projectModalOpen, setProjectModalOpen] = useState(false)

  const chat = useChatSession()
  const workbench = useModelWorkbench()

  useEffect(() => {
    if (window.sovara) {
      window.sovara.invoke('app:getInfo').then((v) => setInfo(v as Info)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    }
  }, [])

  const handleCreateProject = useCallback((name: string, rootPath: string): void => {
    const id = `project-${Date.now()}`
    setProjects((prev) => [
      ...prev,
      { id, name, rootPath, sessions: [] },
    ])
    setSelectedProjectId(id)
    setProjectModalOpen(false)
  }, [])

  const handleNewSession = useCallback((): void => {
    chat.handleCreate()
    setActiveTab('session')
  }, [chat])

  const handleTabSelect = useCallback((tabId: string): void => {
    setActiveTab(tabId)
  }, [])

  const handleSend = useCallback((content: string, attachments?: FileAttachment[]): void => {
    let enrichedContent = content
    if (attachments && attachments.length > 0) {
      const fileSummary = attachments.map((a) => `[Attached: ${a.name} (${a.type})]`).join(' ')
      enrichedContent = `${fileSummary}\n\n${content}`
    }
    chat.handleSend(enrichedContent)
  }, [chat])

  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  return (
    <>
      {activeNav === 'settings' ? (
        <SettingsPage onBack={() => setActiveNav('chat')} />
      ) : (
        <AppShell
          activeNav={activeNav}
          onNavigate={setActiveNav}
          activeTab={activeTab}
          onTabSelect={handleTabSelect}
          onNewSession={handleNewSession}
          footer={null}
          projects={projects}
          selectedProjectId={selectedProjectId}
          selectedSessionId={chat.selectedId}
          onSelectProject={setSelectedProjectId}
          onSelectSession={(id) => {
            chat.switchSession(id)
            setActiveTab('session')
          }}
          onNewProject={() => setProjectModalOpen(true)}
          onNewChat={() => {
            chat.handleCreate()
            setActiveTab('session')
          }}
          recentChats={chat.sessions.map((s) => ({ id: s.id, title: s.title }))}
          selectedChatId={chat.selectedId}
          onSelectChat={(id) => {
            chat.switchSession(id)
            setActiveTab('session')
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
              projectCount={selectedProject?.sessions.length ?? 0}
              onNewProject={() => setProjectModalOpen(true)}
              execMode={execMode}
              onExecModeChange={setExecMode}
              execAvailable={execMode !== 'off'}
              reasoningEnabled={reasoningEnabled}
              onReasoningToggle={setReasoningEnabled}
            />
          ) : null}

          {activeNav === 'models' ? <ModelsPage /> : null}

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
      )}
    </>
  )
}
