import { useState, useEffect, useCallback, type ReactElement } from 'react'
import {
  ArrowLeft, Search, Folder, MoreHorizontal,
  HardDrive, Trash2
} from 'lucide-react'
import {
  listLibraryModels, getLibraryDirectory, setLibraryDirectory,
  deleteLibraryModel, onDownloadEvents, type LibraryModel,
} from '../../lib/ipc'

interface LibraryPageProps {
  onBack: () => void
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
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
    // A finished download lands a new file — rescan the directory.
    const dispose = onDownloadEvents((ev) => {
      if (ev.state === 'done') void refresh()
    })
    return dispose
  }, [refresh])

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
              <button type="button" className="settings-action-btn" title="More options">
                <MoreHorizontal size={14} />
              </button>
            </div>
          </div>
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
