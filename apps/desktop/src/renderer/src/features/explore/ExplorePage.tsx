import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ArrowLeft, BadgeCheck, Brain, Check, ChevronDown, ChevronsUpDown, Download,
  ExternalLink, Eye, FileCode, Loader2, MessageSquare, RefreshCw, Search, Star,
  Wrench, X, Pause, Play,
} from 'lucide-react'
import {
  listExploreModels, getExploreModel, getModelCompatibility, getFileRecommendations,
  downloadModelFile, cancelModelDownload, pauseModelDownload, resumeModelDownload,
  onDownloadEvents, isDownloaded, getActiveDownloads, openExternal,
  type ExploreModel, type CompatibilityResult, type DownloadEventView, type FileRecommendationView,
} from '../../lib/ipc'

// ── Formatting (fresh, LM Studio labels) ─────────────────────────────
function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'size unknown'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / 1024 ** 2
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('en-US')
}
function fmtAgo(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return 'recently'
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} years ago`
}
function shortName(name: string, max = 34): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

// ── Minimal markdown (fresh) ─────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inlineMd(t: string): string {
  let s = esc(t)
  s = s.replace(/`([^`]+)`/g, '<code class="explorer-md-code">$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  return s
}
function renderReadme(md: string): string {
  const out: string[] = []
  const lines = md.split('\n')
  let bullets: string[] = []
  const flush = (): void => {
    if (bullets.length) { out.push(`<ul class="explorer-md-ul">${bullets.map((b) => `<li>${inlineMd(b)}</li>`).join('')}</ul>`); bullets = [] }
  }
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '')
    if (/^\s*[-*]\s+/.test(line)) { bullets.push(line.replace(/^\s*[-*]\s+/, '')); continue }
    flush()
    if (/^\s*$/.test(line)) continue
    const h = line.match(/^(#{1,4})\s+(.*)$/)
    if (h) { const lv = h[1].length; out.push(`<h${lv + 1} class="explorer-md-h${lv}">${inlineMd(h[2])}</h${lv + 1}>`); continue }
    out.push(`<p class="explorer-md-p">${inlineMd(line)}</p>`)
  }
  flush()
  return out.join('')
}

// ── Brand mark ───────────────────────────────────────────────────────
function ModelMark({ model, size = 40 }: { model: ExploreModel; size?: number }): ReactElement {
  const t = model.iconType
  const style: Record<string, { bg: string; fg: string; label: string }> = {
    qwen: { bg: '#7c3aed', fg: '#fff', label: 'Q' },
    google: { bg: '#ffffff', fg: '#4285f4', label: 'G' },
    meta: { bg: '#0668e1', fg: '#fff', label: 'M' },
    mistral: { bg: '#ff6f00', fg: '#fff', label: 'M' },
    microsoft: { bg: '#0f6cbd', fg: '#fff', label: 'B' },
    deepseek: { bg: '#4d6bfe', fg: '#fff', label: 'D' },
    hf: { bg: '#ff9d00', fg: '#fff', label: 'HF' },
  }
  const s = style[t] ?? style.hf
  const isWhite = s.bg === '#ffffff'
  return (
    <div
      className="explorer-mark"
      aria-hidden
      style={{
        width: size, height: size, fontSize: size <= 40 ? 15 : 22,
        background: s.bg, color: s.fg,
        border: isWhite ? '1px solid var(--border)' : 'none',
      }}
    >
      {t === 'google' ? <span style={{ fontWeight: 800 }}>G</span> : s.label}
    </div>
  )
}

function CapIcon({ cap }: { cap: string }): ReactElement | null {
  if (cap === 'Vision') return <Eye size={13} />
  if (cap === 'Tools') return <Wrench size={13} />
  if (cap === 'Reasoning') return <span className="explorer-cap-glyph" aria-hidden>Ⓘ</span>
  if (cap === 'Code') return <FileCode size={13} />
  if (cap === 'Chat' || cap === 'Text') return <MessageSquare size={13} />
  if (cap === 'Embeddings') return <Brain size={13} />
  return null
}

type FitKind = 'full' | 'partial' | 'cpu' | 'large'
function fitKind(c: CompatibilityResult | null): FitKind {
  if (!c) return 'large'
  if (c.severity === 'too-large') return 'large'
  if (c.message.toLowerCase().includes('partial')) return 'partial'
  if (c.message.toLowerCase().includes('cpu')) return 'cpu'
  return 'full'
}
function FitBadge({ result }: { result: CompatibilityResult | null }): ReactElement | null {
  if (!result) return null
  const k = fitKind(result)
  if (k === 'full') return <span className="explorer-fit explorer-fit--full"><span aria-hidden>🚀</span> Full GPU offload possible</span>
  if (k === 'partial') return <span className="explorer-fit explorer-fit--partial">▦ Partial GPU offload possible</span>
  if (k === 'cpu') return <span className="explorer-fit explorer-fit--cpu">✓ Likely fits on CPU</span>
  return <span className="explorer-fit explorer-fit--large"><X size={12} /> Likely too large</span>
}

// ── Sort options (LM Studio order) ───────────────────────────────────
const SORTS = [
  { value: 'Recommended', label: 'Recommended' },
  { value: 'trending', label: 'Trending' },
  { value: 'downloads', label: 'Most downloaded' },
  { value: 'likes', label: 'Most liked' },
  { value: 'lastModified', label: 'Recently updated' },
]

interface Props { onBack: () => void }

export function ExplorePage({ onBack }: Props): ReactElement {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sortBy, setSortBy] = useState('Recommended')
  const [sortOpen, setSortOpen] = useState(false)
  const [models, setModels] = useState<ExploreModel[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ExploreModel | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [compat, setCompat] = useState<CompatibilityResult | null>(null)
  const [recs, setRecs] = useState<FileRecommendationView[] | null>(null)
  const [fileIdx, setFileIdx] = useState(0)
  const [fileOpen, setFileOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [downloads, setDownloads] = useState<Record<string, DownloadEventView>>({})
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  const [installed, setInstalled] = useState<Record<string, boolean>>({})
  const [downloadTo, setDownloadTo] = useState('This device')
  const timer = useRef<number | null>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => models.find((m) => m.id === selectedId) ?? null,
    [models, selectedId],
  )
  const active = detail ?? selected

  // Debounce search like LM Studio (350ms)
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDebounced(query), 350)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [query])

  const reload = useCallback(async (q: string, s: string): Promise<void> => {
    setLoading(true); setError(null)
    try {
      const rows = await listExploreModels({ sortBy: s, query: q, limit: 30 })
      setModels(rows)
      if (rows.length > 0) setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0].id))
      else setSelectedId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load models.')
    } finally {
      setLoading(false); setSpinning(false)
    }
  }, [])

  useEffect(() => { void reload(debounced, sortBy) }, [debounced, sortBy, reload])

  // Detail + fit (LM Studio: per-file estimate, recommended preselected)
  useEffect(() => {
    if (!selected) { setDetail(null); return }
    let dead = false
    setDetailLoading(true); setCompat(null); setRecs(null); setFileIdx(0); setFileOpen(false)
    getExploreModel(selected.id)
      .then((d) => { if (!dead) setDetail(d) })
      .catch(() => { if (!dead) setDetail(null) })
      .finally(() => { if (!dead) setDetailLoading(false) })
    getModelCompatibility(selected.id).then((c) => { if (!dead) setCompat(c) }).catch(() => {})
    getFileRecommendations(selected.id)
      .then((r) => {
        if (dead) return
        setRecs(r)
        const best = r.find((x) => x.rank === 0)
        if (best && best.severity !== 'too-large') setFileIdx(best.index)
      })
      .catch(() => {})
    return () => { dead = true }
  }, [selected?.id])

  // Installed flags per file
  useEffect(() => {
    const m = detail ?? selected
    if (!m) return
    let dead = false
    void Promise.all(m.files.map(async (f) => {
      if (!f.rfilename) return
      try {
        const r = await isDownloaded(m.id, f.rfilename)
        if (!dead && r.downloaded) setInstalled((p) => ({ ...p, [f.rfilename as string]: true }))
      } catch { /* ignore */ }
    }))
    return () => { dead = true }
  }, [detail, selected])

  // Download events
  useEffect(() => {
    const dispose = onDownloadEvents((ev) => {
      setDownloads((prev) => {
        const next = { ...prev }
        const k = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'error' || ev.state === 'cancelled') delete next[k]
        else next[k] = ev
        return next
      })
      if (ev.state === 'done') setInstalled((p) => ({ ...p, [ev.rfilename]: true }))
    })
    void getActiveDownloads().catch(() => {})
    return dispose
  }, [])

  // Close popups on outside click / Escape
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
      if (fileRef.current && !fileRef.current.contains(e.target as Node)) setFileOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setSortOpen(false); setFileOpen(false); setDownloadsOpen(false) }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [])

  const activeFile = active?.files[fileIdx]
  const dlKey = active && activeFile?.rfilename ? `${active.id}\n${activeFile.rfilename}` : null
  const dl = dlKey ? downloads[dlKey] : undefined
  const pct = dl && dl.totalBytes ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : null
  const isInstalled = activeFile?.rfilename ? Boolean(installed[activeFile.rfilename]) : false
  const readmeHtml = useMemo(() => (active?.readme ? renderReadme(active.readme) : ''), [active?.readme])
  const dlCount = Object.keys(downloads).length

  const doDownload = useCallback(async (): Promise<void> => {
    if (!active || !activeFile?.downloadUrl || !activeFile.rfilename) return
    try { await downloadModelFile(active.id, activeFile.rfilename, activeFile.downloadUrl) } catch { /* toast-less */ }
  }, [active, activeFile])

  const refresh = useCallback((): void => {
    setSpinning(true)
    void reload(debounced, sortBy)
  }, [debounced, sortBy, reload])

  return (
    <div className="explorer">
      {/* Top bar: < > Explore ····· Downloads N */}
      <header className="explorer-topbar">
        <div className="explorer-topbar-left">
          <button type="button" className="explorer-navarrow" aria-label="Back" onClick={onBack}><ArrowLeft size={15} /></button>
          <button type="button" className="explorer-navarrow explorer-navarrow--dim" aria-label="Forward" disabled><ArrowLeft size={15} style={{ transform: 'rotate(180deg)' }} /></button>
          <h1 className="explorer-title">Explore</h1>
        </div>
        <div className="explorer-topbar-right">
          <button
            type="button" className="explorer-downloads-btn"
            aria-expanded={downloadsOpen} onClick={() => setDownloadsOpen((v) => !v)}
          >
            <Download size={14} /> Downloads {dlCount > 0 ? <span className="explorer-downloads-count">{dlCount}</span> : null}
          </button>
        </div>
        {downloadsOpen ? (
          <div className="explorer-downloads-pop" role="region" aria-label="Downloads">
            {dlCount === 0
              ? <div className="explorer-downloads-empty">No active downloads.</div>
              : Object.values(downloads).map((ev) => {
                const p = ev.totalBytes ? Math.min(100, Math.round((ev.receivedBytes / ev.totalBytes) * 100)) : 0
                return (
                  <div key={`${ev.modelId}\n${ev.rfilename}`} className="explorer-dl-row">
                    <div className="explorer-dl-info">
                      <div className="explorer-dl-name">{(ev.rfilename ?? '').split('/').pop()}</div>
                      <div className="explorer-dl-meta">{ev.state} · {p}% · {fmtSize(ev.receivedBytes)}</div>
                      <div className="explorer-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}>
                        <span className="explorer-progress-fill" style={{ width: `${p}%` }} />
                      </div>
                    </div>
                    <div className="explorer-dl-actions">
                      {ev.state === 'paused'
                        ? <button type="button" aria-label="Resume" onClick={() => void resumeModelDownload(ev.modelId, ev.rfilename, '')}><Play size={13} /></button>
                        : <button type="button" aria-label="Pause" onClick={() => void pauseModelDownload(ev.modelId, ev.rfilename)}><Pause size={13} /></button>}
                      <button type="button" aria-label="Cancel" onClick={() => void cancelModelDownload(ev.modelId, ev.rfilename)}><X size={13} /></button>
                    </div>
                  </div>
                )
              })}
          </div>
        ) : null}
      </header>

      <div className="explorer-body">
        {/* Left: search + staff picks + list */}
        <aside className="explorer-listcol" aria-label="Model list">
          <div className="explorer-searchwrap">
            <Search size={15} className="explorer-search-icon" />
            <input
              className="explorer-search" type="text" value={query}
              placeholder="Search Hugging Face and staff picks"
              aria-label="Search Hugging Face and staff picks"
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? <button type="button" className="explorer-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={13} /></button> : null}
          </div>

          <div className="explorer-listhead">
            <button type="button" className="explorer-staff" onClick={refresh} title="Refresh staff picks">
              Staff picks <RefreshCw size={12} className={spinning ? 'explorer-spin' : ''} />
            </button>
            <div className="explorer-sort" ref={sortRef}>
              <button
                type="button" className="explorer-sort-btn"
                aria-haspopup="listbox" aria-expanded={sortOpen}
                onClick={() => setSortOpen((v) => !v)}
              >
                {SORTS.find((s) => s.value === sortBy)?.label ?? 'Recommended'}
                <ChevronsUpDown size={13} className={`explorer-sort-chev ${sortOpen ? 'open' : ''}`} />
              </button>
              {sortOpen ? (
                <div className="explorer-sort-menu" role="listbox">
                  {SORTS.map((o) => (
                    <button
                      key={o.value} type="button" role="option" aria-selected={sortBy === o.value}
                      className={`explorer-sort-item ${sortBy === o.value ? 'active' : ''}`}
                      onClick={() => { setSortBy(o.value); setSortOpen(false) }}
                    >
                      {o.label} {sortBy === o.value ? <Check size={12} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="explorer-list" role="listbox" aria-label="Models">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="explorer-skel" style={{ ['--i' as string]: i }}>
                  <div className="explorer-skel-icon" />
                  <div className="explorer-skel-lines"><span /><span className="short" /></div>
                </div>
              ))
            ) : error ? (
              <div className="explorer-empty">{error}<button type="button" className="explorer-retry" onClick={refresh}>Retry</button></div>
            ) : models.length === 0 ? (
              <div className="explorer-empty">No text, vision, tools, code or thinking models found.</div>
            ) : (
              models.map((m, i) => {
                const isActive = m.id === selectedId
                const caps = m.capabilities.filter((c) => ['Vision', 'Tools', 'Reasoning', 'Code'].includes(c)).slice(0, 3)
                return (
                  <button
                    key={m.id} type="button" role="option" aria-selected={isActive}
                    className={`explorer-row ${isActive ? 'active' : ''}`}
                    style={{ ['--i' as string]: Math.min(i, 10) }}
                    onClick={() => setSelectedId(m.id)}
                  >
                    <ModelMark model={m} />
                    <span className="explorer-row-main">
                      <span className="explorer-row-titlerow">
                        <span className="explorer-row-title">{shortName(m.name, 30)}</span>
                        <BadgeCheck size={14} className="explorer-verified" />
                      </span>
                      <span className="explorer-row-desc">{shortName(m.longDescription || m.description, 52)}</span>
                      <span className="explorer-row-time">{fmtAgo(m.updatedAt)}</span>
                    </span>
                    <span className="explorer-row-caps" aria-hidden>
                      {caps.length > 0 ? caps.map((c) => <span key={c} className="explorer-row-cap"><CapIcon cap={c} /></span>) : null}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* Right: detail */}
        <section className="explorer-detail" aria-label="Model details">
          {!active ? (
            <div className="explorer-detail-empty">Select a model to see download options.</div>
          ) : (
            <div className="explorer-detail-inner" key={active.id}>
              <div className="explorer-detail-head">
                <ModelMark model={active} size={56} />
                <div className="explorer-detail-titles">
                  <h2 className="explorer-detail-name">{active.name}</h2>
                  <div className="explorer-detail-slug">{active.slug}</div>
                </div>
              </div>

              <div className="explorer-stats">
                <span className="explorer-stat"><Download size={13} /> {fmtCount(active.downloads)}</span>
                <span className="explorer-stat"><Star size={13} /> {fmtCount(active.likes)}</span>
                {active.staffPick ? <span className="explorer-stat"><BadgeCheck size={13} /> Staff Pick</span> : null}
                <span className="explorer-stat explorer-stat--plain">Updated {fmtAgo(active.updatedAt)}</span>
                <button
                  type="button" className="explorer-openweb"
                  onClick={() => void openExternal(`https://huggingface.co/${active.slug}`).catch(() => window.open(`https://huggingface.co/${active.slug}`, '_blank'))}
                >
                  Open on Web <ExternalLink size={12} />
                </button>
              </div>

              {/* Download Options — LM Studio fit badge + file dropdown + Download */}
              <h3 className="explorer-section-title">Download Options
                <span className="explorer-dlto">Download to
                  <button type="button" className="explorer-dlto-btn" onClick={() => setDownloadTo((v) => (v === 'This device' ? 'External' : 'This device'))}>
                    {downloadTo} <ChevronDown size={12} />
                  </button>
                </span>
              </h3>
              <div className="explorer-card">
                {detailLoading ? (
                  <div className="explorer-loading"><Loader2 size={13} className="explorer-spin" /> Loading files…</div>
                ) : active.files.length === 0 ? (
                  <div className="explorer-empty">No GGUF/MLX files published for this model.</div>
                ) : (
                  <div className="explorer-filewrap" ref={fileRef}>
                    <button
                      type="button" className="explorer-filebtn"
                      aria-expanded={fileOpen} onClick={() => setFileOpen((v) => !v)}
                    >
                      <span className="explorer-format-pill">{activeFile?.format ?? 'GGUF'}</span>
                      <span className="explorer-file-name">{shortName(activeFile?.rfilename?.split('/').pop() ?? active.name, 34)}</span>
                      {activeFile?.quantization ? <span className="explorer-quant-pill">{activeFile.quantization}</span> : null}
                      <span className="explorer-file-size">{fmtSize(activeFile?.sizeBytes ?? 0)}</span>
                      {recs?.find((r) => r.index === fileIdx && r.rank === 0) ? <span className="explorer-rec-pill">Recommended</span> : null}
                      <ChevronDown size={14} className={`explorer-file-chev ${fileOpen ? 'open' : ''}`} />
                    </button>
                    {fileOpen ? (
                      <div className="explorer-filemenu" role="listbox">
                        {active.files.map((f, i) => (
                          <button
                            key={f.rfilename ?? i} type="button" role="option" aria-selected={i === fileIdx}
                            className={`explorer-fileitem ${i === fileIdx ? 'active' : ''}`}
                            onClick={() => { setFileIdx(i); setFileOpen(false) }}
                          >
                            <span className="explorer-format-pill">{f.format}</span>
                            <span className="explorer-file-name">{shortName((f.rfilename ?? '').split('/').pop() || f.format, 30)}</span>
                            <span className="explorer-file-size">{fmtSize(f.sizeBytes ?? 0)}</span>
                            {installed[f.rfilename ?? ''] ? <Check size={12} className="explorer-file-check" /> : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
                <div className="explorer-fitrow"><FitBadge result={compat} /></div>
                <div className="explorer-downloaderow">
                  {isInstalled ? (
                    <div className="explorer-installed">✓ Already in library</div>
                  ) : dl ? (
                    <div className="explorer-progress-row">
                      <div className="explorer-progress explorer-progress--big" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                        <span className="explorer-progress-fill" style={{ width: `${pct ?? 4}%` }} />
                      </div>
                      <span className="explorer-progress-label">{dl.state === 'paused' ? 'Paused' : `${pct ?? 0}%`}</span>
                      {dl.state === 'paused'
                        ? <button type="button" className="explorer-mini-btn" onClick={() => activeFile?.rfilename && void resumeModelDownload(active.id, activeFile.rfilename, activeFile.downloadUrl ?? '')}><Play size={12} /> Resume</button>
                        : <button type="button" className="explorer-mini-btn" onClick={() => activeFile?.rfilename && void pauseModelDownload(active.id, activeFile.rfilename)}><Pause size={12} /> Pause</button>}
                      <button type="button" className="explorer-mini-btn explorer-mini-btn--danger" aria-label="Cancel download" onClick={() => activeFile?.rfilename && void cancelModelDownload(active.id, activeFile.rfilename)}><X size={12} /></button>
                    </div>
                  ) : (
                    <button type="button" className="explorer-download-btn" disabled={!activeFile?.downloadUrl} onClick={doDownload}>
                      <Download size={15} /> Download <span className="explorer-download-size">{fmtSize(activeFile?.sizeBytes ?? 0)}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Details */}
              <h3 className="explorer-section-title">Details</h3>
              <div className="explorer-card">
                <p className="explorer-details-desc">{active.longDescription}</p>
                <div className="explorer-meta">
                  <span className="explorer-meta-label">Parameters</span>
                  <span className="explorer-pill">{active.parameters}</span>
                  <span className="explorer-meta-label">Architecture</span>
                  <span className="explorer-pill">{active.architecture}</span>
                  <span className="explorer-meta-label">Formats</span>
                  <span className="explorer-pill-group">
                    {[...new Set(active.files.map((f) => f.format))].map((f) => <span key={f} className="explorer-pill">{f}</span>)}
                  </span>
                </div>
                <div className="explorer-meta">
                  <span className="explorer-meta-label">Capabilities</span>
                  <span className="explorer-pill-group">
                    {active.capabilities.map((c) => <span key={c} className="explorer-cap"><CapIcon cap={c} /> {c}</span>)}
                  </span>
                </div>
              </div>

              {/* README */}
              <h3 className="explorer-section-title explorer-section-title--upper">README</h3>
              <div className="explorer-card explorer-readme">
                {readmeHtml
                  ? <div className="explorer-md" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
                  : <div className="explorer-md"><h2 className="explorer-md-h1">{active.name}</h2><p className="explorer-md-p">{active.longDescription}</p></div>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
