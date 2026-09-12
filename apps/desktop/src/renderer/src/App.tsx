import { useEffect, useState, useCallback, useMemo } from 'react'
import { AppShell } from './components/layout/AppShell'
import type { NavId } from './components/layout/Sidebar'
import { useChatSession } from './features/chat/useChatSession'
import { useModelWorkbench } from './features/models/useModelWorkbench'
import { ChatView } from './features/chat/ChatView'
import type { FileAttachment } from './features/chat/Composer'
import { CreateProjectModal } from './components/modals/CreateProjectModal'
import { ModelsPage } from './features/models/ModelsPage'
import { ExplorePage } from './features/explore/ExplorePage'
import { LibraryPage } from './features/library/LibraryPage'
import { LoadedInstancesSection } from './features/settings/LoadedInstancesSection'
import { SettingsPage } from './features/settings/SettingsPage'
import { AgentsPage } from './features/agents/AgentsPage'
import { SkillsPage } from './features/skills/SkillsPage'
import { ConnectionsPage } from './features/connections/ConnectionsPage'
import {
  createProject,
  listProjects,
  pickFolder,
  getAppInfo,
  getExecMode,
  setExecMode,
  getAppSettings,
  type ProjectView,
  type ExecMode,
} from '@/lib/client/api'

interface Info {
  name: string
  version: string
  electron: string | null
  node: string
  platform: string
  arch: string
}

export function App(): React.JSX.Element {
  const [_info, setInfo] = useState<Info | null>(null)
  const [_err, setErr] = useState<string | null>(null)
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
    getAppInfo()
      .then((v) => setInfo(v as Info))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    listProjects().then(setProjects).catch(() => {})
    getExecMode().then(setExecModeState).catch(() => {})
    getAppSettings()
      .then((s) => {
        const resolved =
          s.theme === 'system'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
              ? 'dark'
              : 'light'
            : s.theme
        document.documentElement.setAttribute('data-theme', resolved)
        document.documentElement.setAttribute('data-sidebar', s.sidebarBackground)
        document.documentElement.setAttribute('data-diff', s.inlineDiffLayout)
      })
      .catch(() => {})
  }, [])

  const handleExecModeChange = useCallback((mode: ExecMode): void => {
    setExecModeState(mode)
    setExecMode(mode).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const refreshProjects = useCallback((): void => {
    listProjects().then(setProjects).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const handleCreateProject = useCallback(
    async (name: string, rootPath?: string): Promise<void> => {
      let targetPath = rootPath
      if (!targetPath) {
        const picked = await pickFolder()
        if (picked.canceled || !picked.filePath) return
        targetPath = picked.filePath
      }
      try {
        const p = await createProject(name, targetPath)
        refreshProjects()
        setSelectedProjectId(p.id)
        if (chat.selectedId) {
          // If a chat is active, assign it to the new project
          void chat.handleCreate(p.id)
        }
        setProjectModalOpen(false)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshProjects, chat]
  )

  const handleNewSession = useCallback((): void => {
    void chat.handleCreate(null)
    setSelectedProjectId(null)
    setActiveTab('session')
    setActiveNav('chat')
  }, [chat])

  const handleNewProjectChat = useCallback(
    (projectId: string): void => {
      setSelectedProjectId(projectId)
      void chat.handleCreate(projectId)
      setActiveTab('session')
      setActiveNav('chat')
    },
    [chat]
  )

  const handleTabSelect = useCallback(
    (tabId: string): void => {
      setActiveTab(tabId)
      chat.switchSession(tabId)
      setActiveNav('chat')
    },
    [chat]
  )

  const [openChatIds, setOpenChatIds] = useState<string[]>([])

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

  const openChat = useCallback(
    (id: string): void => {
      const sess = chat.sessions.find((s) => s.id === id)
      setSelectedProjectId(sess?.projectId ?? null)
      setOpenChatIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      chat.switchSession(id)
      setActiveTab('session')
      setActiveNav('chat')
    },
    [chat]
  )

  const closeTab = useCallback(
    (id: string): void => {
      setOpenChatIds((prev) => {
        const next = prev.filter((t) => t !== id)
        if (chat.selectedId === id) {
          const fallback = next[next.length - 1]
          if (fallback) {
            const sess = chat.sessions.find((s) => s.id === fallback)
            setSelectedProjectId(sess?.projectId ?? null)
            chat.switchSession(fallback)
          } else {
            chat.clearSelection()
          }
        }
        return next
      })
    },
    [chat]
  )

  const openChats = openChatIds
    .map((id) => chat.sessions.find((s) => s.id === id))
    .filter((s): s is (typeof chat.sessions)[number] => Boolean(s))
    .map((s) => ({ id: s.id, title: s.title }))

  const handleSend = useCallback(
    (content: string, attachments?: FileAttachment[], opts?: { webSearch?: boolean }): void => {
      let enrichedContent = content
      if (attachments && attachments.length > 0) {
        const fileSummary = attachments.map((a) => `[Attached: ${a.name} (${a.type})]`).join(' ')
        enrichedContent = `${fileSummary}\n\n${content}`
      }
      const sendOpts: { webSearch?: boolean; reasoning?: boolean } = { ...opts }
      if (reasoningEnabled) sendOpts.reasoning = true
      void chat.handleSend(enrichedContent, sendOpts)
    },
    [chat, reasoningEnabled]
  )

  const handleRegenerate = useCallback((): void => {
    void chat.handleRegenerate(reasoningEnabled ? { reasoning: true } : undefined)
  }, [chat, reasoningEnabled])

  const handleEditAndResend = useCallback(
    (content: string): void => {
      void chat.handleEditAndResend(content, reasoningEnabled ? { reasoning: true } : undefined)
    },
    [chat, reasoningEnabled]
  )

  const handleCopy = useCallback((_content: string): void => {}, [])

  const handleOpenModels = useCallback((): void => {
    setActiveNav('models')
  }, [])

  const handleOpenExplorer = useCallback((): void => {
    setActiveNav('explore')
  }, [])

  const projectChats = (projectId: string): Array<{ id: string; title: string }> =>
    chat.projectSessions(projectId).map((s) => ({ id: s.id, title: s.title }))

  const activeProjectName = useMemo(() => {
    if (!selectedProjectId) return null
    return projects.find((p) => p.id === selectedProjectId)?.name ?? null
  }, [selectedProjectId, projects])

  const activeModelDisplay = useMemo(() => {
    if (workbench.active.displayName) return workbench.active.displayName
    if (workbench.active.selection) {
      const found = workbench.models.find(
        (m) =>
          m.modelId === workbench.active.selection!.modelId &&
          m.runtimeId === workbench.active.selection!.runtimeId
      )
      return found?.displayName ?? workbench.active.selection.modelId
    }
    return undefined
  }, [workbench.active, workbench.models])

  const hardwareStatus = useMemo(() => {
    if (!workbench.resources) return 'Detecting...'
    if (workbench.resources.gpu.available && workbench.resources.gpu.name) {
      const vramMB = workbench.resources.vram.totalMB
      return vramMB ? `${workbench.resources.gpu.name} (${Math.round(vramMB / 1024)}GB)` : workbench.resources.gpu.name
    }
    return `CPU: ${workbench.resources.cpu.logicalCores} cores`
  }, [workbench.resources])

  const [artifactsOpen, setArtifactsOpen] = useState(false)

  const handleShareSession = useCallback(() => {
    const transcript = chat.events
      .filter((e) => e.type === 'user/message' || e.type === 'assistant/message')
      .map((e) => {
        const role = e.type === 'user/message' ? 'User' : 'Assistant'
        const c = typeof e.data === 'string' ? e.data : (e.data as { content?: string }).content ?? ''
        return `### ${role}\n\n${c}\n`
      })
      .join('\n---\n\n')

    if (navigator.clipboard) {
      void navigator.clipboard.writeText(transcript || 'Empty session.')
    }
  }, [chat.events])

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
        onNewChat={handleNewSession}
        onNewProjectChat={handleNewProjectChat}
        onRenameChat={(id, title) => void chat.handleRename(id, title)}
        onDeleteChat={(id) => void chat.handleDelete(id)}
        recentChats={chat.globalSessions.map((s) => ({ id: s.id, title: s.title }))}
        selectedChatId={chat.selectedId}
        onSelectChat={openChat}
        onCloseChat={closeTab}
        tabs={openChats}
        hideSidebar={activeNav === 'settings'}
        activeModelName={activeModelDisplay}
        activeModelContext={workbench.active.available ? 'Ready' : 'Offline'}
        hardwareStatus={hardwareStatus}
        artifactsOpen={artifactsOpen}
        onToggleArtifacts={() => setArtifactsOpen((v) => !v)}
        splitOpen={artifactsOpen}
        onToggleSplit={() => setArtifactsOpen((v) => !v)}
        onShare={handleShareSession}
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
            execution={chat.execution}
            streamingText={chat.streamingText}
            streamingReasoning={chat.streamingReasoning}
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
            onOpenExplorer={handleOpenExplorer}
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
            onSelectModel={(rid, mid) => {
              void workbench.handleSelect(rid, mid).then(() => chat.refreshModelStatus())
            }}
            projectName={activeProjectName}
            artifactsPanelOpen={artifactsOpen}
            onToggleArtifacts={setArtifactsOpen}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            onSelectProject={setSelectedProjectId}
          />
        ) : null}

        {activeNav === 'models' ? <ModelsPage /> : null}

        {activeNav === 'explore' ? <ExplorePage onBack={() => setActiveNav('chat')} /> : null}

        {activeNav === 'library' ? <LibraryPage onBack={() => setActiveNav('chat')} /> : null}

        {activeNav === 'runtime' ? <LoadedInstancesSection onBack={() => setActiveNav('chat')} /> : null}

        {activeNav === 'agents' ? <AgentsPage /> : null}

        {activeNav === 'skills' ? <SkillsPage onBack={() => setActiveNav('chat')} /> : null}

        {activeNav === 'connections' ? <ConnectionsPage onBack={() => setActiveNav('chat')} /> : null}

        {activeNav === 'settings' ? <SettingsPage onBack={() => setActiveNav('chat')} /> : null}

        <CreateProjectModal
          open={projectModalOpen}
          onClose={() => setProjectModalOpen(false)}
          onCreate={handleCreateProject}
        />
      </AppShell>
    </>
  )
}
