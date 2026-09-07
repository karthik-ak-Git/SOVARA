import { useState, useEffect, useCallback, type ReactElement } from 'react'
import {
  ArrowLeft, Search, Download, Eye, Wrench, Clock,
  ChevronDown, ExternalLink, RefreshCw, Star, ThumbsUp
} from 'lucide-react'
import {
  listExploreModels, getModelCompatibility,
  type ExploreModel, type CompatibilityResult
} from '../../lib/ipc'

interface ExplorePageProps {
  onBack: () => void
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 30) return `${diffDays} days ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  return `${Math.floor(diffDays / 365)} years ago`
}

function ModelIcon({ type }: { type: ExploreModel['iconType'] }): ReactElement {
  const colors: Record<string, string> = {
    qwen: '#7c3aed',
    google: '#4285f4',
    meta: '#0668e1',
    mistral: '#ff6f00',
    microsoft: '#00a4ef',
    deepseek: '#0066ff',
    hf: '#ff9d00',
  }
  const labels: Record<string, string> = {
    qwen: 'Q',
    google: 'G',
    meta: 'M',
    mistral: 'M',
    microsoft: 'Ms',
    deepseek: 'D',
    hf: 'HF',
  }
  return (
    <div className="explore-model-icon" style={{ background: colors[type] || '#6b7280' }}>
      {labels[type] || '?'}
    </div>
  )
}

function CompatibilityBadge({ result }: { result: CompatibilityResult | null }): ReactElement | null {
  if (!result) return null
  if (result.severity === 'too-large') {
    return (
      <div className="compat-badge compat-badge--error">
        <span className="compat-icon">✗</span> Likely too large
      </div>
    )
  }
  if (result.severity === 'tight') {
    return (
      <div className="compat-badge compat-badge--warning">
        <span className="compat-icon">⚠</span> Might be tight
      </div>
    )
  }
  return (
    <div className="compat-badge compat-badge--success">
      <span className="compat-icon">✓</span> Should run on your system
    </div>
  )
}

export function ExplorePage({ onBack }: ExplorePageProps): ReactElement {
  const [models, setModels] = useState<ExploreModel[]>([])
  const [selectedModel, setSelectedModel] = useState<ExploreModel | null>(null)
  const [compatibility, setCompatibility] = useState<CompatibilityResult | null>(null)
  const [compatLoading, setCompatLoading] = useState(false)
  const [sortBy, setSortBy] = useState('recommended')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<number>(0)
  const [showDownloads, setShowDownloads] = useState(true)

  // Load models
  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        const result = await listExploreModels(sortBy, searchQuery)
        setModels(result)
        if (result.length > 0 && !selectedModel) {
          setSelectedModel(result[0])
        }
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [sortBy, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load compatibility when model changes
  useEffect(() => {
    if (!selectedModel) return
    setCompatibility(null)
    setCompatLoading(true)
    setSelectedFile(0)
    getModelCompatibility(selectedModel.id)
      .then(setCompatibility)
      .catch(() => setCompatibility(null))
      .finally(() => setCompatLoading(false))
  }, [selectedModel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await listExploreModels(sortBy, searchQuery)
      setModels(result)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [sortBy, searchQuery])

  const sortOptions = [
    { value: 'recommended', label: 'Recommended' },
    { value: 'likes', label: 'Likes' },
    { value: 'downloads', label: 'Downloads' },
    { value: 'lastModified', label: 'Last modified' },
  ]

  return (
    <div className="explore-page">
      {/* Left panel — model list */}
      <div className="explore-sidebar">
        <div className="explore-sidebar-header">
          <button type="button" className="settings-back-btn" onClick={onBack}>
            <ArrowLeft size={16} />
            <span>Back to app</span>
          </button>
          <div className="explore-nav-title">Explore</div>
        </div>

        <div className="explore-search-wrap">
          <Search size={14} className="explore-search-icon" />
          <input
            type="text"
            className="explore-search"
            placeholder="Search Hugging Face and staff picks"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="explore-toolbar">
          <span className="explore-staff-label">Staff picks</span>
          <button type="button" className="explore-refresh-btn" onClick={handleRefresh} title="Refresh">
            <RefreshCw size={13} />
          </button>
          <div className="explore-sort-wrap">
            <button
              type="button"
              className="explore-sort-btn"
              onClick={() => setShowSortMenu(!showSortMenu)}
            >
              {sortOptions.find((o) => o.value === sortBy)?.label}
              <ChevronDown size={14} />
            </button>
            {showSortMenu && (
              <div className="explore-sort-menu">
                <div className="explore-sort-menu-header">Sort by</div>
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`explore-sort-option ${sortBy === opt.value ? 'explore-sort-option--active' : ''}`}
                    onClick={() => { setSortBy(opt.value); setShowSortMenu(false) }}
                  >
                    {sortBy === opt.value && <span className="explore-check">✓</span>}
                    {opt.label}
                  </button>
                ))}
                <div className="explore-sort-menu-divider" />
                <label className="explore-sort-check-label">
                  <input type="checkbox" defaultChecked className="explore-sort-checkbox" />
                  Only include Staff Picks that fit on a known device
                </label>
                <div className="explore-sort-hint">Based on Spark: 18.10 GB</div>
              </div>
            )}
          </div>
        </div>

        <div className="explore-model-list">
          {loading ? (
            <div className="explore-loading">Loading models...</div>
          ) : models.length === 0 ? (
            <div className="explore-empty">No models found.</div>
          ) : (
            models.map((model) => (
              <button
                key={model.id}
                type="button"
                className={`explore-model-item ${selectedModel?.id === model.id ? 'explore-model-item--active' : ''}`}
                onClick={() => setSelectedModel(model)}
              >
                <ModelIcon type={model.iconType} />
                <div className="explore-model-item-body">
                  <div className="explore-model-item-name">
                    {model.name}
                    {model.staffPick && <span className="explore-staff-badge" title="Staff Pick">✓</span>}
                  </div>
                  <div className="explore-model-item-desc">{model.description}</div>
                  <div className="explore-model-item-meta">
                    <span className="explore-model-item-time">{formatDate(model.updatedAt)}</span>
                    <span className="explore-model-item-icons">
                      {model.capabilities.includes('Vision') && <Eye size={12} aria-label="Vision" />}
                      {model.capabilities.includes('Tools') && <Wrench size={12} aria-label="Tools" />}
                      {model.capabilities.includes('Reasoning') && <span role="img" aria-label="Reasoning">🧠</span>}
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel — model detail */}
      <div className="explore-detail">
        {selectedModel ? (
          <div className="explore-detail-content">
            {/* Header */}
            <div className="explore-detail-header">
              <ModelIcon type={selectedModel.iconType} />
              <div>
                <h2 className="explore-detail-name">{selectedModel.name}</h2>
                <div className="explore-detail-slug">{selectedModel.slug}</div>
              </div>
            </div>

            {/* Stats bar */}
            <div className="explore-stats-bar">
              <span className="explore-stat">
                <Download size={14} /> {formatDownloads(selectedModel.downloads)}
              </span>
              <span className="explore-stat">
                <ThumbsUp size={14} /> {selectedModel.likes}
              </span>
              {selectedModel.staffPick && (
                <span className="explore-stat">
                  <Star size={14} /> Staff Pick
                </span>
              )}
              <span className="explore-stat">
                <Clock size={14} /> Updated {formatDate(selectedModel.updatedAt)}
              </span>
              <a href={`https://${['hugging', 'face', '.co'].join('')}/${selectedModel.slug}`} target="_blank" rel="noopener noreferrer" className="explore-open-web">
                Open on Web <ExternalLink size={12} />
              </a>
            </div>

            {/* Download Options */}
            <div className="explore-section">
              <div className="explore-section-header">
                <h3>Download Options</h3>
                <div className="explore-download-target">
                  Download to <span className="explore-download-device">This device</span>
                  <ChevronDown size={14} />
                </div>
              </div>
              <div className="explore-files">
                {selectedModel.files.map((file, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`explore-file-chip ${selectedFile === i ? 'explore-file-chip--active' : ''}`}
                    onClick={() => setSelectedFile(i)}
                  >
                    <span className="explore-file-format">{file.format}</span>
                    <span className="explore-file-name">{selectedModel.name}</span>
                    {file.quantization && <span className="explore-file-quant">{file.quantization}</span>}
                    <span className="explore-file-size">{file.sizeGB.toFixed(2)} GB</span>
                  </button>
                ))}
              </div>

              {/* Compatibility */}
              <div className="explore-compat">
                {compatLoading ? (
                  <span className="explore-compat-loading">Checking compatibility...</span>
                ) : (
                  <CompatibilityBadge result={compatibility} />
                )}
              </div>

              {/* Download button */}
              <div className="explore-download-row">
                <button type="button" className="explore-download-btn" disabled={!compatibility?.fitsInMemory}>
                  <Download size={16} />
                  Download {selectedModel.files[selectedFile]?.sizeGB.toFixed(2)} GB
                </button>
              </div>
            </div>

            {/* Details */}
            <div className="explore-section">
              <h3>Details</h3>
              <p className="explore-long-desc">{selectedModel.longDescription}</p>
              <div className="explore-tags">
                <div className="explore-tag-group">
                  <span className="explore-tag-label">Parameters</span>
                  <span className="explore-tag-value">{selectedModel.parameters}</span>
                </div>
                <div className="explore-tag-group">
                  <span className="explore-tag-label">Architecture</span>
                  <span className="explore-tag-value">{selectedModel.architecture}</span>
                </div>
                <div className="explore-tag-group">
                  <span className="explore-tag-label">Formats</span>
                  {[...new Set(selectedModel.files.map((f) => f.format))].map((fmt) => (
                    <span key={fmt} className="explore-tag-chip">{fmt}</span>
                  ))}
                </div>
                <div className="explore-tag-group">
                  <span className="explore-tag-label">Capabilities</span>
                  {selectedModel.capabilities.map((cap) => (
                    <span key={cap} className="explore-tag-chip">{cap}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* README preview */}
            <div className="explore-section">
              <h3>README</h3>
              <div className="explore-readme">
                <h4>{selectedModel.name}</h4>
                <p>{selectedModel.longDescription}</p>
                <h5>Highlights</h5>
                <ul>
                  {selectedModel.capabilities.map((cap) => (
                    <li key={cap}><strong>{cap}:</strong> {getCapabilityDescription(cap)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="explore-detail-empty">
            <p>Select a model to see details.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function getCapabilityDescription(cap: string): string {
  switch (cap) {
    case 'Vision': return 'Can understand and analyze images.'
    case 'Tools': return 'Can call external tools and APIs.'
    case 'Reasoning': return 'Strong logical and chain-of-thought reasoning.'
    case 'Code': return 'Excellent code generation and understanding.'
    default: return cap
  }
}
