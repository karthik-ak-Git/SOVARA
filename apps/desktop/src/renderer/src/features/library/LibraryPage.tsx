import { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react'
import {
  Folder,
  FolderOpen,
  Search,
  Radar,
  HardDrive,
  Trash2,
  Cpu,
  ExternalLink,
  RefreshCw,
  Check,
  Copy,
  MessageSquare,
  AlertCircle,
  X,
  Terminal,
  ChevronDown,
  ChevronRight,
  Layers,
  Sparkles,
} from 'lucide-react'
import {
  listLibraryModels,
  getLibraryDirectory,
  setLibraryDirectory,
  detectLibraryLocations,
  deleteLibraryModel,
  revealInFolder,
  onDownloadEvents,
  getActiveDownloads,
  cancelModelDownload,
  listRuntimes,
  getActiveModel,
  selectModel,
  getRecentLogs,
  openExternal,
  type LibraryModel,
  type DetectedModelLocation,
  type DownloadEventView,
} from '@/lib/client/api'
import type { ModelRuntimeEntry, ActiveModelState } from '@shared/types/models'

interface LibraryPageProps {
  onBack?: () => void
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

interface ParsedMeta {
  quantization: string | null
  paramSize: string | null
  author: string | null
  sourceLabel: 'LM Studio' | 'Ollama' | 'Sovara' | 'Hugging Face' | 'Local'
  hfSearchUrl: string | null
}

function parseModelMeta(model: LibraryModel): ParsedMeta {
  const file = model.file
  const lowerPath = model.path.toLowerCase()

  // 1. Quantization extraction (e.g. Q4_K_M, Q8_0, Q5_K_S, IQ3_M, F16, etc.)
  const quantMatch = file.match(/(Q[0-9]_[A-Z0-9_]+|IQ[0-9]_[A-Z0-9_]+|F16|F32|BF16)/i)
  const quantization = quantMatch ? quantMatch[1].toUpperCase() : null

  // 2. Parameter size extraction (e.g. 12B, 4B, 0.5B, 70B, 1.5B)
  const paramMatch =
    file.match(/[-_.]([0-9]+(?:\.[0-9]+)?B)[-_.]/i) || file.match(/^([0-9]+(?:\.[0-9]+)?B)[-_.]/i)
  const paramSize = paramMatch ? paramMatch[1].toUpperCase() : null

  // 3. Source folder / Origin
  let sourceLabel: 'LM Studio' | 'Ollama' | 'Sovara' | 'Hugging Face' | 'Local' = 'Local'
  if (lowerPath.includes('.lmstudio')) sourceLabel = 'LM Studio'
  else if (lowerPath.includes('ollama')) sourceLabel = 'Ollama'
  else if (lowerPath.includes('huggingface')) sourceLabel = 'Hugging Face'
  else if (lowerPath.includes('sovara')) sourceLabel = 'Sovara'

  // 4. Author / Repository parsing
  let author: string | null = null
  if (model.name && model.name !== model.file) {
    if (model.name.includes(' — ')) {
      author = model.name.split(' — ')[0].trim()
    } else if (model.name.includes('/')) {
      author = model.name.split('/')[0].trim()
    } else {
      author = model.name.trim()
    }
  }

  // 5. Hugging Face search URL (safe, clean link)
  let hfSearchUrl: string | null = null
  if (author && !/^[A-Z]:[\\/]/i.test(author)) {
    hfSearchUrl = `https://huggingface.co/models?search=${encodeURIComponent(author)}`
  }

  return { quantization, paramSize, author, sourceLabel, hfSearchUrl }
}

export function LibraryPage({ onBack: _onBack }: LibraryPageProps): ReactElement {
  const [models, setModels] = useState<LibraryModel[]>([])
  const [directory, setDirectory] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [sortBy, setSortBy] = useState<'latest' | 'name' | 'size-desc' | 'size-asc'>('latest')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // External directory detection
  const [detectOpen, setDetectOpen] = useState(false)
  const [detectLocations, setDetectLocations] = useState<DetectedModelLocation[]>([])
  const [detectError, setDetectError] = useState<string | null>(null)
  const [detectLoading, setDetectLoading] = useState(false)
  const [applyingPath, setApplyingPath] = useState<string | null>(null)

  // Connected runtimes & active model in workbench
  const [connectedRuntimes, setConnectedRuntimes] = useState<ModelRuntimeEntry[]>([])
  const [activeModel, setActiveModel] = useState<ActiveModelState>({ selection: null, available: false })
  const [selectingModelPath, setSelectingModelPath] = useState<string | null>(null)

  // Live download rows — same `events:download` channel ExplorePage consumes.
  // Seeded from getActiveDownloads so rows survive remount mid-transfer;
  // terminal done/cancelled entries are removed and trigger a rescan.
  const [activeDownloads, setActiveDownloads] = useState<Record<string, DownloadEventView>>({})

  const handleCancelDownload = useCallback(async (modelId: string, rfilename: string): Promise<void> => {
    try {
      await cancelModelDownload(modelId, rfilename)
    } catch {
      // backend reports failure; the error event updates the row
    }
  }, [])

  // Deletion confirmation
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null)

  // Clipboard copy feedback
  const [copiedPath, setCopiedPath] = useState<string | null>(null)

  // Logs diagnostics
  const [logs, setLogs] = useState<Record<string, string[]>>({})
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)

  const refreshConnected = useCallback(async (): Promise<void> => {
    try {
      const [rts, act] = await Promise.all([
        listRuntimes().catch(() => [] as ModelRuntimeEntry[]),
        getActiveModel().catch(() => ({ selection: null, available: false } as ActiveModelState)),
      ])
      setConnectedRuntimes(rts)
      setActiveModel(act)
    } catch {
      // ignore
    }
  }, [])

  const refreshLogs = useCallback(async (): Promise<void> => {
    setLogsLoading(true)
    try {
      const lg = await getRecentLogs('all').catch(() => ({}))
      setLogs(lg)
    } catch {
      // ignore
    } finally {
      setLogsLoading(false)
    }
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

  const handleManualRefresh = async (): Promise<void> => {
    setRefreshing(true)
    await Promise.all([refresh(), refreshConnected()])
    setTimeout(() => setRefreshing(false), 400)
  }

  useEffect(() => {
    void refresh()
    void refreshConnected()
    // Seed in-progress rows so a remount mid-transfer still shows bytes/speed.
    void getActiveDownloads()
      .then((dls) => {
        if (!Array.isArray(dls)) return
        const map: Record<string, DownloadEventView> = {}
        for (const d of dls) {
          map[`${d.modelId}\n${d.rfilename}`] = {
            modelId: d.modelId,
            rfilename: d.rfilename,
            state: (d.state as DownloadEventView['state']) ?? 'progress',
            receivedBytes: d.receivedBytes ?? 0,
            totalBytes: d.totalBytes ?? null,
          }
        }
        setActiveDownloads(map)
      })
      .catch(() => {})
    const dispose = onDownloadEvents((ev) => {
      setActiveDownloads((prev) => {
        const next = { ...prev }
        const k = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'cancelled') delete next[k]
        else next[k] = ev
        return next
      })
      if (ev.state === 'done') {
        void refresh()
        void refreshConnected()
      }
    })
    return dispose
  }, [refresh, refreshConnected])

  const downloadList = useMemo(() => Object.values(activeDownloads), [activeDownloads])

  // Filter & sort
  const filteredModels = useMemo(() => {
    return models
      .filter((m) => {
        if (!filterQuery.trim()) return true
        const q = filterQuery.toLowerCase()
        return (
          m.file.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          m.path.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        if (sortBy === 'name') return a.file.localeCompare(b.file)
        if (sortBy === 'size-desc') return b.sizeBytes - a.sizeBytes
        if (sortBy === 'size-asc') return a.sizeBytes - b.sizeBytes
        return b.modifiedAt - a.modifiedAt
      })
  }, [models, filterQuery, sortBy])

  // Total size calculation
  const totalSizeBytes = useMemo(() => {
    return models.reduce((acc, m) => acc + (m.sizeBytes || 0), 0)
  }, [models])

  // Check if model is currently active
  const isModelActive = useCallback(
    (model: LibraryModel): boolean => {
      if (!activeModel.selection) return false
      const selId = activeModel.selection.modelId
      return selId.includes(model.file) || activeModel.displayName === model.file
    },
    [activeModel]
  )

  // Select model for chat
  const handleSelectModel = async (model: LibraryModel): Promise<void> => {
    setSelectingModelPath(model.path)
    try {
      let repo = model.name
      if (model.name.includes(' — ')) repo = model.name.split(' — ')[0]
      const modelId = repo && repo !== model.file ? `${repo}/${model.file}` : model.file
      const runtimeId = model.runtimeId || connectedRuntimes[0]?.id || 'local'
      const updated = await selectModel(runtimeId, modelId)
      setActiveModel(updated)
      await refreshConnected()
    } catch (err) {
      console.error('[library] select model error', err)
    } finally {
      setSelectingModelPath(null)
    }
  }

  // Directory change dialog
  const handleChangeDirectory = useCallback(async (): Promise<void> => {
    try {
      const res = await setLibraryDirectory('')
      if (res.ok) {
        setDirectory(res.path)
        void refresh()
      }
    } catch {
      // dialog cancelled
    }
  }, [refresh])

  // Scan external model locations
  const handleToggleDetect = useCallback(async (): Promise<void> => {
    if (!detectOpen) {
      setDetectLoading(true)
      setDetectError(null)
      try {
        const locs = await detectLibraryLocations()
        setDetectLocations(locs)
        if (locs.length === 0) {
          setDetectError('No existing LM Studio or Ollama model directories found on local drives.')
        }
        void refreshConnected()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setDetectError(msg || 'Location detection failed')
        setDetectLocations([])
      } finally {
        setDetectLoading(false)
      }
    }
    setDetectOpen((open) => !open)
  }, [detectOpen, refreshConnected])

  // Register external directory
  const handleApplyLocation = useCallback(
    async (locPath: string): Promise<void> => {
      setApplyingPath(locPath)
      setDetectError(null)
      try {
        const { registerExternalDir } = await import('@/lib/client/api')
        const res = await registerExternalDir(locPath)
        if (res.ok) {
          await refresh()
          await refreshConnected()
        } else {
          throw new Error('Directory registration failed')
        }
      } catch (e) {
        setDetectError(e instanceof Error ? e.message : String(e))
      } finally {
        setApplyingPath(null)
      }
    },
    [refresh, refreshConnected]
  )

  // Reveal file in Explorer
  const handleReveal = useCallback(async (entryPath: string): Promise<void> => {
    try {
      await revealInFolder(entryPath)
    } catch (e) {
      console.error('[library] reveal file failed', e)
    }
  }, [])

  // Delete model
  const handleDelete = useCallback(
    async (entryPath: string): Promise<void> => {
      try {
        await deleteLibraryModel(entryPath)
        setModels((prev) => prev.filter((m) => m.path !== entryPath))
        setConfirmDeletePath(null)
        void refreshConnected()
      } catch (e) {
        console.error('[library] delete model failed', e)
      }
    },
    [refreshConnected]
  )

  // Copy path helper
  const handleCopyPath = (path: string): void => {
    void navigator.clipboard.writeText(path)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath(null), 2000)
  }

  return (
    <div className="settings-modal-scroll library-page-root">
      {/* ── HEADER ── */}
      <div className="library-header-row">
        <div>
          <h1 className="settings-modal-title">Library</h1>
          <p className="settings-modal-subtitle">
            Manage downloaded GGUF weights, local storage directories, and scanned AI models.
          </p>
        </div>
        <div className="library-header-stats">
          <div className="library-stat-pill">
            <Layers size={13} className="library-stat-icon" />
            <span>
              <strong>{models.length}</strong> {models.length === 1 ? 'Model' : 'Models'}
            </span>
          </div>
          <div className="library-stat-pill">
            <HardDrive size={13} className="library-stat-icon" />
            <span>
              <strong>{formatBytes(totalSizeBytes)}</strong>
            </span>
          </div>
          <button
            type="button"
            className="library-btn-action library-btn-refresh"
            title="Rescan model library"
            onClick={() => void handleManualRefresh()}
            disabled={refreshing}
          >
            <RefreshCw size={13} className={refreshing ? 'library-spin' : ''} />
            <span>{refreshing ? 'Scanning…' : 'Rescan'}</span>
          </button>
        </div>
      </div>

      {/* ── STORAGE DIRECTORY CARD ── */}
      <div className="settings-modal-group">
        <div className="settings-modal-group-title">Storage &amp; Scanned Directories</div>
        <div className="settings-modal-card library-storage-card">
          <div className="library-storage-main">
            <div className="library-storage-icon-wrap">
              <Folder size={20} className="library-storage-icon" />
            </div>
            <div className="library-storage-info">
              <div className="library-storage-title">Default Models Directory</div>
              <div className="library-storage-path-row">
                <span className="library-storage-path" title={directory}>
                  {directory || 'Initializing default path…'}
                </span>
                {directory ? (
                  <button
                    type="button"
                    className="library-btn-icon"
                    title={copiedPath === directory ? 'Copied!' : 'Copy path'}
                    onClick={() => handleCopyPath(directory)}
                  >
                    {copiedPath === directory ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="library-storage-actions">
              <button
                type="button"
                className="library-btn-action"
                title="Change default model storage directory"
                onClick={handleChangeDirectory}
              >
                <Folder size={13} />
                <span>Change Folder</span>
              </button>
              {directory ? (
                <button
                  type="button"
                  className="library-btn-action"
                  title="Open folder in File Explorer"
                  onClick={() => void handleReveal(directory)}
                >
                  <FolderOpen size={13} />
                  <span>Open</span>
                </button>
              ) : null}
              <button
                type="button"
                className={`library-btn-action ${detectOpen ? 'active' : ''}`}
                title="Detect models from LM Studio or Ollama"
                onClick={() => void handleToggleDetect()}
              >
                <Radar size={13} />
                <span>Detect External Folders</span>
                {detectLocations.filter((l) => l.exists).length > 0 ? (
                  <span className="library-badge-count">
                    {detectLocations.filter((l) => l.exists).length}
                  </span>
                ) : null}
              </button>
            </div>
          </div>

          {/* ── DETECTED LOCATIONS PANEL ── */}
          {detectOpen ? (
            <div className="library-detect-panel">
              <div className="library-detect-panel-header">
                <div>
                  <div className="library-detect-panel-title">External Model Locations</div>
                  <div className="library-detect-panel-sub">
                    Auto-scanned folders from LM Studio and Ollama. Click Register to make them available without copying files.
                  </div>
                </div>
                <button
                  type="button"
                  className="library-btn-action"
                  style={{ fontSize: 11 }}
                  onClick={() => void handleToggleDetect()}
                >
                  <RefreshCw size={11} className={detectLoading ? 'library-spin' : ''} />
                  <span>Rescan Drives</span>
                </button>
              </div>

              {detectLoading ? (
                <div className="library-detect-loading">
                  <RefreshCw size={16} className="library-spin" />
                  <span>Scanning local drives for external model folders…</span>
                </div>
              ) : detectError ? (
                <div className="library-detect-empty error">
                  <AlertCircle size={15} />
                  <span>{detectError}</span>
                </div>
              ) : detectLocations.filter((l) => l.exists).length === 0 ? (
                <div className="library-detect-empty">
                  No existing LM Studio or Ollama model directories found on your system.
                </div>
              ) : (
                <div className="library-detect-list">
                  {detectLocations
                    .filter((loc) => loc.exists)
                    .map((loc) => (
                      <div key={loc.path} className="library-detect-item">
                        <div className="library-detect-item-icon">
                          {loc.kind === 'ollama' ? <Cpu size={16} /> : <HardDrive size={16} />}
                        </div>
                        <div className="library-detect-item-info">
                          <div className="library-detect-item-title">
                            <span>{loc.name}</span>
                            <span className="library-chip library-chip-source">
                              {loc.kind === 'ollama' ? 'Ollama' : 'LM Studio'}
                            </span>
                          </div>
                          <div className="library-detect-item-path" title={loc.path}>
                            {loc.path}
                          </div>
                        </div>
                        <div className="library-detect-item-meta">
                          <span className="library-stat-pill">
                            {loc.kind === 'ollama'
                              ? `${loc.modelCount} model${loc.modelCount !== 1 ? 's' : ''}`
                              : `${loc.modelCount} GGUF file${loc.modelCount !== 1 ? 's' : ''}`}
                          </span>
                          <button
                            type="button"
                            className="library-btn-action primary"
                            disabled={applyingPath !== null}
                            onClick={() => void handleApplyLocation(loc.path)}
                          >
                            {applyingPath === loc.path ? 'Registering…' : 'Register Folder'}
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* ── TOOLBAR: SEARCH & SORT ── */}
      <div className="library-toolbar-card">
        <div className="library-search-box">
          <Search size={15} className="library-search-icon" />
          <input
            type="text"
            className="library-search-input"
            placeholder="Search models by name, quantization, architecture, or location…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
          {filterQuery ? (
            <button
              type="button"
              className="library-search-clear"
              title="Clear search"
              onClick={() => setFilterQuery('')}
            >
              <X size={13} />
            </button>
          ) : null}
        </div>

        <div className="library-toolbar-controls">
          <span className="library-filter-count">
            Showing <strong>{filteredModels.length}</strong> of {models.length}
          </span>
          <div className="library-sort-wrap">
            <select
              className="library-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            >
              <option value="latest">Recently Added</option>
              <option value="name">Name (A–Z)</option>
              <option value="size-desc">Size (Largest first)</option>
              <option value="size-asc">Size (Smallest first)</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── ACTIVE DOWNLOADS (live bytes/speed, same channel as Explore) ── */}
      {downloadList.length > 0 ? (
        <div className="settings-modal-group">
          <div className="settings-modal-group-title">Active Downloads ({downloadList.length})</div>
          <div className="settings-modal-card" style={{ padding: 0, overflow: 'hidden' }}>
            {downloadList.map((dl) => {
              const pct =
                dl.totalBytes && dl.totalBytes > 0
                  ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100))
                  : 0
              const speedMBps = dl.speedBps ? (dl.speedBps / (1024 * 1024)).toFixed(1) : null
              const received = formatBytes(dl.receivedBytes)
              const total = dl.totalBytes ? formatBytes(dl.totalBytes) : 'size unknown'
              return (
                <div key={`${dl.modelId}\n${dl.rfilename}`} style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {dl.rfilename}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {dl.modelId} • {dl.state}
                        {dl.error ? ` • ${dl.error}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0284c7' }}>{pct}%</span>
                      <button
                        type="button"
                        className="library-btn-action danger"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        onClick={() => void handleCancelDownload(dl.modelId, dl.rfilename)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div style={{ height: 6, width: '100%', background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#0284c7', transition: 'width 0.2s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#64748b' }}>
                    <span>
                      {received} / {total}
                      {speedMBps ? ` · ${speedMBps} MB/s` : ''}
                    </span>
                    <span>{dl.etaSeconds ? `${Math.ceil(dl.etaSeconds)}s remaining` : 'Calculating…'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* ── MODEL CARDS LIST ── */}
      <div className="library-models-container">
        {loading ? (
          <div className="library-empty-state">
            <RefreshCw size={24} className="library-spin" color="#0284c7" />
            <div className="library-empty-title">Scanning Model Library…</div>
            <div className="library-empty-desc">Discovering local weights and storage folders.</div>
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="library-empty-state">
            <div className="library-empty-icon-wrap">
              <HardDrive size={32} />
            </div>
            <div className="library-empty-title">
              {models.length === 0 ? 'No Models Found in Library' : 'No Matching Models'}
            </div>
            <div className="library-empty-desc">
              {models.length === 0
                ? 'Download GGUF models from the Explore tab or detect existing models from LM Studio and Ollama.'
                : `No model matches "${filterQuery}". Try a different search term or clear the filter.`}
            </div>
            {filterQuery ? (
              <button
                type="button"
                className="library-btn-action"
                style={{ marginTop: 12 }}
                onClick={() => setFilterQuery('')}
              >
                Clear Search Filter
              </button>
            ) : (
              <button
                type="button"
                className="library-btn-action primary"
                style={{ marginTop: 12 }}
                onClick={() => void handleToggleDetect()}
              >
                <Radar size={13} />
                <span>Scan for Existing Models</span>
              </button>
            )}
          </div>
        ) : (
          <div className="library-grid">
            {filteredModels.map((model) => {
              const meta = parseModelMeta(model)
              const isActive = isModelActive(model)
              const isConfirmingDelete = confirmDeletePath === model.path
              const isSelecting = selectingModelPath === model.path

              return (
                <div
                  key={model.path}
                  className={`library-model-card ${isActive ? 'is-active-model' : ''}`}
                >
                  <div className="library-card-header">
                    <div className="library-card-icon-wrap">
                      {isActive ? (
                        <Sparkles size={18} className="library-model-card-icon active" />
                      ) : (
                        <Cpu size={18} className="library-model-card-icon" />
                      )}
                    </div>

                    <div className="library-card-main-info">
                      <div className="library-card-title-row">
                        <span className="library-card-filename" title={model.file}>
                          {model.file}
                        </span>
                        {isActive ? (
                          <span className="library-chip library-chip-active">
                            <Sparkles size={11} /> Active in Chat
                          </span>
                        ) : null}
                      </div>

                      {/* BADGES ROW */}
                      <div className="library-chips-row">
                        <span className="library-chip library-chip-size">
                          {formatBytes(model.sizeBytes)}
                        </span>

                        {meta.quantization ? (
                          <span className="library-chip library-chip-quant">
                            {meta.quantization}
                          </span>
                        ) : null}

                        {meta.paramSize ? (
                          <span className="library-chip library-chip-param">
                            {meta.paramSize}
                          </span>
                        ) : null}

                        <span
                          className={`library-chip ${
                            meta.sourceLabel === 'LM Studio'
                              ? 'library-chip-lmstudio'
                              : meta.sourceLabel === 'Ollama'
                              ? 'library-chip-ollama'
                              : 'library-chip-sovara'
                          }`}
                        >
                          {meta.sourceLabel}
                        </span>

                        {meta.author ? (
                          <span className="library-chip library-chip-author">
                            by {meta.author}
                          </span>
                        ) : null}

                        <span className="library-chip library-chip-installed">
                          <Check size={10} /> Installed
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* LOCATION & SOURCE ROW */}
                  <div className="library-card-meta-bar">
                    <div className="library-card-path-wrap">
                      <Folder size={12} className="library-card-meta-icon" />
                      <span className="library-card-path" title={model.path}>
                        {model.path}
                      </span>
                      <button
                        type="button"
                        className="library-btn-icon"
                        title={copiedPath === model.path ? 'Copied!' : 'Copy path'}
                        onClick={() => handleCopyPath(model.path)}
                      >
                        {copiedPath === model.path ? (
                          <Check size={11} color="#10b981" />
                        ) : (
                          <Copy size={11} />
                        )}
                      </button>
                    </div>

                    <div className="library-card-meta-right">
                      <span className="library-card-date">
                        Modified{' '}
                        {new Date(model.modifiedAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>

                      {meta.hfSearchUrl ? (
                        <button
                          type="button"
                          className="library-card-hf-btn"
                          title={`Search ${meta.author || 'model'} on Hugging Face`}
                          onClick={() => void openExternal(meta.hfSearchUrl!)}
                        >
                          <ExternalLink size={11} />
                          <span>Hugging Face</span>
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* ACTIONS BAR */}
                  <div className="library-card-footer">
                    <div className="library-card-footer-left">
                      {isActive ? (
                        <div className="library-active-indicator">
                          <span className="library-active-pulse" />
                          <span>Selected model for current session</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="library-card-footer-right">
                      {isConfirmingDelete ? (
                        <div className="library-confirm-delete-group">
                          <span className="library-delete-warning">Permanently delete file?</span>
                          <button
                            type="button"
                            className="library-btn-action library-btn-confirm-delete"
                            onClick={() => void handleDelete(model.path)}
                          >
                            <Trash2 size={12} />
                            <span>Confirm Delete</span>
                          </button>
                          <button
                            type="button"
                            className="library-btn-action"
                            onClick={() => setConfirmDeletePath(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="library-btn-action"
                            title="Reveal model file in File Explorer"
                            onClick={() => void handleReveal(model.path)}
                          >
                            <FolderOpen size={13} />
                            <span>Reveal in Folder</span>
                          </button>

                          <button
                            type="button"
                            className={`library-btn-action ${isActive ? 'active' : 'primary'}`}
                            title={isActive ? 'Model is active in chat' : 'Set as active model for chat'}
                            disabled={isActive || isSelecting}
                            onClick={() => void handleSelectModel(model)}
                          >
                            {isActive ? (
                              <>
                                <Check size={13} />
                                <span>Active in Chat</span>
                              </>
                            ) : (
                              <>
                                <MessageSquare size={13} />
                                <span>{isSelecting ? 'Selecting…' : 'Use in Chat'}</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            className="library-btn-action danger"
                            title="Delete model from disk"
                            onClick={() => setConfirmDeletePath(model.path)}
                          >
                            <Trash2 size={13} />
                            <span>Delete</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── COLLAPSIBLE LOGS & DIAGNOSTICS (AT BOTTOM) ── */}
      <div className="library-diagnostics-section">
        <button
          type="button"
          className="library-diagnostics-toggle"
          onClick={() => {
            const next = !logsOpen
            setLogsOpen(next)
            if (next) void refreshLogs()
          }}
        >
          <div className="library-diagnostics-toggle-left">
            <Terminal size={13} />
            <span>Detection &amp; Runtime Logs</span>
            <span className="library-diagnostics-count">
              {((logs.detection?.length || 0) + (logs.runtime?.length || 0))} entries
            </span>
          </div>
          <div className="library-diagnostics-toggle-right">
            <span>{logsOpen ? 'Hide Logs' : 'View Logs'}</span>
            {logsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        </button>

        {logsOpen ? (
          <div className="library-diagnostics-viewer">
            <div className="library-diagnostics-viewer-header">
              <span className="library-diagnostics-viewer-title">System Diagnostics</span>
              <button
                type="button"
                className="library-btn-action"
                style={{ fontSize: 11 }}
                onClick={() => void refreshLogs()}
                disabled={logsLoading}
              >
                <RefreshCw size={11} className={logsLoading ? 'library-spin' : ''} />
                <span>Refresh</span>
              </button>
            </div>
            <div className="library-diagnostics-code-pane">
              <div className="library-log-heading">— detection.log (last 30) —</div>
              {(logs.detection ?? []).slice(-30).join('\n') || '(no detection logs recorded)'}
              <div className="library-log-heading" style={{ marginTop: 14 }}>
                — runtime.log (last 30) —
              </div>
              {(logs.runtime ?? []).slice(-30).join('\n') || '(no runtime logs recorded)'}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
