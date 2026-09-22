import { useState, type ReactElement } from 'react'
import {
  Code, Eye, Terminal, Layers, FileText, Check, Copy, ExternalLink, X, Cpu, Clock, Maximize2, Minimize2, Plus
} from 'lucide-react'

export type AuxiliaryTab = 'artifacts' | 'subagents' | 'diffs' | 'terminal'

interface ChangedFileItem {
  path: string
  additions: number
  deletions: number
  diffChunks?: Array<{
    lineOld?: number
    lineNew?: number
    type: 'add' | 'del' | 'context'
    content: string
  }>
}

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
  changedFiles?: ChangedFileItem[]
}

export function AuxiliaryPane({
  isOpen,
  onClose,
  activeTab: controlledTab,
  onTabChange,
  artifactContent = '',
  artifactTitle = 'Implementation Plan',
  artifactType = 'html',
  activeSubagents = [],
  activeTasks = [],
  terminalLogs = [],
  changedFiles = [
    {
      path: 'SOVARA > apps > desktop > src > renderer > components > layout > AppShell.tsx',
      additions: 14,
      deletions: 3,
      diffChunks: [
        { lineOld: 101, lineNew: 101, type: 'context', content: '  return (' },
        { lineOld: 102, lineNew: 102, type: 'context', content: '    <div className="app">' },
        { lineNew: 103, type: 'add', content: '+     <TopBar activeTab={activeTab} />' },
        { lineOld: 104, type: 'del', content: '-     <LegacyHeader />' },
        { lineOld: 105, lineNew: 104, type: 'context', content: '      <div className="layout">' },
        { lineNew: 105, type: 'add', content: '+       <AuxiliaryPane isOpen={artifactsOpen} />' },
      ],
    },
  ],
}: Props): ReactElement | null {
  const [internalTab, setInternalTab] = useState<AuxiliaryTab>('diffs')
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeFileIdx, setActiveFileIdx] = useState(0)

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

  const activeFile = changedFiles[activeFileIdx] || changedFiles[0]

  return (
    <aside
      className="sv-aux-pane"
      aria-label="Auxiliary Workspace Pane"
      style={{
        width: isExpanded ? '60%' : 460,
        height: '100%',
        background: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 50,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.05)',
      }}
    >
      {/* Tab Strip: [Implementation Plan], [AppShell.tsx (single edit)], [+], [ ], [x] */}
      <header
        className="sv-aux-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          height: 42,
          borderBottom: '1px solid #e2e8f0',
          background: '#f8fafc',
        }}
      >
        <div className="sv-aux-tabs" role="tablist" style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto' }}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'artifacts'}
            className={`sv-aux-tab ${tab === 'artifacts' ? 'active' : ''}`}
            onClick={() => setTab('artifacts')}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              background: tab === 'artifacts' ? '#ffffff' : 'transparent',
              color: tab === 'artifacts' ? '#0f172a' : '#64748b',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              boxShadow: tab === 'artifacts' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            {artifactTitle}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'diffs'}
            className={`sv-aux-tab ${tab === 'diffs' ? 'active' : ''}`}
            onClick={() => setTab('diffs')}
            style={{
              padding: '4px 10px',
              borderRadius: 6,
              border: 'none',
              background: tab === 'diffs' ? '#ffffff' : 'transparent',
              color: tab === 'diffs' ? '#0f172a' : '#64748b',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              boxShadow: tab === 'diffs' ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
            }}
          >
            AppShell.tsx (single edit)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'subagents'}
            className={`sv-aux-tab ${tab === 'subagents' ? 'active' : ''}`}
            onClick={() => setTab('subagents')}
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              border: 'none',
              background: tab === 'subagents' ? '#ffffff' : 'transparent',
              color: tab === 'subagents' ? '#0f172a' : '#64748b',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Subagents {activeSubagents.length > 0 ? `(${activeSubagents.length})` : ''}
          </button>
          <button
            type="button"
            aria-label="Add tab"
            style={{ background: 'transparent', border: 'none', padding: 4, cursor: 'pointer', color: '#94a3b8' }}
          >
            <Plus size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            className="sv-aux-btn"
            aria-label={isExpanded ? 'Minimize pane' : 'Maximize pane'}
            onClick={() => setIsExpanded((v) => !v)}
            style={{ background: 'transparent', border: 'none', padding: 4, cursor: 'pointer', color: '#64748b' }}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            type="button"
            className="sv-aux-close"
            aria-label="Close pane"
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', padding: 4, cursor: 'pointer', color: '#64748b' }}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {/* Sub-Header Breadcrumb */}
      <div
        className="sv-aux-breadcrumb"
        style={{
          padding: '6px 12px',
          background: '#ffffff',
          borderBottom: '1px solid #f1f5f9',
          fontSize: 11,
          color: '#64748b',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {activeFile ? activeFile.path : 'SOVARA > apps > desktop > src > renderer'}
      </div>

      <div className="sv-aux-body" style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'diffs' ? (
          <div className="sv-aux-content" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {activeFile && activeFile.diffChunks ? (
              <div
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 12,
                  lineHeight: 1.6,
                }}
              >
                {/* Expandable Chunk Header */}
                <div
                  style={{
                    padding: '4px 12px',
                    background: '#f1f5f9',
                    color: '#64748b',
                    fontSize: 11,
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>@@ -101,5 +101,6 @@</span>
                  <span style={{ color: '#0284c7', cursor: 'pointer' }}>+28 more lines</span>
                </div>
                {activeFile.diffChunks.map((chunk, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      background:
                        chunk.type === 'add'
                          ? '#f0fdf4'
                          : chunk.type === 'del'
                          ? '#fef2f2'
                          : 'transparent',
                      color:
                        chunk.type === 'add'
                          ? '#166534'
                          : chunk.type === 'del'
                          ? '#991b1b'
                          : '#334155',
                      borderLeft:
                        chunk.type === 'add'
                          ? '3px solid #22c55e'
                          : chunk.type === 'del'
                          ? '3px solid #ef4444'
                          : '3px solid transparent',
                      padding: '2px 8px',
                    }}
                  >
                    <span
                      style={{
                        width: 40,
                        color: '#94a3b8',
                        userSelect: 'none',
                        flexShrink: 0,
                      }}
                    >
                      {chunk.lineOld ?? ''}
                    </span>
                    <span
                      style={{
                        width: 40,
                        color: '#94a3b8',
                        userSelect: 'none',
                        flexShrink: 0,
                      }}
                    >
                      {chunk.lineNew ?? ''}
                    </span>
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {chunk.content}
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sv-aux-empty" style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                <FileText size={24} style={{ marginBottom: 8, opacity: 0.6 }} />
                <p>No active file diffs selected.</p>
              </div>
            )}
          </div>
        ) : tab === 'artifacts' ? (
          <div className="sv-aux-content" style={{ height: '100%', padding: 12 }}>
            <div className="sv-aux-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: 13, color: '#0f172a' }}>{artifactTitle}</strong>
              <button
                type="button"
                onClick={copyArtifact}
                style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}
              >
                {copied ? 'Copied' : 'Copy Content'}
              </button>
            </div>
            {artifactContent ? (
              artifactType === 'html' ? (
                <iframe
                  className="sv-aux-iframe"
                  title={artifactTitle}
                  srcDoc={artifactContent}
                  sandbox="allow-scripts allow-modals"
                  style={{ width: '100%', height: 'calc(100% - 40px)', border: '1px solid #e2e8f0', borderRadius: 6 }}
                />
              ) : (
                <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 6, fontSize: 12, overflow: 'auto' }}>
                  <code>{artifactContent}</code>
                </pre>
              )
            ) : (
              <div className="sv-aux-empty" style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                <Eye size={24} style={{ marginBottom: 8, opacity: 0.6 }} />
                <p>No active artifact selected.</p>
              </div>
            )}
          </div>
        ) : tab === 'subagents' ? (
          <div className="sv-aux-content" style={{ padding: 12 }}>
            <strong style={{ fontSize: 13, color: '#0f172a', display: 'block', marginBottom: 12 }}>Active Subagents &amp; Tasks</strong>
            {activeSubagents.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 24 }}>No subagents currently active.</div>
            ) : (
              activeSubagents.map((sa) => (
                <div key={sa.id} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: '#0f172a' }}>{sa.role}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{sa.type} - {sa.state}</div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="sv-aux-content" style={{ padding: 12 }}>
            <strong style={{ fontSize: 13, color: '#0f172a', display: 'block', marginBottom: 12 }}>Terminal Sandbox Log</strong>
            {terminalLogs.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12, textAlign: 'center', padding: 24 }}>Terminal output is empty.</div>
            ) : (
              <div style={{ background: '#0f172a', color: '#f8fafc', padding: 12, borderRadius: 6, fontFamily: 'monospace', fontSize: 11 }}>
                {terminalLogs.map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
