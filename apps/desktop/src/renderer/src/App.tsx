import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import type { NavId } from './components/layout/Sidebar'
import { useChatSession } from './features/chat/useChatSession'
import { useModelWorkbench } from './features/models/useModelWorkbench'
import { ChatView } from './features/chat/ChatView'
import { ModelsPage } from './features/models/ModelsPage'
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

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<NavId>('chat')
  const chat = useChatSession()
  const workbench = useModelWorkbench()

  useEffect(() => {
    if (window.sovara) {
      window.sovara.invoke('app:getInfo').then((v) => setInfo(v as Info)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    }
  }, [])

  const footer = (
    <>
      <div className="foot-label">Build</div>
      <div className="foot-value">{info ? `${info.name} ${info.version}` : '…'}</div>
      {info ? (
        <div className="foot-meta">
          Electron {info.electron} · Node {info.node}
          <br />
          {info.platform}/{info.arch}
        </div>
      ) : null}
      {err ? <div className="foot-error" role="alert">{err}</div> : null}
    </>
  )

  return (
    <AppShell
      activeNav={activeNav}
      onNavigate={setActiveNav}
      footer={footer}
      projects={[]}
      selectedProjectId={null}
      selectedSessionId={chat.selectedId}
      onSelectProject={() => {}}
      onSelectSession={chat.switchSession}
      onNewProject={() => {}}
      onNewChat={chat.handleCreate}
      recentChats={chat.sessions.map((s) => ({ id: s.id, title: s.title }))}
      selectedChatId={chat.selectedId}
      onSelectChat={chat.switchSession}
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
          onSend={chat.handleSend}
          onCancel={chat.handleCancel}
          onCreateSession={chat.handleCreate}
          onSwitchSession={chat.switchSession}
          activeModel={workbench.active}
          runtimes={workbench.runtimes}
          discoveredModels={workbench.models}
          projectCount={0}
          onNewProject={() => {}}
          execMode={null}
          execAvailable={false}
        />
      ) : null}

      {activeNav === 'models' ? <ModelsPage /> : null}

      {activeNav === 'settings' ? (
        <Card>
          <div className="panel-head">
            <div className="panel-title">
              <Settings size={16} aria-hidden />
              <span>Settings</span>
            </div>
            <div className="panel-hint muted small">Sovereign defaults</div>
          </div>
          <EmptyState
            title="Settings"
            description="Theme, network allowlist, resource limits — ConfigService with Zod, file watch in Phase 2."
            icon={<Settings size={20} aria-hidden />}
          />
        </Card>
      ) : null}

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
    </AppShell>
  )
}
