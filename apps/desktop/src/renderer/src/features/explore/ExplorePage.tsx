import { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react'
import {
  ArrowLeft, Search, Download, Eye, Wrench, Clock, X, Filter,
  ChevronDown, ExternalLink, RefreshCw, Star, ThumbsUp, FileCode, Shield,
  Tag, Cpu, Layers, BookOpen, Box, Check, AlertTriangle, Ban, Sparkles, TrendingUp, Calendar
} from 'lucide-react'
import {
  listExploreModels, getExploreModel, getModelCompatibility,
  downloadModelFile, cancelModelDownload, onDownloadEvents,
  type ExploreModel, type CompatibilityResult, type DownloadEventView,
} from '../../lib/ipc'

// ── Formatting helpers ──────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'size unknown'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
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

function formatDateLong(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return iso }
}

// ── Small markdown renderer (no deps) ────────────────────────────────
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function inlineMd(text: string): string {
  // code, bold, italic, links, inline code already escaped partially
  let t = escapeHtml(text)
  t = t.replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>')
  return t
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  let html = ''
  let inCode = false
  let codeBuf: string[] = []
  let listBuf: string[] = []
  let inList = false

  const flushList = (): void => {
    if (inList) {
      html += `<ul class="md-ul">${listBuf.join('')}</ul>`
      listBuf = []
      inList = false
    }
  }

  const flushCode = (): void => {
    if (codeBuf.length > 0) {
      html += `<pre class="md-pre"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`
      codeBuf = []
    }
  }

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('```')) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        flushList()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const item = line.replace(/^\s*[-*]\s+/, '')
      if (!inList) inList = true
      listBuf.push(`<li>${inlineMd(item)}</li>`)
      continue
    }
    if (/^\s*$/.test(line)) {
      flushList()
      continue
    }
    if (/^#{1,6}\s+/.test(line)) {
      flushList()
      const m = line.match(/^(#{1,6})\s+(.*)$/)!
      const level = m[1].length
      const tag = `h${Math.min(level + 1, 6)}`
      html += `<${tag} class="md-h${level}">${inlineMd(m[2])}</${tag}>`
      continue
    }
    if (/^>\s+/.test(line)) {
      flushList()
      html += `<blockquote class="md-quote">${inlineMd(line.replace(/^>\s+/, ''))}</blockquote>`
      continue
    }
    if (/^---+/.test(line.trim())) {
      flushList()
      html += '<hr class="md-hr"/>'
      continue
    }
    flushList()
    html += `<p class="md-p">${inlineMd(line)}</p>`
  }
  flushList()
  flushCode()
  return html
}

// ── Icon + badges ───────────────────────────────────────────────────
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

function CapBadge({ cap }: { cap: string }): ReactElement {
  const map: Record<string, string> = {
    Vision: 'cap--vision',
    Tools: 'cap--tools',
    Reasoning: 'cap--reasoning',
    Code: 'cap--code',
    Chat: 'cap--chat',
    Embeddings: 'cap--embed',
  }
  return <span className={`explore-cap-badge ${map[cap] ?? ''}`}>{cap}</span>
}

function CompatibilityBadge({ result }: { result: CompatibilityResult | null }): ReactElement | null {
  if (!result) return null
  if (result.severity === 'too-large') {
    return (
      <div className="compat-badge compat-badge--error">
        <Ban size={12} /> Likely too large
      </div>
    )
  }
  if (result.severity === 'tight') {
    return (
      <div className="compat-badge compat-badge--warning">
        <AlertTriangle size={12} /> Might be tight
      </div>
    )
  }
  return (
    <div className="compat-badge compat-badge--success">
      <Check size={12} /> Should run on this system
    </div>
  )
}

function hasGguf(model: ExploreModel): boolean {
  return model.files.some((f) => f.format === 'GGUF') || model.tags.some((t) => t.toLowerCase().includes('gguf'))
}

function GgufBadge({ model }: { model: ExploreModel }): ReactElement {
  const gguf = hasGguf(model)
  return (
    <span className={`explore-mini-badge ${gguf ? 'explore-mini-badge--gguf' : 'explore-mini-badge--no-gguf'}`} title={gguf ? 'GGUF available' : 'No GGUF file listed'}>
      {gguf ? 'GGUF' : 'no GGUF'}
    </span>
  )
}

// ── Detail sections ─────────────────────────────────────────────────
function Section({ title, icon, children, defaultOpen = true }: { title: string; icon?: ReactElement; children: ReactElement | ReactElement[]; defaultOpen?: boolean }): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="explore-section">
      <button type="button" className="explore-section-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="explore-section-title">{icon}<span>{title}</span></span>
        <ChevronDown size={14} className={`explore-section-chevron ${open ? 'open' : ''}`} />
      </button>
      {open ? <div className="explore-section-body">{children}</div> : null}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────
const PIPELINE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All tasks' },
  { value: 'text-generation', label: 'Text generation' },
  { value: 'image-text-to-text', label: 'Vision / multimodal' },
  { value: 'text2text-generation', label: 'Text2Text' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'code', label: 'Code' },
  { value: 'fill-mask', label: 'Fill-mask' },
  { value: 'sentence-similarity', label: 'Embeddings' },
]

const TAG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All tags' },
  { value: 'gguf', label: 'GGUF' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'code', label: 'Code' },
  { value: 'vision', label: 'Vision' },
  { value: 'instruct', label: 'Instruct' },
  { value: 'multilingual', label: 'Multilingual' },
]

interface ExplorePageProps {
  onBack: () => void
}

export function ExplorePage({ onBack }: ExplorePageProps): ReactElement {
  const [models, setModels] = useState<ExploreModel[]>([])
  const [selectedModel, setSelectedModel] = useState<ExploreModel | null>(null)
  const [compatibility, setCompatibility] = useState<CompatibilityResult | null>(null)
  const [compatLoading, setCompatLoading] = useState(false)
  const [sortBy, setSortBy] = useState('recommended')
  const [searchQuery, setSearchQuery] = useState('')
  const [pipelineFilter, setPipelineFilter] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<number>(0)
  const [detail, setDetail] = useState<ExploreModel | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<Record<string, DownloadEventView>>({})

  const selectModel = useCallback((model: ExploreModel): void => {
    setSelectedModel(model)
    setDetail(null)
    setDetailError(null)
    setSelectedFile(0)
  }, [])

  // Load models (backend does HF search + tag/task filters)
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true)
      setListError(null)
      try {
        const result = await listExploreModels({ sortBy, query: searchQuery, pipelineTag: pipelineFilter, tag: tagFilter })
        if (cancelled) return
        setModels(result)
        if (result.length > 0 && !selectedModel) {
          selectModel(result[0] as ExploreModel)
        } else if (result.length === 0) {
          setSelectedModel(null)
        }
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : 'Could not load models.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [sortBy, searchQuery, pipelineFilter, tagFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load full detail (sizes, readme) when selection changes.
  useEffect(() => {
    if (!selectedModel) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    getExploreModel(selectedModel.id)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((e: unknown) => {
        if (!cancelled) setDetailError(e instanceof Error ? e.message : 'Could not load model details.')
      })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedModel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Track download progress
  useEffect(() => {
    const dispose = onDownloadEvents((ev) => {
      setDownloads((prev) => {
        const next = { ...prev }
        const k = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled') {
          delete next[k]
        } else {
          next[k] = ev
        }
        return next
      })
    })
    return dispose
  }, [])

  const startFileDownload = useCallback(async (model: ExploreModel, fileIndex: number): Promise<void> => {
    const file = model.files[fileIndex]
    if (!file?.downloadUrl || !file.rfilename) return
    try {
      await downloadModelFile(model.id, file.rfilename, file.downloadUrl)
    } catch {
      // invoke-level failure; transfer failures arrive as events
    }
  }, [])

  const cancelFileDownload = useCallback(async (modelId: string, rfilename: string): Promise<void> => {
    try { await cancelModelDownload(modelId, rfilename) } catch { /* ignore */ }
  }, [])

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
      const result = await listExploreModels({ sortBy, query: searchQuery, pipelineTag: pipelineFilter, tag: tagFilter })
      setModels(result)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [sortBy, searchQuery, pipelineFilter, tagFilter])

  const sortOptions = useMemo(() => [
    { value: 'recommended', label: 'Recommended', icon: Sparkles },
    { value: 'trending', label: 'Trending', icon: TrendingUp },
    { value: 'likes', label: 'Most liked', icon: Star },
    { value: 'downloads', label: 'Most downloaded', icon: Download },
    { value: 'lastModified', label: 'Recently updated', icon: Calendar },
  ], [])

  const activeFiltersCount = (pipelineFilter ? 1 : 0) + (tagFilter ? 1 : 0)
  const hasQuery = searchQuery.trim().length > 0 || pipelineFilter || tagFilter

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
          <div className="explore-nav-subtitle">Discover models from Hugging Face</div>
        </div>

        <div className="explore-search-wrap">
          <Search size={14} className="explore-search-icon" />
          <input
            type="text"
            className="explore-search"
            placeholder="Search by name, tags, tasks (e.g. gguf, vision, code)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery ? (
            <button type="button" className="explore-search-clear" aria-label="Clear search" onClick={() => setSearchQuery('')}>
              <X size={12} />
            </button>
          ) : null}
        </div>

        {/* Filter row: task + tag + sort */}
        <div className="explore-toolbar">
          <button
            type="button"
            className={`explore-filter-btn ${showFilters ? 'explore-filter-btn--active' : ''} ${activeFiltersCount ? 'has-dot' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
          >
            <Filter size={13} /> Filters
            {activeFiltersCount ? <span className="explore-filter-dot">{activeFiltersCount}</span> : null}
          </button>
          <button type="button" className="explore-refresh-btn" onClick={handleRefresh} title="Refresh">
            <RefreshCw size={13} />
          </button>
          <div className="explore-sort-wrap">
            <button
              type="button"
              className="explore-sort-btn"
              aria-haspopup="menu"
              aria-expanded={showSortMenu}
              onClick={() => setShowSortMenu(!showSortMenu)}
            >
              {(() => {
                const cur = sortOptions.find((o) => o.value === sortBy)
                const Icon = cur?.icon ?? Sparkles
                return <><Icon size={13} /> {cur?.label}</>
              })()}
              <ChevronDown size={14} className={showSortMenu ? 'rotated' : ''} />
            </button>
            {showSortMenu && (
              <div className="explore-sort-menu" role="menu">
                <div className="explore-sort-menu-header">Sort by</div>
                {sortOptions.map((opt) => {
                  const Icon = opt.icon
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={sortBy === opt.value}
                      className={`explore-sort-option ${sortBy === opt.value ? 'explore-sort-option--active' : ''}`}
                      onClick={() => { setSortBy(opt.value); setShowSortMenu(false) }}
                    >
                      <Icon size={13} className="explore-sort-option-icon" />
                      {opt.label}
                      {sortBy === opt.value && <span className="explore-check">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="explore-filters-panel">
            <div className="explore-filter-group">
              <label className="explore-filter-label"><Tag size={12} /> Task</label>
              <select
                className="explore-filter-select"
                value={pipelineFilter}
                onChange={(e) => setPipelineFilter(e.target.value)}
              >
                {PIPELINE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="explore-filter-group">
              <label className="explore-filter-label"><Layers size={12} /> Tag</label>
              <select
                className="explore-filter-select"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
              >
                {TAG_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {hasQuery ? (
              <button
                type="button"
                className="explore-filter-clear"
                onClick={() => { setSearchQuery(''); setPipelineFilter(''); setTagFilter('') }}
              >
                Clear all filters
              </button>
            ) : null}
          </div>
        )}

        {/* Active filter chips */}
        {(pipelineFilter || tagFilter) && (
          <div className="explore-active-chips">
            {pipelineFilter ? (
              <span className="explore-active-chip">
                task: {pipelineFilter}
                <button type="button" aria-label="Remove task filter" onClick={() => setPipelineFilter('')}><X size={10} /></button>
              </span>
            ) : null}
            {tagFilter ? (
              <span className="explore-active-chip">
                tag: {tagFilter}
                <button type="button" aria-label="Remove tag filter" onClick={() => setTagFilter('')}><X size={10} /></button>
              </span>
            ) : null}
          </div>
        )}

        <div className="explore-model-list">
          {loading ? (
            <div className="explore-loading">Loading models…</div>
          ) : listError ? (
            <div className="explore-empty">
              {listError}
              <button type="button" className="settings-action-btn" onClick={handleRefresh} style={{ marginTop: 8 }}>
                Retry
              </button>
            </div>
          ) : models.length === 0 ? (
            <div className="explore-empty">No models found. Try different search or filters.</div>
          ) : (
            models.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                active={selectedModel?.id === model.id}
                onSelect={() => selectModel(model)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right panel — detail */}
      <div className="explore-detail">
        {selectedModel ? (
          <ExploreDetail
            summary={selectedModel}
            detail={detail}
            detailLoading={detailLoading}
            detailError={detailError}
            compatibility={compatibility}
            compatLoading={compatLoading}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            downloads={downloads}
            onDownload={startFileDownload}
            onCancelDownload={cancelFileDownload}
          />
        ) : (
          <div className="explore-detail-empty">
            <Box size={28} className="explore-empty-icon" />
            <p>Select a model to see details</p>
            <span className="explore-empty-hint">Browse {models.length} models · Trending, recommended, and filtered by task & tag</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Enriched model card ────────────────────────────────────────────
function ModelCard({ model, active, onSelect }: { model: ExploreModel; active: boolean; onSelect: () => void }): ReactElement {
  const gguf = hasGguf(model)
  const topCaps = model.capabilities.slice(0, 3)
  return (
    <button
      type="button"
      className={`explore-model-item ${active ? 'explore-model-item--active' : ''}`}
      onClick={onSelect}
      aria-pressed={active}
    >
      <ModelIcon type={model.iconType} />
      <div className="explore-model-item-body">
        <div className="explore-model-item-name">
          <span className="explore-model-name-text">{model.name}</span>
          {model.staffPick && <span className="explore-staff-badge" title="Staff Pick">★</span>}
        </div>
        <div className="explore-model-item-desc">{model.description}</div>

        {/* Badges row: params · gguf · license · capabilities */}
        <div className="explore-card-badges">
          <span className="explore-mini-badge explore-mini-badge--params"><Cpu size={10} /> {model.parameters}</span>
          <GgufBadge model={model} />
          {model.license ? <span className="explore-mini-badge explore-mini-badge--license"><Shield size={10} /> {model.license}</span> : null}
          {topCaps.map((c) => (
            <CapBadge key={c} cap={c} />
          ))}
          {model.capabilities.length > 3 ? <span className="explore-mini-badge">+{model.capabilities.length - 3}</span> : null}
        </div>

        {/* Meta row */}
        <div className="explore-model-item-meta">
          <span className="explore-meta-item"><Download size={11} /> {formatDownloads(model.downloads)}</span>
          <span className="explore-meta-item"><ThumbsUp size={11} /> {formatDownloads(model.likes)}</span>
          <span className="explore-meta-item"><Clock size={11} /> {formatDate(model.updatedAt)}</span>
          <span className="explore-card-gguf-dot" aria-label={gguf ? 'GGUF available' : 'No GGUF'} title={gguf ? 'GGUF available' : 'No GGUF listed'}>
            <span className={`dot ${gguf ? 'dot--gguf' : 'dot--no-gguf'}`} />
          </span>
          <span className="explore-model-item-icons">
            {model.capabilities.includes('Vision') && <Eye size={11} aria-label="Vision" />}
            {model.capabilities.includes('Tools') && <Wrench size={11} aria-label="Tools" />}
            {model.capabilities.includes('Code') && <FileCode size={11} aria-label="Code" />}
          </span>
        </div>
      </div>
    </button>
  )
}

function ExploreDetail(props: {
  summary: ExploreModel
  detail: ExploreModel | null
  detailLoading: boolean
  detailError: string | null
  compatibility: CompatibilityResult | null
  compatLoading: boolean
  selectedFile: number
  onSelectFile: (i: number) => void
  downloads: Record<string, DownloadEventView>
  onDownload: (model: ExploreModel, fileIndex: number) => void
  onCancelDownload: (modelId: string, rfilename: string) => void
}): ReactElement {
  const { summary, detail, detailLoading, detailError } = props
  const selectedModel = detail ?? summary
  const activeFile = selectedModel.files[props.selectedFile]
  const dlKey = activeFile?.rfilename ? `${selectedModel.id}\n${activeFile.rfilename}` : null
  const dl = dlKey ? props.downloads[dlKey] : undefined
  const pct = dl && dl.totalBytes ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : null
  const readmeHtml = useMemo(() => selectedModel.readme ? renderMarkdown(selectedModel.readme) : '', [selectedModel.readme])
  const gguf = hasGguf(selectedModel)

  return (
    <div className="explore-detail-content">
      {/* Header */}
      <div className="explore-detail-header">
        <ModelIcon type={selectedModel.iconType} />
        <div className="explore-detail-head-text">
          <h2 className="explore-detail-name">{selectedModel.name}</h2>
          <div className="explore-detail-slug">{selectedModel.slug} <span className="explore-slug-sep">·</span> {selectedModel.author}</div>
          <div className="explore-detail-head-badges">
            <span className="explore-head-badge"><Cpu size={12} /> {selectedModel.parameters}</span>
            <span className={`explore-head-badge ${gguf ? 'explore-head-badge--gguf' : ''}`}>{gguf ? 'GGUF available' : 'No GGUF'}</span>
            {selectedModel.license ? <span className="explore-head-badge"><Shield size={12} /> {selectedModel.license}</span> : null}
            {selectedModel.gated ? <span className="explore-head-badge explore-head-badge--gated">🔒 Gated</span> : null}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="explore-stats-bar">
        <span className="explore-stat"><Download size={14} /> {formatDownloads(selectedModel.downloads)} downloads</span>
        <span className="explore-stat"><ThumbsUp size={14} /> {formatDownloads(selectedModel.likes)} likes</span>
        {selectedModel.staffPick && (
          <span className="explore-stat"><Star size={14} /> Staff Pick</span>
        )}
        <span className="explore-stat"><Calendar size={14} /> {formatDateLong(selectedModel.updatedAt)}</span>
        <a href={`https://huggingface.co/${selectedModel.slug}`} target="_blank" rel="noopener noreferrer" className="explore-open-web">
          Open on Hugging Face <ExternalLink size={12} />
        </a>
      </div>

      {/* ── Overview ── */}
      <Section title="Overview" icon={<BookOpen size={14} />}>
        <>
          <p className="explore-long-desc">{selectedModel.longDescription}</p>
          <div className="explore-overview-grid">
            <div className="explore-overview-item">
              <span className="explore-overview-label">Model</span>
              <span className="explore-overview-value">{selectedModel.slug}</span>
            </div>
            <div className="explore-overview-item">
              <span className="explore-overview-label">Author</span>
              <span className="explore-overview-value">{selectedModel.author}</span>
            </div>
            <div className="explore-overview-item">
              <span className="explore-overview-label">Updated</span>
              <span className="explore-overview-value">{formatDateLong(selectedModel.updatedAt)} · {formatDate(selectedModel.updatedAt)}</span>
            </div>
            <div className="explore-overview-item">
              <span className="explore-overview-label">Parameters</span>
              <span className="explore-overview-value">{selectedModel.parameters}</span>
            </div>
            <div className="explore-overview-item">
              <span className="explore-overview-label">Architecture</span>
              <span className="explore-overview-value">{selectedModel.architecture}</span>
            </div>
            {selectedModel.pipelineTag ? (
              <div className="explore-overview-item">
                <span className="explore-overview-label">Task</span>
                <span className="explore-overview-value explore-tag-chip">{selectedModel.pipelineTag}</span>
              </div>
            ) : null}
            {typeof selectedModel.repoSizeBytes === 'number' ? (
              <div className="explore-overview-item">
                <span className="explore-overview-label">Repo size</span>
                <span className="explore-overview-value">{formatBytes(selectedModel.repoSizeBytes)}</span>
              </div>
            ) : null}
          </div>
        </>
      </Section>

      {/* ── Capabilities ── */}
      <Section title="Capabilities" icon={<Sparkles size={14} />}>
        <>
          <div className="explore-caps-row">
            {selectedModel.capabilities.length > 0 ? selectedModel.capabilities.map((cap) => (
              <CapBadge key={cap} cap={cap} />
            )) : <span className="explore-empty-text">No capabilities tagged</span>}
          </div>
          <div className="explore-tags" style={{ marginTop: 10 }}>
            {selectedModel.languages && selectedModel.languages.length > 0 ? (
              <div className="explore-tag-group">
                <span className="explore-tag-label">Languages</span>
                {selectedModel.languages.map((l) => (
                  <span key={l} className="explore-tag-chip">{l}</span>
                ))}
              </div>
            ) : null}
            {selectedModel.baseModel ? (
              <div className="explore-tag-group">
                <span className="explore-tag-label">Base model</span>
                <span className="explore-tag-value">{selectedModel.baseModel}</span>
              </div>
            ) : null}
            <div className="explore-tag-group">
              <span className="explore-tag-label">Tags</span>
              <span className="explore-tag-value explore-tags-inline">
                {selectedModel.tags.slice(0, 12).map((t) => (
                  <span key={t} className="explore-tag-chip explore-tag-chip--small">{t}</span>
                ))}
                {selectedModel.tags.length > 12 ? <span className="explore-tag-more">+{selectedModel.tags.length - 12} more</span> : null}
              </span>
            </div>
          </div>
        </>
      </Section>

      {/* ── Files ── */}
      <Section title="Files" icon={<Box size={14} />}>
        <>
          {detailLoading ? (
            <div className="explore-compat-loading">Loading file list…</div>
          ) : detailError ? (
            <div className="explore-empty">{detailError}</div>
          ) : (
            <div className="explore-files">
              {selectedModel.files.map((file, i) => (
                <button
                  key={file.rfilename ?? i}
                  type="button"
                  className={`explore-file-chip ${props.selectedFile === i ? 'explore-file-chip--active' : ''}`}
                  onClick={() => props.onSelectFile(i)}
                >
                  <span className="explore-file-format">{file.format}</span>
                  <span className="explore-file-name">{(file.rfilename ?? '').split('/').pop() || selectedModel.name}</span>
                  {file.quantization && <span className="explore-file-quant">{file.quantization}</span>}
                  <span className="explore-file-size">{formatBytes(file.sizeBytes ?? file.sizeGB * 1024 ** 3)}</span>
                </button>
              ))}
              {selectedModel.files.length === 0 ? (
                <div className="explore-empty">No downloadable weight files found for this repo.</div>
              ) : null}
            </div>
          )}

          {/* Compatibility */}
          <div className="explore-compat">
            {props.compatLoading ? (
              <span className="explore-compat-loading">Checking compatibility…</span>
            ) : (
              <CompatibilityBadge result={props.compatibility} />
            )}
            {props.compatibility ? <span className="explore-compat-msg">{props.compatibility.message}</span> : null}
          </div>

          {/* Download button */}
          <div className="explore-download-row">
            {dl ? (
              <div className="explore-download-progress">
                <div className="explore-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                  <div className="explore-download-progress-bar" style={{ width: `${pct ?? 0}%` }} />
                </div>
                <span className="explore-download-progress-label">
                  {pct !== null ? `${pct}% · ` : ''}{formatBytes(dl.receivedBytes)}
                  {dl.totalBytes ? ` of ${formatBytes(dl.totalBytes)}` : ''}
                </span>
                {activeFile?.rfilename ? (
                  <button
                    type="button"
                    className="settings-action-btn"
                    aria-label="Cancel download"
                    onClick={() => props.onCancelDownload(selectedModel.id, activeFile.rfilename as string)}
                  >
                    <X size={14} />
                  </button>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="explore-download-btn"
                disabled={!activeFile?.downloadUrl}
                onClick={() => props.onDownload(selectedModel, props.selectedFile)}
              >
                <Download size={16} />
                {activeFile?.downloadUrl
                  ? `Download ${formatBytes(activeFile.sizeBytes ?? activeFile.sizeGB * 1024 ** 3)}`
                  : 'Select a file'}
              </button>
            )}
          </div>
        </>
      </Section>

      {/* ── License ── */}
      <Section title="License & access" icon={<Shield size={14} />}>
        <>
          <div className="explore-license-grid">
            <div className="explore-license-row">
              <span className="explore-license-label">License</span>
              <span className="explore-license-value">
                {selectedModel.license ? (
                  <span className="explore-tag-chip explore-tag-chip--license">{selectedModel.license}</span>
                ) : (
                  <span className="explore-empty-text">Not specified</span>
                )}
              </span>
            </div>
            <div className="explore-license-row">
              <span className="explore-license-label">Access</span>
              <span className="explore-license-value">
                {selectedModel.gated ? '🔒 Gated — request access on Hugging Face' : 'Public'}
              </span>
            </div>
            <div className="explore-license-row">
              <span className="explore-license-label">Links</span>
              <span className="explore-license-value">
                <a href={`https://huggingface.co/${selectedModel.slug}`} target="_blank" rel="noopener noreferrer" className="explore-inline-link">
                  Model card <ExternalLink size={11} />
                </a>
                <span className="explore-dot-sep">·</span>
                <a href={`https://huggingface.co/${selectedModel.slug}/tree/main`} target="_blank" rel="noopener noreferrer" className="explore-inline-link">
                  Files <ExternalLink size={11} />
                </a>
              </span>
            </div>
          </div>
        </>
      </Section>

      {/* ── README (markdown) ── */}
      <Section title="README" icon={<BookOpen size={14} />} defaultOpen={true}>
        <>
          {selectedModel.readme ? (
            <div className="explore-readme explore-readme--md" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
          ) : (
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
          )}
        </>
      </Section>
    </div>
  )
}

function getCapabilityDescription(cap: string): string {
  switch (cap) {
    case 'Vision': return 'Can understand and analyze images.'
    case 'Tools': return 'Can call external tools and APIs.'
    case 'Reasoning': return 'Strong logical and chain-of-thought reasoning.'
    case 'Code': return 'Excellent code generation and understanding.'
    case 'Chat': return 'Optimized for chat and instruction following.'
    case 'Embeddings': return 'Produces embeddings for search and retrieval.'
    default: return cap
  }
}
