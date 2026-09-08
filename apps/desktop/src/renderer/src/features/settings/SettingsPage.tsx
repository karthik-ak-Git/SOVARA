import { useState, useCallback, useEffect, type ReactElement } from 'react'
import {
  Settings, User, Cpu, CreditCard, Palette, MessageSquare,
  Link2, Puzzle, Globe, BookOpen, Monitor, Server, FileText,
  RotateCcw, ChevronRight, Check, Cloud, ArrowLeft
} from 'lucide-react'
import { getTotalUsage, getUsageByModel, listArchivedSessions, unarchiveSession, scanSkills, toggleSkillsSource, getAppSettings, setAppSettings, checkForUpdatesNow, listDiscoveredModels, listTools, dispatchTool, getPythonSetupStatus, ensurePythonSetup, listMcpServers, addMcpServer, removeMcpServer, toggleMcpServer, probeMcpServer, type TokenUsage, type ModelUsage, type SessionHeaderView, type SkillsSource, type AppSettingsState, type UpdateCheckView, type ToolDefinitionView, type PythonStatusView, type McpServerView } from '../../lib/ipc'
import type { DiscoveredModel } from '@shared/types/models'
import { ExplorePage } from '../explore/ExplorePage'
import { LibraryPage } from '../library/LibraryPage'

type SettingsSection =
  | 'general'
  | 'agent'
  | 'billing'
  | 'appearance'
  | 'sessions'
  | 'connected-apps'
  | 'skills'
  | 'explore'
  | 'library'
  | 'loaded-instances'
  | 'local-model-api'
  | 'local-model-defaults'
  | 'runtime'

interface SettingsNavGroup {
  label: string
  items: Array<{ id: SettingsSection; label: string; icon: ReactElement }>
}

const NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: 'Settings',
    items: [
      { id: 'general', label: 'General', icon: <Settings size={16} /> },
      { id: 'agent', label: 'Agent', icon: <Cpu size={16} /> },
      { id: 'billing', label: 'Usage', icon: <CreditCard size={16} /> },
      { id: 'appearance', label: 'Appearance', icon: <Palette size={16} /> },
      { id: 'sessions', label: 'Sessions', icon: <MessageSquare size={16} /> },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { id: 'connected-apps', label: 'Connected Apps', icon: <Link2 size={16} /> },
      { id: 'skills', label: 'Skills', icon: <Puzzle size={16} /> },
    ],
  },
  {
    label: 'Local Models',
    items: [
      { id: 'explore', label: 'Explore', icon: <Globe size={16} /> },
      { id: 'library', label: 'Library', icon: <BookOpen size={16} /> },
      { id: 'loaded-instances', label: 'Loaded Instances', icon: <Monitor size={16} /> },
      { id: 'local-model-api', label: 'Local Model API', icon: <Server size={16} /> },
      { id: 'local-model-defaults', label: 'Local Model Defaults', icon: <FileText size={16} /> },
      { id: 'runtime', label: 'Runtime', icon: <RotateCcw size={16} /> },
    ],
  },
]

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
}

function Toggle({ checked, onChange, label, description }: ToggleProps): ReactElement {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {description ? <div className="settings-row-desc">{description}</div> : null}
      </div>
      <button
        type="button"
        className={`settings-toggle ${checked ? 'settings-toggle--on' : ''}`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      >
        <span className="settings-toggle-thumb" />
      </button>
    </div>
  )
}

interface InfoRowProps {
  label: string
  value: string
  badge?: string
}

function InfoRow({ label, value, badge }: InfoRowProps): ReactElement {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
      </div>
      <div className="settings-row-value">
        <span className="settings-info-chip">{value}</span>
        {badge ? <span className="settings-info-badge">{badge}</span> : null}
      </div>
    </div>
  )
}

interface ActionButtonProps {
  label: string
  onClick?: () => void
  variant?: 'default' | 'primary'
}

function ActionButton({ label, onClick, variant = 'default' }: ActionButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={`settings-action-btn ${variant === 'primary' ? 'settings-action-btn--primary' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

interface PermissionOptionProps {
  id: string
  label: string
  description: string
  selected: boolean
  onSelect: () => void
}

function PermissionOption({ id, label, description, selected, onSelect }: PermissionOptionProps): ReactElement {
  return (
    <button
      type="button"
      className={`settings-perm-option ${selected ? 'settings-perm-option--selected' : ''}`}
      onClick={onSelect}
      aria-labelledby={`perm-label-${id}`}
      aria-describedby={`perm-desc-${id}`}
    >
      <div className="settings-perm-radio">
        {selected ? <Check size={12} /> : null}
      </div>
      <div className="settings-perm-text">
        <div className="settings-perm-label" id={`perm-label-${id}`}>{label}</div>
        <div className="settings-perm-desc" id={`perm-desc-${id}`}>{description}</div>
      </div>
    </button>
  )
}

interface McpPreset {
  id: string
  name: string
  description: string
  provider: string
  icon: string
}

// ponytail: dynamic brand marks — fetch real logos, never hard-code SVG paths
// Uses SimpleIcons CDN for known brands + favicon fallback for custom http endpoints.
// No new dep: native <img> + onError fallback to initials.
function McpLogo({ id, size = 28 }: { id: string; size?: number }): ReactElement {
  const s = size
  const [failed, setFailed] = useState(false)
  // Derive CDN slug — id is already a brand slug (github, linear, etc.) or provider-derived
  const slug = id.toLowerCase().replace(/[^a-z0-9]/g, '')
  const src = `https://cdn.simpleicons.org/${slug}`
  useEffect(() => setFailed(false), [src])
  if (failed || !slug) {
    return (
      <div style={{ width: s, height: s, borderRadius: 8, background: 'var(--panel-2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(s * 0.4), fontWeight: 700, color: 'var(--muted)' }}>
        {id.slice(0, 2).toUpperCase()}
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      width={s}
      height={s}
      style={{ width: s, height: s, borderRadius: 8, background: '#fff', padding: 4, boxSizing: 'border-box', border: '1px solid var(--border)' }}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

function McpServerLogo({ server, size = 32 }: { server: McpServerView; size?: number }): ReactElement {
  // For http servers, try favicon of the endpoint host first (more accurate for custom MCPs)
  const [faviconFailed, setFaviconFailed] = useState(false)
  useEffect(() => setFaviconFailed(false), [server.id])
  if (server.transport === 'http' && server.endpoint && !faviconFailed) {
    try {
      const host = new URL(server.endpoint).hostname
      const favSrc = `https://icon.horse/icon/${host}`
      // Also try SimpleIcons for provider as secondary if favicon 404 — chain via McpLogo fallback
      return (
        <img
          src={favSrc}
          alt=""
          width={size}
          height={size}
          style={{ width: size, height: size, borderRadius: 8, background: '#fff', padding: 4, border: '1px solid var(--border)' }}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFaviconFailed(true)}
        />
      )
    } catch {
      // fall through to brand logo
    }
  }
  const lid = server.provider.toLowerCase().includes('github') ? 'github' : server.provider.toLowerCase().includes('linear') ? 'linear' : server.provider.toLowerCase().includes('notion') ? 'notion' : server.provider.toLowerCase().includes('sentry') ? 'sentry' : server.provider.toLowerCase().includes('atlassian') ? 'atlassian' : server.provider.toLowerCase().includes('jira') || server.provider.toLowerCase().includes('confluence') ? 'atlassian' : server.name.toLowerCase()
  return <McpLogo id={lid} size={size} />
}

const MCP_PRESETS: McpPreset[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Work with repositories, issues, pull requests, and code.',
    provider: 'GitHub',
    icon: '🐙',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Find, create, and update issues, projects, and comments.',
    provider: 'Linear',
    icon: '📐',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search, read, and update pages and databases in your workspace.',
    provider: 'Notion',
    icon: '📋',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Investigate errors, traces, and application performance.',
    provider: 'Sentry',
    icon: '🔍',
  },
  {
    id: 'atlassian',
    name: 'Atlassian',
    description: 'Work with Jira issues, Confluence pages, and team knowledge.',
    provider: 'Atlassian',
    icon: '🔺',
  },
]

const MCP_PRESET_CMDS: Record<string, string> = {
  github: 'npx -y @modelcontextprotocol/server-github',
  linear: 'npx -y @modelcontextprotocol/server-linear',
  notion: 'npx -y @notionhq/mcp-server',
  sentry: 'npx -y @sentry/mcp-server',
  atlassian: 'npx -y @atlassian/mcp-server',
}

export function SettingsPage({ onBack }: { onBack?: () => void }): ReactElement {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')

  // Appearance — derived from persisted appSettings, not local state
  // ponytail: no local useState mirror, single source is appSettings + applyPatch
  // Token utilization
  const [totalUsage, setTotalUsage] = useState<TokenUsage>({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([])
  const [usageLoaded, setUsageLoaded] = useState(false)

  // Sessions — renameAfterFork is persisted via appSettings, not local state
  // ponytail: no local mirror, single source is appSettings + applyPatch (consumer reads via getAppSettings when fork lands)
  const [archivedSessions, setArchivedSessions] = useState<SessionHeaderView[]>([])
  const [archivedLoaded, setArchivedLoaded] = useState(false)

  // MCP — real persisted via app_meta JSON (mcpStore), not a mock grid
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([])
  const [mcpLoaded, setMcpLoaded] = useState(false)
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false)
  const [mcpDialogPreset, setMcpDialogPreset] = useState<McpPreset | null>(null)
  const [mcpError, setMcpError] = useState<string | null>(null)
  const [mcpForm, setMcpForm] = useState<{ name: string; provider: string; transport: 'stdio' | 'http'; command: string; endpoint: string }>({
    name: '',
    provider: '',
    transport: 'stdio',
    command: '',
    endpoint: '',
  })

  // Skills settings
  const [skillsSources, setSkillsSources] = useState<SkillsSource[]>([])
  const [skillsLoaded, setSkillsLoaded] = useState(false)

  // Agent settings — discovered models + registered tools for the Agent page.
  const [agentModels, setAgentModels] = useState<DiscoveredModel[]>([])
  const [agentTools, setAgentTools] = useState<ToolDefinitionView[]>([])
  const [agentMetaLoaded, setAgentMetaLoaded] = useState(false)
  const [instructionsDraft, setInstructionsDraft] = useState<string | null>(null)
  const [testingSearch, setTestingSearch] = useState(false)
  const [searchTest, setSearchTest] = useState<string | null>(null)
  const [engineStatus, setEngineStatus] = useState<PythonStatusView | null>(null)
  const [retryingEngine, setRetryingEngine] = useState(false)

  const refreshEngineStatus = useCallback(async (): Promise<void> => {
    try {
      setEngineStatus(await getPythonSetupStatus())
    } catch {
      // setup IPC unavailable — row keeps its loading state
    }
  }, [])

  const retryEngineSetup = useCallback(async (): Promise<void> => {
    setRetryingEngine(true)
    try {
      setEngineStatus(await ensurePythonSetup())
    } catch {
      // error state surfaces on the next refresh
    } finally {
      setRetryingEngine(false)
      void refreshEngineStatus()
    }
  }, [refreshEngineStatus])

  // General settings — loaded from main (SQLite), every control below is live.
  const [appSettings, setAppSettingsState] = useState<AppSettingsState | null>(null)
  const [generalLoaded, setGeneralLoaded] = useState(false)
  const [feedDraft, setFeedDraft] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<UpdateCheckView | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)

  const applyPatch = useCallback(async (patch: Parameters<typeof setAppSettings>[0]): Promise<void> => {
    setGeneralError(null)
    try {
      const next = await setAppSettings(patch)
      setAppSettingsState(next)
      if (patch.updateFeedUrl !== undefined) setFeedDraft(null)
      if (patch.customInstructions !== undefined) setInstructionsDraft(null)
    } catch (e) {
      setGeneralError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const runUpdateCheck = useCallback(async (): Promise<void> => {
    setChecking(true)
    setGeneralError(null)
    try {
      const result = await checkForUpdatesNow()
      setCheckResult(result)
      // Refresh persisted last-check metadata shown under the button.
      try {
        setAppSettingsState(await getAppSettings())
      } catch {
        // status line already shows the result
      }
    } catch (e) {
      setGeneralError(e instanceof Error ? e.message : String(e))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    const loadUsage = async (): Promise<void> => {
      try {
        const [total, byModel] = await Promise.all([getTotalUsage(), getUsageByModel()])
        setTotalUsage(total)
        setModelUsage(byModel)
      } catch {
        // Usage not available yet
      } finally {
        setUsageLoaded(true)
      }
    }
    loadUsage()
  }, [])

  // Load archived sessions when sessions tab is active
  useEffect(() => {
    if (activeSection !== 'sessions') return
    const loadArchived = async (): Promise<void> => {
      try {
        const sessions = await listArchivedSessions()
        setArchivedSessions(sessions)
      } catch {
        // archived sessions not available yet
      } finally {
        setArchivedLoaded(true)
      }
    }
    loadArchived()
  }, [activeSection])

  // Load skills sources when skills tab is active
  useEffect(() => {
    if (activeSection !== 'skills') return
    const loadSkills = async (): Promise<void> => {
      try {
        const sources = await scanSkills()
        setSkillsSources(sources)
      } catch {
        // skills not available
      } finally {
        setSkillsLoaded(true)
      }
    }
    loadSkills()
  }, [activeSection])

  // Load general settings once (version, toggles, feed, last check).
  useEffect(() => {
    const loadGeneral = async (): Promise<void> => {
      try {
        setAppSettingsState(await getAppSettings())
      } catch {
        // settings backend unavailable — rows show loading state
      } finally {
        setGeneralLoaded(true)
      }
    }
    loadGeneral()
  }, [])

  // Load agent metadata once (discovered models + registered tools for counts).
  useEffect(() => {
    const loadAgentMeta = async (): Promise<void> => {
      try {
        const [models, tools] = await Promise.all([
          listDiscoveredModels().catch(() => []),
          listTools().catch(() => []),
        ])
        setAgentModels(models)
        setAgentTools(tools)
      } finally {
        setAgentMetaLoaded(true)
      }
    }
    loadAgentMeta()
    void refreshEngineStatus()
  }, [refreshEngineStatus])

  // Apply appearance to document — single source is appSettings, native CSS does the rest.
  useEffect(() => {
    if (!appSettings) return
    const theme = appSettings.theme as string
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme
    document.documentElement.setAttribute('data-theme', resolved)
    document.documentElement.setAttribute('data-sidebar', appSettings.sidebarBackground)
    document.documentElement.setAttribute('data-diff', appSettings.inlineDiffLayout)
  }, [appSettings?.theme, appSettings?.sidebarBackground, appSettings?.inlineDiffLayout])

  // Follow OS theme when "system" is selected — stdlib matchMedia, no dep.
  useEffect(() => {
    if (appSettings?.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [appSettings?.theme])

  // MCP — load when Connected Apps is active, then probe any stale probing servers
  const reloadMcp = useCallback(async (): Promise<void> => {
    try {
      const servers = await listMcpServers()
      setMcpServers(servers)
      // probe any server stuck in probing (e.g. added but not yet verified)
      for (const s of servers) {
        if (s.enabled && s.status === 'probing') {
          try {
            const probed = await probeMcpServer(s.id)
            setMcpServers((prev) => prev.map((p) => (p.id === probed.id ? probed : p)))
          } catch {
            // keep probing state, will retry on next toggle
          }
        }
      }
    } catch {
      // unavailable
    } finally {
      setMcpLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (activeSection !== 'connected-apps') return
    void reloadMcp()
  }, [activeSection, reloadMcp])

  const openMcpDialog = useCallback((preset: McpPreset | null): void => {
    setMcpError(null)
    setMcpDialogPreset(preset)
    if (preset) {
      setMcpForm({
        name: preset.name,
        provider: preset.provider,
        transport: 'stdio',
        command: MCP_PRESET_CMDS[preset.id] ?? '',
        endpoint: '',
      })
    } else {
      setMcpForm({ name: '', provider: '', transport: 'stdio', command: '', endpoint: '' })
    }
    setMcpDialogOpen(true)
  }, [])

  const submitMcp = useCallback(async (): Promise<void> => {
    setMcpError(null)
    const name = mcpForm.name.trim()
    if (!name) {
      setMcpError('Name is required')
      return
    }
    try {
      const created = await addMcpServer({
        name,
        provider: mcpForm.provider.trim() || 'Custom',
        transport: mcpForm.transport,
        ...(mcpForm.transport === 'stdio' ? { command: mcpForm.command.trim() } : { endpoint: mcpForm.endpoint.trim() }),
      })
      setMcpDialogOpen(false)
      // optimistic add, then real probe
      setMcpServers((prev) => [created, ...prev.filter((p) => p.id !== created.id)])
      setMcpLoaded(true)
      try {
        const probed = await probeMcpServer(created.id)
        setMcpServers((prev) => prev.map((p) => (p.id === probed.id ? probed : p)))
      } catch {
        // probe failure keeps the probing/connected state as stored; reload will sync
        void reloadMcp()
      }
    } catch (e) {
      setMcpError(e instanceof Error ? e.message : String(e))
    }
  }, [mcpForm, reloadMcp])

  const runSearchTest = useCallback(async (): Promise<void> => {
    setTestingSearch(true)
    setSearchTest(null)
    setGeneralError(null)
    try {
      const res = await dispatchTool('web_search', { queries: ['current date and time'] })
      if (res.blocked) {
        setSearchTest(`Blocked: ${res.message ?? res.reason ?? 'not allowed'}`)
      } else if (res.result !== undefined) {
        try {
          const parsed = JSON.parse(res.result) as { error?: string }
          setSearchTest(parsed.error ? `Error: ${parsed.error}` : `OK — ${res.result.slice(0, 220)}${res.result.length > 220 ? '…' : ''}`)
        } catch {
          setSearchTest(`OK — ${res.result.slice(0, 220)}${res.result.length > 220 ? '…' : ''}`)
        }
      } else {
        setSearchTest('No result returned.')
      }
    } catch (e) {
      setSearchTest(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setTestingSearch(false)
    }
  }, [])

  const renderContent = (): ReactElement => {
    switch (activeSection) {
      case 'general': {
        const channelLabel = appSettings?.updateChannel === 'beta' ? 'Beta' : 'Stable'
        const feedValue = feedDraft ?? appSettings?.updateFeedUrl ?? ''
        const lastCheck = checkResult?.message
          ?? (appSettings?.lastUpdateCheckAt
            ? `${appSettings.lastUpdateStatus === 'available' ? 'Update available' : appSettings.lastUpdateStatus === 'error' ? 'Last check failed' : appSettings.lastUpdateStatus === 'no-feed' ? 'No feed configured' : 'Up to date'} · ${new Date(appSettings.lastUpdateCheckAt).toLocaleString()}`
            : 'Never checked')
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">General</h2>
            <div className="settings-group">
              <div className="settings-group-header">App and updates</div>
              <div className="settings-card">
                <InfoRow label="App version" value={appSettings?.version ?? (generalLoaded ? 'unknown' : '…')} badge={channelLabel} />
                <Toggle
                  checked={appSettings?.autoUpdates ?? true}
                  onChange={(v) => void applyPatch({ autoUpdates: v })}
                  label="Automatic updates"
                  description="When a configured update feed reports a new release, download it in the background and show Update when it is ready."
                />
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Update channel</div>
                    <div className="settings-row-desc">Stable tracks tested releases. Beta includes pre-release builds.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={appSettings?.updateChannel ?? 'stable'}
                    onChange={(e) => void applyPatch({ updateChannel: e.target.value as 'stable' | 'beta' })}
                    aria-label="Update channel"
                  >
                    <option value="stable">Stable</option>
                    <option value="beta">Beta</option>
                  </select>
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Update feed</div>
                    <div className="settings-row-desc">Release JSON ({'{ "version": "1.2.3" }'}) or a GitHub Releases API URL. Empty disables checks.</div>
                  </div>
                </div>
                <div className="settings-row">
                  <input
                    className="settings-input"
                    type="url"
                    inputMode="url"
                    placeholder="https://…/releases"
                    value={feedValue}
                    onChange={(e) => setFeedDraft(e.target.value)}
                    onBlur={() => {
                      if (feedDraft !== null && feedDraft !== (appSettings?.updateFeedUrl ?? '')) {
                        void applyPatch({ updateFeedUrl: feedDraft })
                      }
                    }}
                    aria-label="Update feed URL"
                  />
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Status</div>
                    <div className="settings-row-desc">{lastCheck}</div>
                  </div>
                  <button
                    type="button"
                    className="settings-action-btn settings-action-btn--primary"
                    onClick={() => void runUpdateCheck()}
                    disabled={checking}
                  >
                    {checking ? 'Checking…' : 'Check for updates'}
                  </button>
                </div>
                {generalError ? (
                  <div className="settings-row">
                    <div className="settings-row-desc settings-error-text" role="alert">{generalError}</div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-header">Chat</div>
              <div className="settings-card">
                <Toggle
                  checked={appSettings?.sessionNotifications ?? true}
                  onChange={(v) => void applyPatch({ sessionNotifications: v })}
                  label="Session completion notifications"
                  description="Show a system notification when a session finishes while its project isn't focused."
                />
              </div>
            </div>
          </div>
        )
      }

      case 'agent': {
        const availableModels = agentModels.filter((m) => m.available)
        const modelCount = agentMetaLoaded ? availableModels.length : null
        const toolCount = agentMetaLoaded ? agentTools.length : null
        const webSearch = appSettings?.webSearch ?? false
        const webStatus = !webSearch
          ? 'Disabled — turn on Web search to let agents use it.'
          : 'Ready — keyless search via the local crawl4ai sidecar (links + page content).'
        const rootValue = appSettings?.rootModel ?? 'no-default'
        const visionValue = appSettings?.visionModel ?? 'off'
        const rootKnown = rootValue === 'no-default' || availableModels.some((m) => m.modelId === rootValue)
        const visionKnown = visionValue === 'off' || availableModels.some((m) => m.modelId === visionValue)
        const instructionsValue = instructionsDraft ?? appSettings?.customInstructions ?? ''
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Agent</h2>

            <div className="settings-group">
              <div className="settings-group-header">Agents</div>
              <div className="settings-card">
                <InfoRow
                  label="Registered agent tools"
                  value={toolCount === null ? '…' : String(toolCount)}
                  badge={agentTools.some((t) => t.name === 'web_search') ? 'web_search live' : undefined}
                />
                <InfoRow
                  label="Discovered local models"
                  value={modelCount === null ? '…' : String(modelCount)}
                />
                <InfoRow
                  label="Exploration helpers"
                  value={(appSettings?.explorationAgents ?? true) ? 'On' : 'Off'}
                />
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Models</div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Root model</div>
                    <div className="settings-row-desc">Default model for new Bionic sessions{modelCount !== null ? ` — ${modelCount} discovered` : ''}. Probe a runtime on the Models page to list more.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={rootKnown ? rootValue : 'no-default'}
                    onChange={(e) => void applyPatch({ rootModel: e.target.value })}
                    aria-label="Root model"
                  >
                    <option value="no-default">No default</option>
                    {availableModels.map((m) => (
                      <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
                    ))}
                    {!rootKnown ? <option value={rootValue}>{rootValue} (not probed)</option> : null}
                  </select>
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Vision subagent model</div>
                    <div className="settings-row-desc">Choose a vision-capable model to help text-only models understand images.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={visionKnown ? visionValue : 'off'}
                    onChange={(e) => void applyPatch({ visionModel: e.target.value })}
                    aria-label="Vision subagent model"
                  >
                    <option value="off">Off</option>
                    {availableModels.map((m) => (
                      <option key={m.modelId} value={m.modelId}>{m.displayName}</option>
                    ))}
                    {!visionKnown ? <option value={visionValue}>{visionValue} (not probed)</option> : null}
                  </select>
                </div>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Behavior</div>
              <div className="settings-card">
                <Toggle
                  checked={webSearch}
                  onChange={(v) => void applyPatch({ webSearch: v })}
                  label="Web search"
                  description="Let agents and the chat globe use keyless web search (local crawl4ai sidecar — no API key). Calls are still gated by the permission level."
                />
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Web engine</div>
                    <div className="settings-row-desc">{engineStatus?.message ?? 'Checking…'}</div>
                  </div>
                  {(engineStatus && (engineStatus.phase === 'error' || engineStatus.phase === 'no-python')) ? (
                    <button
                      type="button"
                      className="settings-action-btn"
                      onClick={() => void retryEngineSetup()}
                      disabled={retryingEngine}
                    >
                      {retryingEngine ? 'Retrying…' : 'Retry setup'}
                    </button>
                  ) : null}
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Status</div>
                    <div className="settings-row-desc">{searchTest ?? webStatus}</div>
                  </div>
                  <button
                    type="button"
                    className="settings-action-btn"
                    onClick={() => void runSearchTest()}
                    disabled={testingSearch}
                  >
                    {testingSearch ? 'Testing…' : 'Send test query'}
                  </button>
                </div>
                <Toggle
                  checked={appSettings?.explorationAgents ?? true}
                  onChange={(v) => void applyPatch({ explorationAgents: v })}
                  label="Exploration agents"
                  description="Allow assistants to spawn helper agents that search your project files in parallel."
                />
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Command Auto Review</div>
              <div className="settings-card">
                <Toggle
                  checked={appSettings?.customAutoReview ?? false}
                  onChange={(v) => void applyPatch({ customAutoReview: v })}
                  label="Custom instructions for Auto Review"
                  description="Additional preferences applied when shell commands are automatically reviewed."
                />
                {(appSettings?.customAutoReview ?? false) ? (
                  <div className="settings-row settings-row--column">
                    <textarea
                      className="settings-textarea"
                      rows={4}
                      maxLength={4000}
                      placeholder="e.g. Never run rm -rf outside the project folder. Prefer pnpm over npm."
                      value={instructionsValue}
                      onChange={(e) => setInstructionsDraft(e.target.value)}
                      onBlur={() => {
                        if (instructionsDraft !== null && instructionsDraft !== (appSettings?.customInstructions ?? '')) {
                          void applyPatch({ customInstructions: instructionsDraft })
                        }
                      }}
                      aria-label="Custom instructions for Auto Review"
                    />
                  </div>
                ) : null}
                {generalError ? (
                  <div className="settings-row">
                    <div className="settings-row-desc settings-error-text" role="alert">{generalError}</div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )
      }

      case 'billing': {
        const hasUsage = totalUsage.totalTokens > 0
        const totalRequests = modelUsage.reduce((n, m) => n + m.requestCount, 0)
        const promptPct = hasUsage ? Math.round((totalUsage.promptTokens / totalUsage.totalTokens) * 100) : 0
        const completionPct = hasUsage ? 100 - promptPct : 0
        const avgPerRequest = totalRequests > 0 ? Math.round(totalUsage.totalTokens / totalRequests) : 0
        const maxTokens = Math.max(...modelUsage.map((m) => m.totalTokens), 1)
        return (
          <div className="settings-content">
            <div className="usage-head">
              <h2 className="settings-section-title">Token Utilization</h2>
              <p className="usage-subtitle">Tracked locally per inference request. No external billing — tokens are from the runtime usage field, estimated by characters when omitted.</p>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Overview</div>
              {!usageLoaded ? (
                <div className="settings-card"><div className="settings-row"><span className="muted">Loading usage…</span></div></div>
              ) : !hasUsage ? (
                <div className="settings-card settings-card--empty">
                  <div className="settings-empty-state">
                    <div className="settings-empty-icon">◐</div>
                    <div className="settings-empty-text">
                      <div className="settings-empty-title">No tokens tracked yet</div>
                      <div className="settings-empty-desc">Send a message with a local model — usage appears here per request and per model.</div>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="usage-stats-grid">
                    <div className="usage-stat">
                      <div className="usage-stat-label">Total tokens</div>
                      <div className="usage-stat-value">{totalUsage.totalTokens.toLocaleString()}</div>
                      <div className="usage-stat-sub">{totalRequests.toLocaleString()} requests · avg {avgPerRequest.toLocaleString()} / req</div>
                    </div>
                    <div className="usage-stat">
                      <div className="usage-stat-label">Prompt</div>
                      <div className="usage-stat-value">{totalUsage.promptTokens.toLocaleString()}</div>
                      <div className="usage-stat-sub">{promptPct}% of total</div>
                    </div>
                    <div className="usage-stat">
                      <div className="usage-stat-label">Completion</div>
                      <div className="usage-stat-value">{totalUsage.completionTokens.toLocaleString()}</div>
                      <div className="usage-stat-sub">{completionPct}% of total</div>
                    </div>
                  </div>
                  <div className="settings-card">
                    <div className="usage-distro">
                      <div className="usage-distro-labels">
                        <span>Prompt {promptPct}%</span>
                        <span>Completion {completionPct}%</span>
                      </div>
                      <div className="usage-distro-bar" role="progressbar" aria-valuenow={promptPct} aria-valuemin={0} aria-valuemax={100} aria-label="Prompt vs completion split">
                        <span className="usage-distro-fill usage-distro-fill--prompt" style={{ width: `${promptPct}%` }} />
                        <span className="usage-distro-fill usage-distro-fill--completion" style={{ width: `${completionPct}%` }} />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Usage by model</div>
              <div className="settings-card">
                {!usageLoaded ? (
                  <div className="settings-row"><span className="muted">Loading…</span></div>
                ) : modelUsage.length === 0 ? (
                  <div className="settings-row"><span className="muted">No per-model data yet.</span></div>
                ) : (
                  <div className="usage-models">
                    {modelUsage.map((m) => {
                      const pct = Math.round((m.totalTokens / totalUsage.totalTokens) * 100) || 0
                      const barW = Math.max(4, Math.round((m.totalTokens / maxTokens) * 100))
                      return (
                        <div key={m.model} className="usage-model-row">
                          <div className="usage-model-top">
                            <span className="usage-model-name" title={m.model}>{m.model}</span>
                            <span className="usage-model-meta">{m.totalTokens.toLocaleString()} · {m.requestCount} req · {pct}%</span>
                          </div>
                          <div className="usage-model-bar-track" aria-hidden>
                            <span className="usage-model-bar-fill" style={{ width: `${barW}%` }} />
                          </div>
                          <div className="usage-model-detail">
                            <span>{m.promptTokens.toLocaleString()} prompt</span>
                            <span aria-hidden>·</span>
                            <span>{m.completionTokens.toLocaleString()} completion</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }

      case 'sessions':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Sessions</h2>

            <div className="settings-group">
              <div className="settings-card">
                <Toggle
                  checked={appSettings?.renameAfterFork ?? true}
                  onChange={(v) => void applyPatch({ renameAfterFork: v })}
                  label="Rename after fork"
                  description="Use the previous session name and the first message sent in a fork to suggest a new name."
                />
              </div>
              {generalError ? (
                <div className="settings-card">
                  <div className="settings-row"><div className="settings-row-desc settings-error-text" role="alert">{generalError}</div></div>
                </div>
              ) : null}
            </div>

            <div className="settings-group">
              <div className="settings-group-header">
                Archived sessions {archivedLoaded ? <span className="settings-badge">{archivedSessions.length}</span> : null}
              </div>
              <p className="settings-row-desc settings-row-desc--spaced">
                Archived sessions stay intact but do not appear in the sidebar.
              </p>
              <div className="settings-card">
                {!archivedLoaded ? (
                  <div className="settings-row"><span className="muted">Loading…</span></div>
                ) : archivedSessions.length === 0 ? (
                  <div className="settings-row">
                    <span className="muted">No archived sessions.</span>
                  </div>
                ) : (
                  archivedSessions.map((session) => (
                    <div key={session.id} className="settings-row">
                      <div className="settings-row-text">
                        <div className="settings-row-label">{session.title}</div>
                      </div>
                      <ActionButton
                        label="Unarchive"
                        onClick={async () => {
                          try {
                            await unarchiveSession(session.id)
                            setArchivedSessions((prev) => prev.filter((s) => s.id !== session.id))
                          } catch {
                            // ignore
                          }
                        }}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )

      case 'appearance': {
        const sb = appSettings?.sidebarBackground ?? 'solid'
        const themeVal = appSettings?.theme ?? 'dark'
        const diff = appSettings?.inlineDiffLayout ?? 'unified'
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Appearance</h2>
            <p className="usage-subtitle">Changes apply instantly and persist locally. No restart required.</p>

            <div className="settings-group">
              <div className="settings-group-header">Interface</div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Sidebar background</div>
                    <div className="settings-row-desc">Solid uses the panel color. Translucent adds a blurred shell behind the sidebar.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={sb}
                    onChange={(e) => void applyPatch({ sidebarBackground: e.target.value })}
                    aria-label="Sidebar background"
                    disabled={!generalLoaded}
                  >
                    <option value="solid">Solid</option>
                    <option value="translucent">Translucent</option>
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">UI color theme</div>
                    <div className="settings-row-desc">System follows the OS setting. Light / Dark override it.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={appSettings?.theme ?? 'dark'}
                    onChange={(e) => void applyPatch({ theme: e.target.value })}
                    aria-label="UI color theme"
                  >
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Inline diff layout</div>
                    <div className="settings-row-desc">How file-change diffs render in the transcript.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={diff}
                    onChange={(e) => void applyPatch({ inlineDiffLayout: e.target.value })}
                    aria-label="Inline diff layout"
                    disabled={!generalLoaded}
                  >
                    <option value="unified">Unified</option>
                    <option value="split">Split</option>
                  </select>
                </div>
              </div>
              {generalError ? (
                <div className="settings-card">
                  <div className="settings-row"><div className="settings-row-desc settings-error-text" role="alert">{generalError}</div></div>
                </div>
              ) : null}
            </div>
          </div>
        )
      }

      case 'connected-apps':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Connected Apps</h2>

            <div className="settings-group">
              <div className="settings-group-header">
                Connected MCP Servers <span className="settings-badge">{mcpLoaded ? String(mcpServers.length) : '…'}</span>
              </div>
              {mcpError ? <div className="settings-row-desc settings-error-text" role="alert">{mcpError}</div> : null}
              <div className="settings-card">
                {!mcpLoaded ? (
                  <div className="settings-row"><span className="muted">Loading…</span></div>
                ) : mcpServers.length === 0 ? (
                  <div className="settings-card--empty">
                    <div className="settings-empty-state">
                      <div className="settings-empty-icon">🔒</div>
                      <div className="settings-empty-text">
                        <div className="settings-empty-title">No MCPs connected yet</div>
                        <div className="settings-empty-desc">Choose a popular MCP below or add a custom one. Servers are persisted locally and survive restarts.</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  mcpServers.map((s) => {
                    const created = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ''
                    return (
                      <div key={s.id} className="settings-row">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, flexShrink: 0 }}><McpServerLogo server={s} size={32} /></div>
                        <div className="settings-row-text">
                          <div className="settings-row-label">
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: s.status === 'connected' ? 'var(--success)' : s.status === 'error' ? 'var(--danger)' : s.status === 'probing' ? 'var(--warn)' : 'var(--muted-2)', marginRight: 6, verticalAlign: 'middle' }} aria-hidden />
                            {s.name} <span className="badge" style={{ marginLeft: 6, fontSize: 10 }}>{s.transport}</span>
                            {s.status === 'probing' ? <span className="muted small"> · connecting…</span> : s.status === 'error' ? <span className="muted small" style={{ color: 'var(--danger)' }}> · {s.lastError ?? 'error'}</span> : !s.enabled || s.status === 'disconnected' ? <span className="muted small"> · disabled</span> : <span className="muted small"> · connected</span>}
                            {created ? <span className="muted small"> · {created}</span> : null}
                          </div>
                          <div className="settings-row-desc" style={{ wordBreak: 'break-all' }}>
                            {s.transport === 'stdio' ? (s.command ?? '') : (s.endpoint ?? '')} · By {s.provider}
                          </div>
                        </div>
                      <div className="settings-row-right">
                        <button
                          type="button"
                          className={`settings-toggle ${s.enabled ? 'settings-toggle--on' : ''}`}
                          onClick={async () => {
                            const next = !s.enabled
                            setMcpServers((prev) => prev.map((p) => (p.id === s.id ? { ...p, enabled: next, status: next ? 'probing' : 'disconnected', lastError: undefined } as McpServerView : p)))
                            try {
                              const toggled = await toggleMcpServer(s.id, next)
                              setMcpServers((prev) => prev.map((p) => (p.id === toggled.id ? toggled : p)))
                              if (next) {
                                const probed = await probeMcpServer(s.id)
                                setMcpServers((prev) => prev.map((p) => (p.id === probed.id ? probed : p)))
                              }
                            } catch {
                              setMcpServers((prev) => prev.map((p) => (p.id === s.id ? { ...p, enabled: !next, status: !next ? 'disconnected' : 'error' } as McpServerView : p)))
                            }
                          }}
                          role="switch"
                          aria-checked={s.enabled}
                          aria-label={`Enable ${s.name}`}
                        >
                          <span className="settings-toggle-thumb" />
                        </button>
                        {s.status === 'error' ? (
                          <button
                            type="button"
                            className="settings-action-btn"
                            onClick={async () => {
                              setMcpServers((prev) => prev.map((p) => (p.id === s.id ? { ...p, status: 'probing' as const, lastError: undefined } : p)))
                              try {
                                const probed = await probeMcpServer(s.id)
                                setMcpServers((prev) => prev.map((p) => (p.id === probed.id ? probed : p)))
                              } catch (e) {
                                setMcpError(e instanceof Error ? e.message : String(e))
                              }
                            }}
                          >
                            Retry
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="settings-action-btn"
                          onClick={async () => {
                            try {
                              await removeMcpServer(s.id)
                              setMcpServers((prev) => prev.filter((p) => p.id !== s.id))
                            } catch (e) {
                              setMcpError(e instanceof Error ? e.message : String(e))
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    )
                  })
                )}
               </div>
             </div>

            <div className="settings-group">
              <div className="settings-group-header">Popular MCPs</div>
              <p className="settings-row-desc settings-row-desc--spaced">
                Hand-picked MCP servers with a simple setup. Click Set Up to prefill the add dialog — no extra install step until you confirm.
              </p>
              <div className="mcp-grid">
                {MCP_PRESETS.map((mcp) => {
                  const connected = mcpServers.some((s) => s.name === mcp.name && s.provider === mcp.provider)
                  return (
                    <div key={mcp.id} className="mcp-card">
                      <div className="mcp-card-icon"><McpLogo id={mcp.id} /></div>
                      <div className="mcp-card-body">
                        <div className="mcp-card-name">{mcp.name} {connected ? <span className="badge badge--success" style={{ marginLeft: 6 }}>connected</span> : null}</div>
                        <div className="mcp-card-desc">{mcp.description}</div>
                        <div className="mcp-card-footer">
                          <span className="mcp-card-by">By {mcp.provider}</span>
                          <button type="button" className="settings-action-btn settings-action-btn--primary" onClick={() => openMcpDialog(mcp)}>
                            Set Up
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Manual MCP server setup</div>
                    <div className="settings-row-desc">Add a local command (stdio) or remote MCP server (http).</div>
                  </div>
                  <button type="button" className="settings-action-btn" onClick={() => openMcpDialog(null)}>
                    + Add custom MCP
                  </button>
                </div>
              </div>
            </div>

            {mcpDialogOpen ? (
              <div className="modal-overlay" onClick={() => setMcpDialogOpen(false)} role="dialog" aria-modal="true" aria-label={mcpDialogPreset ? `Set up ${mcpDialogPreset.name}` : 'Add MCP server'}>
                <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h2 className="modal-title">{mcpDialogPreset ? `Set up ${mcpDialogPreset.name}` : 'Add MCP server'}</h2>
                    <button type="button" className="modal-close" onClick={() => setMcpDialogOpen(false)} aria-label="Close">×</button>
                  </div>
                  <div className="modal-body">
                    <label className="modal-label" htmlFor="mcp-name">Name</label>
                    <input id="mcp-name" className="modal-input" value={mcpForm.name} onChange={(e) => setMcpForm((f) => ({ ...f, name: e.target.value }))} placeholder="GitHub" maxLength={80} />
                    <label className="modal-label" htmlFor="mcp-provider">Provider</label>
                    <input id="mcp-provider" className="modal-input" value={mcpForm.provider} onChange={(e) => setMcpForm((f) => ({ ...f, provider: e.target.value }))} placeholder="GitHub" maxLength={80} />
                    <label className="modal-label" htmlFor="mcp-transport">Transport</label>
                    <select id="mcp-transport" className="settings-select" value={mcpForm.transport} onChange={(e) => setMcpForm((f) => ({ ...f, transport: e.target.value as 'stdio' | 'http' }))}>
                      <option value="stdio">stdio (local command)</option>
                      <option value="http">http (remote URL)</option>
                    </select>
                    {mcpForm.transport === 'stdio' ? (
                      <>
                        <label className="modal-label" htmlFor="mcp-command">Command</label>
                        <input id="mcp-command" className="modal-input" value={mcpForm.command} onChange={(e) => setMcpForm((f) => ({ ...f, command: e.target.value }))} placeholder="npx -y @modelcontextprotocol/server-github" maxLength={512} />
                        <span className="field-hint">Local command executed by the app (Phase 2 will spawn it). No network probe on add.</span>
                      </>
                    ) : (
                      <>
                        <label className="modal-label" htmlFor="mcp-endpoint">Endpoint URL</label>
                        <input id="mcp-endpoint" className="modal-input" value={mcpForm.endpoint} onChange={(e) => setMcpForm((f) => ({ ...f, endpoint: e.target.value }))} placeholder="https://example.com/mcp/sse" inputMode="url" maxLength={512} />
                      </>
                    )}
                    {mcpError ? <div className="settings-error-text" role="alert">{mcpError}</div> : null}
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-sm" onClick={() => setMcpDialogOpen(false)}>Cancel</button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => void submitMcp()}
                      disabled={!mcpForm.name.trim() || (mcpForm.transport === 'stdio' ? !mcpForm.command.trim() : !mcpForm.endpoint.trim())}
                    >
                      {mcpDialogPreset ? 'Add' : 'Add server'}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )

      case 'skills':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Skills</h2>

            <div className="settings-group">
              <div className="settings-group-header">
                <div className="skills-header-row">
                  <span>Bionic Skills</span>
                  <div className="skills-dropdown-wrap">
                    <button type="button" className="settings-action-btn settings-action-btn--primary">
                      + Add Skill
                    </button>
                  </div>
                </div>
              </div>
              <div className="settings-card settings-card--empty">
                <div className="settings-empty-state">
                  <div className="settings-empty-icon">📦</div>
                  <div className="settings-empty-text">
                    <div className="settings-empty-title">No skills installed yet</div>
                    <div className="settings-empty-desc">Create a custom skill or install a pre-built one.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Use skills found in other apps</div>
              <p className="settings-row-desc settings-row-desc--spaced">
                SOVARA can detect and use skills installed in compatible directories on this device.
              </p>
              {!skillsLoaded ? (
                <div className="settings-card">
                  <span className="muted">Scanning…</span>
                </div>
              ) : (
                skillsSources.map((src) => (
                  <div key={src.name} className="settings-card">
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <div className="settings-row-label">{src.name}</div>
                        <div className="settings-row-desc">
                          {src.skillCount > 0
                            ? `${src.skillCount.toLocaleString()} skills found in ${src.path}`
                            : `No skills found in ${src.path}`}
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <span className="settings-badge">{src.skillCount.toLocaleString()}</span>
                        <button
                          type="button"
                          className={`settings-toggle ${src.enabled ? 'settings-toggle--on' : ''}`}
                          onClick={async () => {
                            const newEnabled = !src.enabled
                            setSkillsSources((prev) =>
                              prev.map((s) => (s.name === src.name ? { ...s, enabled: newEnabled } : s))
                            )
                            try {
                              await toggleSkillsSource(src.name, newEnabled)
                            } catch {
                              // revert on error
                              setSkillsSources((prev) =>
                                prev.map((s) => (s.name === src.name ? { ...s, enabled: !newEnabled } : s))
                              )
                            }
                          }}
                          role="switch"
                          aria-checked={src.enabled}
                          aria-label={`Enable ${src.name} skills`}
                        >
                          <span className="settings-toggle-thumb" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )

      case 'explore':
        return (
          <ExplorePage onBack={() => setActiveSection('general')} />
        )

      case 'library':
        return (
          <LibraryPage onBack={() => setActiveSection('general')} />
        )

      default:
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">{NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeSection)?.label}</h2>
            <div className="settings-group">
              <div className="settings-card settings-card--empty">
                <span className="muted">Coming soon</span>
              </div>
            </div>
          </div>
        )
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-sidebar">
        {onBack ? (
          <button type="button" className="settings-back" onClick={onBack} aria-label="Back to chat">
            <ArrowLeft size={14} aria-hidden />
            <span>Back</span>
          </button>
        ) : null}
        <nav className="settings-nav" aria-label="Settings navigation">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="settings-nav-group">
              <div className="settings-nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${activeSection === item.id ? 'settings-nav-item--active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                  aria-current={activeSection === item.id ? 'page' : undefined}
                >
                  <span className="settings-nav-icon">{item.icon}</span>
                  <span className="settings-nav-label">{item.label}</span>
                  {activeSection === item.id ? <ChevronRight size={14} className="settings-nav-arrow" /> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </div>
      <div className="settings-main">
        {renderContent()}
      </div>
    </div>
  )
}
