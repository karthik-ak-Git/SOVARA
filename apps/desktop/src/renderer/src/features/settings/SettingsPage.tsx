import { useState, useCallback, useEffect, type ReactElement } from 'react'
import {
  Settings, User, Cpu, Mic, CreditCard, Palette, MessageSquare,
  Link2, Puzzle, Globe, BookOpen, Monitor, Server, FileText,
  RotateCcw, ChevronRight, ArrowLeft, Check, Cloud
} from 'lucide-react'
import { getTotalUsage, getUsageByModel, type TokenUsage, type ModelUsage } from '../../lib/ipc'

type SettingsSection =
  | 'general'
  | 'agent'
  | 'voice'
  | 'billing'
  | 'appearance'
  | 'sessions'
  | 'connected-apps'
  | 'skills'
  | 'devices'
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
      { id: 'voice', label: 'Voice', icon: <Mic size={16} /> },
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
    label: 'Devices',
    items: [
      { id: 'devices', label: 'LM Link', icon: <Globe size={16} /> },
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

interface SettingsPageProps {
  onBack?: () => void
}

export function SettingsPage({ onBack }: SettingsPageProps): ReactElement {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt')
  const [autoTranscribe, setAutoTranscribe] = useState(true)
  const [whisperModel, setWhisperModel] = useState<'tiny' | 'base' | 'small' | 'medium'>('tiny')

  // Agent settings
  const [rootModel, setRootModel] = useState('no-default')
  const [visionModel, setVisionModel] = useState('off')
  const [webSearch, setWebSearch] = useState(false)
  const [explorationAgents, setExplorationAgents] = useState(true)
  const [customAutoReview, setCustomAutoReview] = useState(false)

  // Billing/usage settings
  const [billingAccount, setBillingAccount] = useState('personal')
  const [totalUsage, setTotalUsage] = useState<TokenUsage>({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([])
  const [usageLoaded, setUsageLoaded] = useState(false)

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

  const handleRequestMic = useCallback(async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMicPermission('granted')
    } catch {
      setMicPermission('denied')
    }
  }, [])

  const renderContent = (): ReactElement => {
    switch (activeSection) {
      case 'voice':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Voice</h2>

            <div className="settings-group">
              <div className="settings-group-header">Microphone</div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Microphone access</div>
                    <div className="settings-row-desc">
                      {micPermission === 'granted'
                        ? 'Microphone is available for voice input.'
                        : micPermission === 'denied'
                          ? 'Microphone permission was denied. Enable it in your system settings.'
                          : 'Allow microphone access to use voice input.'}
                    </div>
                  </div>
                  {micPermission === 'granted' ? (
                    <span className="settings-perm-status settings-perm-status--granted">
                      <Check size={14} /> Connected
                    </span>
                  ) : micPermission === 'denied' ? (
                    <ActionButton label="Open system settings" onClick={handleRequestMic} />
                  ) : (
                    <ActionButton label="Allow microphone" variant="primary" onClick={handleRequestMic} />
                  )}
                </div>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Transcription</div>
              <div className="settings-card">
                <Toggle
                  checked={autoTranscribe}
                  onChange={setAutoTranscribe}
                  label="Auto-transcribe voice input"
                  description="Automatically convert speech to text when you stop recording."
                />

                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Whisper model</div>
                    <div className="settings-row-desc">Larger models are more accurate but slower. Tiny is recommended for real-time use.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={whisperModel}
                    onChange={(e) => setWhisperModel(e.target.value as typeof whisperModel)}
                    aria-label="Whisper model size"
                  >
                    <option value="tiny">Tiny (~75 MB)</option>
                    <option value="base">Base (~140 MB)</option>
                    <option value="small">Small (~460 MB)</option>
                    <option value="medium">Medium (~1.5 GB)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )

      case 'general':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">General</h2>
            <div className="settings-group">
              <div className="settings-group-header">App and updates</div>
              <div className="settings-card">
                <InfoRow label="App version" value="1.0.0" badge="Stable" />
                <Toggle checked={true} onChange={() => {}} label="Automatic updates" description="Download app updates in the background and show Update when they are ready." />
              </div>
            </div>
            <div className="settings-group">
              <div className="settings-group-header">Chat</div>
              <div className="settings-card">
                <Toggle checked={true} onChange={() => {}} label="Session completion notifications" description="Show a system notification when a session finishes while its project isn't focused." />
              </div>
            </div>
          </div>
        )

      case 'agent':
        return (
          <div className="settings-content">
            <h2 className="settings-section-title">Agent</h2>

            <div className="settings-group">
              <div className="settings-group-header">Models</div>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Root model</div>
                    <div className="settings-row-desc">Optionally choose the default model for new Bionic sessions.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={rootModel}
                    onChange={(e) => setRootModel(e.target.value)}
                    aria-label="Root model"
                  >
                    <option value="no-default">No default</option>
                    <option value="local">Local model</option>
                  </select>
                </div>
                <div className="settings-row">
                  <div className="settings-row-text">
                    <div className="settings-row-label">Vision subagent model</div>
                    <div className="settings-row-desc">Choose a vision-capable model to help text-only models understand images.</div>
                  </div>
                  <select
                    className="settings-select"
                    value={visionModel}
                    onChange={(e) => setVisionModel(e.target.value)}
                    aria-label="Vision subagent model"
                  >
                    <option value="off">Off</option>
                    <option value="local">Local model</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Behavior</div>
              <div className="settings-card">
                <Toggle
                  checked={webSearch}
                  onChange={setWebSearch}
                  label="Web search"
                  description="Sign in to use the built-in web search and extraction tools."
                />
                <Toggle
                  checked={explorationAgents}
                  onChange={setExplorationAgents}
                  label="Exploration agents"
                  description="Allow assistants to spawn helper agents that search your project files in parallel."
                />
              </div>
            </div>

            <div className="settings-group">
              <div className="settings-group-header">Command Auto Review</div>
              <div className="settings-card">
                <Toggle
                  checked={customAutoReview}
                  onChange={setCustomAutoReview}
                  label="Custom instructions for Auto Review"
                  description="Additional preferences applied when shell commands are automatically reviewed."
                />
              </div>
            </div>
          </div>
        )

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
                <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Usage is based on API calls made through local inference runtimes. No external billing is required.
                </p>
                {usageLoaded && totalUsage.totalTokens > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Total tokens used:</span>
                      <span style={{ fontWeight: 600 }}>{totalUsage.totalTokens.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Prompt tokens:</span>
                      <span>{totalUsage.promptTokens.toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Completion tokens:</span>
                      <span>{totalUsage.completionTokens.toLocaleString()}</span>
                    </div>
                  </div>
                )}
                {usageLoaded && modelUsage.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      By Model
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {modelUsage.map((m) => (
                        <div key={m.model} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{m.model}</span>
                          <span>{m.totalTokens.toLocaleString()} tokens ({m.requestCount} requests)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
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
        <div className="settings-sidebar-header">
          <button type="button" className="settings-back-btn" onClick={onBack} aria-label="Back to app">
            <ArrowLeft size={16} aria-hidden />
            <span>Back to app</span>
          </button>
        </div>
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
