import { useMemo, useState } from 'react'
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
  Workflow,
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

type AgentLifecycle = 'draft' | 'build' | 'active' | 'published'

interface AgentRecord {
  id: string
  name: string
  handle: string
  description: string
  initials: string
  lifecycle: AgentLifecycle
  model: string
  updatedAt: string
  fav?: boolean
  team?: boolean
  accent: string
}

const AGENTS: AgentRecord[] = [
  { id: 'ag_01', name: 'Sovara Researcher', handle: 'sovara-researcher', description: 'Deep research, multi-step synthesis, and source-grounded answers.', initials: 'SR', lifecycle: 'active', model: 'Qwen3 8B · local', updatedAt: '2h ago', fav: true, accent: '#4a90d9' },
  { id: 'ag_02', name: 'Code Reviewer', handle: 'code-reviewer', description: 'Diff-aware review, risk scoring, and fix suggestions.', initials: 'CR', lifecycle: 'published', model: 'Qwen3 8B · local', updatedAt: 'yesterday', fav: true, team: true, accent: '#7c3aed' },
  { id: 'ag_03', name: 'Support Copilot', handle: 'support-copilot', description: 'Answers from your knowledge base with citations.', initials: 'SC', lifecycle: 'build', model: 'Llama 3.1 8B', updatedAt: '3d ago', accent: '#0ea5e9' },
  { id: 'ag_04', name: 'Data Analyst', handle: 'data-analyst', description: 'Warehouse queries → charts → narrative.', initials: 'DA', lifecycle: 'draft', model: 'Mistral 7B', updatedAt: '1w ago', team: true, accent: '#10b981' },
  { id: 'ag_05', name: 'Ops Agent', handle: 'ops-agent', description: 'Incident triage and runbook automation.', initials: 'OA', lifecycle: 'active', model: 'Qwen3 14B', updatedAt: '5h ago', accent: '#f59e0b' },
]

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
      { id: 'workflows', label: 'Workflows', icon: Workflow, hint: 'Builder' },
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

function Sparkline({ values, color = 'var(--accent)' }: { values: number[]; color?: string }): React.JSX.Element {
  const w = 84
  const h = 28
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

// ── Workspaces ──────────────────────────────────────────────────

function OverviewWorkspace({ agent }: { agent: AgentRecord }): React.JSX.Element {
  return (
    <div className="as-overview">
      <div className="as-metrics">
        <div className="as-metric">
          <div className="as-metric-head"><span className="as-metric-icon"><Activity size={14} aria-hidden /></span><span className="as-metric-label">Total runs · 7d</span><span className="as-trend up"><TrendingUp size={11} aria-hidden /> +12%</span></div>
          <div className="as-metric-value">1,284</div>
          <div className="as-metric-foot"><span className="small muted">98.1% success · 3 failed</span><Sparkline values={[6, 8, 5, 9, 7, 11, 9]} /></div>
        </div>
        <div className="as-metric">
          <div className="as-metric-head"><span className="as-metric-icon"><Gauge size={14} aria-hidden /></span><span className="as-metric-label">Avg latency</span><span className="as-trend down">p95 2.4s</span></div>
          <div className="as-metric-value">1.1<span className="as-metric-unit">s</span></div>
          <div className="as-metric-foot"><span className="small muted">p50 0.7s</span><Sparkline values={[9, 7, 8, 6, 5, 6, 4]} color="#10b981" /></div>
        </div>
        <div className="as-metric">
          <div className="as-metric-head"><span className="as-metric-icon"><BookOpen size={14} aria-hidden /></span><span className="as-metric-label">Knowledge</span><span className="as-trend neutral">12 files</span></div>
          <div className="as-metric-value">94<span className="as-metric-unit">%</span></div>
          <div className="as-metric-foot"><span className="small muted">Indexed · 10.5k chunks</span><Sparkline values={[70, 72, 80, 78, 85, 90, 94]} color="#7c3aed" /></div>
        </div>
        <div className="as-metric">
          <div className="as-metric-head"><span className="as-metric-icon"><Plug2 size={14} aria-hidden /></span><span className="as-metric-label">MCP health</span><span className="as-pill as-pill--ok">3/3 ok</span></div>
          <div className="as-metric-value">All systems</div>
          <div className="as-metric-foot"><span className="small muted">Filesystem · Brave · SQLite</span><Sparkline values={[1, 1, 1, 0.8, 1, 1, 1]} color="#22c55e" /></div>
        </div>
      </div>

      <div className="as-quick">
        <button type="button" className="as-quick-card"><span className="as-quick-icon"><PenLine size={16} aria-hidden /></span><span className="as-quick-text"><strong>Edit prompt</strong><span className="small muted">Instructions → live preview</span></span><ArrowUpRight size={14} aria-hidden className="as-quick-arrow" /></button>
        <button type="button" className="as-quick-card"><span className="as-quick-icon"><Upload size={16} aria-hidden /></span><span className="as-quick-text"><strong>Add knowledge</strong><span className="small muted">Drop files · resumable</span></span><ArrowUpRight size={14} aria-hidden className="as-quick-arrow" /></button>
        <button type="button" className="as-quick-card"><span className="as-quick-icon"><Play size={16} aria-hidden /></span><span className="as-quick-text"><strong>Run test</strong><span className="small muted">Playground → evals</span></span><ArrowUpRight size={14} aria-hidden className="as-quick-arrow" /></button>
        <button type="button" className="as-quick-card primary"><span className="as-quick-icon"><Rocket size={16} aria-hidden /></span><span className="as-quick-text"><strong>Publish</strong><span className="small muted">Version, share, deploy</span></span><ArrowUpRight size={14} aria-hidden className="as-quick-arrow" /></button>
      </div>

      <div className="as-reco">
        <div className="as-reco-head"><Cpu size={13} aria-hidden /><span>System-aware recommendation</span><span className="as-pill">local</span></div>
        <p className="as-reco-body">Your rig has 32 GB RAM · 8 GB VRAM. <strong>Qwen3 8B Q4_K_M (~4.9 GB)</strong> is the best fit for this agent — good quality, fits in VRAM. <span className="muted">Larger Q5/Q6 will spill to RAM and double latency.</span></p>
        <div className="as-reco-actions"><button type="button" className="btn btn-sm primary">Apply recommended model</button><button type="button" className="btn btn-sm">View alternatives</button></div>
      </div>

      <div className="as-two">
        <div className="as-panel">
          <div className="as-panel-head"><span className="as-panel-title"><Workflow size={13} aria-hidden /> Recent workflows</span><button type="button" className="btn btn-sm ghost">Open</button></div>
          <div className="as-list">
            <div className="as-list-row"><span className="as-dot ok" aria-hidden /><span className="as-list-main"><strong>Weekly research digest</strong><span className="small muted">Search → Synthesize → Draft · 2h ago</span></span><span className="as-pill as-pill--ok">Succeeded</span></div>
            <div className="as-list-row"><span className="as-dot warn" aria-hidden /><span className="as-list-main"><strong>Review PRs on push</strong><span className="small muted">On git push · paused</span></span><span className="as-pill">Paused</span></div>
          </div>
        </div>
        <div className="as-panel">
          <div className="as-panel-head"><span className="as-panel-title"><FlaskConical size={13} aria-hidden /> Testing queue</span><span className="small muted">{agent.handle} · {agent.model}</span></div>
          <div className="as-list">
            <div className="as-list-row"><span className="as-dot ok" aria-hidden /><span className="as-list-main"><strong>Groundedness</strong><span className="small muted">92% · 48 cases</span></span><span className="as-pill as-pill--ok">Pass</span></div>
            <div className="as-list-row"><span className="as-dot ok" aria-hidden /><span className="as-list-main"><strong>Latency p50</strong><span className="small muted">1.2s · target 1.5s</span></span><span className="as-pill as-pill--ok">OK</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PromptWorkspace(): React.JSX.Element {
  const [draft, setDraft] = useState(
    'You are Sovara Researcher — a careful, source-grounded assistant.\n\nROLE\n- Answer only from provided Knowledge + Tools; cite sources.\n- Prefer local models; never leak private files.\n\nSTYLE\n- Concise, structured, actionable.\n- If uncertain, say so and propose next steps.\n\nVARIABLES\n{{user_goal}} {{knowledge_context}} {{tool_output}}',
  )
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><PenLine size={13} aria-hidden /> Prompt editor</span><span className="small muted">Markdown · variables · versioned</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sm">Reset</button><button type="button" className="btn btn-sm primary">Save new version</button></div>
      <div className="as-prompt-grid">
        <div className="as-editor">
          <div className="as-editor-bar"><span className="small muted">system.md</span><span className="as-token-count">{draft.length} chars · ~{Math.ceil(draft.length / 4)} tokens</span></div>
          <textarea className="as-textarea" value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} spellCheck={false} aria-label="Agent instructions" />
          <div className="as-editor-foot"><span className="small muted">Variables: {'{{user_goal}}'} {'{{knowledge_context}}'}</span><button type="button" className="btn btn-sm ghost"><Eye size={12} aria-hidden /> Preview</button></div>
        </div>
        <div className="as-preview">
          <div className="as-preview-head"><MessageSquare size={12} aria-hidden /> Live preview <span className="as-pill">local run</span></div>
          <div className="as-bubble user">Summarize the handbook in 5 bullets.</div>
          <div className="as-bubble assistant">1. Scope & SLA … 2. Escalation … <span className="small muted">(streaming 0.8s)</span></div>
          <div className="as-preview-input"><input className="as-input" placeholder="Test this prompt…" aria-label="Test prompt" /><button type="button" className="btn btn-sm primary">Run</button></div>
          <div className="as-preview-meta small muted">Preview uses current Knowledge + MCP tools · no cloud</div>
        </div>
      </div>
    </div>
  )
}

function KnowledgeWorkspace(): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const files = [
    { name: 'product-spec.md', kind: 'md', source: 'Upload', status: 'Indexed · 2.1k chunks', size: '42 KB' },
    { name: 'support-handbook.pdf', kind: 'pdf', source: 'Upload', status: 'Indexed · 8.4k chunks', size: '3.2 MB' },
    { name: 'changelog.jsonl', kind: 'jsonl', source: 'Folder sync · resumable', status: 'Syncing 62%', size: '18 MB' },
  ].filter((f) => !filter || f.name.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar">
        <span className="as-ws-title"><FolderOpen size={13} aria-hidden /> Knowledge explorer</span>
        <span className="small muted">RAG is project-scoped · resumable ingest</span>
        <span style={{ flex: 1 }} />
        <div className="as-search"><Search size={12} aria-hidden /><input className="as-search-input" placeholder="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter knowledge" /></div>
        <button type="button" className="btn btn-sm primary"><Upload size={12} aria-hidden /> Add files</button>
      </div>
      <div className="as-kb-grid">
        <div className="as-file-list" role="list">
          {files.map((f) => (
            <div key={f.name} className="as-file-row" role="listitem">
              <span className="as-file-icon"><File size={14} aria-hidden /></span>
              <span className="as-file-main"><strong>{f.name}</strong><span className="small muted">{f.source} · {f.size}</span></span>
              <span className="as-pill">{f.status}</span>
              {f.name === 'changelog.jsonl' ? (
                <span className="as-progress" aria-label="Sync progress"><span className="as-progress-fill" style={{ width: '62%' }} /></span>
              ) : null}
              <button type="button" className="as-icon-btn" aria-label={`Options for ${f.name}`}><MoreHorizontal size={12} aria-hidden /></button>
            </div>
          ))}
          {files.length === 0 ? <div className="as-empty small muted">No files match.</div> : null}
          <div className="as-drop">Drop files here or <button type="button" className="as-link">browse</button> · resumable via Range · .part kept until done</div>
        </div>
        <div className="as-file-preview">
          <div className="as-preview-head"><FileText size={12} aria-hidden /> Preview — product-spec.md <span className="as-pill as-pill--ok">2.1k chunks</span></div>
          <pre className="as-code"># Product Spec — Sovara 1.4{'\n\n'}Goals: local-first, cited answers…{'\n'}Stack: Electron + pnpm…</pre>
          <div className="as-preview-actions"><button type="button" className="btn btn-sm"><Eye size={12} aria-hidden /> Open</button><button type="button" className="btn btn-sm ghost"><Trash2 size={12} aria-hidden /> Remove</button></div>
        </div>
      </div>
    </div>
  )
}

function SkillsWorkspace(): React.JSX.Element {
  const skills = [
    { name: 'Deep Research', desc: 'Multi-step web + local search with citations.', icon: Search, on: true, uses: '1.2k runs' },
    { name: 'Code Review', desc: 'Diff-aware review with risk scoring.', icon: GitBranch, on: true, uses: '860 runs' },
    { name: 'Data Analysis', desc: 'Notebooks → charts → tables.', icon: BarChart3, on: false, uses: '—' },
    { name: 'Support Drafts', desc: 'Draft replies from knowledge.', icon: MessageSquare, on: true, uses: '420 runs' },
  ]
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Sparkles size={13} aria-hidden /> Skills</span><span className="small muted">Capability cards · toggle per agent</span></div>
      <div className="as-cards">
        {skills.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.name} className="as-card">
              <div className="as-card-head"><span className="as-card-icon"><Icon size={14} aria-hidden /></span><span className="as-card-title">{s.name}</span><span className={`as-toggle ${s.on ? 'on' : ''}`} role="switch" aria-checked={s.on} tabIndex={0} aria-label={`Toggle ${s.name}`}><span className="as-toggle-thumb" /></span></div>
              <p className="small muted" style={{ margin: 0, lineHeight: 1.5 }}>{s.desc}</p>
              <div className="as-card-foot"><span className="small muted">{s.uses}</span><button type="button" className="btn btn-sm ghost">Configure</button></div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function McpWorkspace(): React.JSX.Element {
  const servers = [
    { name: 'Filesystem', desc: 'Scoped folder access for this agent.', by: 'local · stdio', health: 'ok', tools: 2, latency: '0.4 ms' },
    { name: 'Brave Search', desc: 'Web search via MCP — local key.', by: 'community · http', health: 'ok', tools: 1, latency: '18 ms' },
    { name: 'SQLite', desc: 'Query project DB read-only.', by: 'local · stdio', health: 'paused', tools: 3, latency: '—' },
  ]
  return (
    <div className="as-ws">
      <div className="as-callout"><Plug2 size={14} aria-hidden /><span><strong>MCP only — Connected Apps.</strong> Each server is spawned per agent, isolated, and can be paused without touching others. No OAuth.</span></div>
      <div className="as-cards">
        {servers.map((s) => (
          <div key={s.name} className="as-card">
            <div className="as-card-head"><span className="as-card-icon"><Plug2 size={14} aria-hidden /></span><span className="as-card-title">{s.name}</span><span className={`as-pill ${s.health === 'ok' ? 'as-pill--ok' : ''}`}>{s.health === 'ok' ? 'Connected' : 'Paused'}</span></div>
            <p className="small muted" style={{ margin: 0 }}>{s.desc}</p>
            <div className="as-card-meta small muted"><span>{s.by}</span><span>·</span><span>{s.tools} tools</span><span>·</span><span>{s.latency}</span></div>
            <div className="as-card-foot"><button type="button" className="btn btn-sm">{s.health === 'ok' ? 'Configure' : 'Connect'}</button><button type="button" className="btn btn-sm ghost"><Activity size={12} aria-hidden /> Logs</button></div>
          </div>
        ))}
      </div>
      <div className="as-panel"><div className="as-panel-head"><span className="as-panel-title"><Layers size={13} aria-hidden /> Tool manifest</span><span className="small muted">6 tools aggregated</span></div><div className="as-table-wrap"><table className="as-table"><thead><tr><th>Tool</th><th>Server</th><th>Latency</th><th /></tr></thead><tbody><tr><td><Wrench size={11} aria-hidden /> search_local</td><td className="small muted">Filesystem</td><td className="small">0.4 ms</td><td><button type="button" className="btn btn-sm ghost">View</button></td></tr><tr><td><Wrench size={11} aria-hidden /> web_search</td><td className="small muted">Brave Search</td><td className="small">18 ms</td><td><button type="button" className="btn btn-sm ghost">View</button></td></tr></tbody></table></div></div>
    </div>
  )
}

function ToolsWorkspace(): React.JSX.Element {
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Wrench size={13} aria-hidden /> Tools</span><span className="small muted">Functions exposed to the model · MCP servers appear here when enabled</span></div>
      <div className="as-table-wrap"><table className="as-table"><thead><tr><th>Tool</th><th>Origin</th><th>Enabled</th><th>Calls (7d)</th><th /></tr></thead><tbody><tr><td className="as-strong"><Wrench size={11} aria-hidden /> search_local</td><td className="small muted">MCP · Filesystem</td><td><span className="as-pill as-pill--ok">On</span></td><td className="small">842</td><td><button type="button" className="btn btn-sm ghost">View</button></td></tr><tr><td className="as-strong"><Wrench size={11} aria-hidden /> web_search</td><td className="small muted">MCP · Brave Search</td><td><span className="as-pill as-pill--ok">On</span></td><td className="small">312</td><td><button type="button" className="btn btn-sm ghost">View</button></td></tr><tr><td className="as-strong"><Wrench size={11} aria-hidden /> query_db</td><td className="small muted">MCP · SQLite</td><td><span className="as-pill">Off</span></td><td className="small muted">—</td><td><button type="button" className="btn btn-sm ghost">Enable</button></td></tr></tbody></table></div>
    </div>
  )
}

function MemoryWorkspace(): React.JSX.Element {
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Brain size={13} aria-hidden /> Memory inspector</span><span className="small muted">Long-term preferences & facts — scoped to this agent</span><span style={{ flex: 1 }} /><div className="as-search"><Search size={12} aria-hidden /><input className="as-search-input" placeholder="Search memories" aria-label="Search memories" /></div></div>
      <div className="as-memory-grid">
        <label className="as-check"><input type="checkbox" defaultChecked /> Remember preferences across sessions</label>
        <label className="as-check"><input type="checkbox" defaultChecked /> Persist tool outputs as memories (with consent)</label>
        <label className="as-check"><input type="checkbox" /> Auto-compact weekly</label>
      </div>
      <div className="as-table-wrap"><table className="as-table"><thead><tr><th>Memory</th><th>Source</th><th>Updated</th><th /></tr></thead><tbody><tr><td className="small">Prefers concise, bullet-point answers</td><td className="small muted">inferred</td><td className="small muted">2d ago</td><td><button type="button" className="as-icon-btn" aria-label="Remove memory"><X size={12} aria-hidden /></button></td></tr><tr><td className="small">Project Acme uses pnpm + Electron</td><td className="small muted">user</td><td className="small muted">5d ago</td><td><button type="button" className="as-icon-btn" aria-label="Remove memory"><X size={12} aria-hidden /></button></td></tr><tr><td className="small">Uses Q4_K_M for local runs</td><td className="small muted">tool</td><td className="small muted">1w ago</td><td><button type="button" className="as-icon-btn" aria-label="Remove memory"><X size={12} aria-hidden /></button></td></tr></tbody></table></div>
      <div className="as-callout small"><Brain size={12} aria-hidden /> Memories are versioned — see Versions to restore a prior snapshot.</div>
    </div>
  )
}

function WorkflowsWorkspace(): React.JSX.Element {
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Workflow size={13} aria-hidden /> Workflow builder</span><span className="small muted">Trigger: manual · schedule · webhook (MCP)</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sm primary"><Plus size={12} aria-hidden /> New workflow</button></div>
      <div className="as-workflow">
        <div className="as-workflow-canvas" aria-label="Workflow canvas">
          <div className="as-wf-node start"><span className="as-wf-dot" /><span>On demand</span></div>
          <div className="as-wf-edge" aria-hidden />
          <div className="as-wf-node"><Search size={12} aria-hidden /> Search</div>
          <div className="as-wf-edge" aria-hidden />
          <div className="as-wf-node"><FileText size={12} aria-hidden /> Synthesize</div>
          <div className="as-wf-edge" aria-hidden />
          <div className="as-wf-node"><MessageSquare size={12} aria-hidden /> Draft</div>
          <div className="as-wf-edge" aria-hidden />
          <div className="as-wf-node end"><Zap size={12} aria-hidden /> Notify</div>
        </div>
        <div className="as-workflow-list">
          <div className="as-list-row"><span className="as-dot ok" aria-hidden /><span className="as-list-main"><strong>Weekly research digest</strong><span className="small muted">Last run 2h ago · 3 steps · 98% success</span></span><button type="button" className="btn btn-sm">Open</button></div>
          <div className="as-list-row"><span className="as-dot warn" aria-hidden /><span className="as-list-main"><strong>Review PRs on push</strong><span className="small muted">Paused · webhook</span></span><button type="button" className="btn btn-sm">Open</button></div>
        </div>
      </div>
    </div>
  )
}

function TestingWorkspace(): React.JSX.Element {
  return (
    <div className="as-ws">
      <div className="as-testing">
        <div className="as-testing-chat">
          <div className="as-testing-head"><TestTube2 size={13} aria-hidden /> Playground <span className="as-pill">local run · no cloud</span></div>
          <div className="as-bubble user">Summarize the support handbook in 5 bullets.</div>
          <div className="as-bubble assistant">1. Scope… 2. SLA… 3. Escalation… <span className="small muted">(streaming · 0.8s)</span></div>
          <div className="as-testing-input"><input className="as-input" placeholder="Test a prompt…" aria-label="Test prompt" /><button type="button" className="btn btn-sm primary">Run</button></div>
          <div className="as-testing-actions"><button type="button" className="btn btn-sm"><Play size={12} aria-hidden /> Run suite</button><button type="button" className="btn btn-sm ghost"><Download size={12} aria-hidden /> Export</button></div>
        </div>
        <div className="as-testing-evals">
          <div className="as-panel"><div className="as-panel-head"><span className="as-panel-title"><Gauge size={13} aria-hidden /> Evaluation</span><span className="small muted">48 cases</span></div>
            <div className="as-eval-grid"><div className="as-eval"><span className="small muted">Groundedness</span><span className="as-eval-val ok">92%</span></div><div className="as-eval"><span className="small muted">Latency p50</span><span className="as-eval-val">1.2s</span></div><div className="as-eval"><span className="small muted">Tool success</span><span className="as-eval-val ok">98%</span></div></div>
          </div>
          <div className="as-panel"><div className="as-panel-head"><span className="as-panel-title"><History size={13} aria-hidden /> Recent runs</span></div><div className="as-list"><div className="as-list-row"><span className="as-dot ok" aria-hidden /><span className="as-list-main"><strong>research-q3</strong><span className="small muted">2m ago · 1.3s</span></span><span className="as-pill as-pill--ok">Pass</span></div><div className="as-list-row"><span className="as-dot warn" aria-hidden /><span className="as-list-main"><strong>handbook summary</strong><span className="small muted">1h ago · 2.8s</span></span><span className="as-pill">Retry</span></div></div></div>
        </div>
      </div>
    </div>
  )
}

function AnalyticsWorkspace(): React.JSX.Element {
  return (
    <div className="as-ws">
      <div className="as-metrics">
        <div className="as-metric"><div className="as-metric-head"><span className="as-metric-icon"><BarChart3 size={14} aria-hidden /></span><span className="as-metric-label">Runs (7d)</span></div><div className="as-metric-value">342</div><div className="as-metric-foot"><span className="small muted">+12% vs prior</span><Sparkline values={[30, 42, 28, 50, 38, 60, 48]} /></div></div>
        <div className="as-metric"><div className="as-metric-head"><span className="as-metric-icon"><CheckCircle2 size={14} aria-hidden /></span><span className="as-metric-label">Success</span></div><div className="as-metric-value">98.1<span className="as-metric-unit">%</span></div><div className="as-metric-foot"><span className="small muted">3 failures</span><Sparkline values={[96, 97, 98, 97, 98, 99, 98]} color="#22c55e" /></div></div>
        <div className="as-metric"><div className="as-metric-head"><span className="as-metric-icon"><Clock3 size={14} aria-hidden /></span><span className="as-metric-label">Avg latency</span></div><div className="as-metric-value">1.1<span className="as-metric-unit">s</span></div><div className="as-metric-foot"><span className="small muted">p50 0.7s · p95 2.4s</span><Sparkline values={[1.4, 1.2, 1.3, 1.1, 1.0, 1.1, 1.1]} color="#4a90d9" /></div></div>
      </div>
      <div className="as-panel"><div className="as-panel-head"><span className="as-panel-title"><BarChart3 size={13} aria-hidden /> Recent runs</span><span className="small muted">last 50 · resumable ingest included</span></div><div className="as-table-wrap"><table className="as-table"><thead><tr><th>When</th><th>Input</th><th>Status</th><th>Latency</th></tr></thead><tbody><tr><td className="small">2h ago</td><td className="small">Research Q3 roadmap</td><td><span className="as-pill as-pill--ok">Success</span></td><td className="small muted">1.3s</td></tr><tr><td className="small">5h ago</td><td className="small">Summarize handbook.pdf</td><td><span className="as-pill as-pill--ok">Success</span></td><td className="small muted">0.9s</td></tr><tr><td className="small">1d ago</td><td className="small">Draft support reply</td><td><span className="as-pill as-pill--warn">Retry</span></td><td className="small muted">2.8s</td></tr></tbody></table></div></div>
    </div>
  )
}

function VersionsWorkspace(): React.JSX.Element {
  const items = [
    { v: 'v12', when: '2h ago · by you', note: 'Tightened instructions, added citations rule', cur: true },
    { v: 'v11', when: '1d ago · by you', note: 'Added SQLite MCP, disabled code tool', cur: false },
    { v: 'v10', when: '3d ago · auto', note: 'Snapshot before publish', cur: false },
    { v: 'v9', when: '1w ago · by Alex', note: 'Initial draft', cur: false },
  ]
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><History size={13} aria-hidden /> Versions timeline</span><span className="small muted">Every save is a snapshot · diff & restore</span></div>
      <div className="as-timeline">
        {items.map((it) => (
          <div key={it.v} className={`as-tl-row ${it.cur ? 'current' : ''}`}>
            <div className="as-tl-rail"><span className="as-tl-dot" aria-hidden /><span className="as-tl-line" aria-hidden /></div>
            <div className="as-tl-card">
              <div className="as-tl-head"><span className="as-version">{it.v}</span>{it.cur ? <span className="as-pill as-pill--ok">Current</span> : null}<span className="small muted">{it.when}</span></div>
              <div className="small">{it.note}</div>
              <div className="as-tl-actions"><button type="button" className="btn btn-sm ghost"><Eye size={12} aria-hidden /> Diff</button><button type="button" className="btn btn-sm">{it.cur ? 'Current' : 'Restore'}</button></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PermissionsWorkspace(): React.JSX.Element {
  return (
    <div className="as-ws">
      <div className="as-ws-toolbar"><span className="as-ws-title"><Shield size={13} aria-hidden /> Visual permissions</span><span className="small muted">Scopes are per-agent · no cross-agent bleed</span></div>
      <div className="as-perm-grid">
        <div className="as-perm-card">
          <div className="as-perm-head"><Lock size={12} aria-hidden /> Knowledge</div>
          <label className="as-perm-row"><span><strong>Read files</strong><span className="small muted"> · RAG chunks</span></span><span className="as-toggle on" role="switch" aria-checked><span className="as-toggle-thumb" /></span></label>
          <label className="as-perm-row"><span><strong>Write files</strong><span className="small muted"> · ingest only</span></span><span className="as-toggle" role="switch" aria-checked={false}><span className="as-toggle-thumb" /></span></label>
        </div>
        <div className="as-perm-card">
          <div className="as-perm-head"><Wrench size={12} aria-hidden /> Tools & MCP</div>
          <label className="as-perm-row"><span><strong>Call tools</strong><span className="small muted"> · only enabled</span></span><span className="as-toggle on" role="switch" aria-checked><span className="as-toggle-thumb" /></span></label>
          <label className="as-perm-row"><span><strong>Spawn MCP servers</strong></span><span className="as-toggle on" role="switch" aria-checked><span className="as-toggle-thumb" /></span></label>
        </div>
        <div className="as-perm-card">
          <div className="as-perm-head"><UsersRound size={12} aria-hidden /> Sharing</div>
          <label className="as-perm-row"><span><strong>Team visible</strong><span className="small muted"> · under Team Agents</span></span><span className="as-toggle" role="switch" aria-checked={false}><span className="as-toggle-thumb" /></span></label>
          <label className="as-perm-row"><span><strong>Allow publishing</strong></span><span className="as-toggle on" role="switch" aria-checked><span className="as-toggle-thumb" /></span></label>
        </div>
      </div>
      <div className="as-callout small"><ShieldCheck size={12} aria-hidden /> Private by default — even team members cannot see drafts until you publish.</div>
    </div>
  )
}

function SettingsWorkspace({ agent }: { agent: AgentRecord }): React.JSX.Element {
  return (
    <div className="as-ws">
      <div className="as-form">
        <label className="as-field"><span className="as-field-label">Agent name</span><input className="as-input" defaultValue={agent.name} aria-label="Agent name" /></label>
        <label className="as-field"><span className="as-field-label">Handle</span><input className="as-input" defaultValue={agent.handle} aria-label="Agent handle" /></label>
        <label className="as-field"><span className="as-field-label">Description</span><textarea className="as-textarea" rows={3} defaultValue={agent.description} aria-label="Agent description" /></label>
        <div className="as-field"><span className="as-field-label">Danger zone</span><div className="as-danger"><span className="small">Delete this agent and its versions. Knowledge files stay on disk.</span><button type="button" className="btn btn-sm" style={{ background: 'rgba(239,68,68,.08)', borderColor: 'rgba(239,68,68,.3)', color: 'var(--danger)' }}><Trash2 size={12} aria-hidden /> Delete agent</button></div></div>
      </div>
    </div>
  )
}

// ── Main studio shell ────────────────────────────────────────────

export function AgentsPage(): React.JSX.Element {
  const [nav, setNav] = useState<NavFilter>('all')
  const [selectedId, setSelectedId] = useState<string>('ag_01')
  const [ws, setWs] = useState<WorkspaceId>('overview')
  const [intelOpen, setIntelOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [dlPaused, setDlPaused] = useState(false)

  const selected = useMemo(() => AGENTS.find((a) => a.id === selectedId) ?? AGENTS[0], [selectedId])

  const filtered = useMemo(() => {
    let list = AGENTS
    if (nav === 'favorites') list = list.filter((a) => a.fav)
    if (nav === 'team') list = list.filter((a) => a.team)
    if (nav === 'archived') return []
    if (nav === 'templates') return []
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.handle.includes(q))
    }
    if (nav === 'recent') return [...list].sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1))
    return list
  }, [nav, search])

  return (
    <div className={`as-shell ${intelOpen ? '' : 'as-shell--collapsed-right'}`} data-testid="agent-studio" aria-label="Agent Studio">
      {/* Left — Agent Navigator (lifecycle-aware) */}
      <nav className="as-nav" aria-label="Agent navigator">
        <button type="button" className="as-create" onClick={() => setSelectedId(AGENTS[0].id)} aria-label="Create new agent"><Plus size={14} aria-hidden /> Create New Agent</button>

        <div className="as-search-wrap">
          <Search size={13} aria-hidden className="as-search-icon" />
          <input className="as-search-input" placeholder="Search agents" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search agents" />
        </div>

        <div className="as-nav-groups" role="tablist" aria-label="Agent groups">
          <div className="as-nav-section">
            <div className="as-nav-label">Workspace</div>
            <button type="button" className={`as-nav-item ${nav === 'all' ? 'active' : ''}`} onClick={() => setNav('all')} role="tab" aria-selected={nav === 'all'}><Bot size={14} aria-hidden /><span>All Agents</span><span className="as-count">{AGENTS.length}</span></button>
            <button type="button" className={`as-nav-item ${nav === 'favorites' ? 'active' : ''}`} onClick={() => setNav('favorites')} role="tab" aria-selected={nav === 'favorites'}><Star size={14} aria-hidden /><span>Favorites</span><span className="as-count">{AGENTS.filter((a) => a.fav).length}</span></button>
            <button type="button" className={`as-nav-item ${nav === 'recent' ? 'active' : ''}`} onClick={() => setNav('recent')} role="tab" aria-selected={nav === 'recent'}><Clock3 size={14} aria-hidden /><span>Recent</span></button>
            <button type="button" className={`as-nav-item ${nav === 'team' ? 'active' : ''}`} onClick={() => setNav('team')} role="tab" aria-selected={nav === 'team'}><UsersRound size={14} aria-hidden /><span>Team Agents</span><span className="as-count">{AGENTS.filter((a) => a.team).length}</span></button>
          </div>
          <div className="as-nav-section">
            <div className="as-nav-label">Library</div>
            <button type="button" className={`as-nav-item ${nav === 'templates' ? 'active' : ''}`} onClick={() => setNav('templates')} role="tab" aria-selected={nav === 'templates'}><LayoutTemplate size={14} aria-hidden /><span>Templates</span></button>
            <button type="button" className={`as-nav-item ${nav === 'archived' ? 'active' : ''}`} onClick={() => setNav('archived')} role="tab" aria-selected={nav === 'archived'}><Archive size={14} aria-hidden /><span>Archived</span><span className="as-count">0</span></button>
          </div>
        </div>

        <div className="as-agent-list" role="list" aria-label="Agents">
          {nav === 'templates' ? (
            <div className="as-empty"><LayoutTemplate size={18} aria-hidden /><span className="small muted">Templates — start from blank or a team publish.</span></div>
          ) : nav === 'archived' ? (
            <div className="as-empty"><Archive size={18} aria-hidden /><span className="small muted">No archived agents.</span></div>
          ) : filtered.length === 0 ? (
            <div className="as-empty small muted">No agents match.</div>
          ) : (
            filtered.map((a) => (
              <button key={a.id} type="button" role="listitem" className={`as-agent ${selectedId === a.id ? 'active' : ''}`} onClick={() => setSelectedId(a.id)} aria-current={selectedId === a.id ? 'true' : undefined} aria-label={`Open ${a.name}`}>
                <span className="as-avatar" style={{ borderColor: selectedId === a.id ? a.accent : undefined, background: selectedId === a.id ? `${a.accent}14` : undefined }} aria-hidden>{a.initials}</span>
                <span className="as-agent-main">
                  <span className="as-agent-name">{a.name}{a.fav ? <Star size={10} aria-hidden className="as-star" /> : null}</span>
                  <span className="as-agent-sub"><span className={`as-life ${lifecycleClass(a.lifecycle)}`}><CircleDot size={8} aria-hidden /> {lifecycleLabel(a.lifecycle)}</span> · {a.model}</span>
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
        <header className="as-header">
          <div className="as-header-left">
            <div className="as-avatar as-avatar--hero" style={{ borderColor: selected.accent, background: `${selected.accent}14` }} aria-hidden>{selected.initials}</div>
            <div className="as-header-main">
              <div className="as-header-title-row">
                <h1 className="as-title">{selected.name}</h1>
                <span className={`as-life ${lifecycleClass(selected.lifecycle)}`}><CircleDot size={10} aria-hidden /> {lifecycleLabel(selected.lifecycle)}</span>
                <span className="as-handle">@{selected.handle}</span>
                <span className="as-model"><Database size={11} aria-hidden /> {selected.model}</span>
              </div>
              <p className="as-subtitle">{selected.description}</p>
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
            <button type="button" className="btn btn-sm" aria-label="Duplicate agent"><Copy size={12} aria-hidden /> Duplicate</button>
            <button type="button" className="btn btn-sm" aria-label="Publish agent"><Rocket size={12} aria-hidden /> Publish</button>
            <button type="button" className="btn btn-sm" aria-label="More actions"><MoreHorizontal size={14} aria-hidden /></button>
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
          {ws === 'overview' ? <OverviewWorkspace agent={selected} /> : null}
          {ws === 'instructions' ? <PromptWorkspace /> : null}
          {ws === 'knowledge' ? <KnowledgeWorkspace /> : null}
          {ws === 'skills' ? <SkillsWorkspace /> : null}
          {ws === 'connected' ? <McpWorkspace /> : null}
          {ws === 'tools' ? <ToolsWorkspace /> : null}
          {ws === 'memory' ? <MemoryWorkspace /> : null}
          {ws === 'workflows' ? <WorkflowsWorkspace /> : null}
          {ws === 'testing' ? <TestingWorkspace /> : null}
          {ws === 'analytics' ? <AnalyticsWorkspace /> : null}
          {ws === 'versions' ? <VersionsWorkspace /> : null}
          {ws === 'permissions' ? <PermissionsWorkspace /> : null}
          {ws === 'settings' ? <SettingsWorkspace agent={selected} /> : null}
        </div>
      </main>

      {/* Right — Collapsible intelligence panel */}
      <aside id="as-intel" className={`as-intel ${intelOpen ? '' : 'collapsed'}`} aria-label="Intelligence panel" aria-hidden={!intelOpen}>
        <div className="as-intel-head">
          <span className="as-intel-title"><Hammer size={12} aria-hidden /> Intelligence</span>
          <button type="button" className="as-icon-btn" onClick={() => setIntelOpen(false)} aria-label="Collapse intelligence panel"><ChevronRight size={14} aria-hidden /></button>
        </div>

        <section className="as-intel-section" aria-label="Live status">
          <div className="as-intel-label">Live status</div>
          <div className="as-intel-card">
            <div className="as-intel-row"><CircleDot size={11} aria-hidden className="as-live-dot" /><span className="small"><strong>Idle</strong> · ready</span><span className={`as-life ${lifecycleClass(selected.lifecycle)}`} style={{ marginLeft: 'auto' }}>{lifecycleLabel(selected.lifecycle)}</span></div>
            <div className="as-intel-row small muted"><Bot size={11} aria-hidden /> {selected.model} · {selected.id}</div>
            <div className="as-intel-row small muted"><Clock3 size={11} aria-hidden /> Updated {selected.updatedAt} · local run</div>
            <div className="as-intel-row"><span className="as-dot ok" aria-hidden /><span className="small">No active run</span><span className="small muted" style={{ marginLeft: 'auto' }}>last 2h ago</span></div>
          </div>
        </section>

        <section className="as-intel-section" aria-label="Active tools">
          <div className="as-intel-label">Active tools · MCP</div>
          <div className="as-intel-card">
            <div className="as-tool-row"><Plug2 size={12} aria-hidden /><span className="small">Filesystem</span><span className="as-live-pill">MCP</span><CheckCircle2 size={12} aria-hidden className="as-check" /></div>
            <div className="as-tool-row"><Plug2 size={12} aria-hidden /><span className="small">Brave Search</span><span className="as-live-pill">MCP</span><CheckCircle2 size={12} aria-hidden className="as-check" /></div>
            <div className="as-tool-row muted"><Wrench size={12} aria-hidden /><span className="small">query_db</span><span className="small muted" style={{ marginLeft: 'auto' }}>paused</span></div>
            <button type="button" className="btn btn-sm ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => setWs('tools')}><ExternalLink size={11} aria-hidden /> Manage in Tools</button>
          </div>
        </section>

        <section className="as-intel-section" aria-label="Resumable download">
          <div className="as-intel-label">Resumable download · Range</div>
          <div className="as-intel-card">
            <div className="as-intel-row"><Download size={11} aria-hidden /><span className="small"><strong>changelog.jsonl</strong> · 18 MB</span></div>
            <div className="as-progress" role="progressbar" aria-valuenow={62} aria-valuemin={0} aria-valuemax={100} aria-label="Download progress"><span className="as-progress-fill" style={{ width: '62%' }} /></div>
            <div className="as-intel-row small muted"><span>62% · 11.1 MB</span><span style={{ marginLeft: 'auto' }}>{dlPaused ? 'Paused · .part kept' : 'Downloading · 2.4 MB/s'}</span></div>
            <div className="as-intel-actions">
              <button type="button" className="btn btn-sm" onClick={() => setDlPaused((v) => !v)}>{dlPaused ? <><Play size={11} aria-hidden /> Resume</> : <><Pause size={11} aria-hidden /> Pause</>}</button>
              <button type="button" className="btn btn-sm ghost"><X size={11} aria-hidden /> Cancel</button>
            </div>
            <div className="small muted" style={{ lineHeight: 1.4 }}>Pause keeps <code>.part</code> · Resume sends <code>Range: bytes=…</code> · concurrency 2</div>
          </div>
        </section>

        <section className="as-intel-section" aria-label="Recent activity">
          <div className="as-intel-label">Recent activity</div>
          <div className="as-intel-card as-activity">
            <div className="as-activity-row"><span className="small muted">2h ago</span><span className="small">Run succeeded · research digest</span><span className="as-activity-dot ok" aria-hidden /></div>
            <div className="as-activity-row"><span className="small muted">5h ago</span><span className="small">Knowledge synced · handbook.pdf</span><span className="as-activity-dot ok" aria-hidden /></div>
            <div className="as-activity-row"><span className="small muted">1d ago</span><span className="small">Tool paused · query_db (rate limit)</span><span className="as-activity-dot warn" aria-hidden /></div>
            <div className="as-activity-row"><span className="small muted">2d ago</span><span className="small">Version v12 · citations rule</span><span className="as-activity-dot ok" aria-hidden /></div>
            <button type="button" className="btn btn-sm ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => setWs('analytics')}><BarChart3 size={11} aria-hidden /> View analytics</button>
          </div>
        </section>

        <section className="as-intel-section" aria-label="System insight">
          <div className="as-intel-label">System insight</div>
          <div className="as-intel-card">
            <div className="as-intel-row"><Cpu size={11} aria-hidden /><span className="small">32 GB RAM · 8 GB VRAM · GPU avail</span></div>
            <div className="small muted" style={{ lineHeight: 1.5 }}>Best fit: <strong>Qwen3 8B Q4_K_M</strong> — good quality, fits in VRAM. Tip: avoid Q5/Q6 (spill to RAM).</div>
            <button type="button" className="btn btn-sm ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => setWs('analytics')}><Gauge size={11} aria-hidden /> Recommendations</button>
          </div>
        </section>

        <div className="as-intel-foot small muted">Intelligence is per-agent and live — no polling, push updates.</div>
      </aside>

      {!intelOpen ? (
        <button type="button" className="as-fab" onClick={() => setIntelOpen(true)} aria-label="Show intelligence panel"><PanelRight size={14} aria-hidden /> Intelligence</button>
      ) : null}
    </div>
  )
}
