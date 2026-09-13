import { useState, useEffect, useCallback, type ReactElement } from 'react'
import {
  ArrowLeft, Search, Folder, Radar,
  HardDrive, Trash2, Bot, Cpu, ExternalLink, FolderOpen, FileText
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
    setDetectError(null)
    try {
      const { registerExternalDir } = await import('@/lib/client/api')
      const res = await registerExternalDir(locPath)
      if (res.ok) {
        setDetectOpen(false)
        setDetectLocations([])
        await refresh()
        await refreshConnected()
      } else throw new Error('register failed')
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : String(e))
    } finally { setApplyingPath(null) }
  }, [refresh, refreshConnected])

  const handleDelete = useCallback(async (entryPath: string): Promise<void> => {
    try {
      await deleteLibraryModel(entryPath)
      setModels((prev) => prev.filter((m) => m.path !== entryPath))
      void refreshConnected()
    } catch { /* ignore */ }
  }, [refreshConnected])

  const handleReveal = useCallback(async (entryPath: string): Promise<void> => {
    try {
      const sov = (window as unknown as { sovara?: { invoke:(c:string,...a:unknown[])=>Promise<unknown> }}).sovara ?? (window as unknown as { api?: { invoke:(c:string,...a:unknown[])=>Promise<unknown> }}).api
      if (sov) await sov.invoke('library:revealInFolder', entryPath) // highlights the actual .gguf file
    } catch (e) { console.error('[library] reveal file failed', e) }
  }, [])

  const handleOpenCard = useCallback(async (model: LibraryModel): Promise<void> => {
    try {
      const sov = (window as unknown as { sovara?: { invoke:(c:string,...a:unknown[])=>Promise<unknown> }}).sovara ?? (window as unknown as { api?: { invoke:(c:string,...a:unknown[])=>Promise<unknown> }}).api
      // Card click → show the model FOLDER (contains the .json sidecar built on Use), not the file
      const folder = model.path.replace(/[/\\][^/\\]+$/, '')
      if (sov) await sov.invoke('library:revealInFolder', folder)
    } catch (e) { console.error('[library] open folder failed', e) }
  }, [])

  const hfUrl = useCallback((name: string): string => {
    // repository may be "Qwen/Qwen3-0.6B" or "lmstudio-community/GLM-4.6V-Flash-GGUF" or absolute win path
    const isPath = /^[A-Z]:[\\/]/i.test(name) || name.includes(':\\')
    if (!isPath && name.includes('/')) return `https://huggingface.co/${name}`
    // try derive from file's parent: e.g. "C:\\...\\Qwen__Qwen3-0.6B\\file.gguf" already mapped, else search
    return `https://huggingface.co/models?search=${encodeURIComponent(name.replace(/__/g,'/'))}`
  }, [])
  const cardStyleFor = useCallback((m: LibraryModel): { hf: string; cardUrl: string; hasJsonCard: boolean } => {
    const hasJsonCard = !/^[A-Z]:[\\/]/i.test(m.name) // if name is a real repo, Explore JSON card exists; win-path means synthesized card
    const repo = hasJsonCard ? m.name : m.path.split(/[/\\]/).find(p=> p.includes('__'))?.replace('__','/') ?? m.name
    return { hf: hfUrl(repo), cardUrl: hasJsonCard ? `#/model/${encodeURIComponent(m.name)}/modelcards` : `#/model/${encodeURIComponent(repo)}/modelcards`, hasJsonCard }
  }, [hfUrl])

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
              {detectLocations.filter((l) => !l.exists).length > 0 && !detectLoading && !detectError ? (
                <div className="library-detect-empty" style={{ color: '#a3a3a3', fontSize: 11 }}>
                  {detectLocations.filter((l) => !l.exists).length} location{detectLocations.filter((l) => !l.exists).length !== 1 ? 's' : ''} not found — hidden from list
                </div>
              ) : null}
              {detectLoading ? (
                <div className="library-detect-empty">Scanning drives…</div>
              ) : detectError ? (
                <div className="library-detect-empty" style={{ color: '#c0392b' }}>{detectError}<br/><span style={{ fontSize: 11, opacity: 0.7 }}>Logs shown below. Files: %APPDATA%/Sovara/logs/detection.log + runtime.log</span></div>
              ) : detectLocations.filter((l) => l.exists).length === 0 ? (
                <div className="library-detect-empty">No valid locations found.</div>
              ) : (
                detectLocations.filter((loc) => loc.exists).map((loc) => (
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
                      <span className="library-detect-count">
                        {loc.kind === 'ollama'
                          ? `${loc.modelCount} model${loc.modelCount !== 1 ? 's' : ''} installed`
                          : `${loc.modelCount} weight${loc.modelCount !== 1 ? 's' : ''} found`}
                      </span>
                    </div>
                    <div className="settings-row-right">
                      <button
                        type="button"
                        className="settings-action-btn"
                        disabled={applyingPath !== null}
                        title="Register models from this folder without changing Sovara's own directory"
                        onClick={() => void handleApplyLocation(loc.path)}
                      >
                        {applyingPath === loc.path ? 'Registering…' : 'Use'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>

        {/* Logs — dummy Connected models removed per user request (models not actually loaded) */}
        <div className="settings-card" style={{ marginTop: 12 }}>
          <div className="library-detect-header" style={{ cursor: 'pointer' }} onClick={()=>setLogsOpen(o=>!o)}>
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
              <div key={model.path} className="library-model-row" style={{ flexDirection:'column', alignItems:'stretch', padding:12, gap:8, border:'1px solid var(--border)', borderRadius:10 }}>
                <div style={{display:'flex', gap:10, alignItems:'center'}}>
                  <LibraryModelIcon />
                  <div className="library-model-body" style={{flex:1}}>
                    <div className="library-model-name">{model.file}</div>
                    <div className="library-model-meta">
                      <span className="library-model-chip">{formatBytes(model.sizeBytes)}</span>
                      <span className="library-model-chip">{model.name}</span>
                      {model.installStatus ? <InstallStatusChip status={model.installStatus} /> : null}
                    </div>
                  </div>
                </div>
                <div className="library-model-sub" style={{fontSize:11, opacity:0.7}} title={model.path}>
                  {(() => { const c = cardStyleFor(model); return (<>
                    <div>Location: {model.path}</div>
                    <div>{new Date(model.modifiedAt).toLocaleDateString()} · <a href={c.hf} target="_blank" rel="noreferrer" style={{color:'var(--accent)'}}><ExternalLink size={10} style={{display:'inline'}}/> {c.hf}</a> · <a href={c.cardUrl} style={{color:'var(--accent)'}}>/model/modelcards{c.hasJsonCard ? '' : ' (synthesized)'}</a></div>
                  </>)})()}
                </div>
                <div style={{display:'flex', gap:6, justifyContent:'flex-end'}}>
                  <button type="button" className="settings-action-btn" title="Open model card & reveal in Explorer" onClick={() => void handleOpenCard(model)}><FileText size={12}/> Card</button>
                  <button type="button" className="settings-action-btn" title="Reveal in file explorer" onClick={() => void handleReveal(model.path)}><FolderOpen size={12}/> Reveal</button>
                  <button type="button" className="settings-action-btn" style={{color:'#c0392b'}} title="Delete model" onClick={() => void handleDelete(model.path)}><Trash2 size={12}/> Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
