import { useState, useEffect, useCallback, useMemo, useRef, type ReactElement } from 'react'
import {
  ArrowLeft, Search, Download, Eye, Wrench, Clock, X, Filter,
  ChevronDown, ExternalLink, RefreshCw, Star, ThumbsUp, FileCode, Shield,
  Tag, Cpu, Layers, BookOpen, Box, Check, AlertTriangle, Ban, Sparkles, TrendingUp, Calendar,
  Pause, Play, Copy, FolderCheck, HardDrive, Info, FileText, ChevronUp, Loader2, Settings2, Brain, Zap
} from 'lucide-react'
import {
  listExploreModels, getExploreModel, getModelCompatibility, getFileRecommendations, getHardwareProfile,
  downloadModelFile, cancelModelDownload, pauseModelDownload, resumeModelDownload,
  onDownloadEvents, isDownloaded, getActiveDownloads, openExternal,
  type ExploreModel, type CompatibilityResult, type DownloadEventView, type FileRecommendationView,
} from '../../lib/ipc'
import type { HardwareInfo } from '@shared/types/explore'

// ── Formatting ───────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'size unknown'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
function formatDownloads(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'recently'
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'recently'
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 30) return `${diffDays} days ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`
  return `${Math.floor(diffDays / 365)} years ago`
}
function formatDateLong(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return 'recently'
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return 'recently' }
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
  const flushList = (): void => { if (inList) { html += `<ul class="md-ul">${listBuf.join('')}</ul>`; listBuf = []; inList = false } }
  const flushTable = (): void => {
    if (tableBuf && tableBuf.length > 0) {
      const header = tableBuf[0]
      const rows = tableBuf.slice(1).filter((r) => !r.every((c) => /^[-:\s]+$/.test(c)))
      html += '<div class="md-table-wrap"><table class="md-table"><thead><tr>'
      header.forEach((c) => { html += `<th>${inlineMd(c.trim())}</th>` })
      html += '</tr></thead><tbody>'
      rows.forEach((r) => { html += '<tr>'; r.forEach((c) => { html += `<td>${inlineMd(c.trim())}</td>` }); html += '</tr>' })
      html += '</tbody></table></div>'; tableBuf = null
    }
  }
  const flushCode = (): void => { if (codeBuf.length > 0) { html += `<pre class="md-pre"><code>${escapeHtml(codeBuf.join('\n'))}</code></pre>`; codeBuf = [] } }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    if (raw.startsWith('```')) { if (inCode) { flushCode(); inCode = false } else { flushList(); flushTable(); inCode = true } continue }
    if (inCode) { codeBuf.push(raw); continue }
    if (raw.includes('|') && i + 1 < lines.length && /^\s*\|?[\s-|:]+\|[\s-|:]*$/.test(lines[i + 1])) {
      flushList(); const header = raw.split('|').map((s) => s.trim()).filter(Boolean); tableBuf = [header]; i += 1
      while (i + 1 < lines.length && lines[i + 1].includes('|')) { i += 1; const cleaned = lines[i].split('|').map((s) => s.trim()); if (cleaned[0] === '') cleaned.shift(); if (cleaned[cleaned.length - 1] === '') cleaned.pop(); if (cleaned.length > 0) tableBuf.push(cleaned) }
      flushTable(); continue
    }
    if (/^\s*[-*]\s+/.test(raw)) { const item = raw.replace(/^\s*[-*]\s+/, ''); if (!inList) inList = true; listBuf.push(`<li>${inlineMd(item)}</li>`); continue }
    if (/^\s*$/.test(raw)) { flushList(); continue }
    if (/^#{1,6}\s+/.test(raw)) { flushList(); flushTable(); const m = raw.match(/^(#{1,6})\s+(.*)$/)!; const level = m[1].length; const tag = `h${Math.min(level + 1, 6)}`; html += `<${tag} class="md-h${level}">${inlineMd(m[2])}</${tag}>`; continue }
    if (/^>\s+/.test(raw)) { flushList(); flushTable(); html += `<blockquote class="md-quote">${inlineMd(raw.replace(/^>\s+/, ''))}</blockquote>`; continue }
    if (/^---+/.test(raw.trim())) { flushList(); flushTable(); html += '<hr class="md-hr"/>'; continue }
    flushList(); flushTable(); html += `<p class="md-p">${inlineMd(raw)}</p>`
  }
  flushList(); flushTable(); flushCode(); return html
}

// ── UI primitives ────────────────────────────────────────────────────
function ModelIcon({ type, size = 36 }: { type: ExploreModel['iconType']; size?: number }): ReactElement {
  const colors: Record<string, string> = { qwen: '#7c3aed', google: '#4285f4', meta: '#0668e1', mistral: '#ff6f00', microsoft: '#00a4ef', deepseek: '#0066ff', hf: '#ff9d00' }
  const labels: Record<string, string> = { qwen: 'Q', google: 'G', meta: 'M', mistral: 'M', microsoft: 'Ms', deepseek: 'D', hf: 'HF' }
  return <div className="explore-model-icon" style={{ background: colors[type] || '#6b7280', width: size, height: size, fontSize: size * 0.4 }}>{labels[type] || '?'}</div>
}
function CapBadge({ cap }: { cap: string }): ReactElement {
  const map: Record<string, string> = { Vision: 'cap--vision', Tools: 'cap--tools', Reasoning: 'cap--reasoning', Code: 'cap--code', Chat: 'cap--chat', Embeddings: 'cap--embed' }
  const icons: Record<string, ReactElement> = { Vision: <Eye size={11} />, Tools: <Wrench size={11} />, Reasoning: <Brain size={11} />, Code: <FileCode size={11} />, Chat: <Tag size={11} />, Embeddings: <Layers size={11} /> }
  return <span className={`explore-cap-badge ${map[cap] ?? ''}`}>{icons[cap] ?? null} {cap}</span>
}
function CompatibilityBadge({ result }: { result: CompatibilityResult | null }): ReactElement | null {
  if (!result) return null
  if (result.message.includes('Partial GPU Offload')) {
    return <div className="compat-badge compat-badge--info"><HardDrive size={12} /> Partial GPU Offload Possible</div>
  }
  if (result.severity === 'too-large') return <div className="compat-badge compat-badge--error"><Ban size={12} /> Too large for this device</div>
  if (result.severity === 'tight') return <div className="compat-badge compat-badge--warning"><AlertTriangle size={12} /> Tight fit</div>
  return <div className="compat-badge compat-badge--success"><Check size={12} /> Fits this device</div>
}
function hasGguf(model: ExploreModel): boolean { return model.files.some((f) => f.format === 'GGUF') || model.tags.some((t) => t.toLowerCase().includes('gguf')) }

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
        <span className="explore-dm-hint">2 concurrent · pause/resume</span>
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
                {isPaused ? <button type="button" className="explore-dm-btn" aria-label="Resume" onClick={() => onResume(ev.modelId, ev.rfilename, '')} title="Resume"><Play size={12} /></button>
                  : isQueued ? <span className="explore-dm-queued"><Loader2 size={12} className="spin" /></span>
                    : <button type="button" className="explore-dm-btn" aria-label="Pause" onClick={() => onPause(ev.modelId, ev.rfilename)} title="Pause"><Pause size={12} /></button>}
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
  const [hardware, setHardware] = useState<HardwareInfo | null>(null)
  const [sortBy, setSortBy] = useState('Recommended')
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
  const [downloadTo, setDownloadTo] = useState('This device')
  const searchTimer = useRef<number | null>(null)

  const selectModel = useCallback((model: ExploreModel): void => {
    setSelectedModel(model)
    setDetail(null)
    setDetailError(null)
    setSelectedFile(0)
    setRecommendations(null)
  }, [])

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => setDebouncedQuery(searchQuery), 350)
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current) }
  }, [searchQuery])

  useEffect(() => { void getHardwareProfile().then(setHardware).catch(() => {}) }, [])

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
      } catch (e) { if (!cancelled) setListError(e instanceof Error ? e.message : 'Could not load models.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [sortBy, debouncedQuery, pipelineFilter, tagFilter])

  useEffect(() => {
    if (!selectedModel) { setDetail(null); return }
    let cancelled = false
    setDetailLoading(true); setDetailError(null)
    getExploreModel(selectedModel.id).then((d) => { if (!cancelled) setDetail(d) }).catch((e: unknown) => { if (!cancelled) setDetailError(e instanceof Error ? e.message : 'Could not load model details.') }).finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedModel?.id])

  useEffect(() => {
    if (!selectedModel) return
    setCompatibility(null); setCompatLoading(true); setSelectedFile(0)
    getModelCompatibility(selectedModel.id).then(setCompatibility).catch(() => setCompatibility(null)).finally(() => setCompatLoading(false))
    setRecLoading(true); setRecommendations(null)
    getFileRecommendations(selectedModel.id).then(setRecommendations).catch(() => setRecommendations(null)).finally(() => setRecLoading(false))
  }, [selectedModel?.id])

  useEffect(() => {
    if (recommendations && recommendations.length > 0 && detail) {
      const best = recommendations[0]
      if (best && best.severity !== 'too-large') setSelectedFile(best.index)
    }
  }, [recommendations, detail])

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

  useEffect(() => {
    const dispose = onDownloadEvents((ev) => {
      setDownloads((prev) => {
        const next = { ...prev }
        const k = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled') delete next[k]
        else next[k] = ev
        return next
      })
      if (ev.state === 'done') setLibraryStatus((prev) => ({ ...prev, [ev.rfilename]: true }))
    })
    void getActiveDownloads().then(() => {}).catch(() => {})
    return dispose
  }, [])

  const startFileDownload = useCallback(async (model: ExploreModel, fileIndex: number): Promise<void> => {
    const file = model.files[fileIndex]
    if (!file?.downloadUrl || !file.rfilename) return
    try { await downloadModelFile(model.id, file.rfilename, file.downloadUrl) } catch { /* invoke failure */ }
  }, [])
  const cancelFileDownload = useCallback(async (modelId: string, rfilename: string): Promise<void> => { try { await cancelModelDownload(modelId, rfilename) } catch { /* ignore */ } }, [])
  const pauseFileDownload = useCallback(async (modelId: string, rfilename: string): Promise<void> => { try { await pauseModelDownload(modelId, rfilename) } catch { /* ignore */ } }, [])
  const resumeFileDownload = useCallback(async (model: ExploreModel, fileIndex: number): Promise<void> => {
    const file = model.files[fileIndex]
    if (!file?.downloadUrl || !file.rfilename) return
    try { await resumeModelDownload(model.id, file.rfilename, file.downloadUrl) } catch { /* ignore */ }
  }, [])
  const handleRefresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try { const result = await listExploreModels({ sortBy, query: debouncedQuery, pipelineTag: pipelineFilter, tag: tagFilter }); setModels(result) } catch { /* ignore */ } finally { setLoading(false) }
  }, [sortBy, debouncedQuery, pipelineFilter, tagFilter])
  const handleOpenExternal = useCallback(async (url: string): Promise<void> => { try { await openExternal(url) } catch { window.open(url, '_blank', 'noopener') } }, [])

  const sortOptions = useMemo(() => [
    { value: 'Recommended', label: 'Recommended', icon: Sparkles },
    { value: 'trending', label: 'Trending', icon: TrendingUp },
    { value: 'likes', label: 'Most liked', icon: Star },
    { value: 'downloads', label: 'Most downloaded', icon: Download },
    { value: 'lastModified', label: 'Recently updated', icon: Calendar },
  ], [])

  const activeFiltersCount = (pipelineFilter ? 1 : 0) + (tagFilter ? 1 : 0)
  const hasQuery = debouncedQuery.trim().length > 0 || pipelineFilter || tagFilter

  return (
    <div className="explore-page">
      <div className="explore-sidebar">
        <div className="explore-sidebar-header">
          <button type="button" className="explore-back-btn" onClick={onBack}>
            <ArrowLeft size={14} /> Back to app
          </button>
          <div className="explore-title-row">
            <h1 className="explore-title">Explore</h1>
            <span className="explore-subtitle">Hugging Face · real-time · no mocks</span>
          </div>
        </div>

        <div className="explore-search-wrap">
          <Search size={15} className="explore-search-icon" />
          <input type="text" className="explore-search" placeholder="Search Hugging Face and staff picks" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          {searchQuery ? <button type="button" className="explore-search-clear" aria-label="Clear search" onClick={() => setSearchQuery('')}><X size={13} /></button> : null}
        </div>

        <div className="explore-toolbar">
          <div className="explore-staff-picks">
            <span className="explore-staff-label">Staff picks</span>
            <button type="button" className="explore-refresh-btn" onClick={handleRefresh} title="Refresh"><RefreshCw size={12} /></button>
          </div>
          <div className="explore-sort-wrap">
            <button type="button" className="explore-sort-btn" aria-haspopup="menu" aria-expanded={showSortMenu} onClick={() => setShowSortMenu(!showSortMenu)}>
              <Sparkles size={12} /> {sortOptions.find((o) => o.value === sortBy)?.label ?? 'Recommended'} <ChevronDown size={13} className={showSortMenu ? 'rotated' : ''} />
            </button>
            {showSortMenu && (
              <div className="explore-sort-menu" role="menu">
                {sortOptions.map((opt) => {
                  const Icon = opt.icon
                  return (
                    <button key={opt.value} type="button" role="menuitemradio" aria-checked={sortBy === opt.value} className={`explore-sort-option ${sortBy === opt.value ? 'explore-sort-option--active' : ''}`} onClick={() => { setSortBy(opt.value); setShowSortMenu(false) }}>
                      <Icon size={12} className="explore-sort-option-icon" /> {opt.label} {sortBy === opt.value && <Check size={12} className="explore-check" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <div className="explore-filter-row">
          <button type="button" className={`explore-filter-btn ${showFilters ? 'explore-filter-btn--active' : ''}`} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            <Filter size={12} /> Filters {activeFiltersCount ? <span className="explore-filter-dot">{activeFiltersCount}</span> : null}
          </button>
          <span className="explore-filter-hint">{models.length} models</span>
        </div>

        {showFilters && (
          <div className="explore-filters-panel">
            <div className="explore-filter-group">
              <label className="explore-filter-label"><Tag size={11} /> Task</label>
              <select className="explore-filter-select" value={pipelineFilter} onChange={(e) => setPipelineFilter(e.target.value)}>
                {PIPELINE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="explore-filter-group">
              <label className="explore-filter-label"><Layers size={11} /> Tag</label>
              <select className="explore-filter-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                {TAG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {hasQuery ? <button type="button" className="explore-filter-clear" onClick={() => { setSearchQuery(''); setPipelineFilter(''); setTagFilter(''); setDebouncedQuery('') }}>Clear all</button> : null}
          </div>
        )}

        {(pipelineFilter || tagFilter) && (
          <div className="explore-active-chips">
            {pipelineFilter ? <span className="explore-active-chip">task: {pipelineFilter}<button type="button" aria-label="Remove task filter" onClick={() => setPipelineFilter('')}><X size={10} /></button></span> : null}
            {tagFilter ? <span className="explore-active-chip">tag: {tagFilter}<button type="button" aria-label="Remove tag filter" onClick={() => setTagFilter('')}><X size={10} /></button></span> : null}
          </div>
        )}

        <div className="explore-model-list">
          {loading ? <div className="explore-loading"><Loader2 size={14} className="spin" /> Loading…</div>
            : listError ? <div className="explore-empty">{listError}<button type="button" className="explore-retry-btn" onClick={handleRefresh}>Retry</button></div>
              : models.length === 0 ? <div className="explore-empty">No models found. Try different search.</div>
                : models.map((model) => (
                  <ModelListItem key={model.id} model={model} active={selectedModel?.id === model.id} onSelect={() => selectModel(model)} />
                ))}
        </div>
      </div>

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
            hardware={hardware}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
            downloads={downloads}
            libraryStatus={libraryStatus}
            downloadTo={downloadTo}
            onDownloadToChange={setDownloadTo}
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
            <span className="explore-empty-hint">Staff picks · Trending · Filter by task & tag</span>
          </div>
        )}
        {Object.keys(downloads).length > 0 && (
          <div className="explore-dm-dock">
            <button type="button" className="explore-dm-toggle" onClick={() => setShowDownloads((v) => !v)}>
              {showDownloads ? <ChevronDown size={12} /> : <ChevronUp size={12} />} Downloads ({Object.keys(downloads).length})
            </button>
            {showDownloads ? <DownloadManager downloads={downloads} onPause={pauseFileDownload} onResume={(id, f) => { const m = detail ?? selectedModel; const file = m?.files.find((x) => x.rfilename === f); if (file?.downloadUrl) void resumeModelDownload(id, f, file.downloadUrl) }} onCancel={cancelFileDownload} /> : null}
          </div>
        )}
      </div>
    </div>
  )
}

function ModelListItem({ model, active, onSelect }: { model: ExploreModel; active: boolean; onSelect: () => void }): ReactElement {
  return (
    <button type="button" className={`explore-list-item ${active ? 'explore-list-item--active' : ''}`} onClick={onSelect} aria-pressed={active}>
      <ModelIcon type={model.iconType} size={36} />
      <div className="explore-list-item-body">
        <div className="explore-list-item-name">
          <span className="explore-list-item-title">{model.name}</span>
          <span className="explore-list-item-check" title="Staff pick">✓</span>
        </div>
        <div className="explore-list-item-desc">{model.description}</div>
        <div className="explore-list-item-meta">
          <span className="explore-list-item-time">{formatDate(model.updatedAt)}</span>
          <span className="explore-list-item-icons">
            <Eye size={12} aria-label="Vision" /> <Wrench size={12} aria-label="Tools" />
          </span>
        </div>
      </div>
      <div className="explore-list-item-actions">
        <Eye size={12} className="explore-list-eye" />
        <Wrench size={12} className="explore-list-wrench" />
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
  hardware: HardwareInfo | null
  selectedFile: number
  onSelectFile: (i: number) => void
  downloads: Record<string, DownloadEventView>
  libraryStatus: Record<string, boolean>
  downloadTo: string
  onDownloadToChange: (v: string) => void
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
  const isInstalled = activeFile?.rfilename ? Boolean(props.libraryStatus[activeFile.rfilename]) : false
  const recForActive = props.recommendations?.find((r) => r.index === props.selectedFile)

  const [showFileDropdown, setShowFileDropdown] = useState(false)
  const handleReadmeClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a[data-external="true"]') as HTMLAnchorElement | null
    if (anchor?.href) { e.preventDefault(); void props.onOpenExternal(anchor.href) }
  }, [props])

  // Derive display values for header
  const totalDownloads = formatDownloads(selectedModel.downloads)
  const likes = formatDownloads(selectedModel.likes)

  return (
    <div className="explore-detail-content">
      <div className="explore-detail-header">
        <ModelIcon type={selectedModel.iconType} size={52} />
        <div className="explore-detail-head-text">
          <h2 className="explore-detail-name">{selectedModel.name}</h2>
          <div className="explore-detail-slug">{selectedModel.slug}</div>
        </div>
      </div>

      <div className="explore-stats-bar">
        <span className="explore-stat"><Download size={13} /> {totalDownloads}</span>
        <span className="explore-stat"><Star size={13} /> {likes}</span>
        <span className="explore-stat explore-stat--staff"><Shield size={12} /> Staff Pick</span>
        <span className="explore-stat"><Clock size={13} /> Updated {formatDate(selectedModel.updatedAt)}</span>
        <button type="button" className="explore-open-web" onClick={() => void props.onOpenExternal(`https://huggingface.co/${selectedModel.slug}`)}>Open on Web <ExternalLink size={11} /></button>
      </div>

      <div className="explore-download-options">
        <div className="explore-download-options-head">
          <h3 className="explore-section-title"><Download size={14} /> Download Options</h3>
          <div className="explore-download-to">
            Download to <select className="explore-download-select" value={props.downloadTo} onChange={(e) => props.onDownloadToChange(e.target.value)}><option>This device</option><option>External</option></select>
          </div>
        </div>

        <div className="explore-download-card">
          {detailLoading ? <div className="explore-compat-loading"><Loader2 size={12} className="spin" /> Loading files…</div>
            : detailError ? <div className="explore-empty">{detailError}</div>
              : selectedModel.files.length === 0 ? <div className="explore-empty">No files</div>
                : (
                  <div className="explore-file-dropdown">
                    <button type="button" className="explore-file-dropdown-btn" onClick={() => setShowFileDropdown((v) => !v)} aria-expanded={showFileDropdown}>
                      <span className="explore-file-dropdown-format">{activeFile?.format ?? 'GGUF'}</span>
                      <span className="explore-file-dropdown-name">{activeFile ? `${selectedModel.name} · ${activeFile.quantization ?? activeFile.format} · ${formatBytes(activeFile.sizeBytes ?? activeFile.sizeGB * 1024 ** 3)}` : 'Select file'}</span>
                      <span className="explore-file-dropdown-recommended">Recommended</span>
                      <ChevronDown size={14} className={showFileDropdown ? 'rotated' : ''} />
                    </button>
                    {showFileDropdown ? (
                      <div className="explore-file-dropdown-list">
                        {selectedModel.files.map((file, i) => {
                          const installed = file.rfilename ? Boolean(props.libraryStatus[file.rfilename]) : false
                          const rec = props.recommendations?.find((r) => r.index === i)
                          const isRec = rec?.rank === 0 && rec.severity !== 'too-large'
                          return (
                            <button key={file.rfilename ?? i} type="button" className={`explore-file-option ${props.selectedFile === i ? 'explore-file-option--active' : ''}`} onClick={() => { props.onSelectFile(i); setShowFileDropdown(false) }}>
                              <span className="explore-file-option-format">{file.format}</span>
                              <span className="explore-file-option-name">{(file.rfilename ?? '').split('/').pop()}</span>
                              {file.quantization && <span className="explore-file-option-quant">{file.quantization}</span>}
                              <span className="explore-file-option-size">{formatBytes(file.sizeBytes ?? file.sizeGB * 1024 ** 3)}</span>
                              {isRec ? <span className="explore-file-option-rec">Recommended</span> : null}
                              {installed ? <FolderCheck size={11} className="explore-file-option-installed" /> : null}
                              {rec ? <span className={`explore-file-option-sev sev--${rec.severity}`} title={rec.reason} /> : null}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )}

          <div className="explore-offload-row">
            {props.compatLoading || props.recLoading ? <span className="explore-compat-loading"><Loader2 size={11} className="spin" /> Checking system…</span>
              : props.compatibility?.message.includes('Partial GPU Offload') ? <span className="explore-offload-badge"><HardDrive size={11} /> Partial GPU Offload Possible</span>
                : props.compatibility ? <><CompatibilityBadge result={props.compatibility} /><span className="explore-compat-msg">{props.compatibility.message}</span></>
                  : null}
          </div>

          <div className="explore-download-action">
            {(() => {
              if (!activeFile) return null
              if (isInstalled) return <div className="explore-installed-row"><FolderCheck size={14} /> Already in library</div>
              if (dl) {
                const isPaused = dl.state === 'paused'
                const isQueued = dl.state === 'queued'
                return (
                  <div className="explore-download-progress">
                    <div className="explore-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                      <div className="explore-download-progress-bar" style={{ width: `${pct ?? (isPaused || isQueued ? 0 : 8)}%` }} />
                    </div>
                    <span className="explore-download-progress-label">{isQueued ? 'Queued' : isPaused ? 'Paused' : `${pct ?? 0}%`}</span>
                    {!isQueued ? (isPaused ? <button type="button" className="explore-resume-btn" onClick={() => props.onResume(selectedModel, props.selectedFile)}><Play size={12} /> Resume Download {pct ?? 0}%</button> : <button type="button" className="explore-pause-btn" onClick={() => props.onPause(selectedModel.id, activeFile.rfilename as string)}><Pause size={12} /> Pause</button>) : null}
                    <button type="button" className="explore-cancel-btn" onClick={() => props.onCancelDownload(selectedModel.id, activeFile.rfilename as string)}><X size={12} /></button>
                  </div>
                )
              }
              // Not downloading — show Resume/Download button like reference
              const hasProgress = false // could check for .part existence via libraryStatus
              return (
                <button type="button" className="explore-primary-download-btn" disabled={!activeFile.downloadUrl} onClick={() => props.onDownload(selectedModel, props.selectedFile)}>
                  <Download size={14} /> Download {formatBytes(activeFile.sizeBytes ?? activeFile.sizeGB * 1024 ** 3)}
                </button>
              )
            })()}
          </div>
        </div>
      </div>

      <div className="explore-details-card">
        <h3 className="explore-card-title">Details</h3>
        <p className="explore-details-desc">{selectedModel.longDescription} Apache 2.0 licensed.</p>
        <div className="explore-details-grid">
          <div className="explore-details-row">
            <span className="explore-details-label">Parameters</span><span className="explore-details-pill">{selectedModel.parameters}</span>
            <span className="explore-details-label">Architecture</span><span className="explore-details-pill">{selectedModel.architecture}</span>
            <span className="explore-details-label">Formats</span>
            <span className="explore-details-pills">
              {[...new Set(selectedModel.files.map((f) => f.format))].map((fmt) => <span key={fmt} className="explore-details-pill">{fmt}</span>)}
              {[...new Set(selectedModel.files.map((f) => f.format))].length === 0 ? <span className="explore-details-pill">GGUF</span> : null}
            </span>
          </div>
          <div className="explore-details-row">
            <span className="explore-details-label">Capabilities</span>
            <span className="explore-details-pills">
              {selectedModel.capabilities.map((cap) => <span key={cap} className="explore-cap-pill"><Zap size={10} /> {cap}</span>)}
            </span>
          </div>
        </div>
        {props.hardware ? (
          <div className="explore-hw-footer">
            <HardDrive size={11} /> {props.hardware.gpuAvailable && props.hardware.totalVramMB ? `${props.hardware.gpuName} · ${(props.hardware.totalVramMB / 1024).toFixed(1)} GB VRAM` : 'CPU only'} · RAM {(props.hardware.totalRamMB / 1024).toFixed(1)} GB
            <span className={`explore-hw-badge ${props.hardware.gpuAvailable ? 'explore-hw-badge--gpu' : 'explore-hw-badge--cpu'}`}>{props.hardware.gpuAvailable ? 'VRAM' : 'RAM'}: Requires ~{(props.recommendations?.[0]?.estimatedRamGB ?? 0).toFixed(1)} GB</span>
          </div>
        ) : null}
      </div>

      <div className="explore-readme-card">
        <h3 className="explore-card-title">README</h3>
        {selectedModel.readme ? (
          <div className="explore-readme explore-readme--md" onClick={handleReadmeClick} dangerouslySetInnerHTML={{ __html: readmeHtml }} />
        ) : (
          <div className="explore-readme">
            <h4>{selectedModel.name}</h4>
            <p>{selectedModel.longDescription}</p>
          </div>
        )}
      </div>
    </div>
  )
}
