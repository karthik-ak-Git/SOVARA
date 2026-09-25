import { useMemo, useState, useEffect, useCallback } from 'react'
import { listMcpServers, getMcpDir, openMcpFolder, installMcpFromUrl, toggleMcpServer, probeMcpServer, removeMcpServer, listSessions, getSessionEvents, type McpServerView } from '@/lib/client/api'
import {
  fetchAgents,
  createAgent,
  updateAgent,
  duplicateAgent,
  removeAgent,
  setArchived,
  fetchKnowledge,
  addKnowledge,
  removeKnowledge,
  fetchMemories,
  addMemory,
  removeMemory,
  fetchWorkflows,
  createWorkflow,
  updateWorkflow,
  removeWorkflow,
  fetchEvals,
  recordEval,
  fetchVersions,
  fetchPermissions,
  savePermissions,
  fetchSkillToggles,
  setSkillToggle,
  fetchToolCallCounts,
  fetchSkillRunCounts,
  fetchRecentActivity,
  fetchRealTools,
  fetchRealSkills,
  fetchRealDownloads,
  fetchWebSearchEnabled,
  validateAgentForm,
  timeAgo,
  formatBytes,
  type StudioAgent,
  type AgentLifecycle,
  type KnowledgeFile,
  type MemoryEntry,
  type Workflow,
  type EvalRun,
  type VersionEntry,
  type AgentPermissions,
  type WorkflowTrigger,
} from './agentStudioClient'
import {
  Bot,
  Star,
  Clock3,
  UsersRound,
  LayoutTemplate,
  Archive,
  Plus,
  Search,
  ChevronRight,
  ChevronLeft,
  PanelRight,
  PanelRightClose,
  Sparkles,
  Database,
  FileText,
  BookOpen,
  Plug2,
  Wrench,
  Brain,
  Workflow as WorkflowIcon,
  FlaskConical,
  BarChart3,
  History,
  ShieldCheck,
  Settings2,
  MoreHorizontal,
  Activity,
  Zap,
  CheckCircle2,
  CircleDot,
  Copy,
  Trash2,
  ExternalLink,
  MessageSquare,
  Layers,
  Cpu,
  Rocket,
  Play,
  Pause,
  Download,
  Upload,
  File,
  FolderOpen,
  Eye,
  GitBranch,
  Lock,
  Gauge,
  PenLine,
  Hammer,
  TestTube2,
  Shield,
  ArrowUpRight,
  TrendingUp,
  AlertTriangle,
  X,
} from 'lucide-react'

// ─────────────────────────────────────────────────────────────
// Agent Studio — greenfield command center (does NOT reuse old .agents-* layout)
// IA: Lifecycle-ordered → Design (Prompt) → Build (Knowledge/Skills/MCP/Tools/Memory) → Automate (Workflows) → Validate (Testing/Analytics) → Govern (Versions/Permissions/Settings)
//
// Honesty policy: every panel renders persisted local history (sessions,
// tool/call events, MCP registry) or the Studio store
// (agents, knowledge, memories, workflows, evals, versions, permissions).
// Collections start empty and only fill after real user actions —
// honest "No X yet" empty states, never invented numbers.
// ─────────────────────────────────────────────────────────────

type NavFilter = 'all' | 'favorites' | 'recent' | 'team' | 'templates' | 'archived'
type WorkspaceId =
  | 'overview'
  | 'instructions'
  | 'knowledge'
  | 'skills'
  | 'connected'
  | 'tools'
  | 'memory'
  | 'workflows'
  | 'testing'
  | 'analytics'
  | 'versions'
  | 'permissions'
  | 'settings'

const WORKSPACE_GROUPS: Array<{ group: string; items: Array<{ id: WorkspaceId; label: string; icon: typeof FileText; hint: string }> }> = [
  { group: 'Command', items: [{ id: 'overview', label: 'Overview', icon: Gauge, hint: 'Metrics & quick actions' }] },
  {
    group: 'Design',
    items: [
      { id: 'instructions', label: 'Instructions', icon: PenLine, hint: 'System prompt' },
      { id: 'knowledge', label: 'Knowledge', icon: BookOpen, hint: 'File explorer & RAG' },
      { id: 'skills', label: 'Skills', icon: Sparkles, hint: 'Capability cards' },
      { id: 'connected', label: 'Connected Apps', icon: Plug2, hint: 'MCP only' },
    ],
  },
  {
    group: 'Build',
    items: [
      { id: 'tools', label: 'Tools', icon: Wrench, hint: 'Functions' },
      { id: 'memory', label: 'Memory', icon: Brain, hint: 'Inspector' },
      { id: 'workflows', label: 'Workflows', icon: WorkflowIcon, hint: 'Builder' },
    ],
  },
  {
    group: 'Validate',
    items: [
      { id: 'testing', label: 'Testing', icon: TestTube2, hint: 'Playground' },
      { id: 'analytics', label: 'Analytics', icon: BarChart3, hint: 'Dashboards' },
    ],
  },
  {
    group: 'Govern',
    items: [
      { id: 'versions', label: 'Versions', icon: History, hint: 'Timeline' },
      { id: 'permissions', label: 'Permissions', icon: Shield, hint: 'Visual matrix' },
      { id: 'settings', label: 'Settings', icon: Settings2, hint: 'General' },
    ],
  },
]

function lifecycleLabel(l: AgentLifecycle): string {
  if (l === 'active') return 'Active'
  if (l === 'published') return 'Published'
  if (l === 'build') return 'Build'
  return 'Draft'
}
function lifecycleClass(l: AgentLifecycle): string {
  if (l === 'active') return 'as-life--active'
  if (l === 'published') return 'as-life--published'
  if (l === 'build') return 'as-life--build'
  return 'as-life--draft'
}

const NEXT_LIFECYCLE: Record<AgentLifecycle, AgentLifecycle | null> = {
  draft: 'build',
  build: 'active',
  active: 'published',
  published: null,
}

function Sparkline({ values, color = 'var(--accent)' }: { values: number[]; color?: string }): React.JSX.Element {
  const w = 84
  const h = 28
  if (values.length < 2) return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden />
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * (h - 6) - 3}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" points={pts} opacity={0.95} />
    </svg>
  )
}

// ── Real usage metrics (no fake numbers) ─────────────────────────
// Computed live from persisted session events via IPC. Renders an honest
// empty state when no local run history exists yet.
interface UsageStats {
  loading: boolean
  totalMessages: number
  last7d: number[] // messages per day, oldest → newest
  errors: number
  avgChars: number
}

function useUsageStats(): UsageStats {
  const [stats, setStats] = useState<UsageStats>({ loading: true, totalMessages: 0, last7d: [], errors: 0, avgChars: 0 })
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const sessions = await listSessions()
        const recent = sessions.slice(0, 25)
        const eventLists = await Promise.all(recent.map((s) => getSessionEvents(s.id).catch(() => [])))
        if (!alive) return
        const now = Date.now()
        const days = Array<number>(7).fill(0)
        let total = 0
        let errors = 0
        let chars = 0
        for (const events of eventLists) {
          for (const e of events) {
            if (e.type === 'user/message' || e.type === 'assistant/message') {
              const content = typeof e.data === 'object' && e.data !== null && typeof (e.data as Record<string, unknown>)['content'] === 'string'
                ? (e.data as Record<string, unknown>)['content'] as string : ''
              total++
              chars += content.length
              const ageDays = Math.floor((now - e.time) / 86_400_000)
              if (ageDays >= 0 && ageDays < 7) days[6 - ageDays]++
            }
            if (e.type === 'task:error' || e.type === 'error') errors++
          }
        }
        setStats({ loading: false, totalMessages: total, last7d: days, errors, avgChars: total > 0 ? Math.round(chars / total) : 0 })
      } catch {
        if (alive) setStats({ loading: false, totalMessages: 0, last7d: [], errors: 0, avgChars: 0 })
      }
    })()
    return () => { alive = false }
  }, [])
  return stats
}

function MetricOrEmpty({ stats, children }: { stats: UsageStats; children: (s: UsageStats) => React.JSX.Element }): React.JSX.Element {
  if (stats.loading) return <div className="as-metric-foot"><span className="small muted">Loading local run history…</span></div>
  if (stats.totalMessages === 0) return <div className="as-metric-foot"><span className="small muted">No local runs yet — metrics appear after you chat.</span></div>
  return children(stats)
}

// Real hardware recommendation from SystemResources IPC — never a hardcoded rig.
function HardwareReco(): React.JSX.Element {
  const [reco, setReco] = useState<{ loading: boolean; text: React.JSX.Element | null }>({ loading: true, text: null })
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const { getSystemResources, listDiscoveredModels } = await import('@/lib/client/api')
        const [hw, models] = await Promise.all([getSystemResources(), listDiscoveredModels()])
        if (!alive) return
        const vramGB = hw.vram?.totalMB != null && hw.vram.totalMB > 0 ? hw.vram.totalMB / 1024 : null
        const ramGB = hw.ram?.totalMB != null ? hw.ram.totalMB / 1024 : null
        if (vramGB == null && ramGB == null) {
          setReco({ loading: false, text: <p className="as-reco-body">Hardware detection unavailable.</p> })
          return
        }
        const fitText = vramGB != null
          ? `Your rig has ${ramGB != null ? `${ramGB.toFixed(0)} GB RAM · ` : ''}${vramGB.toFixed(1)} GB VRAM.`
          : `Your rig has ${ramGB?.toFixed(0)} GB RAM (no dedicated GPU detected).`
        // Largest available discovered model by real file size that fits free VRAM (fallback RAM).
        const budgetMb = vramGB != null && (hw.vram?.freeMB ?? 0) > 0 ? (hw.vram?.freeMB ?? 0) : (hw.ram?.freeMB ?? 0)
        const sizeMb = (m: typeof models[number]): number => {
          const st = m as unknown as { fileSizeBytes?: number; sizeBytes?: number }
          if (typeof st.fileSizeBytes === 'number' && st.fileSizeBytes > 0) return st.fileSizeBytes / (1024 * 1024)
          if (typeof st.sizeBytes === 'number' && st.sizeBytes > 0) return st.sizeBytes / (1024 * 1024)
          const pm = m.modelId.match(/([\d.]+)\s*b\b/i)
          return (pm ? parseFloat(pm[1]) : 7) * 550
        }
        const fitting = models
          .filter((m) => m.available)
          .map((m) => ({ m, mb: sizeMb(m) }))
          .filter((x) => x.mb > 0 && x.mb <= budgetMb * 0.9)
          .sort((a, b) => b.mb - a.mb)[0]
        setReco({
          loading: false,
          text: fitting ? (
            <p className="as-reco-body">{fitText} <strong>{fitting.m.displayName}</strong> is the best available fit on this machine (~{(fitting.mb / 1024).toFixed(1)} GB, measured against free memory).</p>
          ) : (
            <p className="as-reco-body">{fitText} No downloaded model fits in free memory yet — download a smaller quant from Explore.</p>
          ),
        })
      } catch {
        if (alive) setReco({ loading: false, text: <p className="as-reco-body">Recommendation unavailable — open Models to check hardware.</p> })
      }
    })()
    return () => { alive = false }
  }, [])
  return reco.loading ? <p className="as-reco-body">Detecting hardware…</p> : (reco.text ?? <p className="as-reco-body">Recommendation unavailable.</p>)
}

// ── Shared collection hook (per-agent store entities) ────────────────

function useAgentCollection<T>(agentId: string | null, load: (agentId: string) => Promise<T[]>): { items: T[]; loading: boolean; reload: () => Promise<void> } {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const reload = useCallback(async () => {
    if (!agentId) { setItems([]); setLoading(false); return }
    setLoading(true)
    try {
      setItems(await load(agentId))
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [agentId, load])
  useEffect(() => { void reload() }, [reload])
  return { items, loading, reload }
}

// ── Workspaces ──────────────────────────────────────────────────

function OverviewWorkspace({ agent, onNavigate, onPublish }: { agent: StudioAgent | null; onNavigate: (ws: WorkspaceId) => void; onPublish: () => void }): React.JSX.Element {
  const stats = useUsageStats()
  const { items: workflows } = useAgentCollection<Workflow>(agent?.id ?? null, fetchWorkflows)
  const { items: evals } = useAgentCollection<EvalRun>(agent?.id ?? null, fetchEvals)
  return (
    <div className="as-overview">
      {agent ? null : (
        <div className="as-panel" style={{ padding: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>No agent selected</div>
          <div className="small muted" style={{ marginTop: 4 }}>Create your first agent from the navigator — metrics below already reflect real local run history.</div>
        </div>
      )}
      <div className="as-metrics">
        <div className="as-metric">
          <div className="as-metric-head"><span className="as-metric-icon"><Activity size={14} aria-hidden /></span><span className="as-metric-label">Messages · recent sessions</span></div>
          <div className="as-metric-value">{stats.loading ? '…' : stats.totalMessages}</div>
          <MetricOrEmpty stats={stats}>{(s) => (
            <div className="as-metric-foot"><span className="small muted">{s.errors} error event{s.errors === 1 ? '' : 's'} · avg {s.avgChars} chars/msg</span><Sparkline values={s.last7d.length >= 2 ? s.last7d : [0, 0]} /></div>
          )}</MetricOrEmpty>
        </div>
        <div className="as-metric">
          <div className="as-metric-head"><span className="as-metric-icon"><Gauge size={14} aria-hidden /></span><span className="as-metric-label">Activity · 7d</span></div>
          <div className="as-metric-value">{stats.loading ? '…' : stats.last7d.reduce((a, b) => a + b, 0)}</div>
          <MetricOrEmpty stats={stats}>{(s) => (
            <div className="as-metric-foot"><span className="small muted">messages per day, last 7 days</span><Sparkline values={s.last7d.length >= 2 ? s.last7d : [0, 0]} color="#10b981" /></div>
          )}</MetricOrEmpty>
        </div>
        <div className="as-metric">
          <div className="as-metric-head"><span className="as-metric-icon"><BookOpen size={14} aria-hidden /></span><span className="as-metric-label">Avg message size</span></div>
          <div className="as-metric-value">{stats.loading ? '…' : stats.avgChars}<span className="as-metric-unit">chars</span></div>
          <MetricOrEmpty stats={stats}>{() => (
            <div className="as-metric-foot"><span className="small muted">derived from persisted session events</span></div>
          )}</MetricOrEmpty>
        </div>
        <div className="as-metric">
          <div className="as-metric-head"><span className="as-metric-icon"><Plug2 size={14} aria-hidden /></span><span className="as-metric-label">Sovereignty</span><span className="as-pill as-pill--ok">local</span></div>
          <div className="as-metric-value">Offline</div>
          <div className="as-metric-foot"><span className="small muted">No cloud · no telemetry · local models only</span></div>
        </div>
      </div>

      <div className="as-quick">
        <button type="button" className="as-quick-card" onClick={() => onNavigate('instructions')}><span className="as-quick-icon"><PenLine size={16} aria-hidden /></span><span className="as-quick-text"><strong>Edit prompt</strong><span className="small muted">Instructions → live preview</span></span><ArrowUpRight size={14} aria-hidden className="as-quick-arrow" /></button>
        <button type="button" className="as-quick-card" onClick={() => onNavigate('knowledge')}><span className="as-quick-icon"><Upload size={16} aria-hidden /></span><span className="as-quick-text"><strong>Add knowledge</strong><span className="small muted">Register files per agent</span></span><ArrowUpRight size={14} aria-hidden className="as-quick-arrow" /></button>
        <button type="button" className="as-quick-card" onClick={() => onNavigate('testing')}><span className="as-quick-icon"><Play size={16} aria-hidden /></span><span className="as-quick-text"><strong>Run test</strong><span className="small muted">Playground → evals</span></span><ArrowUpRight size={14} aria-hidden className="as-quick-arrow" /></button>
        <button type="button" className="as-quick-card primary" disabled={!agent} onClick={onPublish}><span className="as-quick-icon"><Rocket size={16} aria-hidden /></span><span className="as-quick-text"><strong>Publish</strong><span className="small muted">Advance lifecycle</span></span><ArrowUpRight size={14} aria-hidden className="as-quick-arrow" /></button>
      </div>

      <div className="as-reco">
        <div className="as-reco-head"><Cpu size={13} aria-hidden /><span>System-aware recommendation</span><span className="as-pill">local</span></div>
        <HardwareReco />
      </div>

      <div className="as-two">
        <div className="as-panel">
          <div className="as-panel-head"><span className="as-panel-title"><WorkflowIcon size={13} aria-hidden /> Recent workflows</span><button type="button" className="btn btn-sm ghost" onClick={() => onNavigate('workflows')}>Open</button></div>
          <div className="as-list">
            {agent == null ? <div className="as-empty small muted">No agent selected.</div>
              : workflows.length === 0 ? <div className="as-empty small muted">No workflows yet — create one in Workflows.</div>
                : workflows.slice(0, 3).map((w) => (
                  <div key={w.id} className="as-list-row"><span className={`as-dot ${w.status === 'paused' ? 'warn' : 'ok'}`} aria-hidden /><span className="as-list-main"><strong>{w.name}</strong><span className="small muted">{w.trigger} · {w.steps.length} step{w.steps.length === 1 ? '' : 's'} · {w.status}</span></span><span className={`as-pill ${w.status === 'paused' ? '' : 'as-pill--ok'}`}>{w.status === 'paused' ? 'Paused' : 'Active'}</span></div>
                ))}
          </div>
        </div>
        <div className="as-panel">
          <div className="as-panel-head"><span className="as-panel-title"><FlaskConical size={13} aria-hidden /> Testing queue</span><span className="small muted">{agent ? `${agent.handle} · ${agent.model || 'no model'}` : 'no agent'}</span></div>
          <div className="as-list">
            {agent == null ? <div className="as-empty small muted">No agent selected.</div>
              : evals.length === 0 ? <div className="as-empty small muted">No runs yet — record one in Testing.</div>
                : evals.slice(0, 3).map((e) => (
                  <div key={e.id} className="as-list-row"><span className="as-dot ok" aria-hidden /><span className="as-list-main"><strong>{e.prompt.slice(0, 60)}{e.prompt.length > 60 ? '…' : ''}</strong><span className="small muted">{timeAgo(e.createdAt)} · {e.status}</span></span><span className="as-pill as-pill--ok">{e.status}</span></div>
                ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const PROMPT_STARTER = 'You are a careful, source-grounded assistant.\n\nROLE\n- Answer only from provided Knowledge + Tools; cite sources.\n- Prefer local models; never leak private files.\n\nSTYLE\n- Concise, structured, actionable.\n- If uncertain, say so and propose next steps.\n\nVARIABLES\n{{user_goal}} {{knowledge_context}} {{tool_output}}'

function PromptWorkspace({ agent, onSaved }: { agent: StudioAgent | null; onSaved: () => void }): React.JSX.Element {
  const saved = agent?.instructions ?? ''
  const [draft, setDraft] = useState(saved || PROMPT_STARTER)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setDraft(saved || PROMPT_STARTER); setError(null) }, [agent?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = draft !== (saved || PROMPT_STARTER)
  const variables = useMemo(() => {
    const found = draft.match(/\{\{[a-zA-Z0-9_]+\}\}/g) ?? []
    return [...new Set(found)]
  }, [draft])
  const handleSave = useCallback(async () => {
    if (!agent) return
    setSaving(true)
    setError(null)
    try {
      await updateAgent(agent.id, { instructions: draft.slice(0, 20000) })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [agent, draft, onSaved])
  const handleReset = useCallback(() => { setDraft(saved || PROMPT_STARTER); setError(null) }, [saved])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><PenLine size={13} aria-hidden /> Prompt editor</span><span className="small muted">Markdown · variables · versioned{dirty ? ' · unsaved changes' : ''}</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sm" onClick={handleReset}>Reset</button><button type="button" className="btn btn-sm primary" disabled={saving} onClick={() => void handleSave()}>{saving ? 'Saving…' : 'Save new version'}</button></div>
      {error ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)', margin: '0 12px' }}><AlertTriangle size={12} aria-hidden /><span>{error}</span></div> : null}
      <div className="as-prompt-grid">
        <div className="as-editor">
          <div className="as-editor-bar"><span className="small muted">system.md</span><span className="as-token-count">{draft.length} chars · ~{Math.ceil(draft.length / 4)} tokens</span></div>
          <textarea className="as-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} spellCheck={false} aria-label="Agent instructions" />
          <div className="as-editor-foot"><span className="small muted">{variables.length > 0 ? `Variables: ${variables.join(' ')}` : 'No {{variables}} detected'}</span></div>
        </div>
        <div className="as-preview">
          <div className="as-preview-head"><MessageSquare size={12} aria-hidden /> Live preview <span className="as-pill">draft text</span></div>
          <pre className="as-code" style={{ whiteSpace: 'pre-wrap' }}>{draft.slice(0, 1200)}{draft.length > 1200 ? '\n…(truncated)' : ''}</pre>
          <div className="as-preview-meta small muted">Preview renders the saved draft · saving creates a real version snapshot</div>
        </div>
      </div>
    </div>
  )
}

function KnowledgeWorkspace({ agent }: { agent: StudioAgent | null }): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { items, loading, reload } = useAgentCollection<KnowledgeFile>(agent?.id ?? null, fetchKnowledge)
  const [error, setError] = useState<string | null>(null)
  const files = items.filter((f) => !filter || f.name.toLowerCase().includes(filter.toLowerCase()))
  const selected = items.find((f) => f.id === selectedId) ?? files[0] ?? null
  const handleFiles = useCallback(async (list: FileList | null) => {
    if (!agent || !list) return
    setError(null)
    try {
      for (const file of Array.from(list)) {
        await addKnowledge(agent.id, { name: file.name, sizeBytes: file.size, mime: file.type || undefined })
      }
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [agent, reload])
  const handleRemove = useCallback(async (id: string) => {
    try {
      await removeKnowledge(id)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [reload])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar">
        <span className="as-ws-title"><FolderOpen size={13} aria-hidden /> Knowledge explorer</span>
        <span className="small muted">Per-agent registry · files are registered, not yet RAG-indexed</span>
        <span style={{ flex: 1 }} />
        <div className="as-search"><Search size={12} aria-hidden /><input className="as-search-input" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter knowledge" /></div>
        <label className="btn btn-sm primary" style={{ cursor: 'pointer' }}><Upload size={12} aria-hidden /> Add files<input type="file" multiple hidden onChange={(e) => { void handleFiles(e.target.files); e.target.value = '' }} aria-label="Add knowledge files" /></label>
      </div>
      {error ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)', margin: '0 12px' }}><AlertTriangle size={12} aria-hidden /><span>{error}</span></div> : null}
      <div className="as-kb-grid">
        <div className="as-file-list" role="list">
          {loading ? <div className="as-empty small muted">Loading knowledge…</div>
            : files.length === 0 ? <div className="as-empty small muted">{items.length === 0 ? 'No knowledge files yet — add files to register them for this agent.' : 'No files match.'}</div>
              : files.map((f) => (
                <div key={f.id} className="as-file-row" role="listitem">
                  <span className="as-file-icon"><File size={14} aria-hidden /></span>
                  <span className="as-file-main"><strong>{f.name}</strong><span className="small muted">{f.mime ?? 'file'} · {formatBytes(f.sizeBytes)}</span></span>
                  <span className="as-pill">{f.status}</span>
                  <button type="button" className="btn btn-sm ghost" onClick={() => setSelectedId(f.id)}>View</button>
                  <button type="button" className="as-icon-btn" aria-label={`Remove ${f.name}`} onClick={() => void handleRemove(f.id)}><Trash2 size={12} aria-hidden /></button>
                </div>
              ))}
          <div className="as-drop">Registered files stay scoped to @{agent.handle} · RAG indexing arrives with the retrieval backend</div>
        </div>
        <div className="as-file-preview">
          {selected ? (
            <>
              <div className="as-preview-head"><FileText size={12} aria-hidden /> Preview — {selected.name} <span className="as-pill as-pill--ok">{selected.status}</span></div>
              <pre className="as-code">name: {selected.name}{'\n'}size: {formatBytes(selected.sizeBytes)}{'\n'}type: {selected.mime ?? 'unknown'}{'\n'}registered: {new Date(selected.createdAt).toLocaleString()}</pre>
              <div className="as-preview-actions"><button type="button" className="btn btn-sm ghost" onClick={() => void handleRemove(selected.id)}><Trash2 size={12} aria-hidden /> Remove</button></div>
            </>
          ) : (
            <>
              <div className="as-preview-head"><FileText size={12} aria-hidden /> Preview</div>
              <div className="as-empty small muted">Select a file to inspect its registration.</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function SkillsWorkspace({ agent }: { agent: StudioAgent | null }): React.JSX.Element {
  const [skills, setSkills] = useState<Array<{ name: string; source: string; description: string }>>([])
  const [counts, setCounts] = useState<Array<{ skillName: string; runs: number }>>([])
  const [toggles, setToggles] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      try {
        const [s, c, t] = await Promise.all([fetchRealSkills(), fetchSkillRunCounts(), agent ? fetchSkillToggles(agent.id) : Promise.resolve({} as Record<string, boolean>)])
        if (!alive) return
        setSkills(s)
        setCounts(c)
        setToggles(t)
      } catch {
        if (alive) { setSkills([]); setCounts([]) }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [agent?.id])
  const runsFor = useCallback((name: string): number | null => {
    const hit = counts.find((c) => c.skillName.toLowerCase() === name.toLowerCase())
    return hit ? hit.runs : null
  }, [counts])
  const handleToggle = useCallback(async (name: string) => {
    if (!agent) return
    const next = !(toggles[name] ?? true)
    setToggles((prev) => ({ ...prev, [name]: next }))
    try {
      await setSkillToggle(agent.id, name, next)
    } catch {
      // keep optimistic UI; persisted on next successful write
    }
  }, [agent, toggles])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Sparkles size={13} aria-hidden /> Skills</span><span className="small muted">Discovered skills · run counts from real read_skill events · toggle per agent</span></div>
      {loading ? <div className="as-panel" style={{ margin: '0 12px', padding: 16 }}><span className="small muted">Loading skills…</span></div>
        : skills.length === 0 ? <div className="as-panel" style={{ margin: '0 12px', padding: 16, textAlign: 'center' }}><div style={{ fontWeight: 700, fontSize: 13 }}>No skills discovered yet</div><div className="small muted">Skills appear here once the skills scanner finds them.</div></div>
          : (
            <div className="as-cards">
              {skills.map((s) => {
                const on = toggles[s.name] ?? true
                const runs = runsFor(s.name)
                return (
                  <div key={`${s.source}:${s.name}`} className="as-card">
                    <div className="as-card-head"><span className="as-card-icon"><Sparkles size={14} aria-hidden /></span><span className="as-card-title">{s.name}</span><button type="button" className={`as-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={`Toggle ${s.name}`} onClick={() => void handleToggle(s.name)}><span className="as-toggle-thumb" /></button></div>
                    <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>{s.description || `Source: ${s.source}`}</p>
                    <div className="as-card-foot"><span className="small muted">{runs == null ? 'No runs yet' : `${runs} run${runs === 1 ? '' : 's'}`}</span><span className="small muted">{s.source}</span></div>
                  </div>
                )
              })}
            </div>
          )}
    </div>
  )
}

function McpWorkspace(): React.JSX.Element {
  const [servers, setServers] = useState<McpServerView[]>([])
  const [dir, setDir] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [url, setUrl] = useState('')
  const [installing, setInstalling] = useState(false)
  const [steps, setSteps] = useState<string[]>([])
  const [installError, setInstallError] = useState<string | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [list, d] = await Promise.all([listMcpServers(), getMcpDir()])
      setServers(list)
      setDir(d.path)
    } catch {
      // keep previous
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Poll status every 10s for probing/installing servers
    const id = window.setInterval(() => { void refresh() }, 10000)
    return () => window.clearInterval(id)
  }, [refresh])

  const active = servers.filter((s) => s.enabled && s.status === 'connected').length
  const issues = servers.filter((s) => s.status === 'error').length
  const installingCount = servers.filter((s) => s.status === 'installing').length

  const isValidUrl = useMemo(() => {
    if (!url.trim()) return false
    try {
      const u = new URL(url.trim())
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname === 'github.com' && u.pathname.split('/').filter(Boolean).length >= 2
    } catch { return false }
  }, [url])

  const handleInstall = useCallback(async () => {
    if (!isValidUrl || installing) return
    setInstalling(true)
    setInstallError(null)
    setSteps([`AI agent: analyzing ${url.trim()}`, 'Resolving repository…'])
    try {
      const res = await installMcpFromUrl(url.trim())
      setSteps(res.steps)
      setUrl('')
      await refresh()
    } catch (e) {
      setInstallError(e instanceof Error ? e.message : String(e))
      setSteps((prev) => [...prev, `Failed: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setInstalling(false)
    }
  }, [url, isValidUrl, installing, refresh])

  const handleToggle = useCallback(async (s: McpServerView) => {
    setActionId(s.id)
    try {
      await toggleMcpServer(s.id, !s.enabled)
      await refresh()
    } finally { setActionId(null) }
  }, [refresh])

  const handleProbe = useCallback(async (s: McpServerView) => {
    setActionId(s.id)
    try {
      await probeMcpServer(s.id)
      await refresh()
    } finally { setActionId(null) }
  }, [refresh])

  const handleRemove = useCallback(async (s: McpServerView) => {
    if (!window.confirm(`Remove ${s.name}? This will delete its folder ${s.localPath ?? ''} and cannot be undone.`)) return
    setActionId(s.id)
    try {
      await removeMcpServer(s.id)
      await refresh()
    } finally { setActionId(null) }
  }, [refresh])

  const handleOpenFolder = useCallback(async () => {
    try { await openMcpFolder() } catch {}
  }, [])

  const handleCopyPath = useCallback((p: string) => {
    try { void navigator.clipboard?.writeText?.(p) } catch {}
  }, [])

  if (loading) {
    return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">Loading Connected Apps…</span></div></div>
  }

  return (
    <div className="as-ws">
      {/* Professional header */}
      <div className="as-ws-toolbar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="as-ws-title"><Plug2 size={14} aria-hidden /> Connected Apps — MCP only</span>
          <span className="as-pill">Global MCP folder</span>
          <span style={{ flex: 1 }} />
          <span className="as-pill as-pill--ok">{active} activated</span>
          {issues ? <span className="as-pill" style={{ background: 'rgba(239,68,68,.08)', borderColor: 'rgba(239,68,68,.22)', color: 'var(--danger)' }}>{issues} issue{issues>1?'s':''}</span> : null}
          {installingCount ? <span className="as-pill" style={{ background: 'rgba(245,158,11,.10)', borderColor: 'rgba(245,158,11,.24)', color: '#92400e' }}>{installingCount} installing</span> : null}
          <span className="as-pill">{servers.length} total</span>
        </div>
        <div className="small muted" style={{ lineHeight: 1.5 }}>Every MCP is installed into the <strong>global MCP folder</strong> and stays connected for all future sessions. Statuses: <span style={{ color: '#166534' }}>● Activated</span> · <span style={{ color: 'var(--muted)' }}>● Disabled</span> · <span style={{ color: '#dc2626' }}>● Issue</span> · <span style={{ color: '#92400e' }}>● Installing/Probing</span> — each server is isolated per agent.</div>
      </div>

      {/* Global MCP Folder — the source of truth */}
      <div className="as-panel" style={{ margin: '0 12px' }}>
        <div className="as-panel-head">
          <span className="as-panel-title"><FolderOpen size={13} aria-hidden /> Global MCP folder</span>
          <button type="button" className="btn btn-sm ghost" onClick={handleOpenFolder}><ExternalLink size={12} aria-hidden /> Open folder</button>
        </div>
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="as-code" style={{ flex: 1, minWidth: 200, wordBreak: 'break-all', padding: '6px 10px' }}>{dir || '—'}</span>
            <button type="button" className="btn btn-sm" onClick={handleOpenFolder}>Open</button>
            <button type="button" className="btn btn-sm ghost" onClick={() => handleCopyPath(dir)}>Copy path</button>
          </div>
          <div className="small muted" style={{ lineHeight: 1.5 }}>All MCP repositories are cloned here as <code>mcp/&lt;repo&gt;</code>. The folder is created automatically; you can browse it in your file manager. Deleting an MCP also removes its folder.</div>
        </div>
      </div>

      {/* AI Agent URL Install — replaces the old transport-type form */}
      <div className="as-panel" style={{ margin: '0 12px' }}>
        <div className="as-panel-head">
          <span className="as-panel-title"><GitBranch size={13} aria-hidden /> Install via AI Agent — paste a repository URL</span>
          <span className="small muted">No manual command/transport needed</span>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 280, position: 'relative', display: 'flex', alignItems: 'center' }}>
              <GitBranch size={13} aria-hidden style={{ position: 'absolute', left: 9, color: 'var(--muted-2)', pointerEvents: 'none' }} />
              <input
                className="as-input"
                style={{ paddingLeft: 28 }}
                placeholder="https://github.com/owner/mcp-repo"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && isValidUrl && !installing) void handleInstall() }}
                aria-label="MCP repository URL"
                inputMode="url"
                autoComplete="off"
              />
            </div>
            <button type="button" className="btn primary" disabled={!isValidUrl || installing} onClick={() => void handleInstall()}>
              {installing ? <><span className="spin" style={{ display: 'inline-block' }}><Activity size={12} aria-hidden /></span> AI installing…</> : <><Sparkles size={12} aria-hidden /> Install via AI Agent</>}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="small muted">Examples:</span>
            {['https://github.com/modelcontextprotocol/servers', 'https://github.com/anthropics/mcp-hello-world', 'https://github.com/notionhq/notion-mcp-server'].map((ex) => (
              <button key={ex} type="button" className="as-pill" style={{ cursor: 'pointer', background: 'var(--panel-2)' }} onClick={() => setUrl(ex)}>{ex.replace('https://github.com/', '')}</button>
            ))}
          </div>
          {installError ? <div className="as-callout" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)' }}><AlertTriangle size={12} aria-hidden /><span>{installError}</span></div> : null}
          {steps.length ? (
            <div className="as-panel" style={{ background: 'var(--bg-soft)', borderStyle: 'dashed' }}>
              <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={12} aria-hidden /><span className="small" style={{ fontWeight: 700 }}>AI agent log</span><span className="small muted" style={{ marginLeft: 'auto' }}>{installing ? 'Running…' : 'Done'}</span></div>
              <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto', font: '11px/1.5 ui-monospace, monospace' }}>
                {steps.map((s, i) => <div key={i} style={{ color: s.startsWith('Failed') || s.startsWith('Clone note') ? 'var(--danger)' : 'var(--muted)', whiteSpace: 'pre-wrap' }}>› {s}</div>)}
              </div>
            </div>
          ) : (
            <div className="as-callout small"><Sparkles size={12} aria-hidden /> The AI agent will: clone the repo into <code>mcp/</code> → read <code>package.json</code>/<code>README</code> → detect the MCP command (<code>npx -y …</code> / <code>python …</code>) → run <code>npm install</code> → register &amp; probe — so it works in every future session without you writing a command.</div>
          )}
        </div>
      </div>

      {/* Installed MCPs — professional status grid */}
      {servers.length === 0 ? (
        <div className="as-panel" style={{ margin: '0 12px', padding: 16, textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <Plug2 size={20} aria-hidden style={{ color: 'var(--muted-2)' }} />
            <div style={{ fontWeight: 700, fontSize: 13 }}>No MCPs connected yet</div>
            <div className="small muted" style={{ maxWidth: 520 }}>Paste a GitHub URL above and let the AI agent set it up in the global MCP folder. It will be probed and show <span style={{ color: '#166534' }}>Activated</span> when ready.</div>
          </div>
        </div>
      ) : (
        <div className="as-cards" style={{ paddingTop: 0 }}>
          {servers.map((s) => {
            const status = s.status ?? (s.enabled ? 'connected' : 'disconnected')
            const statusLabel = status === 'connected' ? 'Activated' : status === 'error' ? 'Issue' : status === 'probing' ? 'Probing' : status === 'installing' ? 'Installing' : status === 'disconnected' ? 'Disabled' : status
            const statusClass = status === 'connected' ? 'as-pill--ok' : status === 'error' ? '' : status === 'installing' || status === 'probing' ? '' : ''
            const statusStyle = status === 'error' ? { background: 'rgba(239,68,68,.08)', borderColor: 'rgba(239,68,68,.22)', color: 'var(--danger)' } as const : status === 'installing' || status === 'probing' ? { background: 'rgba(245,158,11,.10)', borderColor: 'rgba(245,158,11,.24)', color: '#92400e' } as const : undefined
            return (
              <div key={s.id} className="as-card" style={{ opacity: status === 'installing' ? 0.9 : 1 }}>
                <div className="as-card-head">
                  <span className="as-card-icon"><Plug2 size={14} aria-hidden /></span>
                  <span className="as-card-title" style={{ fontSize: 13 }}>{s.name}</span>
                  <span className={`as-pill ${statusClass}`} style={statusStyle}>{statusLabel}</span>
                </div>
                <div className="small muted" style={{ lineHeight: 1.4 }}>By {s.provider} · {s.transport} · <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{s.command ?? s.endpoint ?? '—'}</span></div>
                {s.url ? <div className="small" style={{ wordBreak: 'break-all', color: 'var(--muted)', fontSize: 11 }}><ExternalLink size={10} aria-hidden /> {s.url}</div> : null}
                {s.localPath ? <div className="small" style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--muted-2)' }}>{s.localPath}</div> : null}
                {s.lastError ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)', padding: '6px 8px' }}><AlertTriangle size={11} aria-hidden /><span>{s.lastError}</span></div> : null}
                <div className="as-card-meta small muted" style={{ marginTop: 2 }}>
                  <span>{s.enabled ? 'Enabled' : 'Disabled'}</span><span>·</span><span>{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" disabled={actionId === s.id} onClick={() => void handleToggle(s)}>{s.enabled ? 'Disable' : 'Enable'}</button>
                  <button type="button" className="btn btn-sm ghost" disabled={actionId === s.id} onClick={() => void handleProbe(s)}><Activity size={11} aria-hidden /> Probe</button>
                  <button type="button" className="btn btn-sm ghost" onClick={() => { if (s.localPath) handleCopyPath(s.localPath) }}>Copy path</button>
                  <button type="button" className="btn btn-sm ghost" style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,.18)' }} disabled={actionId === s.id} onClick={() => void handleRemove(s)}><Trash2 size={11} aria-hidden /></button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="as-panel" style={{ margin: '0 12px' }}>
        <div className="as-panel-head"><span className="as-panel-title"><Layers size={13} aria-hidden /> Tool manifest</span><span className="small muted">{servers.filter((s) => s.enabled && s.status === 'connected').length} active servers → tools</span></div>
        <div style={{ padding: 12 }} className="small muted">{servers.filter((s) => s.enabled && s.status === 'connected').length === 0 ? 'No active MCP tools. Install a repository above and enable it — the AI will wire the tools for future sessions.' : `Active MCPs expose tools as mcp_<name> — available to the agent in every session via the global folder ${dir || 'mcp/'}.`}</div>
      </div>
    </div>
  )
}

function ToolsWorkspace(): React.JSX.Element {
  const [tools, setTools] = useState<Array<{ name: string; toolset: string; description: string }>>([])
  const [counts, setCounts] = useState<Array<{ name: string; total: number; last7d: number }>>([])
  const [webSearch, setWebSearch] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [t, c, w] = await Promise.all([fetchRealTools(), fetchToolCallCounts(), fetchWebSearchEnabled()])
        if (!alive) return
        setTools(t)
        setCounts(c.byTool)
        setWebSearch(w)
      } catch {
        if (alive) { setTools([]); setCounts([]) }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])
  const countFor = useCallback((name: string): number | null => {
    const hit = counts.find((c) => c.name === name)
    return hit ? hit.last7d : null
  }, [counts])
  const detail = selected ? tools.find((t) => t.name === selected) : null
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Wrench size={13} aria-hidden /> Tools</span><span className="small muted">Registered functions · call counts from real tool/call events (7d)</span></div>
      {webSearch === false ? <div className="as-callout small" style={{ margin: '0 12px' }}><AlertTriangle size={12} aria-hidden /><span>Web tools are registered but Web search is off — enable it in Settings → Agent to use web_search / web_fetch.</span></div> : null}
      {loading ? <div className="as-panel" style={{ margin: '0 12px', padding: 16 }}><span className="small muted">Loading tools…</span></div>
        : tools.length === 0 ? <div className="as-panel" style={{ margin: '0 12px', padding: 16, textAlign: 'center' }}><div style={{ fontWeight: 700, fontSize: 13 }}>No tools registered</div><div className="small muted">Tools appear here once the runtime registers them.</div></div>
          : (
            <div className="as-table-wrap"><table className="as-table"><thead><tr><th>Tool</th><th>Origin</th><th>Registered</th><th>Calls (7d)</th><th /></tr></thead><tbody>
              {tools.map((t) => {
                const calls = countFor(t.name)
                return (
                  <tr key={t.name}>
                    <td className="as-strong"><Wrench size={11} aria-hidden /> {t.name}</td>
                    <td className="small muted">{t.toolset}</td>
                    <td><span className="as-pill as-pill--ok">Available</span></td>
                    <td className="small">{calls == null ? <span className="muted">—</span> : calls}</td>
                    <td><button type="button" className="btn btn-sm ghost" onClick={() => setSelected(selected === t.name ? null : t.name)}>View</button></td>
                  </tr>
                )
              })}
            </tbody></table></div>
          )}
      {detail ? <div className="as-panel" style={{ margin: '0 12px' }}><div className="as-panel-head"><span className="as-panel-title"><Wrench size={13} aria-hidden /> {detail.name}</span><button type="button" className="btn btn-sm ghost" onClick={() => setSelected(null)}><X size={12} aria-hidden /></button></div><div style={{ padding: 12 }} className="small">{detail.description || 'No description.'}</div></div> : null}
    </div>
  )
}

function MemoryWorkspace({ agent, onChanged }: { agent: StudioAgent | null; onChanged: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { items, loading, reload } = useAgentCollection<MemoryEntry>(agent?.id ?? null, fetchMemories)
  const filtered = items.filter((m) => !query || m.content.toLowerCase().includes(query.toLowerCase()))
  const handleAdd = useCallback(async () => {
    if (!agent || !draft.trim()) return
    setError(null)
    try {
      await addMemory(agent.id, draft)
      setDraft('')
      await reload()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [agent, draft, reload, onChanged])
  const handleRemove = useCallback(async (id: string) => {
    try {
      await removeMemory(id)
      await reload()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [reload, onChanged])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Brain size={13} aria-hidden /> Memory inspector</span><span className="small muted">Long-term preferences & facts — scoped to @{agent.handle}</span><span style={{ flex: 1 }} /><div className="as-search"><Search size={12} aria-hidden /><input className="as-search-input" placeholder="Search memories" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search memories" /></div></div>
      {error ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)', margin: '0 12px' }}><AlertTriangle size={12} aria-hidden /><span>{error}</span></div> : null}
      <div style={{ display: 'flex', gap: 8, padding: '0 12px', flexWrap: 'wrap' }}>
        <input className="as-input" style={{ flex: 1, minWidth: 220 }} placeholder="Add a memory — e.g. prefers concise answers" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd() }} aria-label="New memory" />
        <button type="button" className="btn btn-sm primary" disabled={!draft.trim()} onClick={() => void handleAdd()}><Plus size={12} aria-hidden /> Add</button>
      </div>
      {loading ? <div className="as-panel" style={{ margin: '0 12px', padding: 16 }}><span className="small muted">Loading memories…</span></div>
        : filtered.length === 0 ? <div className="as-panel" style={{ margin: '0 12px', padding: 16, textAlign: 'center' }}><div className="small muted">{items.length === 0 ? 'No memories yet — add the first one above.' : 'No memories match.'}</div></div>
          : (
            <div className="as-table-wrap"><table className="as-table"><thead><tr><th>Memory</th><th>Source</th><th>Added</th><th /></tr></thead><tbody>
              {filtered.map((m) => (
                <tr key={m.id}><td className="small">{m.content}</td><td className="small muted">{m.source}</td><td className="small muted">{timeAgo(m.createdAt)}</td><td><button type="button" className="as-icon-btn" aria-label="Remove memory" onClick={() => void handleRemove(m.id)}><X size={12} aria-hidden /></button></td></tr>
              ))}
            </tbody></table></div>
          )}
      <div className="as-callout small"><Brain size={12} aria-hidden /> Memories persist per agent — snapshots appear in Versions when the agent is saved.</div>
    </div>
  )
}

function WorkflowsWorkspace({ agent }: { agent: StudioAgent | null }): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [stepDraft, setStepDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { items, loading, reload } = useAgentCollection<Workflow>(agent?.id ?? null, fetchWorkflows)
  const selected = items.find((w) => w.id === selectedId) ?? null
  useEffect(() => {
    if (selectedId && !items.some((w) => w.id === selectedId)) setSelectedId(null)
  }, [items, selectedId])
  const handleCreate = useCallback(async () => {
    if (!agent) return
    setError(null)
    try {
      const wf = await createWorkflow(agent.id)
      await reload()
      setSelectedId(wf.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [agent, reload])
  const handleAddStep = useCallback(async () => {
    if (!selected || !stepDraft.trim()) return
    setError(null)
    try {
      await updateWorkflow(selected.id, { steps: [...selected.steps, stepDraft.trim().slice(0, 200)] })
      setStepDraft('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [selected, stepDraft, reload])
  const handleRemoveStep = useCallback(async (idx: number) => {
    if (!selected) return
    try {
      await updateWorkflow(selected.id, { steps: selected.steps.filter((_, i) => i !== idx) })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [selected, reload])
  const handleToggleStatus = useCallback(async (w: Workflow) => {
    try {
      await updateWorkflow(w.id, { status: w.status === 'paused' ? 'active' : 'paused' })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [reload])
  const handleTrigger = useCallback(async (w: Workflow, trigger: WorkflowTrigger) => {
    try {
      await updateWorkflow(w.id, { trigger })
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [reload])
  const handleRemove = useCallback(async (id: string) => {
    try {
      await removeWorkflow(id)
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [reload])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><WorkflowIcon size={13} aria-hidden /> Workflow builder</span><span className="small muted">Trigger: manual · schedule · webhook — no fabricated runs</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sm primary" onClick={() => void handleCreate()}><Plus size={12} aria-hidden /> New workflow</button></div>
      {error ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)', margin: '0 12px' }}><AlertTriangle size={12} aria-hidden /><span>{error}</span></div> : null}
      <div className="as-workflow">
        <div className="as-workflow-canvas" aria-label="Workflow canvas">
          {selected == null ? <div className="as-empty small muted">{items.length === 0 ? 'No workflows yet — create one to design its steps.' : 'Select a workflow to see its steps.'}</div>
            : selected.steps.length === 0 ? <div className="as-empty small muted">No steps yet — add the first step below.</div>
              : selected.steps.map((s, i) => (
                <span key={i} style={{ display: 'contents' }}>
                  {i > 0 ? <div className="as-wf-edge" aria-hidden /> : null}
                  <div className="as-wf-node"><span>{s}</span><button type="button" className="as-icon-btn" aria-label={`Remove step ${s}`} onClick={() => void handleRemoveStep(i)}><X size={10} aria-hidden /></button></div>
                </span>
              ))}
        </div>
        <div className="as-workflow-list">
          {loading ? <div className="as-empty small muted">Loading workflows…</div>
            : items.length === 0 ? <div className="as-empty small muted">No workflows yet.</div>
              : items.map((w) => (
                <div key={w.id} className="as-list-row"><span className={`as-dot ${w.status === 'paused' ? 'warn' : 'ok'}`} aria-hidden /><span className="as-list-main"><strong>{w.name}</strong><span className="small muted">{w.trigger} · {w.steps.length} step{w.steps.length === 1 ? '' : 's'} · {w.status}</span></span><button type="button" className="btn btn-sm" onClick={() => setSelectedId(w.id)}>Open</button></div>
              ))}
        </div>
      </div>
      {selected ? (
        <div className="as-panel" style={{ margin: '0 12px' }}>
          <div className="as-panel-head"><span className="as-panel-title">{selected.name}</span><span className={`as-pill ${selected.status === 'paused' ? '' : 'as-pill--ok'}`}>{selected.status}</span></div>
          <div style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="as-input" style={{ flex: 1, minWidth: 200 }} placeholder="Add a step — e.g. Search" value={stepDraft} onChange={(e) => setStepDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleAddStep() }} aria-label="New workflow step" />
            <button type="button" className="btn btn-sm primary" disabled={!stepDraft.trim()} onClick={() => void handleAddStep()}><Plus size={12} aria-hidden /> Add step</button>
            <select className="as-input" style={{ width: 'auto' }} value={selected.trigger} onChange={(e) => void handleTrigger(selected, e.target.value as WorkflowTrigger)} aria-label="Workflow trigger">
              <option value="manual">manual</option>
              <option value="schedule">schedule</option>
              <option value="webhook">webhook</option>
            </select>
            <button type="button" className="btn btn-sm ghost" onClick={() => void handleToggleStatus(selected)}>{selected.status === 'paused' ? <><Play size={11} aria-hidden /> Resume</> : <><Pause size={11} aria-hidden /> Pause</>}</button>
            <button type="button" className="btn btn-sm ghost" style={{ color: 'var(--danger)' }} onClick={() => void handleRemove(selected.id)}><Trash2 size={11} aria-hidden /> Delete</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TestingWorkspace({ agent }: { agent: StudioAgent | null }): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { items: evals, reload } = useAgentCollection<EvalRun>(agent?.id ?? null, fetchEvals)
  const handleRun = useCallback(async () => {
    if (!agent || !prompt.trim() || running) return
    setRunning(true)
    setError(null)
    try {
      await recordEval(agent.id, prompt)
      setPrompt('')
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }, [agent, prompt, running, reload])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-testing">
        <div className="as-testing-chat">
          <div className="as-testing-head"><TestTube2 size={13} aria-hidden /> Playground <span className="as-pill">local · recorded runs only</span></div>
          {error ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)' }}><AlertTriangle size={12} aria-hidden /><span>{error}</span></div> : null}
          <div className="as-testing-input"><input className="as-input" placeholder="Test a prompt…" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleRun() }} aria-label="Test prompt" /><button type="button" className="btn btn-sm primary" disabled={!prompt.trim() || running} onClick={() => void handleRun()}>{running ? 'Recording…' : 'Run'}</button></div>
          <div className="small muted" style={{ lineHeight: 1.5 }}>Runs are recorded with timestamp only — model scoring arrives with the eval backend.</div>
        </div>
        <div className="as-testing-evals">
          <div className="as-panel"><div className="as-panel-head"><span className="as-panel-title"><Gauge size={13} aria-hidden /> Evaluation</span><span className="small muted">{evals.length === 0 ? 'no recorded runs' : `${evals.length} recorded run${evals.length === 1 ? '' : 's'}`}</span></div>
            {evals.length === 0 ? <div style={{ padding: '10px 14px' }} className="small muted">No eval runs yet — record one in the playground. Scores appear here only from real scored runs.</div>
              : (
                <div className="as-eval-grid">
                  <div className="as-eval"><span className="small muted">Recorded runs</span><span className="as-eval-val">{evals.length}</span></div>
                  <div className="as-eval"><span className="small muted">Last run</span><span className="as-eval-val">{timeAgo(evals[0]?.createdAt ?? Date.now())}</span></div>
                  <div className="as-eval"><span className="small muted">Scored runs</span><span className="as-eval-val">0</span></div>
                </div>
              )}
          </div>
          <div className="as-panel"><div className="as-panel-head"><span className="as-panel-title"><History size={13} aria-hidden /> Recent runs</span></div><div className="as-list">
            {evals.length === 0 ? <div className="as-empty small muted">No eval runs yet — use the playground above.</div>
              : evals.slice(0, 5).map((e) => (
                <div key={e.id} className="as-list-row"><span className="as-dot ok" aria-hidden /><span className="as-list-main"><strong>{e.prompt.slice(0, 60)}{e.prompt.length > 60 ? '…' : ''}</strong><span className="small muted">{timeAgo(e.createdAt)}</span></span><span className="as-pill as-pill--ok">{e.status}</span></div>
              ))}
          </div></div>
        </div>
      </div>
    </div>
  )
}

function AnalyticsWorkspace(): React.JSX.Element {
  const stats = useUsageStats()
  return (
    <div className="as-ws">
      <div className="as-metrics">
        <div className="as-metric"><div className="as-metric-head"><span className="as-metric-icon"><BarChart3 size={14} aria-hidden /></span><span className="as-metric-label">Messages (7d)</span></div><div className="as-metric-value">{stats.loading ? '…' : stats.last7d.reduce((a, b) => a + b, 0)}</div>
          <MetricOrEmpty stats={stats}>{(s) => <div className="as-metric-foot"><span className="small muted">from local session events</span><Sparkline values={s.last7d.length >= 2 ? s.last7d : [0, 0]} /></div>}</MetricOrEmpty></div>
        <div className="as-metric"><div className="as-metric-head"><span className="as-metric-icon"><CheckCircle2 size={14} aria-hidden /></span><span className="as-metric-label">Errors</span></div><div className="as-metric-value">{stats.loading ? '…' : stats.errors}</div>
          <MetricOrEmpty stats={stats}>{(s) => <div className="as-metric-foot"><span className="small muted">error events across recent sessions</span><Sparkline values={s.last7d.length >= 2 ? s.last7d : [0, 0]} color="#22c55e" /></div>}</MetricOrEmpty></div>
        <div className="as-metric"><div className="as-metric-head"><span className="as-metric-icon"><Clock3 size={14} aria-hidden /></span><span className="as-metric-label">Total messages</span></div><div className="as-metric-value">{stats.loading ? '…' : stats.totalMessages}</div>
          <MetricOrEmpty stats={stats}>{(s) => <div className="as-metric-foot"><span className="small muted">avg {s.avgChars} chars per message</span></div>}</MetricOrEmpty></div>
      </div>
      <div className="as-panel"><div className="as-panel-head"><span className="as-panel-title"><BarChart3 size={13} aria-hidden /> Usage</span><span className="small muted">derived live from persisted session events — no fabricated data</span></div>
        <div className="as-metric-foot" style={{ padding: '10px 14px' }}><span className="small muted">{stats.loading ? 'Loading…' : stats.totalMessages === 0 ? 'No local runs yet — chat to populate analytics.' : `Tracking ${stats.totalMessages} messages across recent local sessions. ${stats.errors} error event${stats.errors === 1 ? '' : 's'} recorded.`}</span></div>
      </div>
    </div>
  )
}

function VersionsWorkspace({ agent, onRestored }: { agent: StudioAgent | null; onRestored: () => void }): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { items, loading, reload } = useAgentCollection<VersionEntry>(agent?.id ?? null, fetchVersions)
  const handleRestore = useCallback(async (v: VersionEntry) => {
    if (!agent) return
    setError(null)
    try {
      // Restore content fields only — lifecycle stays sequential, never rewound.
      await updateAgent(agent.id, { name: v.snapshot.name, description: v.snapshot.description, model: v.snapshot.model, instructions: v.snapshot.instructions })
      await reload()
      onRestored()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [agent, reload, onRestored])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><History size={13} aria-hidden /> Versions timeline</span><span className="small muted">Every save is a snapshot · content restore (lifecycle never rewinds)</span></div>
      {error ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)', margin: '0 12px' }}><AlertTriangle size={12} aria-hidden /><span>{error}</span></div> : null}
      {loading ? <div className="as-panel" style={{ margin: '0 12px', padding: 16 }}><span className="small muted">Loading versions…</span></div>
        : items.length === 0 ? <div className="as-panel" style={{ margin: '0 12px', padding: 16, textAlign: 'center' }}><div style={{ fontWeight: 700, fontSize: 13 }}>No versions yet</div><div className="small muted">Saving the agent records a real snapshot here.</div></div>
          : (
            <div className="as-timeline">
              {items.map((it, idx) => (
                <div key={it.id} className={`as-tl-row ${idx === 0 ? 'current' : ''}`}>
                  <div className="as-tl-rail"><span className="as-tl-dot" aria-hidden /><span className="as-tl-line" aria-hidden /></div>
                  <div className="as-tl-card">
                    <div className="as-tl-head"><span className="as-version">{it.version}</span>{idx === 0 ? <span className="as-pill as-pill--ok">Current</span> : null}<span className="small muted">{timeAgo(it.createdAt)}</span></div>
                    <div className="small">{it.note || 'Snapshot'}</div>
                    {expanded === it.id ? <pre className="as-code" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{JSON.stringify(it.snapshot, null, 2)}</pre> : null}
                    <div className="as-tl-actions"><button type="button" className="btn btn-sm ghost" onClick={() => setExpanded(expanded === it.id ? null : it.id)}><Eye size={12} aria-hidden /> {expanded === it.id ? 'Hide' : 'Snapshot'}</button>{idx === 0 ? <button type="button" className="btn btn-sm" disabled>Current</button> : <button type="button" className="btn btn-sm" onClick={() => void handleRestore(it)}>Restore</button>}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
    </div>
  )
}

function PermRow({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <div className="as-perm-row"><span><strong>{label}</strong>{hint ? <span className="small muted">{hint}</span> : null}</span><button type="button" className={`as-toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={onToggle}><span className="as-toggle-thumb" /></button></div>
  )
}

function PermissionsWorkspace({ agent }: { agent: StudioAgent | null }): React.JSX.Element {
  const [perms, setPerms] = useState<AgentPermissions | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      if (!agent) { if (alive) { setPerms(null); setLoading(false) } return }
      try {
        const p = await fetchPermissions(agent.id)
        if (alive) setPerms(p)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [agent?.id])
  const toggle = useCallback(async (key: keyof Omit<AgentPermissions, 'agentId'>) => {
    if (!agent || !perms) return
    const next = { ...perms, [key]: !perms[key] }
    setPerms(next)
    try {
      await savePermissions(agent.id, { [key]: next[key] })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [agent, perms])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  if (loading || !perms) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">Loading permissions…</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Shield size={13} aria-hidden /> Visual permissions</span><span className="small muted">Scopes are per-agent · persisted · no cross-agent bleed</span></div>
      {error ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)', margin: '0 12px' }}><AlertTriangle size={12} aria-hidden /><span>{error}</span></div> : null}
      <div className="as-perm-grid">
        <div className="as-perm-card">
          <div className="as-perm-head"><Lock size={12} aria-hidden /> Knowledge</div>
          <PermRow label="Read files" hint=" · RAG chunks" on={perms.knowledgeRead} onToggle={() => void toggle('knowledgeRead')} />
          <PermRow label="Write files" hint=" · ingest only" on={perms.knowledgeWrite} onToggle={() => void toggle('knowledgeWrite')} />
        </div>
        <div className="as-perm-card">
          <div className="as-perm-head"><Wrench size={12} aria-hidden /> Tools & MCP</div>
          <PermRow label="Call tools" hint=" · only enabled" on={perms.toolsCall} onToggle={() => void toggle('toolsCall')} />
          <PermRow label="Spawn MCP servers" on={perms.mcpSpawn} onToggle={() => void toggle('mcpSpawn')} />
        </div>
        <div className="as-perm-card">
          <div className="as-perm-head"><UsersRound size={12} aria-hidden /> Sharing</div>
          <PermRow label="Team visible" hint=" · under Team Agents" on={perms.teamVisible} onToggle={() => void toggle('teamVisible')} />
          <PermRow label="Allow publishing" on={perms.allowPublish} onToggle={() => void toggle('allowPublish')} />
        </div>
      </div>
      <div className="as-callout small"><ShieldCheck size={12} aria-hidden /> Private by default — even team members cannot see drafts until you publish.</div>
    </div>
  )
}

function SettingsWorkspace({ agent, onChanged, onDeleted }: { agent: StudioAgent | null; onChanged: () => void; onDeleted: () => void }): React.JSX.Element {
  const [name, setName] = useState(agent?.name ?? '')
  const [handle, setHandle] = useState(agent?.handle ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [model, setModel] = useState(agent?.model ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  useEffect(() => {
    setName(agent?.name ?? '')
    setHandle(agent?.handle ?? '')
    setDescription(agent?.description ?? '')
    setModel(agent?.model ?? '')
    setError(null)
    setSavedNote(null)
  }, [agent?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const handleSave = useCallback(async () => {
    if (!agent) return
    const err = validateAgentForm({ handle, name, description })
    if (err) { setError(err); return }
    if (handle.trim() !== agent.handle) { setError('Handle is immutable after creation — duplicate the agent to rename it.'); return }
    setSaving(true)
    setError(null)
    setSavedNote(null)
    try {
      await updateAgent(agent.id, { name: name.trim(), description: description.slice(0, 500), model: model.slice(0, 256) })
      setSavedNote(`Saved ${new Date().toLocaleTimeString()} — snapshot recorded in Versions.`)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [agent, handle, name, description, model, onChanged])
  const handleDelete = useCallback(async () => {
    if (!agent) return
    if (!window.confirm(`Delete ${agent.name}? Versions, memories and workflows are removed. Knowledge files stay on disk.`)) return
    try {
      await removeAgent(agent.id)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [agent, onDeleted])
  const handleArchive = useCallback(async (archived: boolean) => {
    if (!agent) return
    setError(null)
    try {
      await setArchived(agent.id, archived)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [agent, onChanged])
  if (!agent) return <div className="as-ws"><div className="as-panel" style={{ padding: 16 }}><span className="small muted">No agent selected.</span></div></div>
  return (
    <div className="as-ws">
      <div className="as-form">
        {error ? <div className="as-callout small" style={{ background: 'rgba(239,68,68,.06)', borderColor: 'rgba(239,68,68,.22)' }}><AlertTriangle size={12} aria-hidden /><span>{error}</span></div> : null}
        {savedNote ? <div className="as-callout small"><CheckCircle2 size={12} aria-hidden /><span>{savedNote}</span></div> : null}
        <label className="as-field"><span className="as-field-label">Agent name</span><input className="as-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Agent name" /></label>
        <label className="as-field"><span className="as-field-label">Handle (immutable)</span><input className="as-input" value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="Agent handle" /></label>
        <label className="as-field"><span className="as-field-label">Description</span><textarea className="as-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Agent description" /></label>
        <label className="as-field"><span className="as-field-label">Model</span><input className="as-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="No model selected" aria-label="Agent model" /></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm primary" disabled={saving} onClick={() => void handleSave()}>{saving ? 'Saving…' : 'Save changes'}</button>
          {agent.archived
            ? <button type="button" className="btn btn-sm" onClick={() => void handleArchive(false)}><Archive size={12} aria-hidden /> Unarchive</button>
            : <button type="button" className="btn btn-sm ghost" onClick={() => void handleArchive(true)}><Archive size={12} aria-hidden /> Archive</button>}
        </div>
        <div className="as-field"><span className="as-field-label">Danger zone</span><div className="as-danger"><span className="small">Delete this agent and its versions. Knowledge files stay on disk.</span><button type="button" className="btn btn-sm" style={{ background: 'rgba(239,68,68,.08)', borderColor: 'rgba(239,68,68,.3)', color: 'var(--danger)' }} onClick={() => void handleDelete()}><Trash2 size={12} aria-hidden /> Delete agent</button></div></div>
      </div>
    </div>
  )
}

// ── Right intelligence rail (real snapshots only) ────────────────────

function IntelRail({ agent, onNavigate }: { agent: StudioAgent | null; onNavigate: (ws: WorkspaceId) => void }): React.JSX.Element {
  const stats = useUsageStats()
  const [tools, setTools] = useState<Array<{ name: string; toolset: string }>>([])
  const [downloads, setDownloads] = useState<Array<{ modelId: string; rfilename: string; state: string; receivedBytes?: number; totalBytes?: number | null }>>([])
  const [activity, setActivity] = useState<Array<{ time: number; text: string; ok: boolean }>>([])
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [t, d, a] = await Promise.all([fetchRealTools(), fetchRealDownloads(), fetchRecentActivity(5)])
        if (!alive) return
        setTools(t)
        setDownloads(d)
        setActivity(a)
      } catch {
        // keep previous
      }
    })()
    return () => { alive = false }
  }, [])
  const mcpTools = tools.filter((t) => t.toolset === 'mcp').length
  return (
    <>
      <div className="as-intel-head">
        <span className="as-intel-title"><Hammer size={12} aria-hidden /> Intelligence</span>
      </div>

      <section className="as-intel-section" aria-label="Live status">
        <div className="as-intel-label">Live status</div>
        <div className="as-intel-card">
          {agent ? (
            <>
              <div className="as-intel-row"><CircleDot size={11} aria-hidden className="as-live-dot" /><span className="small"><strong>Idle</strong> · ready</span><span className={`as-life ${lifecycleClass(agent.lifecycle)}`} style={{ marginLeft: 'auto' }}>{lifecycleLabel(agent.lifecycle)}</span></div>
              <div className="as-intel-row small muted"><Bot size={11} aria-hidden /> {agent.model || 'No model selected'} · {agent.id}</div>
              <div className="as-intel-row small muted"><Clock3 size={11} aria-hidden /> Updated {timeAgo(agent.updatedAt)} · local run</div>
              <div className="as-intel-row"><span className="as-dot ok" aria-hidden /><span className="small">{stats.loading ? 'Reading local history…' : stats.totalMessages === 0 ? 'No local runs yet' : `${stats.totalMessages} messages in recent sessions`}</span></div>
            </>
          ) : (
            <div className="as-intel-row small muted">No agent selected.</div>
          )}
        </div>
      </section>

      <section className="as-intel-section" aria-label="Active tools">
        <div className="as-intel-label">Active tools{tools.length > 0 ? ` · ${tools.length}` : ''}</div>
        <div className="as-intel-card">
          {tools.length === 0 ? <div className="small muted">No tools registered yet.</div>
            : (
              <>
                {tools.slice(0, 4).map((t) => (
                  <div key={t.name} className="as-tool-row"><Wrench size={12} aria-hidden /><span className="small">{t.name}</span>{t.toolset === 'mcp' ? <span className="as-live-pill">MCP</span> : null}<CheckCircle2 size={12} aria-hidden className="as-check" /></div>
                ))}
                {mcpTools > 0 ? <div className="small muted">{mcpTools} MCP tool{mcpTools === 1 ? '' : 's'} connected</div> : null}
              </>
            )}
          <button type="button" className="btn btn-sm ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => onNavigate('tools')}><ExternalLink size={11} aria-hidden /> Manage in Tools</button>
        </div>
      </section>

      <section className="as-intel-section" aria-label="Resumable download">
        <div className="as-intel-label">Resumable download · Range</div>
        <div className="as-intel-card">
          {downloads.length === 0 ? <div className="small muted">No active downloads.</div>
            : downloads.slice(0, 2).map((d) => {
              const pct = d.totalBytes && d.totalBytes > 0 && typeof d.receivedBytes === 'number'
                ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100))
                : null
              return (
                <div key={`${d.modelId}:${d.rfilename}`}>
                  <div className="as-intel-row"><Download size={11} aria-hidden /><span className="small"><strong>{d.rfilename}</strong> · {d.state}</span></div>
                  {pct != null ? (
                    <>
                      <div className="as-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Download progress"><span className="as-progress-fill" style={{ width: `${pct}%` }} /></div>
                      <div className="as-intel-row small muted"><span>{pct}%</span><span style={{ marginLeft: 'auto' }}>{d.state}</span></div>
                    </>
                  ) : null}
                </div>
              )
            })}
          <div className="small muted" style={{ lineHeight: 1.4 }}>Pause keeps <code>.part</code> · Resume sends <code>Range: bytes=…</code> · manage in Library</div>
        </div>
      </section>

      <section className="as-intel-section" aria-label="Recent activity">
        <div className="as-intel-label">Recent activity</div>
        <div className="as-intel-card as-activity">
          {activity.length === 0 ? <div className="small muted">No activity yet — chat to populate this feed.</div>
            : activity.map((a, i) => (
              <div key={i} className="as-activity-row"><span className="small muted">{timeAgo(a.time)}</span><span className="small">{a.text}</span><span className={`as-activity-dot ${a.ok ? 'ok' : 'warn'}`} aria-hidden /></div>
            ))}
          <button type="button" className="btn btn-sm ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => onNavigate('analytics')}><BarChart3 size={11} aria-hidden /> View analytics</button>
        </div>
      </section>

      <section className="as-intel-section" aria-label="System insight">
        <div className="as-intel-label">System insight</div>
        <div className="as-intel-card">
          <HardwareReco />
          <button type="button" className="btn btn-sm ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => onNavigate('analytics')}><Gauge size={11} aria-hidden /> Recommendations</button>
        </div>
      </section>

      <div className="as-intel-foot small muted">Local snapshot — refreshes when you switch agents or reload.</div>
    </>
  )
}

// ── Main studio shell ────────────────────────────────────────────

export function AgentsPage(): React.JSX.Element {
  const [nav, setNav] = useState<NavFilter>('all')
  const [agents, setAgents] = useState<StudioAgent[]>([])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ws, setWs] = useState<WorkspaceId>('overview')
  const [intelOpen, setIntelOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createHandle, setCreateHandle] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [storeTick, setStoreTick] = useState(0)

  const reloadAgents = useCallback(async () => {
    setAgentsLoading(true)
    setAgentsError(null)
    try {
      setAgents(await fetchAgents())
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : String(e))
      setAgents([])
    } finally {
      setAgentsLoading(false)
    }
  }, [])

  useEffect(() => { void reloadAgents() }, [reloadAgents])
  useEffect(() => { void reloadAgents() }, [storeTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const refreshStore = useCallback(() => { setStoreTick((n) => n + 1); void reloadAgents() }, [reloadAgents])

  const visibleAgents = useMemo(() => agents.filter((a) => !a.archived), [agents])
  const archivedAgents = useMemo(() => agents.filter((a) => a.archived), [agents])

  useEffect(() => {
    if (selectedId && visibleAgents.some((a) => a.id === selectedId)) return
    if (nav === 'archived' && archivedAgents.length > 0) {
      setSelectedId(archivedAgents[0]?.id ?? null)
      return
    }
    setSelectedId(visibleAgents[0]?.id ?? null)
  }, [visibleAgents, archivedAgents, selectedId, nav])

  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? (nav === 'archived' ? archivedAgents[0] ?? null : visibleAgents[0] ?? null),
    [agents, selectedId, nav, archivedAgents, visibleAgents],
  )

  const filtered = useMemo(() => {
    if (nav === 'archived') return archivedAgents
    if (nav === 'templates') return []
    let list = visibleAgents
    if (nav === 'favorites') list = list.filter((a) => a.fav)
    if (nav === 'team') list = list.filter((a) => a.team)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.handle.includes(q))
    }
    if (nav === 'recent') return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
    return list
  }, [nav, search, visibleAgents, archivedAgents])

  const handleCreate = useCallback(async () => {
    const err = validateAgentForm({ handle: createHandle, name: createName })
    if (err) { setCreateError(err); return }
    setCreating(true)
    setCreateError(null)
    try {
      const created = await createAgent({ name: createName.trim(), handle: createHandle.trim() })
      setCreateName('')
      setCreateHandle('')
      setShowCreate(false)
      await reloadAgents()
      setSelectedId(created.id)
      setNav('all')
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }, [createName, createHandle, reloadAgents])

  const handleDuplicate = useCallback(async () => {
    if (!selected) return
    try {
      const dup = await duplicateAgent(selected.id)
      await reloadAgents()
      setSelectedId(dup.id)
    } catch {
      // best-effort; list refresh surfaces errors
    }
  }, [selected, reloadAgents])

  const handlePublish = useCallback(async () => {
    if (!selected) return
    const next = NEXT_LIFECYCLE[selected.lifecycle]
    if (!next) return
    try {
      await updateAgent(selected.id, { lifecycle: next })
      await reloadAgents()
    } catch {
      // sequential rule enforced in the store; UI stays on current stage
    }
  }, [selected, reloadAgents])

  const handleToggleFav = useCallback(async () => {
    if (!selected) return
    try {
      await updateAgent(selected.id, { fav: !selected.fav })
      await reloadAgents()
    } catch {}
  }, [selected, reloadAgents])

  const favCount = visibleAgents.filter((a) => a.fav).length
  const teamCount = visibleAgents.filter((a) => a.team).length

  return (
    <div className={`as-shell ${intelOpen ? '' : 'as-shell--collapsed-right'}`} data-testid="agent-studio" aria-label="Agent Studio">
      {/* Left — Agent Navigator (lifecycle-aware) */}
      <nav className="as-nav" aria-label="Agent navigator">
        <button type="button" className="as-create" onClick={() => { setShowCreate((v) => !v); setCreateError(null) }} aria-label="Create new agent" aria-expanded={showCreate}><Plus size={14} aria-hidden /> Create New Agent</button>

        {showCreate ? (
          <div className="as-panel" style={{ margin: '8px', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input className="as-input" placeholder="Agent name" value={createName} onChange={(e) => setCreateName(e.target.value)} aria-label="New agent name" />
            <input className="as-input" placeholder="handle-like-this" value={createHandle} onChange={(e) => setCreateHandle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate() }} aria-label="New agent handle" />
            {createError ? <div className="small" style={{ color: 'var(--danger)' }}>{createError}</div> : null}
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-sm primary" disabled={creating} onClick={() => void handleCreate()}>{creating ? 'Creating…' : 'Create'}</button>
              <button type="button" className="btn btn-sm ghost" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        ) : null}

        <div className="as-search-wrap">
          <Search size={13} aria-hidden className="as-search-icon" />
          <input className="as-search-input" placeholder="Search agents" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search agents" />
        </div>

        <div className="as-nav-groups" role="tablist" aria-label="Agent groups">
          <div className="as-nav-section">
            <div className="as-nav-label">Workspace</div>
            <button type="button" className={`as-nav-item ${nav === 'all' ? 'active' : ''}`} onClick={() => setNav('all')} role="tab" aria-selected={nav === 'all'}><Bot size={14} aria-hidden /><span>All Agents</span><span className="as-count">{visibleAgents.length}</span></button>
            <button type="button" className={`as-nav-item ${nav === 'favorites' ? 'active' : ''}`} onClick={() => setNav('favorites')} role="tab" aria-selected={nav === 'favorites'}><Star size={14} aria-hidden /><span>Favorites</span><span className="as-count">{favCount}</span></button>
            <button type="button" className={`as-nav-item ${nav === 'recent' ? 'active' : ''}`} onClick={() => setNav('recent')} role="tab" aria-selected={nav === 'recent'}><Clock3 size={14} aria-hidden /><span>Recent</span></button>
            <button type="button" className={`as-nav-item ${nav === 'team' ? 'active' : ''}`} onClick={() => setNav('team')} role="tab" aria-selected={nav === 'team'}><UsersRound size={14} aria-hidden /><span>Team Agents</span><span className="as-count">{teamCount}</span></button>
          </div>
          <div className="as-nav-section">
            <div className="as-nav-label">Library</div>
            <button type="button" className={`as-nav-item ${nav === 'templates' ? 'active' : ''}`} onClick={() => setNav('templates')} role="tab" aria-selected={nav === 'templates'}><LayoutTemplate size={14} aria-hidden /><span>Templates</span></button>
            <button type="button" className={`as-nav-item ${nav === 'archived' ? 'active' : ''}`} onClick={() => setNav('archived')} role="tab" aria-selected={nav === 'archived'}><Archive size={14} aria-hidden /><span>Archived</span><span className="as-count">{archivedAgents.length}</span></button>
          </div>
        </div>

        <div className="as-agent-list" role="list" aria-label="Agents">
          {agentsLoading ? (
            <div className="as-empty small muted">Loading agents…</div>
          ) : agentsError ? (
            <div className="as-empty small muted">{agentsError}</div>
          ) : nav === 'templates' ? (
            <div className="as-empty"><LayoutTemplate size={18} aria-hidden /><span className="small muted">No templates yet — publish an agent to create one.</span></div>
          ) : nav === 'archived' ? (
            filtered.length === 0 ? <div className="as-empty"><Archive size={18} aria-hidden /><span className="small muted">No archived agents.</span></div>
              : filtered.map((a) => (
                <button key={a.id} type="button" role="listitem" className={`as-agent ${selected?.id === a.id ? 'active' : ''}`} onClick={() => setSelectedId(a.id)} aria-current={selected?.id === a.id ? 'true' : undefined} aria-label={`Open ${a.name}`}>
                  <span className="as-avatar" style={{ borderColor: selected?.id === a.id ? a.accent : undefined, background: selected?.id === a.id ? `${a.accent}14` : undefined }} aria-hidden>{a.initials}</span>
                  <span className="as-agent-main">
                    <span className="as-agent-name">{a.name}{a.fav ? <Star size={10} aria-hidden className="as-star" /> : null}</span>
                    <span className="as-agent-sub"><span className={`as-life ${lifecycleClass(a.lifecycle)}`}><CircleDot size={8} aria-hidden /> {lifecycleLabel(a.lifecycle)}</span> · {a.model || 'no model'}</span>
                  </span>
                  <ChevronRight size={12} aria-hidden className="as-chevron" />
                </button>
              ))
          ) : agents.length === 0 ? (
            <div className="as-empty"><Bot size={18} aria-hidden /><span className="small muted">No agents yet — create your first agent above.</span></div>
          ) : filtered.length === 0 ? (
            <div className="as-empty small muted">No agents match.</div>
          ) : (
            filtered.map((a) => (
              <button key={a.id} type="button" role="listitem" className={`as-agent ${selected?.id === a.id ? 'active' : ''}`} onClick={() => setSelectedId(a.id)} aria-current={selected?.id === a.id ? 'true' : undefined} aria-label={`Open ${a.name}`}>
                <span className="as-avatar" style={{ borderColor: selected?.id === a.id ? a.accent : undefined, background: selected?.id === a.id ? `${a.accent}14` : undefined }} aria-hidden>{a.initials}</span>
                <span className="as-agent-main">
                  <span className="as-agent-name">{a.name}{a.fav ? <Star size={10} aria-hidden className="as-star" /> : null}</span>
                  <span className="as-agent-sub"><span className={`as-life ${lifecycleClass(a.lifecycle)}`}><CircleDot size={8} aria-hidden /> {lifecycleLabel(a.lifecycle)}</span> · {a.model || 'no model'}</span>
                </span>
                <ChevronRight size={12} aria-hidden className="as-chevron" />
              </button>
            ))
          )}
        </div>

        <div className="as-nav-foot small muted">Local-first · MCP isolated per agent</div>
      </nav>

      {/* Center — Overview dashboard + dynamic workspaces */}
      <main className="as-center" aria-label="Agent command center">
        {selected ? (
          <>
            <header className="as-header">
              <div className="as-header-left">
                <div className="as-avatar as-avatar--hero" style={{ borderColor: selected.accent, background: `${selected.accent}14` }} aria-hidden>{selected.initials}</div>
                <div className="as-header-main">
                  <div className="as-header-title-row">
                    <h1 className="as-title">{selected.name}</h1>
                    <span className={`as-life ${lifecycleClass(selected.lifecycle)}`}><CircleDot size={10} aria-hidden /> {lifecycleLabel(selected.lifecycle)}</span>
                    <span className="as-handle">@{selected.handle}</span>
                    <span className="as-model"><Database size={11} aria-hidden /> {selected.model || 'No model selected'}</span>
                  </div>
                  <p className="as-subtitle">{selected.description || 'No description yet — add one in Settings.'}</p>
                  <div className="as-lifecycle" aria-label="Lifecycle">
                    <span className={`as-stage ${selected.lifecycle === 'draft' ? 'active' : selected.lifecycle === 'build' || selected.lifecycle === 'active' || selected.lifecycle === 'published' ? 'done' : ''}`}>Draft</span>
                    <span className="as-stage-sep" aria-hidden>→</span>
                    <span className={`as-stage ${selected.lifecycle === 'build' ? 'active' : selected.lifecycle === 'active' || selected.lifecycle === 'published' ? 'done' : ''}`}>Build</span>
                    <span className="as-stage-sep" aria-hidden>→</span>
                    <span className={`as-stage ${selected.lifecycle === 'active' ? 'active' : selected.lifecycle === 'published' ? 'done' : ''}`}>Active</span>
                    <span className="as-stage-sep" aria-hidden>→</span>
                    <span className={`as-stage ${selected.lifecycle === 'published' ? 'active' : ''}`}>Published</span>
                  </div>
                </div>
              </div>
              <div className="as-header-actions">
                <button type="button" className="btn btn-sm" aria-label="Duplicate agent" onClick={() => void handleDuplicate()}><Copy size={12} aria-hidden /> Duplicate</button>
                <button type="button" className="btn btn-sm" aria-label={NEXT_LIFECYCLE[selected.lifecycle] ? `Advance to ${NEXT_LIFECYCLE[selected.lifecycle]}` : 'Publish agent'} disabled={!NEXT_LIFECYCLE[selected.lifecycle]} onClick={() => void handlePublish()}><Rocket size={12} aria-hidden /> {NEXT_LIFECYCLE[selected.lifecycle] ? `Advance to ${lifecycleLabel(NEXT_LIFECYCLE[selected.lifecycle] as AgentLifecycle)}` : 'Published'}</button>
                <button type="button" className="btn btn-sm" aria-label={selected.fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={!!selected.fav} onClick={() => void handleToggleFav()}><Star size={12} aria-hidden /> {selected.fav ? 'Favorited' : 'Favorite'}</button>
                <button type="button" className="as-intel-toggle" onClick={() => setIntelOpen((v) => !v)} aria-label={intelOpen ? 'Collapse intelligence panel' : 'Expand intelligence panel'} aria-expanded={intelOpen} aria-controls="as-intel">
                  {intelOpen ? <PanelRightClose size={14} aria-hidden /> : <PanelRight size={14} aria-hidden />}
                </button>
              </div>
            </header>

            <div className="as-workspace-bar" role="tablist" aria-label="Workspaces">
              {WORKSPACE_GROUPS.map((g) => (
                <span key={g.group} className="as-ws-group">
                  <span className="as-ws-group-label">{g.group}</span>
                  {g.items.map((it) => {
                    const Icon = it.icon
                    const active = ws === it.id
                    return (
                      <button key={it.id} type="button" role="tab" aria-selected={active} className={`as-ws-tab ${active ? 'active' : ''}`} onClick={() => setWs(it.id)} aria-label={`${it.label}: ${it.hint}`}>
                        <Icon size={13} aria-hidden />
                        <span>{it.label}</span>
                        {it.id === 'connected' ? <span className="as-mcp-badge">MCP only</span> : null}
                      </button>
                    )
                  })}
                </span>
              ))}
            </div>

            <div className="as-workspace" role="tabpanel" aria-label={`${ws} workspace`}>
              {ws === 'overview' ? <OverviewWorkspace agent={selected} onNavigate={setWs} onPublish={() => void handlePublish()} /> : null}
              {ws === 'instructions' ? <PromptWorkspace agent={selected} onSaved={refreshStore} /> : null}
              {ws === 'knowledge' ? <KnowledgeWorkspace agent={selected} /> : null}
              {ws === 'skills' ? <SkillsWorkspace agent={selected} /> : null}
              {ws === 'connected' ? <McpWorkspace /> : null}
              {ws === 'tools' ? <ToolsWorkspace /> : null}
              {ws === 'memory' ? <MemoryWorkspace agent={selected} onChanged={refreshStore} /> : null}
              {ws === 'workflows' ? <WorkflowsWorkspace agent={selected} /> : null}
              {ws === 'testing' ? <TestingWorkspace agent={selected} /> : null}
              {ws === 'analytics' ? <AnalyticsWorkspace /> : null}
              {ws === 'versions' ? <VersionsWorkspace agent={selected} onRestored={refreshStore} /> : null}
              {ws === 'permissions' ? <PermissionsWorkspace agent={selected} /> : null}
              {ws === 'settings' ? <SettingsWorkspace agent={selected} onChanged={refreshStore} onDeleted={() => { setSelectedId(null); refreshStore() }} /> : null}
            </div>
          </>
        ) : (
          <div className="as-workspace" role="tabpanel" aria-label="empty workspace">
            <OverviewWorkspace agent={null} onNavigate={setWs} onPublish={() => {}} />
          </div>
        )}
      </main>

      {/* Right — Collapsible intelligence panel */}
      <aside id="as-intel" className={`as-intel ${intelOpen ? '' : 'collapsed'}`} aria-label="Intelligence panel" aria-hidden={!intelOpen}>
        {intelOpen ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 4px 0' }}>
              <button type="button" className="as-icon-btn" onClick={() => setIntelOpen(false)} aria-label="Collapse intelligence panel"><ChevronRight size={14} aria-hidden /></button>
            </div>
            <IntelRail agent={selected} onNavigate={setWs} />
          </>
        ) : null}
      </aside>

      {!intelOpen ? (
        <button type="button" className="as-fab" onClick={() => setIntelOpen(true)} aria-label="Show intelligence panel"><PanelRight size={14} aria-hidden /> Intelligence</button>
      ) : null}
    </div>
  )
}
