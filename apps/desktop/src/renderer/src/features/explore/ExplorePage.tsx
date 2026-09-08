import { useState, useEffect, useCallback, useMemo, useRef, type ReactElement } from 'react'
import {
  ArrowLeft, Search, Download, Eye, Wrench, Clock, X, Filter,
  ChevronDown, ExternalLink, RefreshCw, Star, ThumbsUp, FileCode, Shield,
  Tag, Cpu, Layers, BookOpen, Box, Check, AlertTriangle, Ban, Sparkles, TrendingUp, Calendar,
  Pause, Play, Copy, FolderCheck, HardDrive, Info, FileText, ChevronUp, Loader2
} from 'lucide-react'
import {
  listExploreModels, getExploreModel, getModelCompatibility, getFileRecommendations,
  downloadModelFile, cancelModelDownload, pauseModelDownload, resumeModelDownload,
  onDownloadEvents, isDownloaded, getActiveDownloads, openExternal,
  type ExploreModel, type CompatibilityResult, type DownloadEventView, type FileRecommendationView,
} from '../../lib/ipc'

// ── Formatting ───────────────────────────────────────────────────────
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
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 30) return `${diffDays} days ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  return `${Math.floor(diffDays / 365)} years ago`
}
function formatDateLong(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) } catch { return iso }
}

// ── Markdown ─────────────────────────────────────────────────────────
function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function inlineMd(text: string): string {
  let t = escapeHtml(text)
  t = t.replace(/`([^`]+)`/g, '<code class="md-code-inline">$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" class="md-link" data-external="true">$1</a>')
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '<img alt="$1" src="$2" class="md-img" loading="lazy" />')
  return t
}
function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  let html = ''
  let inCode = false
  let codeBuf: string[] = []
  let listBuf: string[] = []
  let inList = false
  let tableBuf: string[][] | null = null

  const flushList = (): void => {
    if (inList) { html += `<ul class="md-ul">${listBuf.join('')}</ul>`; listBuf = []; inList = false }
  }
  const flushTable = (): void => {
    if (tableBuf && tableBuf.length > 0) {
      const header = tableBuf[0]
      const rows = tableBuf.slice(1).filter((r) => !r.every((c) => /^[-:\s]+$/.test(c)))
      html += '<div class="md-table-wrap"><table class="md-table"><thead><tr>'
      header.forEach((c) => { html += `<th>${inlineMd(c.trim())}</th>` })
      html += '</tr></thead><tbody>'
      rows.forEach((r) => {
        html += '<tr>'
        r.forEach((c) => { html += `<td>${inlineMd(c.trim())}</td>` })
        html += '</tr>'
      })
      html += '</tbody></table></div>'
      tableBuf = null
    }
  }
  const flushCode = (): void => { if (codeBuf.length > 0) { html += `<pre class="md-pre"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`; codeBuf = [] } }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    if (raw.startsWith('```')) {
      if (inCode) { flushCode(); inCode = false } else { flushList(); flushTable(); inCode = true }
      continue
    }
    if (inCode) { codeBuf.push(raw); continue }

    // Table detection: line contains | and next line is separator
    if (raw.includes('|') && i + 1 < lines.length && /^\s*\|?[\s-|:]+\|[\s-|:]*$/.test(lines[i + 1])) {
      flushList()
      const header = raw.split('|').map((s) => s.trim()).filter(Boolean)
      tableBuf = [header]
      i += 1 // skip separator
      // collect rows
      while (i + 1 < lines.length && lines[i + 1].includes('|')) {
        i += 1
        const row = lines[i].split('|').map((s) => s.trim()).filter((_, idx, arr) => idx !== 0 || idx !== arr.length - 1 || lines[i].trim().startsWith('|') === false ? true : true)
        // simpler: split and filter empty ends
        const cleaned = lines[i].split('|').map((s) => s.trim())
        // remove leading/trailing empty due to leading |
        if (cleaned[0] === '') cleaned.shift()
        if (cleaned[cleaned.length - 1] === '') cleaned.pop()
        if (cleaned.length > 0) tableBuf.push(cleaned)
      }
      flushTable()
      continue
    }
    if (/^\s*[-*]\s+/.test(raw)) {
      const item = raw.replace(/^\s*[-*]\s+/, '')
      if (!inList) inList = true
      listBuf.push(`<li>${inlineMd(item)}</li>`)
      continue
    }
    if (/^\s*$/.test(raw)) { flushList(); continue }
    if (/^#{1,6}\s+/.test(raw)) {
      flushList(); flushTable()
      const m = raw.match(/^(#{1,6})\s+(.*)$/)!
      const level = m[1].length
      const tag = `h${Math.min(level + 1, 6)}`
      html += `<${tag} class="md-h${level}">${inlineMd(m[2])}</${tag}>`
      continue
    }
    if (/^>\s+/.test(raw)) { flushList(); flushTable(); html += `<blockquote class="md-quote">${inlineMd(raw.replace(/^>\s+/, ''))}</blockquote>`; continue }
    if (/^---+/.test(raw.trim())) { flushList(); flushTable(); html += '<hr class="md-hr"/>'; continue }
    flushList(); flushTable()
    html += `<p class="md-p">${inlineMd(raw)}</p>`
  }
  flushList(); flushTable(); flushCode()
  return html
}

// ── UI primitives ────────────────────────────────────────────────────
function ModelIcon({ type }: { type: ExploreModel['iconType'] }): ReactElement {
  const colors: Record<string, string> = { qwen: '#7c3aed', google: '#4285f4', meta: '#0668e1', mistral: '#ff6f00', microsoft: '#00a4ef', deepseek: '#0066ff', hf: '#ff9d00' }
  const labels: Record<string, string> = { qwen: 'Q', google: 'G', meta: 'M', mistral: 'M', microsoft: 'Ms', deepseek: 'D', hf: 'HF' }
  return <div className="explore-model-icon" style={{ background: colors[type] || '#6b7280' }}>{labels[type] || '?'}</div>
}
function CapBadge({ cap }: { cap: string }): ReactElement {
  const map: Record<string, string> = { Vision: 'cap--vision', Tools: 'cap--tools', Reasoning: 'cap--reasoning', Code: 'cap--code', Chat: 'cap--chat', Embeddings: 'cap--embed' }
  return <span className={`explore-cap-badge ${map[cap] ?? ''}`}>{cap}</span>
}
function CompatibilityBadge({ result }: { result: CompatibilityResult | null }): ReactElement | null {
  if (!result) return null
  if (result.severity === 'too-large') return <div className="compat-badge compat-badge--error"><Ban size={12} /> Likely too large</div>
  if (result.severity === 'tight') return <div className="compat-badge compat-badge--warning"><AlertTriangle size={12} /> Might be tight</div>
  return <div className="compat-badge compat-badge--success"><Check size={12} /> Should run on this system</div>
}
function hasGguf(model: ExploreModel): boolean { return model.files.some((f) => f.format === 'GGUF') || model.tags.some((t) => t.toLowerCase().includes('gguf')) }
function GgufBadge({ model }: { model: ExploreModel }): ReactElement {
  const gguf = hasGguf(model)
  return <span className={`explore-mini-badge ${gguf ? 'explore-mini-badge--gguf' : 'explore-mini-badge--no-gguf'}`} title={gguf ? 'GGUF available' : 'No GGUF file listed'}>{gguf ? 'GGUF' : 'no GGUF'}</span>
}
function Section({ title, icon, children, defaultOpen = true, badge }: { title: string; icon?: ReactElement; children: ReactElement | ReactElement[]; defaultOpen?: boolean; badge?: string }): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="explore-section">
      <button type="button" className="explore-section-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="explore-section-title">{icon}<span>{title}</span>{badge ? <span className="explore-section-badge">{badge}</span> : null}</span>
        <ChevronDown size={14} className={`explore-section-chevron ${open ? 'open' : ''}`} />
      </button>
      {open ? <div className="explore-section-body">{children}</div> : null}
    </div>
  )
}

// ── Options ──────────────────────────────────────────────────────────
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

// ── Download Manager ─────────────────────────────────────────────────
function DownloadManager({ downloads, onPause, onResume, onCancel }: {
  downloads: Record<string, DownloadEventView>
  onPause: (modelId: string, rfilename: string) => void
  onResume: (modelId: string, rfilename: string, url: string) => void
  onCancel: (modelId: string, rfilename: string) => void
}): ReactElement | null {
  const items = Object.values(downloads)
  if (items.length === 0) return null
  return (
    <div className="explore-download-manager" role="region" aria-label="Active downloads">
      <div className="explore-dm-header">
        <HardDrive size={14} /> Background downloads
        <span className="explore-dm-count">{items.length}</span>
        <span className="explore-dm-hint">2 concurrent · pause/resume supported</span>
      </div>
      <div className="explore-dm-list">
        {items.map((ev) => {
          const pct = ev.totalBytes ? Math.min(100, Math.round((ev.receivedBytes / ev.totalBytes) * 100)) : null
          const isPaused = ev.state === 'paused'
          const isQueued = ev.state === 'queued'
          return (
            <div key={`${ev.modelId}\n${ev.rfilename}`} className="explore-dm-item">
              <div className="explore-dm-item-main">
                <div className="explore-dm-item-title">{ev.modelId.split('/').pop()} · {(ev.rfilename ?? '').split('/').pop()}</div>
                <div className="explore-dm-item-meta">
                  {isQueued ? 'Queued' : isPaused ? 'Paused' : ev.state} {pct !== null ? `· ${pct}%` : ''} · {formatBytes(ev.receivedBytes)}{ev.totalBytes ? ` / ${formatBytes(ev.totalBytes)}` : ''}
                </div>
                <div className="explore-dm-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                  <div className="explore-dm-progress-bar" style={{ width: `${pct ?? (isPaused || isQueued ? 0 : 8)}%` }} />
                </div>
              </div>
              <div className="explore-dm-actions">
                {isPaused ? (
                  <button type="button" className="explore-dm-btn" aria-label="Resume" onClick={() => onResume(ev.modelId, ev.rfilename, '')} title="Resume"><Play size={12} /></button>
                ) : isQueued ? (
                  <span className="explore-dm-queued"><Loader2 size={12} className="spin" /></span>
                ) : (
                  <button type="button" className="explore-dm-btn" aria-label="Pause" onClick={() => onPause(ev.modelId, ev.rfilename)} title="Pause"><Pause size={12} /></button>
                )}
                <button type="button" className="explore-dm-btn explore-dm-btn--danger" aria-label="Cancel" onClick={() => onCancel(ev.modelId, ev.rfilename)} title="Cancel"><X size={12} /></button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────
interface ExplorePageProps { onBack: () => void }

export function ExplorePage({ onBack }: ExplorePageProps): ReactElement {
  const [models, setModels] = useState<ExploreModel[]>([])
  const [selectedModel, setSelectedModel] = useState<ExploreModel | null>(null)
  const [compatibility, setCompatibility] = useState<CompatibilityResult | null>(null)
  const [compatLoading, setCompatLoading] = useState(false)
  const [recommendations, setRecommendations] = useState<FileRecommendationView[] | null>(null)
  const [recLoading, setRecLoading] = useState(false)
  const [sortBy, setSortBy] = useState('recommended')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
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
  const [libraryStatus, setLibraryStatus] = useState<Record<string, boolean>>({})
  const [showDownloads, setShowDownloads] = useState(true)
  const searchTimer = useRef<number | null>(null)

  const selectModel = useCallback((model: ExploreModel): void => {
    setSelectedModel(model)
    setDetail(null)
    setDetailError(null)
    setSelectedFile(0)
    setRecommendations(null)
  }, [])

  // debounced search
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => setDebouncedQuery(searchQuery), 350)
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current) }
  }, [searchQuery])

  // Load models
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      setLoading(true); setListError(null)
      try {
        const result = await listExploreModels({ sortBy, query: debouncedQuery, pipelineTag: pipelineFilter, tag: tagFilter })
        if (cancelled) return
        setModels(result)
        if (result.length > 0 && !selectedModel) selectModel(result[0] as ExploreModel)
        else if (result.length === 0) setSelectedModel(null)
      } catch (e) {
        if (!cancelled) setListError(e instanceof Error ? e.message : 'Could not load models.')
      } finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [sortBy, debouncedQuery, pipelineFilter, tagFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Detail
  useEffect(() => {
    if (!selectedModel) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true); setDetailError(null)
    getExploreModel(selectedModel.id)
      .then((d) => { if (!cancelled) setDetail(d) })
      .catch((e: unknown) => { if (!cancelled) setDetailError(e instanceof Error ? e.message : 'Could not load model details.') })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedModel?.id])

  // Compatibility + recommendations
  useEffect(() => {
    if (!selectedModel) return
    setCompatibility(null); setCompatLoading(true); setSelectedFile(0)
    getModelCompatibility(selectedModel.id).then(setCompatibility).catch(() => setCompatibility(null)).finally(() => setCompatLoading(false))
    setRecLoading(true); setRecommendations(null)
    getFileRecommendations(selectedModel.id).then(setRecommendations).catch(() => setRecommendations(null)).finally(() => setRecLoading(false))
  }, [selectedModel?.id])

  // Auto-select recommended file when recs arrive
  useEffect(() => {
    if (recommendations && recommendations.length > 0 && detail) {
      const best = recommendations[0]
      if (best && best.severity !== 'too-large') setSelectedFile(best.index)
    }
  }, [recommendations, detail])

  // Library sync for selected model files
  useEffect(() => {
    const m = detail ?? selectedModel
    if (!m) return
    let cancelled = false
    const checkAll = async (): Promise<void> => {
      const next: Record<string, boolean> = {}
      await Promise.all(m.files.map(async (f) => {
        if (!f.rfilename) return
        try { const r = await isDownloaded(m.id, f.rfilename); if (!cancelled) next[f.rfilename] = r.downloaded } catch { /* ignore */ }
      }))
      if (!cancelled) setLibraryStatus(next)
    }
    void checkAll()
    return () => { cancelled = true }
  }, [detail, selectedModel])

  // Download events + refresh library on done
  useEffect(() => {
    const dispose = onDownloadEvents((ev) => {
      setDownloads((prev) => {
        const next = { ...prev }
        const k = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled') delete next[k]
        else next[k] = ev
        return next
      })
      if (ev.state === 'done') {
        // refresh library status for that file
        setLibraryStatus((prev) => ({ ...prev, [ev.rfilename]: true }))
      }
    })
    // Also poll active downloads on mount (survives reload)
    void getActiveDownloads().then((act) => {
      // No-op: events will populate, but we seed from backend if needed
      if (act.length > 0) {
        // keep manager visible
      }
    }).catch(() => {})
    return dispose
  }, [])

  const startFileDownload = useCallback(async (model: ExploreModel, fileIndex: number): Promise<void> => {
    const file = model.files[fileIndex]
    if (!file?.downloadUrl || !file.rfilename) return
    try { await downloadModelFile(model.id, file.rfilename, file.downloadUrl) } catch { /* invoke failure */ }
  }, [])
  const cancelFileDownload = useCallback(async (modelId: string, rfilename: string): Promise<void> => {
    try { await cancelModelDownload(modelId, rfilename) } catch { /* ignore */ }
  }, [])
  const pauseFileDownload = useCallback(async (modelId: string, rfilename: string): Promise<void> => {
    try { await pauseModelDownload(modelId, rfilename) } catch { /* ignore */ }
  }, [])
  const resumeFileDownload = useCallback(async (model: ExploreModel, fileIndex: number): Promise<void> => {
    const file = model.files[fileIndex]
    if (!file?.downloadUrl || !file.rfilename) return
    try { await resumeModelDownload(model.id, file.rfilename, file.downloadUrl) } catch { /* ignore */ }
  }, [])

  const handleRefresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try { const result = await listExploreModels({ sortBy, query: debouncedQuery, pipelineTag: pipelineFilter, tag: tagFilter }); setModels(result) } catch { /* ignore */ } finally { setLoading(false) }
  }, [sortBy, debouncedQuery, pipelineFilter, tagFilter])

  const handleOpenExternal = useCallback(async (url: string): Promise<void> => {
    try { await openExternal(url) } catch { window.open(url, '_blank', 'noopener') }
  }, [])

  const sortOptions = useMemo(() => [
    { value: 'recommended', label: 'Recommended', icon: Sparkles },
    { value: 'trending', label: 'Trending', icon: TrendingUp },
    { value: 'likes', label: 'Most liked', icon: Star },
    { value: 'downloads', label: 'Most downloaded', icon: Download },
    { value: 'lastModified', label: 'Recently updated', icon: Calendar },
  ], [])

  const activeFiltersCount = (pipelineFilter ? 1 : 0) + (tagFilter ? 1 : 0)
  const hasQuery = debouncedQuery.trim().length > 0 || pipelineFilter || tagFilter

  return (
    <div className="explore-page">
      {/* Left: list */}
      <div className="explore-sidebar">
        <div className="explore-sidebar-header">
          <button type="button" className="settings-back-btn" onClick={onBack}>
            <ArrowLeft size={16} /><span>Back to app</span>
          </button>
          <div className="explore-nav-title">Explore</div>
          <div className="explore-nav-subtitle">Hugging Face · real-time · no mocks</div>
        </div>

        <div className="explore-search-wrap">
          <Search size={14} className="explore-search-icon" />
          <input type="text" className="explore-search" placeholder="Search name, tags, tasks (gguf, vision, code)" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          {searchQuery ? <button type="button" className="explore-search-clear" aria-label="Clear search" onClick={() => setSearchQuery('')}><X size={12} /></button> : null}
        </div>

        <div className="explore-toolbar">
          <button type="button" className={`explore-filter-btn ${showFilters ? 'explore-filter-btn--active' : ''}`} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <Filter size={13} /> Filters {activeFiltersCount ? <span className="explore-filter-dot">{activeFiltersCount}</span> : null}
          </button>
          <button type="button" className="explore-refresh-btn" onClick={handleRefresh} title="Refresh"><RefreshCw size={13} /></button>
          <div className="explore-sort-wrap">
            <button type="button" className="explore-sort-btn" aria-haspopup="menu" aria-expanded={showSortMenu} onClick={() => setShowSortMenu(!showSortMenu)}>
              {(() => { const cur = sortOptions.find((o) => o.value === sortBy); const Icon = cur?.icon ?? Sparkles; return <><Icon size={13} /> {cur?.label}</> })()}
              <ChevronDown size={14} className={showSortMenu ? 'rotated' : ''} />
            </button>
            {showSortMenu && (
              <div className="explore-sort-menu" role="menu">
                <div className="explore-sort-menu-header">Sort by</div>
                {sortOptions.map((opt) => {
                  const Icon = opt.icon
                  return (
                    <button key={opt.value} type="button" role="menuitemradio" aria-checked={sortBy === opt.value} className={`explore-sort-option ${sortBy === opt.value ? 'explore-sort-option--active' : ''}`} onClick={() => { setSortBy(opt.value); setShowSortMenu(false) }}>
                      <Icon size={13} className="explore-sort-option-icon" /> {opt.label} {sortBy === opt.value && <span className="explore-check">✓</span>}
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
              <select className="explore-filter-select" value={pipelineFilter} onChange={(e) => setPipelineFilter(e.target.value)}>
                {PIPELINE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="explore-filter-group">
              <label className="explore-filter-label"><Layers size={12} /> Tag</label>
              <select className="explore-filter-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                {TAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {hasQuery ? <button type="button" className="explore-filter-clear" onClick={() => { setSearchQuery(''); setPipelineFilter(''); setTagFilter(''); setDebouncedQuery('') }}>Clear all filters</button> : null}
          </div>
        )}

        {(pipelineFilter || tagFilter) && (
          <div className="explore-active-chips">
            {pipelineFilter ? <span className="explore-active-chip">task: {pipelineFilter}<button type="button" aria-label="Remove task filter" onClick={() => setPipelineFilter('')}><X size={10} /></button></span> : null}
            {tagFilter ? <span className="explore-active-chip">tag: {tagFilter}<button type="button" aria-label="Remove tag filter" onClick={() => setTagFilter('')}><X size={10} /></button></span> : null}
          </div>
        )}

        <div className="explore-model-list">
          {loading ? <div className="explore-loading"><Loader2 size={16} className="spin" /> Loading models…</div>
            : listError ? <div className="explore-empty">{listError}<button type="button" className="settings-action-btn" onClick={handleRefresh} style={{ marginTop: 8 }}>Retry</button></div>
              : models.length === 0 ? <div className="explore-empty">No models found. Try different search or filters.</div>
                : models.map((model) => (
                  <ModelCard key={model.id} model={model} active={selectedModel?.id === model.id} onSelect={() => selectModel(model)} />
                ))}
        </div>
      </div>

      {/* Right: detail */}
      <div className="explore-detail">
        {selectedModel ? (
          <ExploreDetail
            summary={selectedModel}
            detail={detail}
            detailLoading={detailLoading}
            detailError={detailError}
            compatibility={compatibility}
            compatLoading={compatLoading}
            recommendations={recommendations}
            recLoading={recLoading}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            downloads={downloads}
            libraryStatus={libraryStatus}
            onDownload={startFileDownload}
            onCancelDownload={cancelFileDownload}
            onPause={pauseFileDownload}
            onResume={resumeFileDownload}
            onOpenExternal={handleOpenExternal}
          />
        ) : (
          <div className="explore-detail-empty">
            <Box size={28} className="explore-empty-icon" />
            <p>Select a model to see details</p>
            <span className="explore-empty-hint">Browse {models.length} models · Trending, recommended, filtered by task & tag</span>
          </div>
        )}

        {/* Global download manager dock */}
        {Object.keys(downloads).length > 0 && (
          <div className="explore-dm-dock">
            <button type="button" className="explore-dm-toggle" onClick={() => setShowDownloads((v) => !v)}>
              {showDownloads ? <ChevronDown size={12} /> : <ChevronUp size={12} />} Downloads ({Object.keys(downloads).length})
            </button>
            {showDownloads ? (
              <DownloadManager
                downloads={downloads}
                onPause={pauseFileDownload}
                onResume={(id, f) => {
                  const m = detail ?? selectedModel
                  const file = m?.files.find((x) => x.rfilename === f)
                  if (file?.downloadUrl) void resumeModelDownload(id, f, file.downloadUrl)
                }}
                onCancel={cancelFileDownload}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function ModelCard({ model, active, onSelect }: { model: ExploreModel; active: boolean; onSelect: () => void }): ReactElement {
  const gguf = hasGguf(model)
  const topCaps = model.capabilities.slice(0, 3)
  return (
    <button type="button" className={`explore-model-item ${active ? 'explore-model-item--active' : ''}`} onClick={onSelect} aria-pressed={active}>
      <ModelIcon type={model.iconType} />
      <div className="explore-model-item-body">
        <div className="explore-model-item-name">
          <span className="explore-model-name-text">{model.name}</span>
          {model.staffPick && <span className="explore-staff-badge" title="Staff Pick">★</span>}
        </div>
        <div className="explore-model-item-desc">{model.description}</div>
        <div className="explore-card-badges">
          <span className="explore-mini-badge explore-mini-badge--params"><Cpu size={10} /> {model.parameters}</span>
          <GgufBadge model={model} />
          {model.license ? <span className="explore-mini-badge explore-mini-badge--license"><Shield size={10} /> {model.license}</span> : null}
          {topCaps.map((c) => <CapBadge key={c} cap={c} />)}
          {model.capabilities.length > 3 ? <span className="explore-mini-badge">+{model.capabilities.length - 3}</span> : null}
        </div>
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
  recommendations: FileRecommendationView[] | null
  recLoading: boolean
  selectedFile: number
  onSelectFile: (i: number) => void
  downloads: Record<string, DownloadEventView>
  libraryStatus: Record<string, boolean>
  onDownload: (model: ExploreModel, fileIndex: number) => void
  onCancelDownload: (modelId: string, rfilename: string) => void
  onPause: (modelId: string, rfilename: string) => void
  onResume: (model: ExploreModel, fileIndex: number) => void
  onOpenExternal: (url: string) => void
}): ReactElement {
  const { summary, detail, detailLoading, detailError } = props
  const selectedModel = detail ?? summary
  const activeFile = selectedModel.files[props.selectedFile]
  const dlKey = activeFile?.rfilename ? `${selectedModel.id}\n${activeFile.rfilename}` : null
  const dl = dlKey ? props.downloads[dlKey] : undefined
  const pct = dl && dl.totalBytes ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : null
  const readmeHtml = useMemo(() => selectedModel.readme ? renderMarkdown(selectedModel.readme) : '', [selectedModel.readme])
  const gguf = hasGguf(selectedModel)
  const isInstalled = activeFile?.rfilename ? Boolean(props.libraryStatus[activeFile.rfilename]) : false
  const recForActive = props.recommendations?.find((r) => r.index === props.selectedFile)

  const handleReadmeClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a[data-external="true"]') as HTMLAnchorElement | null
    if (anchor?.href) {
      e.preventDefault()
      void props.onOpenExternal(anchor.href)
    }
  }, [props])

  return (
    <div className="explore-detail-content">
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
            {isInstalled ? <span className="explore-head-badge explore-head-badge--installed"><FolderCheck size={12} /> Installed</span> : null}
          </div>
        </div>
      </div>

      <div className="explore-stats-bar">
        <span className="explore-stat"><Download size={14} /> {formatDownloads(selectedModel.downloads)} downloads</span>
        <span className="explore-stat"><ThumbsUp size={14} /> {formatDownloads(selectedModel.likes)} likes</span>
        {selectedModel.staffPick && <span className="explore-stat"><Star size={14} /> Staff Pick</span>}
        <span className="explore-stat"><Calendar size={14} /> {formatDateLong(selectedModel.updatedAt)}</span>
        <button type="button" className="explore-open-web" onClick={() => void props.onOpenExternal(`https://huggingface.co/${selectedModel.slug}`)}>Open on Hugging Face <ExternalLink size={12} /></button>
      </div>

      <Section title="Overview" icon={<BookOpen size={14} />}>
        <>
          <p className="explore-long-desc">{selectedModel.longDescription}</p>
          <div className="explore-overview-grid">
            <div className="explore-overview-item"><span className="explore-overview-label">Model</span><span className="explore-overview-value">{selectedModel.slug}</span></div>
            <div className="explore-overview-item"><span className="explore-overview-label">Author</span><span className="explore-overview-value">{selectedModel.author}</span></div>
            <div className="explore-overview-item"><span className="explore-overview-label">Updated</span><span className="explore-overview-value">{formatDateLong(selectedModel.updatedAt)} · {formatDate(selectedModel.updatedAt)}</span></div>
            <div className="explore-overview-item"><span className="explore-overview-label">Parameters</span><span className="explore-overview-value">{selectedModel.parameters}</span></div>
            <div className="explore-overview-item"><span className="explore-overview-label">Architecture</span><span className="explore-overview-value">{selectedModel.architecture}</span></div>
            {selectedModel.pipelineTag ? <div className="explore-overview-item"><span className="explore-overview-label">Task</span><span className="explore-overview-value explore-tag-chip">{selectedModel.pipelineTag}</span></div> : null}
            {typeof selectedModel.repoSizeBytes === 'number' ? <div className="explore-overview-item"><span className="explore-overview-label">Repo size</span><span className="explore-overview-value">{formatBytes(selectedModel.repoSizeBytes)}</span></div> : null}
          </div>
        </>
      </Section>

      <Section title="System recommendation" icon={<HardDrive size={14} />} badge={props.compatLoading || props.recLoading ? 'checking…' : undefined}>
        <>
          <div className="explore-compat">
            {props.compatLoading || props.recLoading ? <span className="explore-compat-loading"><Loader2 size={12} className="spin" /> Checking system…</span>
              : (
                <>
                  <CompatibilityBadge result={props.compatibility} />
                  {props.compatibility ? <span className="explore-compat-msg">{props.compatibility.message}</span> : null}
                  {props.recommendations && props.recommendations.length > 0 ? (
                    <div className="explore-rec-list">
                      {props.recommendations.slice(0, 3).map((r) => (
                        <div key={r.index} className={`explore-rec-item ${r.rank === 0 ? 'explore-rec-item--primary' : ''} ${r.severity === 'too-large' ? 'explore-rec-item--bad' : ''}`}>
                          <span className="explore-rec-file">{(r.file.rfilename ?? '').split('/').pop()} {r.file.quantization ? `· ${r.file.quantization}` : ''} · {formatBytes(r.file.sizeBytes ?? r.file.sizeGB * 1024 ** 3)}</span>
                          <span className={`explore-rec-sev sev--${r.severity}`}>{r.severity}</span>
                          <span className="explore-rec-reason">{r.reason}</span>
                          {r.rank === 0 && r.severity !== 'too-large' ? <span className="explore-rec-badge">★ Recommended</span> : null}
                        </div>
                      ))}
                      {recForActive ? <div className="explore-rec-active">Selected: {recForActive.reason}</div> : null}
                    </div>
                  ) : null}
                </>
              )}
          </div>
          <div className="explore-rec-hint"><Info size={12} /> Recommendation balances quality (higher quant) vs fit. Largest good file is preferred.</div>
        </>
      </Section>

      <Section title="Capabilities" icon={<Sparkles size={14} />}>
        <>
          <div className="explore-caps-row">
            {selectedModel.capabilities.length > 0 ? selectedModel.capabilities.map((cap) => <CapBadge key={cap} cap={cap} />) : <span className="explore-empty-text">No capabilities tagged</span>}
          </div>
          <div className="explore-tags" style={{ marginTop: 10 }}>
            {selectedModel.languages && selectedModel.languages.length > 0 ? (
              <div className="explore-tag-group"><span className="explore-tag-label">Languages</span>{selectedModel.languages.map((l) => <span key={l} className="explore-tag-chip">{l}</span>)}</div>
            ) : null}
            {selectedModel.baseModel ? <div className="explore-tag-group"><span className="explore-tag-label">Base model</span><span className="explore-tag-value">{selectedModel.baseModel}</span></div> : null}
            <div className="explore-tag-group">
              <span className="explore-tag-label">Tags</span>
              <span className="explore-tag-value explore-tags-inline">
                {selectedModel.tags.slice(0, 14).map((t) => <span key={t} className="explore-tag-chip explore-tag-chip--small">{t}</span>)}
                {selectedModel.tags.length > 14 ? <span className="explore-tag-more">+{selectedModel.tags.length - 14} more</span> : null}
              </span>
            </div>
          </div>
        </>
      </Section>

      <Section title="Files" icon={<Box size={14} />} badge={`${selectedModel.files.length} files`}>
        <>
          {detailLoading ? <div className="explore-compat-loading"><Loader2 size={12} className="spin" /> Loading file list…</div>
            : detailError ? <div className="explore-empty">{detailError}</div>
              : (
                <div className="explore-files">
                  {selectedModel.files.map((file, i) => {
                    const installed = file.rfilename ? Boolean(props.libraryStatus[file.rfilename]) : false
                    const rec = props.recommendations?.find((r) => r.index === i)
                    const isRec = rec?.rank === 0 && rec.severity !== 'too-large'
                    return (
                      <button key={file.rfilename ?? i} type="button" className={`explore-file-chip ${props.selectedFile === i ? 'explore-file-chip--active' : ''} ${isRec ? 'explore-file-chip--rec' : ''} ${installed ? 'explore-file-chip--installed' : ''}`} onClick={() => props.onSelectFile(i)}>
                        <span className="explore-file-format">{file.format}</span>
                        <span className="explore-file-name">{(file.rfilename ?? '').split('/').pop() || selectedModel.name}</span>
                        {file.quantization && <span className="explore-file-quant">{file.quantization}</span>}
                        <span className="explore-file-size">{formatBytes(file.sizeBytes ?? file.sizeGB * 1024 ** 3)}</span>
                        {installed ? <span className="explore-file-installed" title="Already in library"><FolderCheck size={12} /></span> : null}
                        {isRec ? <span className="explore-file-rec" title={rec?.reason}>★</span> : null}
                        {rec ? <span className={`explore-file-sev sev--${rec.severity}`} title={rec.reason} /> : null}
                      </button>
                    )
                  })}
                  {selectedModel.files.length === 0 ? <div className="explore-empty">No downloadable weight files found for this repo.</div> : null}
                </div>
              )}

          {/* Download row */}
          <div className="explore-download-row">
            {(() => {
              if (!activeFile) return <div className="explore-empty-text">Select a file above</div>
              if (isInstalled) return (
                <div className="explore-installed-row"><FolderCheck size={16} /> Already in library · {activeFile.rfilename?.split('/').pop()} <button type="button" className="explore-inline-link" onClick={() => void props.onOpenExternal(`file://${selectedModel.slug}`)}>Show in folder</button></div>
              )
              if (dl) {
                const isPaused = dl.state === 'paused'
                const isQueued = dl.state === 'queued'
                return (
                  <div className="explore-download-progress">
                    <div className="explore-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                      <div className="explore-download-progress-bar" style={{ width: `${pct ?? (isPaused || isQueued ? 0 : 8)}%` }} />
                    </div>
                    <span className="explore-download-progress-label">
                      {isQueued ? 'Queued (max 2 concurrent)' : isPaused ? 'Paused' : `${pct !== null ? `${pct}% · ` : ''}${formatBytes(dl.receivedBytes)}${dl.totalBytes ? ` of ${formatBytes(dl.totalBytes)}` : ''}`}
                    </span>
                    {!isQueued ? (
                      isPaused
                        ? <button type="button" className="settings-action-btn" aria-label="Resume" onClick={() => props.onResume(selectedModel, props.selectedFile)}><Play size={14} /> Resume</button>
                        : <button type="button" className="settings-action-btn" aria-label="Pause" onClick={() => props.onPause(selectedModel.id, activeFile.rfilename as string)}><Pause size={14} /> Pause</button>
                    ) : null}
                    <button type="button" className="settings-action-btn" aria-label="Cancel" onClick={() => props.onCancelDownload(selectedModel.id, activeFile.rfilename as string)}><X size={14} /></button>
                  </div>
                )
              }
              return (
                <button type="button" className="explore-download-btn" disabled={!activeFile.downloadUrl} onClick={() => props.onDownload(selectedModel, props.selectedFile)}>
                  <Download size={16} /> {activeFile.downloadUrl ? `Download ${formatBytes(activeFile.sizeBytes ?? activeFile.sizeGB * 1024 ** 3)}` : 'Select a file'}
                  {recForActive?.rank === 0 && recForActive.severity === 'good' ? <span className="explore-dl-rec">★ Recommended</span> : null}
                </button>
              )
            })()}
          </div>
          <div className="explore-files-hint"><Copy size={11} /> Files are from <code>huggingface.co/{selectedModel.slug}/resolve/main/…</code> · resume via Range · 2 concurrent limit</div>
        </>
      </Section>

      <Section title="License & access" icon={<Shield size={14} />}>
        <>
          <div className="explore-license-grid">
            <div className="explore-license-row"><span className="explore-license-label">License</span><span className="explore-license-value">{selectedModel.license ? <span className="explore-tag-chip explore-tag-chip--license">{selectedModel.license}</span> : <span className="explore-empty-text">Not specified</span>}</span></div>
            <div className="explore-license-row"><span className="explore-license-label">Access</span><span className="explore-license-value">{selectedModel.gated ? '🔒 Gated — request access on Hugging Face' : 'Public'}</span></div>
            <div className="explore-license-row"><span className="explore-license-label">Links</span><span className="explore-license-value">
              <button type="button" className="explore-inline-link" onClick={() => void props.onOpenExternal(`https://huggingface.co/${selectedModel.slug}`)}>Model card <ExternalLink size={11} /></button>
              <span className="explore-dot-sep">·</span>
              <button type="button" className="explore-inline-link" onClick={() => void props.onOpenExternal(`https://huggingface.co/${selectedModel.slug}/tree/main`)}>Files <ExternalLink size={11} /></button>
              <span className="explore-dot-sep">·</span>
              <button type="button" className="explore-inline-link" onClick={() => void props.onOpenExternal(`https://huggingface.co/${selectedModel.slug}/raw/main/README.md`)}>Raw README <ExternalLink size={11} /></button>
            </span></div>
          </div>
        </>
      </Section>

      <Section title="README" icon={<FileText size={14} />} defaultOpen={true}>
        <>
          {selectedModel.readme ? (
            <div className="explore-readme explore-readme--md" onClick={handleReadmeClick} dangerouslySetInnerHTML={{ __html: readmeHtml }} />
          ) : (
            <div className="explore-readme">
              <h4>{selectedModel.name}</h4>
              <p>{selectedModel.longDescription}</p>
              <h5>Highlights</h5>
              <ul>{selectedModel.capabilities.map((cap) => <li key={cap}><strong>{cap}:</strong> {getCapabilityDescription(cap)}</li>)}</ul>
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
