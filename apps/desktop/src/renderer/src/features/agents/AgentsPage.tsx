import { useState } from 'react'
import {
  Bot,
  Star,
  Clock3,
  UsersRound,
  LayoutTemplate,
  Archive,
  Plus,
  ChevronRight,
  PanelRight,
  Plug2,
  Wrench,
  Brain,
  Workflow,
  FlaskConical,
  BarChart3,
  History,
  ShieldCheck,
  Settings2,
  FileText,
  BookOpen,
  Sparkles,
  Database,
  Search,
  MoreHorizontal,
  Activity,
  Zap,
  CheckCircle2,
  CircleDot,
  Copy,
  Trash2,
  ExternalLink,
  MessageSquare,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────

type AgentsNavId = 'all' | 'favorites' | 'recent' | 'team' | 'templates' | 'archived'

type AgentTab =
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

interface AgentSummary {
  id: string
  name: string
  description: string
  avatar: string
  status: 'active' | 'draft' | 'paused'
  model: string
  updatedAt: string
  starred?: boolean
  team?: boolean
}

const MOCK_AGENTS: AgentSummary[] = [
  { id: 'a1', name: 'Sovara Researcher', description: 'Deep research, synthesis, and source-grounded answers.', avatar: 'SR', status: 'active', model: 'Qwen3 8B · local', updatedAt: 'Updated 2h ago', starred: true },
  { id: 'a2', name: 'Code Reviewer', description: 'Reviews diffs against spec, flags risks, suggests fixes.', avatar: 'CR', status: 'active', model: 'Qwen3 8B · local', updatedAt: 'Updated yesterday', starred: true, team: true },
  { id: 'a3', name: 'Support Copilot', description: 'Answers from your knowledge base with citations.', avatar: 'SC', status: 'draft', model: 'Llama 3.1 8B', updatedAt: 'Draft · 3d ago' },
  { id: 'a4', name: 'Data Analyst', description: 'Runs analysis workflows and charts from warehouse data.', avatar: 'DA', status: 'paused', model: 'Mistral 7B', updatedAt: 'Paused · 1w ago', team: true },
]

// ── Tab definitions ────────────────────────────────────────────────

const TABS: Array<{ id: AgentTab; label: string; icon: typeof FileText }> = [
  { id: 'instructions', label: 'Instructions', icon: FileText },
  { id: 'knowledge', label: 'Knowledge', icon: BookOpen },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'connected', label: 'Connected Apps', icon: Plug2 },
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'testing', label: 'Testing', icon: FlaskConical },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

const TAB_HINT: Record<AgentTab, string> = {
  instructions: 'System prompt & behavior',
  knowledge: 'Files, docs & RAG',
  skills: 'Curated capabilities',
  connected: 'MCP only',
  tools: 'Function tools',
  memory: 'Long-term memory',
  workflows: 'Multi-step runs',
  testing: 'Playground & evals',
  analytics: 'Usage & quality',
  versions: 'History & restore',
  permissions: 'Access & scopes',
  settings: 'Agent settings',
}

// ── Small helpers ──────────────────────────────────────────────────

function StatusDot({ status }: { status: AgentSummary['status'] }): React.JSX.Element {
  if (status === 'active') return <span className="agent-dot agent-dot--active" aria-hidden />
  if (status === 'paused') return <span className="agent-dot agent-dot--paused" aria-hidden />
  return <span className="agent-dot agent-dot--draft" aria-hidden />
}

// ── Component ──────────────────────────────────────────────────────

export function AgentsPage(): React.JSX.Element {
  const [nav, setNav] = useState<AgentsNavId>('all')
  const [selectedId, setSelectedId] = useState<string>('a1')
  const [tab, setTab] = useState<AgentTab>('instructions')
  const [contextOpen, setContextOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [instructionsDraft, setInstructionsDraft] = useState(
    'You are Sovara Researcher — a careful, source-grounded assistant.\n\n- Answer only from provided knowledge + tools; cite sources.\n- Prefer local models; never leak private files.\n- If uncertain, say so and propose next steps.\n- Keep answers concise, structured, and actionable.',
  )

  const selected = MOCK_AGENTS.find((a) => a.id === selectedId) ?? MOCK_AGENTS[0]

  const filtered = MOCK_AGENTS.filter((a) => {
    if (nav === 'favorites' && !a.starred) return false
    if (nav === 'team' && !a.team) return false
    if (nav === 'archived') return false
    if (nav === 'templates') return false
    if (nav === 'recent') return true // mock: show all for recent
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!a.name.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div className="agents-workspace" aria-label="Agents workspace">
      {/* ── Left: Agents nav ── */}
      <aside className="agents-nav" aria-label="Agents navigation">
        <button type="button" className="agents-create-btn" onClick={() => setSelectedId(MOCK_AGENTS[0].id)}>
          <Plus size={14} aria-hidden />
          Create New Agent
        </button>

        <div className="agents-search-wrap">
          <Search size={13} aria-hidden className="agents-search-icon" />
          <input
            className="agents-search-input"
            placeholder="Search agents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search agents"
          />
        </div>

        <nav className="agents-nav-list" aria-label="Agent groups">
          <div className="agents-nav-group">
            <div className="agents-nav-group-label">Workspace</div>
            <button type="button" className={`agents-nav-item ${nav === 'all' ? 'active' : ''}`} onClick={() => setNav('all')}>
              <Bot size={14} aria-hidden className="agents-nav-icon" />
              <span className="agents-nav-text">All Agents</span>
              <span className="agents-nav-count">{MOCK_AGENTS.length}</span>
            </button>
            <button type="button" className={`agents-nav-item ${nav === 'favorites' ? 'active' : ''}`} onClick={() => setNav('favorites')}>
              <Star size={14} aria-hidden className="agents-nav-icon" />
              <span className="agents-nav-text">Favorites</span>
              <span className="agents-nav-count">{MOCK_AGENTS.filter((a) => a.starred).length}</span>
            </button>
            <button type="button" className={`agents-nav-item ${nav === 'recent' ? 'active' : ''}`} onClick={() => setNav('recent')}>
              <Clock3 size={14} aria-hidden className="agents-nav-icon" />
              <span className="agents-nav-text">Recent</span>
            </button>
            <button type="button" className={`agents-nav-item ${nav === 'team' ? 'active' : ''}`} onClick={() => setNav('team')}>
              <UsersRound size={14} aria-hidden className="agents-nav-icon" />
              <span className="agents-nav-text">Team Agents</span>
              <span className="agents-nav-count">{MOCK_AGENTS.filter((a) => a.team).length}</span>
            </button>
          </div>

          <div className="agents-nav-group">
            <div className="agents-nav-group-label">Library</div>
            <button type="button" className={`agents-nav-item ${nav === 'templates' ? 'active' : ''}`} onClick={() => setNav('templates')}>
              <LayoutTemplate size={14} aria-hidden className="agents-nav-icon" />
              <span className="agents-nav-text">Templates</span>
            </button>
            <button type="button" className={`agents-nav-item ${nav === 'archived' ? 'active' : ''}`} onClick={() => setNav('archived')}>
              <Archive size={14} aria-hidden className="agents-nav-icon" />
              <span className="agents-nav-text">Archived</span>
              <span className="agents-nav-count">0</span>
            </button>
          </div>
        </nav>

        <div className="agents-nav-agentlist" role="list" aria-label="Agents">
          {nav === 'templates' ? (
            <div className="agents-nav-empty">
              <LayoutTemplate size={18} aria-hidden />
              <span className="small muted">Templates coming soon — start from a blank agent.</span>
            </div>
          ) : nav === 'archived' ? (
            <div className="agents-nav-empty">
              <Archive size={18} aria-hidden />
              <span className="small muted">No archived agents.</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="agents-nav-empty small muted">No agents match your search.</div>
          ) : (
            filtered.map((a) => (
              <button
                key={a.id}
                type="button"
                role="listitem"
                className={`agents-agent-row ${selectedId === a.id ? 'active' : ''}`}
                onClick={() => setSelectedId(a.id)}
                aria-current={selectedId === a.id ? 'true' : undefined}
                aria-label={`Open ${a.name}`}
              >
                <span className="agents-agent-avatar" aria-hidden>{a.avatar}</span>
                <span className="agents-agent-main">
                  <span className="agents-agent-name">
                    {a.name}
                    {a.starred ? <Star size={10} aria-hidden className="agents-star" /> : null}
                  </span>
                  <span className="agents-agent-meta">
                    <StatusDot status={a.status} />
                    {a.status === 'active' ? 'Active' : a.status === 'paused' ? 'Paused' : 'Draft'} · {a.model}
                  </span>
                </span>
                <ChevronRight size={12} aria-hidden className="agents-agent-chevron" />
              </button>
            ))
          )}
        </div>

        <div className="agents-nav-foot">
          <span className="small muted">Local-first · MCP tools isolated per agent</span>
        </div>
      </aside>

      {/* ── Center: overview + tabs ── */}
      <div className="agents-center">
        {/* Overview card */}
        <div className="agents-overview">
          <div className="agents-overview-top">
            <div className="agents-overview-avatar" aria-hidden>{selected.avatar}</div>
            <div className="agents-overview-main">
              <div className="agents-overview-title-row">
                <h1 className="agents-overview-name">{selected.name}</h1>
                <span className={`agents-status-pill agents-status-pill--${selected.status}`}>
                  <StatusDot status={selected.status} />
                  {selected.status === 'active' ? 'Active' : selected.status === 'paused' ? 'Paused' : 'Draft'}
                </span>
                <span className="agents-model-pill">
                  <Database size={11} aria-hidden />
                  {selected.model}
                </span>
              </div>
              <p className="agents-overview-desc">{selected.description}</p>
              <div className="agents-overview-meta">
                <span className="agents-meta-item"><Clock3 size={11} aria-hidden /> {selected.updatedAt}</span>
                <span className="agents-meta-sep" aria-hidden>·</span>
                <span className="agents-meta-item"><Bot size={11} aria-hidden /> {selected.id}</span>
                <span className="agents-meta-sep" aria-hidden>·</span>
                <span className="agents-meta-item"><ShieldCheck size={11} aria-hidden /> Private to you</span>
              </div>
            </div>
            <div className="agents-overview-actions">
              <button type="button" className="btn btn-sm" aria-label="Duplicate agent">
                <Copy size={12} aria-hidden /> Duplicate
              </button>
              <button type="button" className="btn btn-sm" aria-label="Archive agent">
                <Archive size={12} aria-hidden /> Archive
              </button>
              <button type="button" className="btn btn-sm btn-stop" aria-label="Delete agent">
                <Trash2 size={12} aria-hidden />
              </button>
              <button type="button" className="agents-kebab" aria-label="More actions"><MoreHorizontal size={14} aria-hidden /></button>
            </div>
          </div>
          <div className="agents-overview-stats">
            <div className="agents-stat">
              <span className="agents-stat-label">Knowledge</span>
              <span className="agents-stat-value">12 files</span>
            </div>
            <div className="agents-stat">
              <span className="agents-stat-label">Skills</span>
              <span className="agents-stat-value">4 active</span>
            </div>
            <div className="agents-stat">
              <span className="agents-stat-label">MCP apps</span>
              <span className="agents-stat-value">3 connected</span>
            </div>
            <div className="agents-stat">
              <span className="agents-stat-label">Runs</span>
              <span className="agents-stat-value">1.2k · 98% success</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="agents-tabs" role="tablist" aria-label="Agent sections">
          {TABS.map((t) => {
            const ActiveIcon = t.icon
            const isActive = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`agents-tab ${isActive ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                <ActiveIcon size={13} aria-hidden />
                <span className="agents-tab-label">{t.label}</span>
                {t.id === 'connected' ? <span className="agents-tab-badge">MCP only</span> : null}
              </button>
            )
          })}
        </div>
        <div className="agents-tab-hint muted small" aria-live="polite">{TAB_HINT[tab]}</div>

        {/* Tab panels */}
        <div className="agents-panel" role="tabpanel" aria-label={`${TABS.find((t) => t.id === tab)?.label} panel`}>
          {tab === 'instructions' ? (
            <div className="agents-tab-content">
              <div className="agents-field">
                <div className="agents-field-head">
                  <label className="agents-field-label" htmlFor="agent-instructions">System instructions</label>
                  <span className="agents-field-meta">Used as the agent system prompt · Markdown supported</span>
                </div>
                <textarea
                  id="agent-instructions"
                  className="agents-textarea"
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  rows={10}
                  placeholder="Describe how this agent should behave, what it can do, and what to avoid…"
                />
                <div className="agents-field-actions">
                  <span className="small muted">{instructionsDraft.length} chars</span>
                  <span className="agents-field-spacer" />
                  <button type="button" className="btn btn-sm">Reset</button>
                  <button type="button" className="btn btn-sm primary">Save instructions</button>
                </div>
              </div>
              <div className="agents-help-card">
                <div className="agents-help-title"><FileText size={13} aria-hidden /> Tips</div>
                <ul className="agents-help-list">
                  <li>Be explicit about sources, tool use, and when to ask for clarification.</li>
                  <li>Keep it portable — this prompt ships with Versions so you can diff & restore.</li>
                  <li>Use Knowledge + Skills to ground behavior instead of stuffing everything here.</li>
                </ul>
              </div>
            </div>
          ) : null}

          {tab === 'knowledge' ? (
            <div className="agents-tab-content">
              <div className="agents-toolbar">
                <button type="button" className="btn btn-sm primary"><Plus size={12} aria-hidden /> Add knowledge</button>
                <button type="button" className="btn btn-sm"><Search size={12} aria-hidden /> Search</button>
                <span className="agents-toolbar-hint muted small">RAG is project-scoped · Files stay on disk</span>
              </div>
              <div className="agents-table-wrap">
                <table className="agents-table" aria-label="Knowledge files">
                  <thead><tr><th>Name</th><th>Source</th><th>Indexed</th><th /></tr></thead>
                  <tbody>
                    {[
                      { name: 'product-spec.md', source: 'Upload', indexed: 'Indexed · 2.1k chunks' },
                      { name: 'support-handbook.pdf', source: 'Upload', indexed: 'Indexed · 8.4k chunks' },
                      { name: 'changelog.jsonl', source: 'Folder sync', indexed: 'Syncing…' },
                    ].map((r) => (
                      <tr key={r.name}>
                        <td className="agents-table-name"><FileText size={12} aria-hidden /> {r.name}</td>
                        <td className="muted small">{r.source}</td>
                        <td><span className="agents-chip">{r.indexed}</span></td>
                        <td><button type="button" className="agents-icon-btn" aria-label={`Options for ${r.name}`}><MoreHorizontal size={12} aria-hidden /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === 'skills' ? (
            <div className="agents-tab-content">
              <div className="agents-cards">
                {[
                  { name: 'Deep Research', desc: 'Multi-step web + local search with citations.', on: true },
                  { name: 'Code Review', desc: 'Diff-aware review with risk scoring.', on: true },
                  { name: 'Data Analysis', desc: 'Run notebooks, emit charts & tables.', on: false },
                  { name: 'Support Drafts', desc: 'Draft replies from knowledge base.', on: true },
                ].map((s) => (
                  <div key={s.name} className="agents-skill-card">
                    <div className="agents-skill-head">
                      <span className="agents-skill-icon"><Sparkles size={14} aria-hidden /></span>
                      <span className="agents-skill-name">{s.name}</span>
                      <span className={`agents-toggle ${s.on ? 'on' : ''}`} role="switch" aria-checked={s.on} tabIndex={0} aria-label={`Toggle ${s.name}`}>
                        <span className="agents-toggle-thumb" />
                      </span>
                    </div>
                    <p className="agents-skill-desc">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === 'connected' ? (
            <div className="agents-tab-content">
              <div className="agents-callout">
                <Plug2 size={14} aria-hidden />
                <span><strong>Connected Apps</strong> — MCP only. No OAuth, no browser embeds. Each server is spawned per agent and can be paused without touching other agents.</span>
              </div>
              <div className="agents-cards">
                {[
                  { name: 'Filesystem', desc: 'Scoped folder access for this agent.', by: 'local · stdio', on: true },
                  { name: 'Brave Search', desc: 'Web search via MCP — local key.', by: 'community · http', on: true },
                  { name: 'SQLite', desc: 'Query the project DB read-only.', by: 'local · stdio', on: false },
                ].map((m) => (
                  <div key={m.name} className="agents-mcp-card">
                    <div className="agents-mcp-head">
                      <span className="agents-mcp-icon"><Plug2 size={14} aria-hidden /></span>
                      <span className="agents-mcp-name">{m.name}</span>
                      <span className={`agents-pill ${m.on ? 'agents-pill--on' : ''}`}>{m.on ? 'Connected' : 'Paused'}</span>
                    </div>
                    <p className="agents-skill-desc">{m.desc}</p>
                    <div className="agents-mcp-foot">
                      <span className="small muted">{m.by}</span>
                      <button type="button" className="btn btn-sm">{m.on ? 'Configure' : 'Connect'}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === 'tools' ? (
            <div className="agents-tab-content">
              <div className="agents-toolbar">
                <span className="small muted">Tools are function calls exposed to the model · MCP servers appear here when enabled.</span>
              </div>
              <div className="agents-table-wrap">
                <table className="agents-table" aria-label="Tools">
                  <thead><tr><th>Tool</th><th>Origin</th><th>Enabled</th><th /></tr></thead>
                  <tbody>
                    {[
                      { tool: 'search_local', origin: 'MCP · Filesystem', on: true },
                      { tool: 'web_search', origin: 'MCP · Brave Search', on: true },
                      { tool: 'query_db', origin: 'MCP · SQLite', on: false },
                    ].map((r) => (
                      <tr key={r.tool}>
                        <td className="agents-table-name"><Wrench size={12} aria-hidden /> {r.tool}</td>
                        <td className="muted small">{r.origin}</td>
                        <td><span className={`agents-pill ${r.on ? 'agents-pill--on' : ''}`}>{r.on ? 'On' : 'Off'}</span></td>
                        <td><button type="button" className="btn btn-sm ghost">View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === 'memory' ? (
            <div className="agents-tab-content">
              <div className="agents-field">
                <div className="agents-field-head">
                  <span className="agents-field-label">Memory</span>
                  <span className="agents-field-meta">Long-term preferences & facts — scoped to this agent</span>
                </div>
                <div className="agents-memory-grid">
                  <label className="agents-memory-item">
                    <input type="checkbox" defaultChecked /> Remember user preferences across sessions
                  </label>
                  <label className="agents-memory-item">
                    <input type="checkbox" defaultChecked /> Persist tool outputs as memories (with consent)
                  </label>
                  <label className="agents-memory-item">
                    <input type="checkbox" /> Auto-compact memories weekly
                  </label>
                </div>
                <div className="agents-table-wrap" style={{ marginTop: 12 }}>
                  <table className="agents-table" aria-label="Memories">
                    <thead><tr><th>Memory</th><th>Updated</th><th /></tr></thead>
                    <tbody>
                      <tr><td className="small">Prefers concise, bullet-point answers</td><td className="muted small">2d ago</td><td><button type="button" className="agents-icon-btn" aria-label="Remove memory"><Trash2 size={12} aria-hidden /></button></td></tr>
                      <tr><td className="small">Project Acme uses pnpm + Electron</td><td className="muted small">5d ago</td><td><button type="button" className="agents-icon-btn" aria-label="Remove memory"><Trash2 size={12} aria-hidden /></button></td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'workflows' ? (
            <div className="agents-tab-content">
              <div className="agents-toolbar">
                <button type="button" className="btn btn-sm primary"><Workflow size={12} aria-hidden /> New workflow</button>
                <span className="muted small">Trigger: manual · schedule · webhook (MCP)</span>
              </div>
              <div className="agents-stack">
                {[
                  { name: 'Weekly research digest', steps: 'Search → Synthesize → Draft → Notify', runs: 'Last run 2h ago · 3 steps' },
                  { name: 'Review PRs on push', steps: 'On git push → Review diff → Comment', runs: 'Paused' },
                ].map((w) => (
                  <div key={w.name} className="agents-row-card">
                    <div className="agents-row-main">
                      <span className="agents-row-title">{w.name}</span>
                      <span className="small muted">{w.steps}</span>
                    </div>
                    <span className="agents-chip">{w.runs}</span>
                    <button type="button" className="btn btn-sm">Open</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === 'testing' ? (
            <div className="agents-tab-content">
              <div className="agents-testing">
                <div className="agents-testing-chat">
                  <div className="agents-testing-head">
                    <MessageSquare size={13} aria-hidden /> Playground
                    <span className="agents-chip">Local run · no cloud</span>
                  </div>
                  <div className="agents-testing-bubble user">Summarize the support handbook in 5 bullets.</div>
                  <div className="agents-testing-bubble assistant">1. Scope… 2. SLA… 3. Escalation… <span className="muted small">(streaming · 0.8s)</span></div>
                  <div className="agents-testing-composer">
                    <input className="agents-mini-input" placeholder="Test a prompt…" aria-label="Test prompt" />
                    <button type="button" className="btn btn-sm primary">Run</button>
                  </div>
                </div>
                <div className="agents-testing-side">
                  <div className="agents-field-label">Evaluation</div>
                  <div className="agents-stack">
                    <div className="agents-row-card"><span className="small">Groundedness</span><span className="agents-pill agents-pill--on">92%</span></div>
                    <div className="agents-row-card"><span className="small">Latency p50</span><span className="agents-chip">1.2s</span></div>
                    <div className="agents-row-card"><span className="small">Tool success</span><span className="agents-pill agents-pill--on">98%</span></div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'analytics' ? (
            <div className="agents-tab-content">
              <div className="agents-stats-grid">
                <div className="agents-stat-card"><span className="agents-stat-label">Runs (7d)</span><span className="agents-stat-big">342</span><span className="small muted">+12% vs prior</span></div>
                <div className="agents-stat-card"><span className="agents-stat-label">Success rate</span><span className="agents-stat-big">98.1%</span><span className="small muted">3 failures</span></div>
                <div className="agents-stat-card"><span className="agents-stat-label">Avg latency</span><span className="agents-stat-big">1.1s</span><span className="small muted">p50 0.7s · p95 2.4s</span></div>
              </div>
              <div className="agents-table-wrap">
                <table className="agents-table" aria-label="Recent runs">
                  <thead><tr><th>When</th><th>Input</th><th>Status</th><th>Latency</th></tr></thead>
                  <tbody>
                    <tr><td className="small">2h ago</td><td className="small">Research Q3 roadmap</td><td><span className="agents-pill agents-pill--on">Success</span></td><td className="small muted">1.3s</td></tr>
                    <tr><td className="small">5h ago</td><td className="small">Summarize handbook.pdf</td><td><span className="agents-pill agents-pill--on">Success</span></td><td className="small muted">0.9s</td></tr>
                    <tr><td className="small">1d ago</td><td className="small">Draft support reply</td><td><span className="agents-pill agents-pill--warn">Retry</span></td><td className="small muted">2.8s</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {tab === 'versions' ? (
            <div className="agents-tab-content">
              <div className="agents-stack">
                {[
                  { v: 'v12', when: '2h ago · by you', note: 'Tightened instructions, added citations rule' },
                  { v: 'v11', when: '1d ago · by you', note: 'Added SQLite MCP, disabled code tool' },
                  { v: 'v10', when: '3d ago · auto', note: 'Snapshot before publish' },
                ].map((r) => (
                  <div key={r.v} className="agents-row-card">
                    <span className="agents-version-badge">{r.v}</span>
                    <span className="agents-row-main">
                      <span className="agents-row-title">{r.note}</span>
                      <span className="small muted">{r.when}</span>
                    </span>
                    <button type="button" className="btn btn-sm">Restore</button>
                    <button type="button" className="btn btn-sm ghost"><History size={12} aria-hidden /> Diff</button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {tab === 'permissions' ? (
            <div className="agents-tab-content">
              <div className="agents-help-card">
                <div className="agents-help-title"><ShieldCheck size={13} aria-hidden /> Scopes</div>
                <div className="agents-stack">
                  <label className="agents-switch-row"><span><strong>Can read knowledge</strong><span className="small muted"> — files & RAG chunks</span></span><span className="agents-toggle on" role="switch" aria-checked><span className="agents-toggle-thumb" /></span></label>
                  <label className="agents-switch-row"><span><strong>Can call tools</strong><span className="small muted"> — only enabled Tools & MCP apps</span></span><span className="agents-toggle on" role="switch" aria-checked><span className="agents-toggle-thumb" /></span></label>
                  <label className="agents-switch-row"><span><strong>Team visible</strong><span className="small muted"> — appears under Team Agents</span></span><span className="agents-toggle" role="switch" aria-checked={false}><span className="agents-toggle-thumb" /></span></label>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'settings' ? (
            <div className="agents-tab-content">
              <div className="agents-field">
                <label className="agents-field-label" htmlFor="agent-name">Agent name</label>
                <input id="agent-name" className="agents-mini-input" defaultValue={selected.name} />
              </div>
              <div className="agents-field">
                <label className="agents-field-label" htmlFor="agent-desc">Description</label>
                <textarea id="agent-desc" className="agents-textarea" rows={3} defaultValue={selected.description} />
              </div>
              <div className="agents-field">
                <span className="agents-field-label">Danger zone</span>
                <div className="agents-danger">
                  <span className="small">Delete this agent and its versions. Knowledge files stay on disk.</span>
                  <button type="button" className="btn btn-sm btn-stop"><Trash2 size={12} aria-hidden /> Delete agent</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Collapse toggle (mobile/tablet keeps it visible) */}
        <button
          type="button"
          className="agents-context-toggle"
          onClick={() => setContextOpen((v) => !v)}
          aria-label={contextOpen ? 'Collapse context panel' : 'Expand context panel'}
          aria-expanded={contextOpen}
        >
          {contextOpen ? <ChevronRight size={12} aria-hidden /> : <PanelRight size={12} aria-hidden />}
          <span className="small">{contextOpen ? 'Hide context' : 'Show context'}</span>
        </button>
      </div>

      {/* ── Right: context panel ── */}
      <aside className={`agents-context ${contextOpen ? '' : 'collapsed'}`} aria-label="Live context" aria-hidden={!contextOpen}>
        <div className="agents-context-head">
          <span className="agents-context-title"><Activity size={13} aria-hidden /> Live status</span>
          <button type="button" className="agents-icon-btn" onClick={() => setContextOpen(false)} aria-label="Collapse context panel">
            <ChevronRight size={14} aria-hidden />
          </button>
        </div>

        <div className="agents-context-section">
          <div className="agents-context-label">Agent</div>
          <div className="agents-context-card">
            <div className="agents-context-row">
              <CircleDot size={12} aria-hidden className="agents-live-dot" />
              <span className="small"><strong>Idle</strong> · ready for run</span>
            </div>
            <div className="agents-context-row small muted">
              <Bot size={11} aria-hidden /> {selected.model}
            </div>
            <div className="agents-context-row small muted">
              <Zap size={11} aria-hidden /> No active run · last 2h ago
            </div>
          </div>
        </div>

        <div className="agents-context-section">
          <div className="agents-context-label">Active tools</div>
          <div className="agents-context-card">
            <div className="agents-tool-row">
              <Plug2 size={12} aria-hidden />
              <span className="small">Filesystem</span>
              <span className="agents-live-pill">MCP</span>
              <CheckCircle2 size={12} aria-hidden className="agents-check" />
            </div>
            <div className="agents-tool-row">
              <Plug2 size={12} aria-hidden />
              <span className="small">Brave Search</span>
              <span className="agents-live-pill">MCP</span>
              <CheckCircle2 size={12} aria-hidden className="agents-check" />
            </div>
            <div className="agents-tool-row muted">
              <Wrench size={12} aria-hidden />
              <span className="small">query_db</span>
              <span className="small muted">paused</span>
            </div>
            <button type="button" className="btn btn-sm ghost" style={{ marginTop: 6, width: '100%' }}>
              <ExternalLink size={11} aria-hidden /> Manage in Tools
            </button>
          </div>
        </div>

        <div className="agents-context-section">
          <div className="agents-context-label">Recent activity</div>
          <div className="agents-context-card agents-activity">
            {[
              { t: '2h ago', msg: 'Run succeeded · research digest', ok: true },
              { t: '5h ago', msg: 'Knowledge synced · support-handbook.pdf', ok: true },
              { t: '1d ago', msg: 'Tool paused · query_db (rate limit)', ok: false },
            ].map((a) => (
              <div key={a.t + a.msg} className="agents-activity-row">
                <span className="small muted">{a.t}</span>
                <span className="small">{a.msg}</span>
                <span className={`agents-activity-dot ${a.ok ? 'ok' : 'warn'}`} aria-hidden />
              </div>
            ))}
            <button type="button" className="btn btn-sm ghost" style={{ marginTop: 6, width: '100%' }}>
              <BarChart3 size={11} aria-hidden /> View analytics
            </button>
          </div>
        </div>

        <div className="agents-context-foot small muted">
          Context is live and per-agent — refresh is automatic.
        </div>
      </aside>

      {/* Floating expand when collapsed */}
      {!contextOpen ? (
        <button type="button" className="agents-context-fab" onClick={() => setContextOpen(true)} aria-label="Show context panel">
          <PanelRight size={14} aria-hidden />
          Context
        </button>
      ) : null}
    </div>
  )
}
