import { useState, type ReactElement } from 'react'
import {
  Code, Eye, Terminal, Layers, FileText, Check, Copy, ExternalLink, X, Cpu, Clock, Wrench, Shield, Play
} from 'lucide-react'

export type AuxiliaryTab = 'artifacts' | 'subagents' | 'diffs' | 'terminal'

interface Props {
  isOpen: boolean
  onClose: () => void
  activeTab?: AuxiliaryTab
  onTabChange?: (tab: AuxiliaryTab) => void
  artifactContent?: string
  artifactTitle?: string
  artifactType?: 'html' | 'markdown' | 'svg' | 'code'
  activeSubagents?: Array<{ id: string; role: string; type: string; state: string; detail?: string }>
  activeTasks?: Array<{ id: string; name: string; status: string; progress?: string }>
  terminalLogs?: string[]
  changedFiles?: Array<{ path: string; additions: number; deletions: number }>
}

export function AuxiliaryPane({
  isOpen,
  onClose,
  activeTab: controlledTab,
  onTabChange,
  artifactContent = '',
  artifactTitle = 'Generated Artifact',
  artifactType = 'html',
  activeSubagents = [],
  activeTasks = [],
  terminalLogs = [],
  changedFiles = [],
}: Props): ReactElement | null {
  const [internalTab, setInternalTab] = useState<AuxiliaryTab>('artifacts')
  const [copied, setCopied] = useState(false)
  const tab = controlledTab ?? internalTab

  const setTab = (t: AuxiliaryTab): void => {
    setInternalTab(t)
    onTabChange?.(t)
  }

  if (!isOpen) return null

  const copyArtifact = (): void => {
    if (artifactContent) {
      void navigator.clipboard.writeText(artifactContent)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <aside className="sv-aux-pane" aria-label="Auxiliary Workspace Pane">
      <header className="sv-aux-header">
        <div className="sv-aux-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'artifacts'}
            className={`sv-aux-tab ${tab === 'artifacts' ? 'active' : ''}`}
            onClick={() => setTab('artifacts')}
          >
            <Eye size={13} /> Artifacts
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'subagents'}
            className={`sv-aux-tab ${tab === 'subagents' ? 'active' : ''}`}
            onClick={() => setTab('subagents')}
          >
            <Layers size={13} /> Subagents {activeSubagents.length > 0 ? <span className="sv-aux-badge">{activeSubagents.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'diffs'}
            className={`sv-aux-tab ${tab === 'diffs' ? 'active' : ''}`}
            onClick={() => setTab('diffs')}
          >
            <FileText size={13} /> Diffs {changedFiles.length > 0 ? <span className="sv-aux-badge">{changedFiles.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'terminal'}
            className={`sv-aux-tab ${tab === 'terminal' ? 'active' : ''}`}
            onClick={() => setTab('terminal')}
          >
            <Terminal size={13} /> Terminal
          </button>
        </div>
        <button type="button" className="sv-aux-close" aria-label="Close pane" onClick={onClose}>
          <X size={14} />
        </button>
      </header>

      <div className="sv-aux-body">
        {tab === 'artifacts' ? (
          <div className="sv-aux-content">
            <div className="sv-aux-toolbar">
              <span className="sv-aux-title">{artifactTitle}</span>
              <div className="sv-aux-actions">
                <button type="button" className="sv-aux-btn" onClick={copyArtifact} title="Copy code">
                  {copied ? <Check size={12} style={{ color: 'var(--success)' }} /> : <Copy size={12} />}
                </button>
              </div>
            </div>
            {artifactContent ? (
              artifactType === 'html' ? (
                <iframe
                  className="sv-aux-iframe"
                  title={artifactTitle}
                  srcDoc={artifactContent}
                  sandbox="allow-scripts allow-modals"
                />
              ) : (
                <pre className="sv-aux-codeblock"><code>{artifactContent}</code></pre>
              )
            ) : (
              <div className="sv-aux-empty">
                <Eye size={24} className="sv-aux-empty-icon" />
                <p>No active artifact selected.</p>
                <span>Interactive UI widgets, charts, and generated documents render here live.</span>
              </div>
            )}
          </div>
        ) : tab === 'subagents' ? (
          <div className="sv-aux-content">
            <div className="sv-aux-toolbar">
              <span className="sv-aux-title">Active Subagents &amp; Tasks</span>
            </div>
            {activeSubagents.length === 0 && activeTasks.length === 0 ? (
              <div className="sv-aux-empty">
                <Cpu size={24} className="sv-aux-empty-icon" />
                <p>No subagents currently active.</p>
                <span>Autonomous workers and background cron schedules appear here.</span>
              </div>
            ) : (
              <div className="sv-aux-list">
                {activeSubagents.map((agent) => (
                  <div key={agent.id} className="sv-aux-card">
                    <div className="sv-aux-card-head">
                      <span className="sv-aux-card-dot online" />
                      <strong className="sv-aux-card-name">{agent.role}</strong>
                      <span className="sv-aux-card-type">{agent.type}</span>
                    </div>
                    {agent.detail ? <p className="sv-aux-card-detail">{agent.detail}</p> : null}
                  </div>
                ))}
                {activeTasks.map((t) => (
                  <div key={t.id} className="sv-aux-card">
                    <div className="sv-aux-card-head">
                      <Clock size={13} />
                      <strong className="sv-aux-card-name">{t.name}</strong>
                      <span className="sv-aux-card-type">{t.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : tab === 'diffs' ? (
          <div className="sv-aux-content">
            <div className="sv-aux-toolbar">
              <span className="sv-aux-title">Workspace Changes &amp; Diffs</span>
            </div>
            {changedFiles.length === 0 ? (
              <div className="sv-aux-empty">
                <FileText size={24} className="sv-aux-empty-icon" />
                <p>No uncommitted changes.</p>
                <span>File modifications made by active agents will be highlighted here.</span>
              </div>
            ) : (
              <div className="sv-aux-list">
                {changedFiles.map((f) => (
                  <div key={f.path} className="sv-aux-diff-row">
                    <span className="sv-aux-diff-path">{f.path}</span>
                    <span className="sv-aux-diff-add">+{f.additions}</span>
                    <span className="sv-aux-diff-del">-{f.deletions}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="sv-aux-content">
            <div className="sv-aux-toolbar">
              <span className="sv-aux-title">Terminal Sandbox Log</span>
            </div>
            {terminalLogs.length === 0 ? (
              <div className="sv-aux-empty">
                <Terminal size={24} className="sv-aux-empty-icon" />
                <p>Terminal output is empty.</p>
                <span>Command execution logs and process output stream here in real time.</span>
              </div>
            ) : (
              <div className="sv-aux-terminal">
                {terminalLogs.map((line, i) => (
                  <div key={i} className="sv-aux-term-line">{line}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
