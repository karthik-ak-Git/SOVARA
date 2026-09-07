import { useState, useCallback, useEffect, type ReactElement } from 'react'
import {
  Settings, User, Cpu, CreditCard, Palette, MessageSquare,
  Link2, Puzzle, Globe, BookOpen, Monitor, Server, FileText,
  RotateCcw, ChevronRight, Check, Cloud, ArrowLeft
} from 'lucide-react'
import { getTotalUsage, getUsageByModel, listArchivedSessions, unarchiveSession, scanSkills, toggleSkillsSource, getAppSettings, setAppSettings, checkForUpdatesNow, listDiscoveredModels, listTools, dispatchTool, type TokenUsage, type ModelUsage, type SessionHeaderView, type SkillsSource, type AppSettingsState, type UpdateCheckView, type ToolDefinitionView } from '../../lib/ipc'
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
      { id: 'billing', label: 'Billing and Usage', icon: <CreditCard size={16} /> },
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

export function SettingsPage({ onBack }: { onBack?: () => void }): ReactElement {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')

  // Appearance settings
  const [sidebarBackground, setSidebarBackground] = useState('solid')
  const [uiColorTheme, setUiColorTheme] = useState('system')
  const [inlineDiffLayout, setInlineDiffLayout] = useState('unified')

  // Billing/usage settings
  const [billingAccount, setBillingAccount] = useState('personal')
  const [totalUsage, setTotalUsage] = useState<TokenUsage>({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([])
  const [usageLoaded, setUsageLoaded] = useState(false)

  // Sessions settings
  const [renameAfterFork, setRenameAfterFork] = useState(true)
  const [archivedSessions, setArchivedSessions] = useState<SessionHeaderView[]>([])
  const [archivedLoaded, setArchivedLoaded] = useState(false)

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
  }, [])

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

      case 'billing':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Billing</h2>
            <div className="settings-group">
              <div className="settings-group-header">Billing account</div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-content">
                    <span className="settings-row-label">Billing account</span>
                  </div>
                  <select
                    className="settings-select"
                    value={billingAccount}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setBillingAccount(e.target.value)}
                    aria-label="Billing account"
                  >
                    <option value="personal">Personal</option>
                    <option value="team">Team</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Usage</div>
              <div className="settings-card">
                <p className="settings-usage-desc">
                  Usage is based on API calls made through local inference runtimes. No external billing is required.
                </p>
                {usageLoaded && totalUsage.totalTokens > 0 && (
                  <div className="settings-usage-stats">
                    <div className="settings-usage-row">
                      <span className="settings-usage-label">Total tokens used:</span>
                      <span className="settings-usage-value settings-usage-value--bold">{totalUsage.totalTokens.toLocaleString()}</span>
                    </div>
                    <div className="settings-usage-row">
                      <span className="settings-usage-label">Prompt tokens:</span>
                      <span className="settings-usage-value">{totalUsage.promptTokens.toLocaleString()}</span>
                    </div>
                    <div className="settings-usage-row">
                      <span className="settings-usage-label">Completion tokens:</span>
                      <span className="settings-usage-value">{totalUsage.completionTokens.toLocaleString()}</span>
                    </div>
                  </div>
                )}
                {usageLoaded && modelUsage.length > 0 && (
                  <div className="settings-model-usage">
                    <div className="settings-model-usage-title">By Model</div>
                    <div className="settings-model-usage-list">
                      {modelUsage.map((m) => (
                        <div key={m.model} className="settings-model-usage-row">
                          <span className="settings-model-usage-name">{m.model}</span>
                          <span className="settings-model-usage-detail">{m.totalTokens.toLocaleString()} tokens ({m.requestCount} requests)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )

      case 'sessions':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Sessions</h2>

            <div className="settings-group">
              <div className="settings-card">
                <Toggle
                  checked={renameAfterFork}
                  onChange={setRenameAfterFork}
                  label="Rename after fork"
                  description="Use the previous session name and the first message sent in a fork to suggest a new name."
                />
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Archived sessions</div>
              <p className="settings-row-desc settings-row-desc--spaced">
                Archived sessions stay intact but do not appear in the sidebar.
              </p>
              <div className="settings-card">
                {archivedSessions.length === 0 ? (
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

      case 'appearance':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Appearance</h2>

            <div className="settings-group">
              <div className="settings-group-header">Interface</div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Sidebar background</div>
                    <div className="settings-row-desc">Choose the translucent shell look or a solid sidebar surface.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={sidebarBackground}
                    onChange={(e) => setSidebarBackground(e.target.value)}
                    aria-label="Sidebar background"
                  >
                    <option value="solid">Solid</option>
                    <option value="translucent">Translucent</option>
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">UI color theme</div>
                    <div className="settings-row-desc">Choose the app-wide color theme.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={uiColorTheme}
                    onChange={(e) => setUiColorTheme(e.target.value)}
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
                    <div className="settings-row-desc">Choose how inline file-change diffs appear in the transcript.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={inlineDiffLayout}
                    onChange={(e) => setInlineDiffLayout(e.target.value)}
                    aria-label="Inline diff layout"
                  >
                    <option value="unified">Unified</option>
                    <option value="split">Split</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )

      case 'connected-apps':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Connected Apps</h2>

            <div className="settings-group">
              <div className="settings-group-header">
                Connected MCP Servers <span className="settings-badge">0</span>
              </div>
              <div className="settings-card settings-card--empty">
                <div className="settings-empty-state">
                  <div className="settings-empty-icon">🔒</div>
                  <div className="settings-empty-text">
                    <div className="settings-empty-title">No MCPs connected yet</div>
                    <div className="settings-empty-desc">Choose a popular MCP below to get started.</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Popular MCPs</div>
              <p className="settings-row-desc settings-row-desc--spaced">
                Hand-picked MCP servers with a simple setup.
              </p>
              <div className="mcp-grid">
                {MCP_PRESETS.map((mcp) => (
                  <div key={mcp.id} className="mcp-card">
                    <div className="mcp-card-icon">{mcp.icon}</div>
                    <div className="mcp-card-body">
                      <div className="mcp-card-name">{mcp.name}</div>
                      <div className="mcp-card-desc">{mcp.description}</div>
                      <div className="mcp-card-footer">
                        <span className="mcp-card-by">By {mcp.provider}</span>
                        <button type="button" className="settings-action-btn settings-action-btn--primary">
                          Set Up
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Manual MCP server setup</div>
                    <div className="settings-row-desc">Add a local command or remote MCP server.</div>
                  </div>
                  <button type="button" className="settings-action-btn">
                    + Add custom MCP
                  </button>
                </div>
              </div>
            </div>
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
