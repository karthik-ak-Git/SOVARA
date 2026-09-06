import { useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import type { NavId } from './components/layout/Sidebar'
import { Card } from './components/ui/Card'
import { Button } from './components/ui/Button'
import { EmptyState } from './components/ui/EmptyState'
import {
  MessageSquare,
  Clock,
  Database,
  Bot,
  Sparkles,
  Library,
  Cpu,
  Settings,
  Shield,
} from 'lucide-react'

import { ChatView } from './features/chat/ChatView'

interface Info {
  name: string
  version: string
  electron: string
  node: string
  platform: string
  arch: string
}
interface SessionHeader {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}
interface SessionEventView {
  seq: number
  time: number
  type: string
  data: unknown
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
  const [sessions, setSessions] = useState<SessionHeader[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionEventView[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const loadSessions = async (): Promise<void> => {
    if (!window.sovara) return
    try {
      const list = (await window.sovara.invoke('sessions:list')) as SessionHeader[]
      setSessions(list)
    } catch (e) {
      // sovereigntiy: ignore if sovara not ready yet
    }
  }
  const loadEvents = async (id: string): Promise<void> => {
    if (!window.sovara) return
    try {
      const evts = (await window.sovara.invoke('sessions:getEvents', id)) as SessionEventView[]
      setEvents(evts)
    } catch (e) {
      // ignore if sovara not ready yet
    }
  }

  useEffect(() => {
    if (window.sovara) {
      window.sovara.invoke('app:getInfo').then((v) => setInfo(v as Info)).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    }
    void loadSessions()
  }, [])

  useEffect(() => {
    if (selectedId) void loadEvents(selectedId)
  }, [selectedId])

  // keep selection valid after list changes
  useEffect(() => {
    if (sessions.length > 0 && !selectedId) setSelectedId(sessions[0].id)
    if (sessions.length === 0) setSelectedId(null)
  }, [sessions, selectedId])

  const handleCreate = async (): Promise<void> => {
    if (!window.sovara) return
    setBusy(true)
    try {
      const h = (await window.sovara.invoke('sessions:create', { title: `Session ${sessions.length + 1}` })) as SessionHeader
      await loadSessions()
      setSelectedId(h.id)
    } finally {
      setBusy(false)
    }
  }
  const handleSend = async (): Promise<void> => {
    if (!window.sovara || !selectedId || !draft.trim()) return
    setBusy(true)
    try {
      await window.sovara.invoke('chat:send', { sessionId: selectedId, content: draft.trim() })
      setDraft('')
      await loadEvents(selectedId)
      await loadSessions()
    } finally {
      setBusy(false)
    }
  }

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
          sessions={sessions.map((s) => ({ id: s.id, title: s.title }))}
          selectedId={selectedId}
          events={events}
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          setBusy={setBusy}
          onSend={handleSend}
          onNewline={() => {}}
          onCreateSession={handleCreate}
          onSwitchSession={(id: string) => setSelectedId(id)}
        />
      ) : null}

      {activeNav === 'sessions' ? (
        <Card>
          <PanelTitle icon={Clock} title="Sessions" hint={`${sessions.length} persisted · WAL + JSONL`} />
          <p className="muted">Full session management UI arrives in Commit 5. The store is already durable — this placeholder proves the IA.</p>
          <EmptyState
            title="Sessions placeholder"
            description="Navigation destination reserved. Backend is live; UI follows in Commit 5."
            icon={<Clock size={20} aria-hidden />}
          />
        </Card>
      ) : null}

      {activeNav === 'models' ? (
        <Card>
          <PanelTitle icon={Database} title="Models" hint="Runtime-agnostic · local only" />
          <EmptyState title="Local model library" description="Discovery for llama.cpp / Ollama / LM Studio / vLLM — interface only in Phase 1." icon={<Database size={20} aria-hidden />} />
        </Card>
      ) : null}

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