import { useState, useEffect, useCallback, type ReactElement } from 'react'
import {
  ArrowLeft, Search, Folder, Radar,
  HardDrive, Trash2, Bot, Cpu
} from 'lucide-react'
import {
  listLibraryModels, getLibraryDirectory, setLibraryDirectory,
  detectLibraryLocations, deleteLibraryModel, onDownloadEvents,
  listDiscoveredModels, listRuntimes, getActiveModel, getRecentLogs,
  type LibraryModel, type DetectedModelLocation,
} from '@/lib/client/api'
import type { DiscoveredModel, ModelRuntimeEntry, ActiveModelState } from '@shared/types/models'

interface LibraryPageProps {
  onBack: () => void
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function InstallStatusChip({ status }: { status: NonNullable<LibraryModel['installStatus']> }): ReactElement | null {
  if (status === 'installed') {
    return <span className="library-model-chip library-model-chip--installed">Installed</span>
  }
  if (status === 'missing') {
    return <span className="library-model-chip library-model-chip--missing">Missing</span>
  }
  return <span className="library-model-chip library-model-chip--unregistered">Unregistered</span>
}

function LibraryModelIcon(): ReactElement {
  return (
    <div className="library-model-icon">
      <HardDrive size={16} />
    </div>
  )
}

export function LibraryPage({ onBack }: LibraryPageProps): ReactElement {
  const [models, setModels] = useState<LibraryModel[]>([])
  const [directory, setDirectory] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [sortBy, setSortBy] = useState('latest')
  const [loading, setLoading] = useState(true)
  const [detectOpen, setDetectOpen] = useState(false)
  const [detectLocations, setDetectLocations] = useState<DetectedModelLocation[]>([])
  const [detectError, setDetectError] = useState<string | null>(null)
  const [detectLoading, setDetectLoading] = useState(false)
  const [applyingPath, setApplyingPath] = useState<string | null>(null)
  const [connectedRuntimes, setConnectedRuntimes] = useState<ModelRuntimeEntry[]>([])
  const [connectedModels, setConnectedModels] = useState<DiscoveredModel[]>([])
  const [activeModel, setActiveModel] = useState<ActiveModelState>({ selection: null, available: false })
  const [logs, setLogs] = useState<Record<string,string[]>>({})
  const [logsOpen, setLogsOpen] = useState(false)

  const refreshConnected = useCallback(async (): Promise<void> => {
    try {
      const [rts, mods, act, lg] = await Promise.all([
        listRuntimes().catch(()=>[] as ModelRuntimeEntry[]),
        listDiscoveredModels().catch(()=>[] as DiscoveredModel[]),
        getActiveModel().catch(()=>({ selection: null, available: false } as ActiveModelState)),
        getRecentLogs('all').catch(()=>({})),
      ])
      setConnectedRuntimes(rts)
      setConnectedModels(mods)
      setActiveModel(act)
      setLogs(lg)
    } catch { /* ignore */ }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [modelsResult, dirResult] = await Promise.all([
        listLibraryModels(),
        getLibraryDirectory(),
      ])
      setModels(modelsResult)
      setDirectory(dirResult.path)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    void refreshConnected()
    // A finished download lands a new file — rescan the directory.
    const dispose = onDownloadEvents((ev) => {
      if (ev.state === 'done') { void refresh(); void refreshConnected() }
    })
    return dispose
  }, [refresh, refreshConnected])

  const filteredModels = models
    .filter((m) => {
      if (!filterQuery.trim()) return true
      const q = filterQuery.toLowerCase()
      return m.name.toLowerCase().includes(q) || m.file.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.file.localeCompare(b.file)
      if (sortBy === 'size') return b.sizeBytes - a.sizeBytes
      return b.modifiedAt - a.modifiedAt
    })

  const handleChangeDirectory = useCallback(async (): Promise<void> => {
    try {
      const res = await setLibraryDirectory('')
      if (res.ok) {
        setDirectory(res.path)
        void refresh()
      }
    } catch {
      // dialog cancelled or failed — keep current directory
    }
  }, [refresh])

  const handleDetect = useCallback(async (): Promise<void> => {
    if (!detectOpen) {
      setDetectLoading(true)
      setDetectError(null)
      try {
        const locs = await detectLibraryLocations()
        setDetectLocations(locs)
        if (locs.length === 0) setDetectError('Backend returned 0 candidates — detection failed. Try restarting the app.')
        void refreshConnected()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setDetectError(msg || 'Detection failed')
        setDetectLocations([])
      } finally {
        setDetectLoading(false)
      }
    }
    setDetectOpen((open) => !open)
  }, [detectOpen, refreshConnected])

  const handleApplyLocation = useCallback(async (locPath: string): Promise<void> => {
    setApplyingPath(locPath)
    try {
      const res = await setLibraryDirectory(locPath)
      if (res.ok) {
        setDirectory(res.path)
        setDetectOpen(false)
        setDetectLocations([])
        void refresh()
      }
    } finally {
      setApplyingPath(null)
    }
  }, [refresh])

  const handleDelete = useCallback(async (entryPath: string): Promise<void> => {
    try {
      await deleteLibraryModel(entryPath)
      setModels((prev) => prev.filter((m) => m.path !== entryPath))
    } catch {
      // ignore — row stays
    }
  }, [])

  return (
    <div className="settings-content">
      <h2 className="settings-section-title">Library</h2>

      <div className="settings-group">
        <h3 className="settings-section-subtitle">My Models</h3>

        {/* Directory selector */}
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-label">
                <Folder size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Models directory
              </div>
              <div className="settings-row-desc">{directory || 'Not configured'}</div>
            </div>
            <div className="settings-row-right">
              <button type="button" className="settings-action-btn" onClick={handleChangeDirectory}>
                Change
              </button>
              <button
                type="button"
                className="settings-action-btn"
                title="Detect LM Studio or Ollama model folders"
                onClick={() => void handleDetect()}
              >
                <Radar size={14} />
              </button>
            </div>
          </div>
          {detectOpen ? (
            <div className="library-detect">
              <div className="library-detect-header">
                <span className="library-detect-title">Detected locations</span>
                <button type="button" className="settings-action-btn" style={{ fontSize: 11 }} onClick={() => void refreshConnected()}>Refresh logs</button>
              </div>
              {detectLoading ? (
                <div className="library-detect-empty">Scanning drives…</div>
              ) : detectError ? (
                <div className="library-detect-empty" style={{ color: '#c0392b' }}>{detectError}<br/><span style={{ fontSize: 11, opacity: 0.7 }}>Logs shown below. Files: %APPDATA%/Sovara/logs/detection.log + runtime.log</span></div>
              ) : detectLocations.length === 0 ? (
                <div className="library-detect-empty">No candidates found.</div>
              ) : (
                detectLocations.map((loc) => (
                  <div key={loc.path} className="library-detect-row">
                    <div className="library-detect-icon">
                      {loc.kind === 'ollama' ? <Bot size={14} /> : <Cpu size={14} />}
                    </div>
                    <div className="library-detect-body">
                      <div className="library-detect-name">
                        {loc.name} <span className="library-detect-kind">{loc.kind}</span>
                      </div>
                      <div className="library-detect-path">{loc.path}</div>
                    </div>
                    <div className="library-detect-meta">
                      {loc.exists ? (
                        <span className="library-detect-count">
                        {loc.kind === 'ollama'
                          ? `${loc.modelCount} model${loc.modelCount !== 1 ? 's' : ''} installed`
                          : `${loc.modelCount} weight${loc.modelCount !== 1 ? 's' : ''} found`}
                      </span>
                      ) : (
                        <span className="library-model-chip library-model-chip--missing">Not found</span>
                      )}
                    </div>
                    <div className="settings-row-right">
                      <button
                        type="button"
                        className="settings-action-btn"
                        disabled={!loc.exists || applyingPath !== null}
                        onClick={() => void handleApplyLocation(loc.path)}
                      >
                        {applyingPath === loc.path ? 'Applying…' : 'Apply'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>

        {/* Connected models (orchestrated runtimes §6) */}
        <div className="settings-card" style={{ marginTop: 12 }}>
          <div className="library-detect-header">
            <span className="library-detect-title">Connected models</span>
            <span className="muted small">{connectedRuntimes.length} runtime{connectedRuntimes.length!==1?'s':''} · {connectedModels.length} model{connectedModels.length!==1?'s':''} · active: {activeModel.selection ? `${activeModel.selection.modelId} ${activeModel.available ? '(Ready)' : '(Unavailable)'}` : 'none'}</span>
          </div>
          {connectedModels.length===0 ? (
            <div className="library-detect-empty">No connected models — add a runtime in Settings → Models or drop a .gguf into the library folder. Library files appear as <em>Local Library</em> runtime.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 0' }}>
              {connectedModels.map(m => {
                const rt = connectedRuntimes.find(r=>r.id===m.runtimeId)
                const isActive = activeModel.selection?.modelId===m.modelId && activeModel.selection?.runtimeId===m.runtimeId
                return (
                  <div key={`${m.runtimeId}:${m.modelId}`} className="library-detect-row" style={{ borderLeft: isActive ? '3px solid #22c55e' : undefined }}>
                    <div className="library-detect-icon"><HardDrive size={14} /></div>
                    <div className="library-detect-body">
                      <div className="library-detect-name">{m.displayName} {isActive ? <span className="library-model-chip library-model-chip--installed">Active</span> : null} {!m.available ? <span className="library-model-chip library-model-chip--missing">Unavailable</span> : null}</div>
                      <div className="library-detect-path">{m.modelId} · {rt?.displayName ?? m.runtimeId}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="library-detect-header" style={{ marginTop: 8, cursor: 'pointer' }} onClick={()=>setLogsOpen(o=>!o)}>
            <span className="library-detect-title">Logs (orchestrated chat §11)</span>
            <span className="muted small">{logsOpen ? 'hide' : 'show'} — detection.log · runtime.log</span>
          </div>
          {logsOpen ? (
            <div style={{ maxHeight: 220, overflow: 'auto', background: '#0f1115', color: '#a3a3a3', fontFamily: 'monospace', fontSize: 11, padding: 8, borderRadius: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              <div style={{ color: '#e5e7eb', marginBottom: 4 }}>— detection.log (last 30) —</div>
              {(logs.detection ?? []).slice(-30).join('\n') || '(empty)'}
              <div style={{ color: '#e5e7eb', margin: '12px 0 4px' }}>— runtime.log (last 30) —</div>
              {(logs.runtime ?? []).slice(-30).join('\n') || '(empty)'}
            </div>
          ) : null}
        </div>

        {/* Search + sort */}
        <div className="library-toolbar">
          <div className="library-search-wrap">
            <Search size={14} className="library-search-icon" />
            <input
              type="text"
              className="library-search"
              placeholder="Filter models..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Count + sort */}
        <div className="library-info-row">
          <span className="library-count">
            Showing {filteredModels.length} model{filteredModels.length !== 1 ? 's' : ''}
          </span>
          <select
            className="settings-select library-sort-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="latest">Latest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
        </div>

        {/* Model list */}
        {loading ? (
          <div className="settings-card">
            <span className="muted">Loading models...</span>
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="settings-card settings-card--empty">
            <div className="settings-empty-state">
              <div className="settings-empty-icon">📦</div>
              <div className="settings-empty-text">
                <div className="settings-empty-title">
                  {models.length === 0 ? 'No models downloaded yet' : 'No models match your filter'}
                </div>
                <div className="settings-empty-desc">
                  {models.length === 0
                    ? 'Go to Explore to download your first model.'
                    : 'Try a different search term.'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="library-model-list">
            {filteredModels.map((model) => (
              <div key={model.path} className="library-model-row">
                <LibraryModelIcon />
                <div className="library-model-body">
                  <div className="library-model-name">{model.file}</div>
                  <div className="library-model-meta">
                    <span className="library-model-chip">{formatBytes(model.sizeBytes)}</span>
                    <span className="library-model-chip">{model.name}</span>
                    {model.installStatus ? <InstallStatusChip status={model.installStatus} /> : null}
                  </div>
                  <div className="library-model-sub">
                    {new Date(model.modifiedAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-action-btn"
                  title="Delete model file"
                  aria-label={`Delete ${model.file}`}
                  onClick={() => void handleDelete(model.path)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
