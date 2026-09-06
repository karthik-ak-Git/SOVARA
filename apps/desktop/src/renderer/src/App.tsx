import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import type { NavId } from './components/layout/Sidebar'
import { Card } from './components/ui/Card'
import { EmptyState } from './components/ui/EmptyState'
import {
  Clock,
  Bot,
  Sparkles,
  Library,
  Cpu,
  Settings,
  Shield,
} from 'lucide-react'

import { ChatView } from './features/chat/ChatView'
import { useChatSession } from './features/chat/useChatSession'
import { ModelsPage } from './features/models/ModelsPage'

interface Info {
  name: string
  version: string
  electron: string
  node: string
  platform: string
  arch: string
}

function PanelTitle({ icon: Icon, title, hint }: { icon: React.ElementType; title: string; hint?: string }): React.JSX.Element {
  return (
    <div className="panel-head">
      <div className="panel-title">
        <Icon size={16} aria-hidden />
        <span>{title}</span>
      </div>
      {hint ? <div className="panel-hint muted small">{hint}</div> : null}
    </div>
  )
}

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<Info | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [activeNav, setActiveNav] = useState<NavId>('chat')
  const chat = useChatSession()

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
      <div className="foot-meta" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
        <Shield size={12} aria-hidden />
        <span>Local · Offline · No telemetry</span>
      </div>
    </>
  )

  return (
    <AppShell activeNav={activeNav} onNavigate={setActiveNav} footer={footer}>
      {activeNav === 'chat' ? (
        <ChatView
          sessions={chat.sessions.map((s) => ({ id: s.id, title: s.title }))}
          selectedId={chat.selectedId}
          events={chat.events}
          draft={chat.draft}
          setDraft={chat.setDraft}
          busy={chat.busy}
          error={chat.error}
          onDismissError={chat.dismissError}
          onSend={chat.handleSend}
          onCreateSession={chat.handleCreate}
          onSwitchSession={chat.switchSession}
        />
      ) : null}

      {activeNav === 'sessions' ? (
        <Card>
          <PanelTitle icon={Clock} title="Sessions" hint={`${chat.sessions.length} persisted · WAL + JSONL`} />
          <p className="muted">Full session management UI arrives in Commit 5. The store is already durable — this placeholder proves the IA.</p>
          <EmptyState
            title="Sessions placeholder"
            description="Navigation destination reserved. Backend is live; UI follows in Commit 5."
            icon={<Clock size={20} aria-hidden />}
          />
        </Card>
      ) : null}

      {activeNav === 'models' ? <ModelsPage /> : null}

      {activeNav === 'agents' ? (
        <Card>
          <PanelTitle icon={Bot} title="Agents" hint="DshPort / HermesPort stubs" />
          <EmptyState title="Agents" description="Agent presets and composition — stubs in Phase 1, Cordis/Hermes adapters in Phase 2." icon={<Bot size={20} aria-hidden />} />
        </Card>
      ) : null}

      {activeNav === 'skills' ? (
        <Card>
          <PanelTitle icon={Sparkles} title="Skills" hint="Coming soon" />
          <EmptyState title="Skills" description="Skill library and curated memory — reserved for Phase 2." icon={<Sparkles size={20} aria-hidden />} />
        </Card>
      ) : null}

      {activeNav === 'library' ? (
        <Card>
          <PanelTitle icon={Library} title="Library" hint="Coming soon" />
          <EmptyState title="Library" description="Knowledge / RAG documents — KnowledgePort stub, ingestion in Phase 2." icon={<Library size={20} aria-hidden />} />
        </Card>
      ) : null}

      {activeNav === 'runtime' ? (
        <Card>
          <PanelTitle icon={Cpu} title="Runtime" hint="SystemResourceManagerPort" />
          <EmptyState
            title="Runtime & resources"
            description="CPU / RAM / GPU / VRAM / disk and model instances — contract + stub in Phase 1, real probes in Phase 2."
            icon={<Cpu size={20} aria-hidden />}
          />
        </Card>
      ) : null}

      {activeNav === 'settings' ? (
        <Card>
          <PanelTitle icon={Settings} title="Settings" hint="Sovereign defaults" />
          <EmptyState
            title="Settings"
            description="Theme, network allowlist, resource limits — ConfigService with Zod, file watch in Phase 2."
            icon={<Settings size={20} aria-hidden />}
          />
        </Card>
      ) : null}
    </AppShell>
  )
}