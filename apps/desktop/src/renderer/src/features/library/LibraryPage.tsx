import { useState, useEffect, useCallback, type ReactElement } from 'react'
import {
  ArrowLeft, Search, Folder, MoreHorizontal,
  Eye, Wrench, Clock, HardDrive
} from 'lucide-react'
import { listLibraryModels, getLibraryDirectory, type LibraryModel } from '../../lib/ipc'

interface LibraryPageProps {
  onBack: () => void
}

function formatTimeAgo(iso?: string): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours} hours ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return '1 day ago'
  return `${diffDays} days ago`
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

  useEffect(() => {
    const load = async (): Promise<void> => {
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
    }
    load()
  }, [])

  const filteredModels = models.filter((m) => {
    if (!filterQuery.trim()) return true
    const q = filterQuery.toLowerCase()
    return m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q)
  })

  const handleChangeDirectory = useCallback(async (): Promise<void> => {
    // TODO: open folder picker dialog
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
              <div key={model.id} className="library-model-row">
                <LibraryModelIcon />
                <div className="library-model-body">
                  <div className="library-model-name">{model.name}</div>
                  <div className="library-model-meta">
                    <span className="library-model-chip">{model.sizeGB.toFixed(2)} GB</span>
                    <span className="library-model-chip">{model.format}</span>
                    {model.quantization && (
                      <span className="library-model-chip">{model.quantization}</span>
                    )}
                    <span className="library-model-icons">
                      {model.capabilities.includes('Vision') && <Eye size={12} aria-label="Vision" />}
                      {model.capabilities.includes('Tools') && <Wrench size={12} aria-label="Tools" />}
                    </span>
                  </div>
                  <div className="library-model-sub">
                    {model.slug} · Last used {formatTimeAgo(model.lastUsed)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
