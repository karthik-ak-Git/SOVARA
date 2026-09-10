import { useEffect, useState, useCallback } from 'react'
import { AppShell } from './components/layout/AppShell'
import type { NavId } from './components/layout/Sidebar'
import { useChatSession } from './features/chat/useChatSession'
import { useModelWorkbench } from './features/models/useModelWorkbench'
import { ChatView } from './features/chat/ChatView'
import type { FileAttachment } from './features/chat/Composer'
import { CreateProjectModal } from './components/modals/CreateProjectModal'
import { ModelsPage } from './features/models/ModelsPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { Settings, Cpu, Sparkles, Library } from 'lucide-react'
import { Card } from './components/ui/Card'
import { EmptyState } from './components/ui/EmptyState'
import { AgentsPage } from './features/agents/AgentsPage'
import { createProject, listProjects, pickFolder, getExecMode, setExecMode, getAppSettings, type ProjectView, type ExecMode } from './lib/ipc'

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
  const [execMode, setExecModeState] = useState<ExecMode>('ask')
  const [reasoningEnabled, setReasoningEnabled] = useState(false)
  const [projectModalOpen, setProjectModalOpen] = useState(false)

  const chat = useChatSession()
  const workbench = useModelWorkbench()

  useEffect(() => {
    if (window.sovara) {
      window.sovara.invoke('app:getInfo').then((v) => setInfo(v as Info)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      listProjects().then(setProjects).catch(() => {})
      getExecMode().then(setExecModeState).catch(() => {})
      // ponytail: apply persisted appearance before first paint — CSS does the rest, no extra dep
      getAppSettings().then((s) => {
        const resolved = s.theme === 'system'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : s.theme
        document.documentElement.setAttribute('data-theme', resolved)
        document.documentElement.setAttribute('data-sidebar', s.sidebarBackground)
        document.documentElement.setAttribute('data-diff', s.inlineDiffLayout)
      }).catch(() => {})
    }
  }, [])

  const handleExecModeChange = useCallback((mode: ExecMode): void => {
    setExecModeState(mode)
    setExecMode(mode).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
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

  // ── Open tabs (header) — closing a tab only hides it; the chat stays in
  // the sidebar and its files are untouched. Permanent removal lives only in
  // the sidebar 3-dots menu / tab X never deletes.
  const [openChatIds, setOpenChatIds] = useState<string[]>([])

  // Seed open tabs from the auto-selected session; prune ids of deleted chats.
  useEffect(() => {
    if (chat.selectedId) {
      setOpenChatIds((prev) => {
        const alive = prev.filter((id) => chat.sessions.some((s) => s.id === id))
        return alive.includes(chat.selectedId ?? '')
          ? alive
          : [...alive, chat.selectedId ?? ''].filter(Boolean)
      })
    } else {
      setOpenChatIds((prev) => prev.filter((id) => chat.sessions.some((s) => s.id === id)))
    }
  }, [chat.selectedId, chat.sessions])

  const openChat = useCallback((id: string): void => {
    const sess = chat.sessions.find((s) => s.id === id)
    setSelectedProjectId(sess?.projectId ?? null)
    setOpenChatIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
    chat.switchSession(id)
    setActiveTab('session')
  }, [chat])

  const closeTab = useCallback((id: string): void => {
    setOpenChatIds((prev) => {
      const next = prev.filter((t) => t !== id)
      if (chat.selectedId === id) {
        // Fall back to the newest remaining open tab, else clear the view.
        const fallback = next[next.length - 1]
        if (fallback) {
          const sess = chat.sessions.find((s) => s.id === fallback)
          setSelectedProjectId(sess?.projectId ?? null)
          chat.switchSession(fallback)
        } else {
          // No tabs left — keep the session list, clear the conversation view.
          chat.clearSelection()
        }
      }
      return next
    })
  }, [chat])

  const openChats = openChatIds
    .map((id) => chat.sessions.find((s) => s.id === id))
    .filter((s): s is (typeof chat.sessions)[number] => Boolean(s))
    .map((s) => ({ id: s.id, title: s.title }))

  const handleSend = useCallback((content: string, attachments?: FileAttachment[], opts?: { webSearch: boolean }): void => {
    let enrichedContent = content
    if (attachments && attachments.length > 0) {
      const fileSummary = attachments.map((a) => `[Attached: ${a.name} (${a.type})]`).join(' ')
      enrichedContent = `${fileSummary}\n\n${content}`
    }
    chat.handleSend(enrichedContent, opts)
  }, [chat])

  const handleRegenerate = useCallback((): void => {
    void chat.handleRegenerate()
  }, [chat])

  const handleEditAndResend = useCallback((content: string): void => {
    void chat.handleEditAndResend(content)
  }, [chat])

  const handleCopy = useCallback((_content: string): void => {
    // Clipboard handled inside MessageBubble/MessageActions; hook for analytics
  }, [])

  const handleOpenModels = useCallback((): void => {
    setActiveNav('models')
  }, [])

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
        onSelectSession={openChat}
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
        onSelectChat={openChat}
        onCloseChat={closeTab}
        tabs={openChats}
        hideSidebar={activeNav === 'settings'}
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
            model={workbench.active}
            onDismissError={chat.dismissError}
            onSend={handleSend}
            onCancel={chat.handleCancel}
            onRegenerate={handleRegenerate}
            onEditAndResend={handleEditAndResend}
            onCopy={handleCopy}
            onCreateSession={handleNewSession}
            onSwitchSession={chat.switchSession}
            onOpenModels={handleOpenModels}
            activeModel={workbench.active}
            runtimes={workbench.runtimes}
            discoveredModels={workbench.models}
            projectCount={selectedProjectId ? projectChats(selectedProjectId).length : 0}
            onNewProject={() => setProjectModalOpen(true)}
            execMode={execMode}
            onExecModeChange={handleExecModeChange}
            execAvailable={execMode !== 'off'}
            reasoningEnabled={reasoningEnabled}
            onReasoningToggle={setReasoningEnabled}
            onSelectModel={(rid,mid)=>{ console.info('[app] select', rid, mid); void workbench.handleSelect(rid,mid).then(()=>chat.refreshModelStatus()) }}
          />
        ) : null}

        {activeNav === 'models' ? <ModelsPage /> : null}

        {activeNav === 'settings' ? <SettingsPage onBack={() => setActiveNav('chat')} /> : null}

        {activeNav === 'agents' ? <AgentsPage /> : null}

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
