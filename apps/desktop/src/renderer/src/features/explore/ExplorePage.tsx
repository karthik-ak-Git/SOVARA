import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ArrowLeft, BadgeCheck, Brain, Check, ChevronDown, ChevronsUpDown, Download,
  ExternalLink, Eye, FileCode, FolderOpen, Loader2, MessageSquare, RefreshCw, Search, Star,
  Wrench, X, Pause, Play,
} from 'lucide-react'
import {
  listExploreModelsPage, getExploreModel, getModelCompatibility, getFileRecommendations,
  downloadModelFile, cancelModelDownload, pauseModelDownload, resumeModelDownload,
  onDownloadEvents, getModelFileStatus, reconcileLibrary, openModelFolder,
  getActiveDownloads, getHardwareProfile, openExternal,
  type ExploreListOpts, type ExploreModel, type CompatibilityResult, type DownloadEventView,
  type FileRecommendationView, type ModelFileStatus, type ExploreFormatFilter,
  type HardwareInfo,
} from '@/lib/client/api'
import type { ExplorerFitTier } from '@shared/types/explore'

// ── Format-aware repo view (files are the source of truth) ──────────
// Present formats from the repo inventory (+ GGUF download rows): a
// Safetensors-only repo shows [Safetensors] with NO GGUF button; mixed
// repos show each format actually present.
function presentFormats(m: ExploreModel): Array<'gguf' | 'safetensors' | 'other'> {
  const set = new Set<'gguf' | 'safetensors' | 'other'>()
  for (const f of m.repoFiles ?? []) set.add(f.format)
  for (const f of m.files) {
    const t = (f.format ?? '').toLowerCase()
    if (t === 'gguf') set.add('gguf')
    else if (t.includes('safetensor')) set.add('safetensors')
  }
  if (m.format === 'gguf') set.add('gguf')
  else if (m.format === 'safetensors') set.add('safetensors')
  else if (m.format === 'other') set.add('other')
  else if (m.format === 'mixed' && set.size === 0) { set.add('gguf'); set.add('safetensors') }
  return (['gguf', 'safetensors', 'other'] as const).filter((x) => set.has(x))
}
const FORMAT_LABEL: Record<string, string> = { gguf: 'GGUF', safetensors: 'Safetensors', other: 'Other weights' }

const FORMAT_FILTERS: Array<{ value: ExploreFormatFilter; label: string }> = [
  { value: 'all', label: 'All formats' },
  { value: 'gguf', label: 'GGUF' },
  { value: 'safetensors', label: 'Safetensors' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'other', label: 'Other' },
]

// ── Extended list filters (all enforced together in main; see matchesAllFilters) ──
const QUANT_FILTERS = ['all', 'Q2_K', 'Q3_K_S', 'Q3_K_M', 'Q4_0', 'Q4_K_S', 'Q4_K_M', 'Q5_0', 'Q5_K_S', 'Q5_K_M', 'Q6_K', 'Q8_0', 'F16', 'F32', 'Other'] as const
const PARAM_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Any size' },
  { value: 'lt3', label: '< 3B' },
  { value: 'b3to7', label: '3B–7B' },
  { value: 'b7to14', label: '7B–14B' },
  { value: 'b14to32', label: '14B–32B' },
  { value: 'b32to70', label: '32B–70B' },
  { value: 'gt70', label: '70B+' },
]
const LICENSE_FILTERS = ['all', 'Apache-2.0', 'MIT', 'Llama', 'Other', 'Unknown'] as const
const CAP_FILTERS = ['all', 'Vision', 'Tools', 'Reasoning', 'Code', 'Text', 'Chat', 'Embeddings'] as const
const GATED_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Any access' },
  { value: 'accessible', label: 'Accessible' },
  { value: 'gated', label: 'Gated' },
]
const DOWNLOADED_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Any status' },
  { value: 'downloaded', label: 'Downloaded' },
  { value: 'available', label: 'Available' },
]
const COMPAT_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Any fit' },
  { value: 'likely', label: '✓ Likely compatible' },
  { value: 'possible', label: '◐ Possibly compatible' },
  { value: 'unlikely', label: '✕ Unlikely' },
  { value: 'unknown', label: '? Unknown fit' },
]

interface PersistedExplorerFilters {
  query: string
  sortBy: string
  format: ExploreFormatFilter
  quant: string
  params: string
  license: string
  capability: string
  gated: string
  downloaded: string
  compat: string
}
const DEFAULT_FILTERS: PersistedExplorerFilters = {
  query: '', sortBy: 'Recommended', format: 'all', quant: 'all', params: 'all',
  license: 'all', capability: 'all', gated: 'all', downloaded: 'all', compat: 'all',
}
// Module-level so filter state survives navigation away and back (the page
// unmounts on section switch; this is page-UI state, not a new store).
const persistedExplorerFilters: PersistedExplorerFilters = { ...DEFAULT_FILTERS }

interface FilterOption { value: string; label: string; count?: number; disabled?: boolean }

/** Self-closing dropdown menu reusing the explorer sort-menu styles. */
function FilterMenu({ label, ariaLabel, value, options, onChange }: {
  label: string
  ariaLabel: string
  value: string
  options: FilterOption[]
  onChange: (value: string) => void
}): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open ])
  return (
    <div className="explorer-sort" ref={ref}>
      <button
        type="button" className="explorer-sort-btn"
        aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronsUpDown size={13} className={`explorer-sort-chev ${open ? 'open' : ''}`} />
      </button>
      {open ? (
        <div className="explorer-sort-menu explorer-sort-menu--left" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button
              key={o.value} type="button" role="option" aria-selected={value === o.value}
              className={`explorer-sort-item ${value === o.value ? 'active' : ''}`}
              disabled={o.disabled}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              {o.label}
              {typeof o.count === 'number' ? <span className="explorer-filter-count">{o.count}</span> : null}
              {value === o.value ? <Check size={12} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const FIT_DOT: Record<ExplorerFitTier, { label: string; cls: string }> = {
  likely: { label: 'Estimated fit: likely compatible', cls: 'explorer-fitdot--likely' },
  possible: { label: 'Estimated fit: possibly compatible', cls: 'explorer-fitdot--possible' },
  unlikely: { label: 'Estimated fit: unlikely to fit', cls: 'explorer-fitdot--unlikely' },
  unknown: { label: 'Fit unknown', cls: 'explorer-fitdot--unknown' },
}

/** Memoized list row: selection/download events must not rerender every row. */
const ModelRow = memo(function ModelRow({ model, isActive, index, onSelect }: {
  model: ExploreModel
  isActive: boolean
  index: number
  onSelect: (id: string) => void
}): ReactElement {
  // Row shows distinctive caps only; Text is the implied baseline
  // and is shown only when a model has no distinctive capability.
  const distinctive = sortCaps(model.capabilities.filter((c) => ['Vision', 'Tools', 'Reasoning', 'Code'].includes(c)))
  const caps = (distinctive.length > 0 ? distinctive : sortCaps(model.capabilities.filter((c) => c === 'Text' || c === 'Chat')).slice(0, 1)).slice(0, 3)
  const fit = model.fitTier ? FIT_DOT[model.fitTier] : null
  return (
    <button
      type="button" role="option" aria-selected={isActive}
      className={`explorer-row ${isActive ? 'active' : ''}`}
      style={{ ['--i' as string]: Math.min(index, 10) }}
      onClick={() => onSelect(model.id)}
    >
      <ModelMark model={model} />
      <span className="explorer-row-main">
        <span className="explorer-row-titlerow">
          <span className="explorer-row-title">{shortName(model.name, 30)}</span>
          {fit ? <span className={`explorer-fitdot ${fit.cls}`} title={fit.label} aria-label={fit.label} /> : null}
        </span>
        <span className="explorer-row-desc">{shortName(model.longDescription || model.description, 52)}</span>
        <span className="explorer-row-time">{fmtAgo(model.updatedAt)}</span>
      </span>
      <span className="explorer-row-caps">
        {caps.length > 0 ? caps.map((c) => <span key={c} className="explorer-row-cap" title={CAP_HINT[c] ?? c}><CapIcon cap={c} /></span>) : null}
      </span>
    </button>
  )
})

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
function fmtSpeed(bps: number | undefined): string | null {
  if (!bps || !Number.isFinite(bps) || bps <= 0) return null
  const mb = bps / 1024 ** 2
  if (mb >= 1) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB/s`
  return `${Math.max(1, Math.round(bps / 1024))} KB/s`
}
function fmtEta(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null
  if (seconds < 5) return 'a few seconds'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
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

// ── README viewer: full-ish markdown (fresh) ─────────────────────────
// Blocks: fenced code (+copy), tables, headings, quotes, hr, ul/ol,
// paragraphs. Inline: images, links, bold, italic, strike, code.
// Relative image/asset URLs resolve against the HF repo so provider
// images and diagrams load instead of 404ing.
interface ReadmeDoc { html: string; code: string[] }
export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
export function resolveAsset(src: string, modelSlug: string): string {
  const s = src.trim()
  if (/^(https?:|data:|blob:)/i.test(s)) return s
  if (s.startsWith('/')) return `https://huggingface.co${s}`
  return `https://huggingface.co/${modelSlug}/resolve/main/${s.replace(/^\.\//, '')}`
}
// ── Literal HTML inside model cards (Gemma-style READMEs mix <div>/<img>/<a>/
// into markdown). Everything is escaped first; only this safe whitelist is
// restored — script/iframe/form/event-handlers/javascript: URLs stay escaped.
const HTML_PHRASING = new Set(['a', 'img', 'b', 'strong', 'i', 'em', 'code', 'br', 'span'])
const HTML_BLOCK = new Set(['div', 'p', 'details', 'summary', 'ul', 'ol', 'li', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'])
const HTML_VOID = new Set(['img', 'br', 'hr'])

function unescEntities(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}
function htmlAttr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+)`, 'i'))
  if (!m) return null
  let v = m[1]
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  return unescEntities(v)
}
export function restoreHtmlTags(s: string, modelSlug: string): string {
  return s.replace(/&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)\b((?:(?!&gt;).)*)&gt;/g, (full, close: string, rawName: string, rawAttrs: string) => {
    const name = rawName.toLowerCase()
    if (!HTML_PHRASING.has(name) && !HTML_BLOCK.has(name)) return full // keep escaped
    const attrs = unescEntities(rawAttrs)
    if (close) {
      if (HTML_VOID.has(name)) return ''
      return `</${name}>`
    }
    if (name === 'a') {
      const href = htmlAttr(attrs, 'href')
      if (!href || /^(javascript|data|vbscript|file):/i.test(href.trim())) return full
      const abs = /^https?:\/\//i.test(href)
        ? href
        : href.startsWith('/') ? `https://huggingface.co${href}` : `https://huggingface.co/${modelSlug}/blob/main/${href.replace(/^\.\//, '')}`
      if (!/^https?:\/\//i.test(abs)) return full
      return `<a href="${escHtml(abs)}" data-ext="1" class="explorer-md-link">`
    }
    if (name === 'img') {
      const src = htmlAttr(attrs, 'src')
      if (!src) return ''
      return `<img class="explorer-md-img" alt="${escHtml(htmlAttr(attrs, 'alt') ?? '')}" src="${escHtml(resolveAsset(src, modelSlug))}" loading="lazy" />`
    }
    if (name === 'div' || name === 'p') {
      const align = (htmlAttr(attrs, 'align') ?? '').toLowerCase()
      return ['center', 'left', 'right', 'justify'].includes(align) ? `<${name} align="${align}">` : `<${name}>`
    }
    if (name === 'br' || name === 'hr') return name === 'hr' ? '<hr class="explorer-md-hr"/>' : '<br/>'
    if (name === 'code') return '<code class="explorer-md-code">'
    // Structural table attributes survive (colspan/rowspan/align); every
    // presentational attribute (class/style/id/...) is dropped like HF.
    if (name === 'td' || name === 'th') {
      let extra = ''
      const cs = htmlAttr(attrs, 'colspan')
      const rs = htmlAttr(attrs, 'rowspan')
      if (cs && /^\d+$/.test(cs) && Number(cs) > 1 && Number(cs) <= 20) extra += ` colspan="${cs}"`
      if (rs && /^\d+$/.test(rs) && Number(rs) > 1 && Number(rs) <= 20) extra += ` rowspan="${rs}"`
      const align = (htmlAttr(attrs, 'align') ?? '').toLowerCase()
      if (['left', 'center', 'right', 'justify'].includes(align)) extra += ` align="${align}"`
      return `<${name}${extra}>`
    }
    return `<${name}>`
  })
}

/** Sanitize a raw HTML block (already-escaped chunk): tags restored, text
 *  segments get inline markdown — inner lines are never <p>-wrapped. */
function sanitizeHtmlBlock(chunk: string, modelSlug: string): string {
  return chunk
    .split(/(&lt;\/?[a-zA-Z][a-zA-Z0-9]*\b(?:(?!&gt;).)*&gt;)/g)
    .map((tok, idx) => (idx % 2 === 1 ? restoreHtmlTags(tok, modelSlug) : inlineCore(tok, modelSlug)))
    .join('')
}

function inlineCore(escaped: string, modelSlug: string): string {
  // Pull `code` spans aside so inner * _ ~ [ ] are not formatted.
  const stash: string[] = []
  let s = escaped
  s = s.replace(/`([^`\n]+)`/g, (_m, c: string) => {
    stash.push(`<code class="explorer-md-code">${c}</code>`)
    return `ZZCODE${stash.length - 1}CODEZZ`
  })
  // Restore whitelisted literal HTML next so markdown formatting applies
  // uniformly (autolink stays safe: restored hrefs are quote-prefixed).
  s = restoreHtmlTags(s, modelSlug)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, src: string) =>
    `<img class="explorer-md-img" alt="${alt}" src="${resolveAsset(src, modelSlug)}" loading="lazy" />`)
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2" data-ext="1" class="explorer-md-link">$1</a>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" data-ext="1" class="explorer-md-link">$2</a>')
  s = s.replace(/ZZCODE(\d+)CODEZZ/g, (_m, i: string) => stash[Number(i)] ?? '')
  return s
}
function inlineReadme(t: string, modelSlug: string): string {
  return inlineCore(escHtml(t), modelSlug)
}

// Block-level HTML containers: consumed to their matching close tag (depth
// counted) and emitted as one sanitized unit — HF/CommonMark html-block
// behavior, so table cell text is never wrapped in <p>.
const HTML_CONTAINER = new Set(['table', 'div', 'details', 'figure', 'section', 'article', 'aside', 'header', 'footer', 'blockquote', 'pre', 'ul', 'ol', 'dl'])
function tagOpenCount(line: string, tag: string): number {
  const m = line.match(new RegExp(`<${tag}(?=[\\s>/])`, 'gi'))
  return m ? m.length : 0
}
function tagCloseCount(line: string, tag: string): number {
  const m = line.match(new RegExp(`</${tag}\\s*>`, 'gi'))
  return m ? m.length : 0
}

export function renderReadmeDoc(md: string, modelSlug: string): ReadmeDoc {
  const code: string[] = []
  const out: string[] = []
  // HF strips <style>/<script> server-side: drop whole spans (even unclosed)
  // so CSS text never leaks into the card like in the bug report.
  const clean = md
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(style|script)\b[^>]*>[\s\S]*$/gi, '')
  const lines = clean.split('\n')
  let ul: string[] = []
  let ol: string[] = []
  let quote: string[] = []
  const flushLists = (): void => {
    if (ul.length) { out.push(`<ul class="explorer-md-ul">${ul.map((b) => `<li>${inlineReadme(b, modelSlug)}</li>`).join('')}</ul>`); ul = [] }
    if (ol.length) { out.push(`<ol class="explorer-md-ol">${ol.map((b) => `<li>${inlineReadme(b, modelSlug)}</li>`).join('')}</ol>`); ol = [] }
    if (quote.length) { out.push(`<blockquote class="explorer-md-quote">${quote.map((b) => inlineReadme(b, modelSlug)).join('<br/>')}</blockquote>`); quote = [] }
  }
  const isTableDelim = (l: string): boolean => /^\s*\|?[\s\-:|]+\|[\s\-:|]*$/.test(l) && l.includes('-')
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '')
    // Fenced code
    const fence = raw.match(/^```\s*([\w+-]*)\s*$/)
    if (fence) {
      flushLists()
      const lang = (fence[1] || 'code').slice(0, 24)
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i].replace(/\r$/, '')); i += 1 }
      const body = buf.join('\n')
      const idx = code.length
      code.push(body)
      out.push(
        `<div class="explorer-codeblock"><div class="explorer-codeblock-bar"><span>${escHtml(lang)}</span>` +
        `<button type="button" data-copy-idx="${idx}" class="explorer-copy-btn">Copy</button></div>` +
        `<pre class="explorer-codeblock-pre"><code>${escHtml(body) || ' '}</code></pre></div>`,
      )
      continue
    }
    // HTML container blocks (<table> … </table>, <div> … </div>): consume to
    // the matching close tag and emit one sanitized unit — inner lines are
    // never markdown-paragraph-wrapped (HF/CommonMark html-block behavior).
    const container = raw.match(/^\s*<([a-zA-Z][a-zA-Z0-9]*)\b/)
    if (container && HTML_CONTAINER.has(container[1].toLowerCase())) {
      const tag = container[1].toLowerCase()
      flushLists()
      const buf = [raw]
      let depth = tagOpenCount(raw, tag) - tagCloseCount(raw, tag)
      // Cap: a never-closed tag must not swallow the rest of the document.
      while (depth > 0 && i + 1 < lines.length && buf.length < 150) {
        i += 1
        const l = lines[i].replace(/\r$/, '')
        buf.push(l)
        depth += tagOpenCount(l, tag) - tagCloseCount(l, tag)
      }
      const blockHtml = sanitizeHtmlBlock(escHtml(buf.join('\n')), modelSlug)
      // Wide benchmark tables scroll horizontally like HF's card layout.
      out.push(tag === 'table' ? `<div class="explorer-md-tablewrap">${blockHtml}</div>` : blockHtml)
      continue
    }
    // Standalone HTML tag-only lines (<br>, <img …>) pass through sanitized
    // instead of being wrapped in <p> or shown escaped.
    if (/^\s*(?:<\/?[a-zA-Z][^<>]*>\s*)+$/.test(raw)) {
      flushLists()
      out.push(restoreHtmlTags(escHtml(raw.trim()), modelSlug))
      continue
    }
    // Table (header + delimiter + rows)
    if (raw.includes('|') && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
      flushLists()
      const cells = (l: string): string[] => l.split('|').map((c) => c.trim()).filter((c, k, a) => !(k === 0 && c === '') && !(k === a.length - 1 && c === ''))
      const head = cells(raw)
      i += 1 // skip delimiter
      const rows: string[][] = []
      while (i + 1 < lines.length && lines[i + 1].includes('|') && !isTableDelim(lines[i + 1]) && lines[i + 1].trim() !== '') {
        i += 1
        rows.push(cells(lines[i]))
      }
      const headHtml = head.map((c) => '<th>' + inlineReadme(c, modelSlug) + '</th>').join('')
      const bodyHtml = rows.map((r) => '<tr>' + r.map((c) => '<td>' + inlineReadme(c, modelSlug) + '</td>').join('') + '</tr>').join('')
      out.push(
        '<div class="explorer-md-tablewrap"><table class="explorer-md-table"><thead><tr>' +
        headHtml +
        '</tr></thead><tbody>' +
        bodyHtml +
        '</tbody></table></div>',
      )
      continue
    }
    if (/^\s*([-*+])\s+/.test(raw)) { ol = []; quote = []; ul.push(raw.replace(/^\s*[-*+]\s+/, '')); continue }
    if (/^\s*\d+[.)]\s+/.test(raw)) { ul = []; quote = []; ol.push(raw.replace(/^\s*\d+[.)]\s+/, '')); continue }
    if (/^\s*>\s?/.test(raw)) { ul = []; ol = []; quote.push(raw.replace(/^\s*>\s?/, '')); continue }
    flushLists()
    if (/^\s*$/.test(raw)) continue
    if (/^---+$/.test(raw.trim())) { out.push('<hr class="explorer-md-hr"/>'); continue }
    const h = raw.match(/^(#{1,6})\s+(.*)$/)
    if (h) { const lv = Math.min(h[1].length, 4); out.push(`<h${lv + 1} class="explorer-md-h${lv}">${inlineReadme(h[2], modelSlug)}</h${lv + 1}>`); continue }
    out.push(`<p class="explorer-md-p">${inlineReadme(raw, modelSlug)}</p>`)
  }
  flushLists()
  return { html: out.join(''), code }
}

function ReadmeViewer({ markdown, modelSlug, onOpenLink }: {
  markdown: string
  modelSlug: string
  onOpenLink: (url: string) => void
}): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const doc = useMemo(() => renderReadmeDoc(markdown, modelSlug), [markdown, modelSlug])
  const codeRef = useRef<string[]>(doc.code)
  codeRef.current = doc.code
  const long = markdown.split('\n').length > 45 || doc.html.length > 6000

  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement
    const copyBtn = el.closest('[data-copy-idx]') as HTMLElement | null
    if (copyBtn) {
      const idx = Number(copyBtn.getAttribute('data-copy-idx'))
      const text = codeRef.current[idx] ?? ''
      const done = (): void => {
        setCopied(idx)
        window.setTimeout(() => setCopied((c) => (c === idx ? null : c)), 1400)
      }
      if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done).catch(done)
      else done()
      return
    }
    const anchor = el.closest('a[data-ext="1"]') as HTMLAnchorElement | null
    if (anchor?.href) { e.preventDefault(); onOpenLink(anchor.href) }
  }, [onOpenLink])

  const onImgError = useCallback((e: React.SyntheticEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (t instanceof HTMLImageElement) t.style.display = 'none'
  }, [])

  return (
    <div className={`explorer-readme-view ${expanded ? 'expanded' : ''}`}>
      <div
        className={`explorer-md ${long && !expanded ? 'clamped' : ''}`}
        onClick={onClick}
        onErrorCapture={onImgError}
        dangerouslySetInnerHTML={{ __html: doc.html }}
      />
      {copied !== null ? <span className="sr-only" role="status">Code copied</span> : null}
      {long ? (
        <button type="button" className="explorer-readme-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  )
}

// ── Provider avatar: real brand logo via SimpleIcons CDN (CSP-allowed),
// HF org avatar attempt, letter mark fallback — mirrors SettingsPage McpLogo.
function brandSlugFor(model: ExploreModel): string | null {
  const a = (model.author || '').toLowerCase()
  if (a.includes('google') || a.includes('gemma')) return 'google'
  if (a.includes('meta') || a.includes('llama')) return 'meta'
  if (a.includes('microsoft') || a.includes('phi')) return 'microsoft'
  if (a.includes('mistral') || a.includes('mixtral')) return 'mistralai'
  if (a.includes('nvidia')) return 'nvidia'
  if (a.includes('apple')) return 'apple'
  if (a.includes('deepseek')) return 'deepseek'
  if (model.iconType === 'hf') return 'huggingface'
  const slug = a.replace(/[^a-z0-9]/g, '')
  return slug || null
}
function LetterMark({ model, size }: { model: ExploreModel; size: number }): ReactElement {
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
  return (
    <div
      className="explorer-mark"
      aria-hidden
      style={{
        width: size, height: size, fontSize: size <= 40 ? 15 : 22,
        background: s.bg, color: s.fg,
        border: s.bg === '#ffffff' ? '1px solid var(--border)' : 'none',
      }}
    >
      <span style={{ fontWeight: 800 }}>{s.label}</span>
    </div>
  )
}
function ModelMark({ model, size = 40 }: { model: ExploreModel; size?: number }): ReactElement {
  const [failed, setFailed] = useState(false)
  const slug = brandSlugFor(model)
  useEffect(() => setFailed(false), [model.id, size])
  if (!slug || failed) return <LetterMark model={model} size={size} />
  return (
    <div
      className="explorer-mark explorer-mark--img"
      aria-hidden
      style={{ width: size, height: size }}
    >
      <img
        src={`https://cdn.simpleicons.org/${slug}`}
        alt=""
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
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

// ── Per-file fit state (LM Studio: every quant row carries its own badge,
// header badge follows the SELECTED file — never a stale model-level value)
function recCompat(rec: FileRecommendationView | undefined): CompatibilityResult | null {
  if (!rec) return null
  return {
    fitsInMemory: rec.severity !== 'too-large',
    estimatedRamUsageGB: rec.estimatedRamGB,
    estimatedVramUsageGB: rec.estimatedRamGB,
    message: rec.reason,
    severity: rec.severity,
  }
}
function MiniFit({ rec }: { rec: FileRecommendationView | undefined }): ReactElement | null {
  if (!rec) return null
  const msg = rec.reason.toLowerCase()
  const cls = rec.severity === 'too-large'
    ? 'explorer-minifit--large'
    : msg.includes('partial') ? 'explorer-minifit--partial' : 'explorer-minifit--full'
  const label = rec.severity === 'too-large'
    ? 'Likely too large'
    : msg.includes('partial') ? 'Partial GPU offload possible' : msg.includes('cpu') ? 'Likely fits on CPU' : 'Full GPU offload possible'
  return (
    <span className={`explorer-minifit ${cls}`} title={rec.reason}>
      {rec.severity === 'too-large' ? <X size={10} /> : null} {label}
    </span>
  )
}

// Canonical capability order + human explanations (tooltips).
const CAP_ORDER = ['Vision', 'Tools', 'Reasoning', 'Code', 'Text', 'Chat', 'Embeddings'] as const
const CAP_HINT: Record<string, string> = {
  Vision: 'Understands images as well as text',
  Tools: 'Can call functions and use tools',
  Reasoning: 'Thinks step by step before answering',
  Code: 'Tuned for writing and understanding code',
  Text: 'General text generation',
  Chat: 'Tuned for conversation',
  Embeddings: 'Produces text embeddings',
}
function sortCaps(caps: string[]): string[] {
  const rank = (c: string): number => {
    const i = (CAP_ORDER as readonly string[]).indexOf(c)
    return i < 0 ? 99 : i
  }
  return [...caps].sort((a, b) => rank(a) - rank(b))
}
function capClass(cap: string): string {
  if (cap === 'Vision') return 'explorer-cap--vision'
  if (cap === 'Tools') return 'explorer-cap--tools'
  if (cap === 'Reasoning') return 'explorer-cap--reasoning'
  if (cap === 'Code') return 'explorer-cap--code'
  if (cap === 'Text' || cap === 'Chat') return 'explorer-cap--text'
  return ''
}

// ── Read-only repo file inventory (all formats, never downloadable) ──
// Safetensors/other weights are shown for what they are — no download
// button is ever rendered for them (no silent format conversion).
function RepoFileList({ files }: { files: NonNullable<ExploreModel['repoFiles']> }): ReactElement | null {
  if (files.length === 0) return null
  const shown = files.slice(0, 12)
  return (
    <div className="explorer-repofiles">
      <div className="explorer-repofiles-title">Repository files</div>
      {shown.map((f) => (
        <div key={f.rfilename} className="explorer-repofile">
          <span className="explorer-format-pill">{FORMAT_LABEL[f.format] ?? f.format}</span>
          <span className="explorer-file-name">{shortName((f.rfilename ?? '').split('/').pop() || 'file', 30)}</span>
          {f.quantization ? <span className="explorer-quant-pill">{f.quantization}</span> : null}
          <span className="explorer-file-size">{fmtSize(f.sizeBytes ?? 0)}</span>
        </div>
      ))}
      {files.length > shown.length ? (
        <div className="explorer-repofiles-more">+{files.length - shown.length} more on Hugging Face</div>
      ) : null}
    </div>
  )
}

// ── Sort options (LM Studio order + recency) ──────────────────────────
const SORTS = [
  { value: 'Recommended', label: 'Recommended' },
  { value: 'trending', label: 'Trending' },
  { value: 'downloads', label: 'Most downloaded' },
  { value: 'likes', label: 'Most liked' },
  { value: 'lastModified', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
]

interface Props { onBack: () => void }

export function ExplorePage({ onBack }: Props): ReactElement {
  const [query, setQuery] = useState(persistedExplorerFilters.query)
  const [debounced, setDebounced] = useState(persistedExplorerFilters.query)
  const [sortBy, setSortBy] = useState(persistedExplorerFilters.sortBy)
  const [sortOpen, setSortOpen] = useState(false)
  const [formatFilter, setFormatFilter] = useState<ExploreFormatFilter>(persistedExplorerFilters.format)
  const [formatOpen, setFormatOpen] = useState(false)
  const [quantFilter, setQuantFilter] = useState(persistedExplorerFilters.quant)
  const [paramsFilter, setParamsFilter] = useState(persistedExplorerFilters.params)
  const [licenseFilter, setLicenseFilter] = useState(persistedExplorerFilters.license)
  const [capabilityFilter, setCapabilityFilter] = useState(persistedExplorerFilters.capability)
  const [gatedFilter, setGatedFilter] = useState(persistedExplorerFilters.gated)
  const [downloadedFilter, setDownloadedFilter] = useState(persistedExplorerFilters.downloaded)
  const [compatFilter, setCompatFilter] = useState(persistedExplorerFilters.compat)
  const [models, setModels] = useState<ExploreModel[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ExploreModel | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [compat, setCompat] = useState<CompatibilityResult | null>(null)
  const [recs, setRecs] = useState<FileRecommendationView[] | null>(null)
  const [fileIdx, setFileIdx] = useState(0)
  const [fileOpen, setFileOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [downloads, setDownloads] = useState<Record<string, DownloadEventView>>({})
  const [downloadsOpen, setDownloadsOpen] = useState(false)
  // Persistent per-variant file states (registry + filesystem, restart-safe).
  // Keyed by model + file — two repos may ship the same basename.
  const [fileStates, setFileStates] = useState<Record<string, ModelFileStatus>>({})
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [downloadTo, setDownloadTo] = useState('This device')
  const timer = useRef<number | null>(null)
  const sortRef = useRef<HTMLDivElement>(null)
  const formatRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLDivElement>(null)
  // Generation guard: overlapping sweeps resolve out of order (typing +
  // filter taps); only the latest generation may commit results.
  const genRef = useRef(0)
  const modelsRef = useRef<ExploreModel[]>([])
  modelsRef.current = models
  // Ref mirrors for the stable download-event subscription below.
  const refreshRef = useRef<() => void>(() => {})
  const downloadedFilterRef = useRef(downloadedFilter)
  downloadedFilterRef.current = downloadedFilter

  const selected = useMemo(
    () => models.find((m) => m.id === selectedId) ?? null,
    [models, selectedId],
  )
  const active = detail ?? selected

  // Persist filter UI state across navigation (page unmounts on switch).
  useEffect(() => {
    persistedExplorerFilters.query = query
    persistedExplorerFilters.sortBy = sortBy
    persistedExplorerFilters.format = formatFilter
    persistedExplorerFilters.quant = quantFilter
    persistedExplorerFilters.params = paramsFilter
    persistedExplorerFilters.license = licenseFilter
    persistedExplorerFilters.capability = capabilityFilter
    persistedExplorerFilters.gated = gatedFilter
    persistedExplorerFilters.downloaded = downloadedFilter
    persistedExplorerFilters.compat = compatFilter
  }, [query, sortBy, formatFilter, quantFilter, paramsFilter, licenseFilter, capabilityFilter, gatedFilter, downloadedFilter, compatFilter])

  // One hardware read per mount for row fit dots + the Recommended header.
  useEffect(() => {
    let dead = false
    void getHardwareProfile().then((h) => { if (!dead) setHw(h) }).catch(() => {})
    return () => { dead = true }
  }, [])

  // Debounce NETWORK searches only (350ms); local typing stays instant.
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDebounced(query), 350)
    return () => { if (timer.current) window.clearTimeout(timer.current) }
  }, [query])

  interface ReloadSnapshot {
    q: string; s: string; f: ExploreFormatFilter; qu: string; p: string
    li: string; c: string; g: string; d: string; k: string
  }
  const reload = useCallback(async (snap: ReloadSnapshot, opts?: { append?: boolean; cursor?: string }): Promise<void> => {
    const gen = ++genRef.current
    if (opts?.append) setLoadingMore(true)
    else if (modelsRef.current.length === 0) setLoading(true)
    else setRefreshing(true)
    if (!opts?.append) setError(null)
    setNotice(null)
    try {
      const page = await listExploreModelsPage({
        sortBy: snap.s, query: snap.q, limit: 30, format: snap.f,
        quants: snap.qu === 'all' ? [] : [snap.qu],
        params: snap.p as ExploreListOpts['params'],
        licenses: snap.li === 'all' ? [] : [snap.li],
        capabilities: snap.c === 'all' ? [] : [snap.c],
        gated: snap.g as ExploreListOpts['gated'],
        downloaded: snap.d as ExploreListOpts['downloaded'],
        compat: snap.k as ExploreListOpts['compat'],
        ...(opts?.cursor ? { cursor: opts.cursor } : {}),
      })
      if (gen !== genRef.current) return // stale sweep — a newer one owns the list
      setModels((prev) => {
        if (!opts?.append) return page.models
        const seen = new Set(prev.map((m) => m.id))
        return [...prev, ...page.models.filter((m) => !seen.has(m.id))]
      })
      setNextCursor(page.nextCursor)
      if (!opts?.append) {
        setSelectedId((prev) => {
          const rows = page.models
          if (rows.length > 0) return (prev && rows.some((r) => r.id === prev) ? prev : rows[0].id)
          return null
        })
      }
    } catch (e) {
      if (gen !== genRef.current) return
      if (opts?.append) {
        setNotice(e instanceof Error ? e.message : 'Could not load more models.')
      } else if (modelsRef.current.length === 0) {
        setError(e instanceof Error ? e.message : 'Could not load models.')
      } else {
        // Degraded mode: stale list stays, error is a banner, Retry reuses it.
        setNotice(`Couldn't refresh — showing previous results. (${e instanceof Error ? e.message : 'network error'})`)
      }
    } finally {
      if (gen !== genRef.current) return
      setLoading(false); setRefreshing(false); setLoadingMore(false); setSpinning(false)
    }
  }, [])

  useEffect(() => {
    void reload({ q: debounced, s: sortBy, f: formatFilter, qu: quantFilter, p: paramsFilter, li: licenseFilter, c: capabilityFilter, g: gatedFilter, d: downloadedFilter, k: compatFilter })
    // snap fields enumerated above (reload itself is stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, sortBy, formatFilter, quantFilter, paramsFilter, licenseFilter, capabilityFilter, gatedFilter, downloadedFilter, compatFilter, reload])

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
        // LM Studio preselects the TOP RECOMMENDED quant (rank 0) even when it
        // does not fit — the badge states that honestly instead of hiding it.
        const best = r.find((x) => x.rank === 0) ?? r[0]
        if (best) setFileIdx(best.index)
      })
      .catch(() => {})
    return () => { dead = true }
  }, [selected?.id])

  // Reconcile registry ↔ filesystem on mount (startup repair also runs in
  // main): vanished files flip back to Download, orphans get adopted.
  useEffect(() => {
    void reconcileLibrary().catch(() => {})
  }, [])

  // Installed flags per file — authoritative lookup in main (registry +
  // filesystem), cached here only. Refreshed on every terminal event so a
  // completed file reads Downloaded even after an app restart.
  const refreshFileState = useCallback((modelId: string, rfilename: string): void => {
    void getModelFileStatus(modelId, rfilename).then((s) => {
      setFileStates((p) => ({ ...p, [`${modelId}\n${rfilename}`]: s }))
    }).catch(() => {})
  }, [])
  useEffect(() => {
    const m = detail ?? selected
    if (!m) return
    let dead = false
    void Promise.all(m.files.map(async (f) => {
      if (!f.rfilename) return
      try {
        const s = await getModelFileStatus(m.id, f.rfilename)
        if (!dead) setFileStates((p) => ({ ...p, [`${m.id}\n${f.rfilename as string}`]: s }))
      } catch { /* ignore */ }
    }))
    return () => { dead = true }
  }, [detail, selected])

  // Download events — error rows STAY visible with their message + retry so a
  // failed GGUF fetch is diagnosable instead of vanishing at 0%. Terminal
  // events re-read the persistent file state (restart-safe Downloaded).
  useEffect(() => {
    const dispose = onDownloadEvents((ev) => {
      setDownloads((prev) => {
        const next = { ...prev }
        const k = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'cancelled') delete next[k]
        else next[k] = ev
        return next
      })
      if (ev.state === 'done' || ev.state === 'error') refreshFileState(ev.modelId, ev.rfilename)
      // A completion can change downloaded-filtered listings; refresh those.
      if (ev.state === 'done' && downloadedFilterRef.current === 'downloaded') refreshRef.current()
    })
    void getActiveDownloads().catch(() => {})
    return dispose
    // refresh + downloadedFilter read via refs (stable subscription).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshFileState])

  // Real file URL for pause/resume/retry actions (backend rejects '' safely).
  const urlFor = useCallback((modelId: string, rfilename: string): string => {
    for (const m of [detail, selected]) {
      if (m && m.id === modelId) {
        const hit = m.files.find((f) => f.rfilename === rfilename)
        if (hit?.downloadUrl) return hit.downloadUrl
      }
    }
    return ''
  }, [detail, selected])
  const dismissDl = useCallback((modelId: string, rfilename: string): void => {
    const k = `${modelId}\n${rfilename}`
    setDownloads((prev) => {
      if (!(k in prev)) return prev
      const next = { ...prev }
      delete next[k]
      return next
    })
  }, [])

  // Close popups on outside click / Escape
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false)
      if (formatRef.current && !formatRef.current.contains(e.target as Node)) setFormatOpen(false)
      if (fileRef.current && !fileRef.current.contains(e.target as Node)) setFileOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setSortOpen(false); setFormatOpen(false); setFileOpen(false); setDownloadsOpen(false) }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [])

  const activeFile = active?.files[fileIdx]
  // Mixed repos: GGUF rows stay downloadable; other formats are disclosed,
  // never offered as downloads.
  const hasNonGgufWeights = (active?.repoFiles ?? []).some((f) => f.format !== 'gguf')
  // Dropdown order: backend rank (TOP RECOMMENDED first), then the rest —
  // never truncated, the menu scrolls. Header badge always reflects the
  // SELECTED file's own fit so its state updates on every selection.
  const menuOrder = useMemo((): number[] => {
    if (!active) return []
    if (recs && recs.length === active.files.length) return recs.map((r) => r.index)
    return active.files.map((_, i) => i)
  }, [active, recs])
  const selectedRec = recs?.find((r) => r.index === fileIdx)
  const headerFit: CompatibilityResult | null = recCompat(selectedRec) ?? compat
  const dlKey = active && activeFile?.rfilename ? `${active.id}\n${activeFile.rfilename}` : null
  const dl = dlKey ? downloads[dlKey] : undefined
  // Real byte ratio only — never timers or estimates. Clamped, never >100.
  // Resumed transfers start from existing .part bytes (backend emits them in
  // `started`), so 2.7/5.2 GB reads ≈52%, never 0%.
  const pct = dl && dl.totalBytes ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : null
  const statusOf = useCallback((modelId: string, rfilename: string | undefined): ModelFileStatus | undefined => {
    if (!rfilename) return undefined
    return fileStates[`${modelId}\n${rfilename}`]
  }, [fileStates])
  const activeStatus = active && activeFile?.rfilename ? statusOf(active.id, activeFile.rfilename) : undefined
  const isInstalled = activeStatus?.state === 'downloaded'
  const dlCount = Object.keys(downloads).length
  const openReadmeLink = useCallback((url: string): void => {
    void openExternal(url).catch(() => window.open(url, '_blank', 'noopener'))
  }, [])

  const doDownload = useCallback(async (): Promise<void> => {
    // Gated repos need access approval — never start an anonymous download.
    if (!active || active.gated || !activeFile?.downloadUrl || !activeFile.rfilename || activeFile.runnable === false) return
    // Shard sets download every part sequentially as one job (+ vision
    // projector sidecar when present); progress aggregates on this row.
    const extra = activeFile.multipart && activeFile.parts
      ? { parts: activeFile.parts, companion: activeFile.companion, revision: 'main', format: activeFile.format, quantization: activeFile.quantization, license: active.license, gated: active.gated }
      : activeFile.companion
        ? { companion: activeFile.companion, revision: 'main', format: activeFile.format, quantization: activeFile.quantization, license: active.license, gated: active.gated }
        : { revision: 'main', format: activeFile.format, quantization: activeFile.quantization, license: active.license, gated: active.gated }
    try { await downloadModelFile(active.id, activeFile.rfilename, activeFile.downloadUrl, extra) } catch { /* toast-less */ }
  }, [active, activeFile])

  const doResume = useCallback(async (): Promise<void> => {
    if (!active?.id || !activeFile?.rfilename || !activeFile.downloadUrl) return
    try { await resumeModelDownload(active.id, activeFile.rfilename, activeFile.downloadUrl, 'main') } catch { /* toast-less */ }
  }, [active, activeFile])

  const doOpenFolder = useCallback(async (): Promise<void> => {
    if (!active?.id || !activeFile?.rfilename) return
    try { await openModelFolder(active.id, activeFile.rfilename, 'main') } catch { /* toast-less */ }
  }, [active, activeFile])

  const refresh = useCallback((): void => {
    setSpinning(true)
    void reload({ q: debounced, s: sortBy, f: formatFilter, qu: quantFilter, p: paramsFilter, li: licenseFilter, c: capabilityFilter, g: gatedFilter, d: downloadedFilter, k: compatFilter })
  }, [debounced, sortBy, formatFilter, quantFilter, paramsFilter, licenseFilter, capabilityFilter, gatedFilter, downloadedFilter, compatFilter, reload])

  refreshRef.current = refresh

  const loadMore = useCallback((): void => {
    if (!nextCursor || loadingMore || loading) return
    void reload({ q: debounced, s: sortBy, f: formatFilter, qu: quantFilter, p: paramsFilter, li: licenseFilter, c: capabilityFilter, g: gatedFilter, d: downloadedFilter, k: compatFilter }, { append: true, cursor: nextCursor })
  }, [nextCursor, loadingMore, loading, debounced, sortBy, formatFilter, quantFilter, paramsFilter, licenseFilter, capabilityFilter, gatedFilter, downloadedFilter, compatFilter, reload])

  const clearFilters = useCallback((): void => {
    setQuantFilter('all'); setParamsFilter('all'); setLicenseFilter('all')
    setCapabilityFilter('all'); setGatedFilter('all'); setDownloadedFilter('all')
    setCompatFilter('all'); setFormatFilter('all')
  }, [])

  const hasActiveFilters = formatFilter !== 'all' || quantFilter !== 'all' || paramsFilter !== 'all' ||
    licenseFilter !== 'all' || capabilityFilter !== 'all' || gatedFilter !== 'all' ||
    downloadedFilter !== 'all' || compatFilter !== 'all' || debounced.trim() !== ''

  // Quant options carry live counts from the current page; zero-count quants
  // disable (not hide) so the menu stays stable while signaling relevance.
  const quantOptions: FilterOption[] = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of models) {
      for (const f of m.files) {
        if (f.runnable === false) continue
        const q = (f.quantization ?? '').toUpperCase()
        counts.set(q === '' ? 'Other' : q, (counts.get(q === '' ? 'Other' : q) ?? 0) + 1)
      }
    }
    return [{ value: 'all', label: 'Any quant' }, ...QUANT_FILTERS.filter((q) => q !== 'all').map((q) => {
      const n = counts.get(q) ?? 0
      return { value: q, label: n > 0 ? `${q} (${n})` : q, count: undefined, disabled: n === 0 && models.length > 0 }
    })]
  }, [models])

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
                const stateLabel = ev.state === 'started' ? 'Starting…' : ev.state === 'queued' ? 'Queued' : ev.state === 'paused' ? 'Paused' : `${p}%`
                if (ev.state === 'error') {
                  const retryUrl = urlFor(ev.modelId, ev.rfilename)
                  return (
                    <div key={`${ev.modelId}\n${ev.rfilename}`} className="explorer-dl-row explorer-dl-row--error">
                      <div className="explorer-dl-info">
                        <div className="explorer-dl-name">{(ev.rfilename ?? '').split('/').pop()}</div>
                        <div className="explorer-dl-error" role="alert">{ev.error ?? 'Download failed'}</div>
                      </div>
                      <div className="explorer-dl-actions">
                        {/* Resume (not fresh start): shard sets rebuild from the
                            sidecar, singles continue their .part via Range. */}
                        {retryUrl ? <button type="button" aria-label="Retry download" title="Retry" onClick={() => { dismissDl(ev.modelId, ev.rfilename); void resumeModelDownload(ev.modelId, ev.rfilename, retryUrl, 'main').catch(() => {}) }}><RefreshCw size={13} /></button> : null}
                        <button type="button" aria-label="Dismiss" onClick={() => dismissDl(ev.modelId, ev.rfilename)}><X size={13} /></button>
                      </div>
                    </div>
                  )
                }
                const speed = fmtSpeed(ev.speedBps)
                const eta = fmtEta(ev.etaSeconds)
                return (
                  <div key={`${ev.modelId}\n${ev.rfilename}`} className="explorer-dl-row">
                    <div className="explorer-dl-info">
                      <div className="explorer-dl-name">{(ev.rfilename ?? '').split('/').pop()}</div>
                      <div className="explorer-dl-meta">{stateLabel}{ev.totalBytes ? ` · ${fmtSize(ev.receivedBytes)} / ${fmtSize(ev.totalBytes)}` : ev.receivedBytes > 0 ? ` · ${fmtSize(ev.receivedBytes)} downloaded` : ''}{speed ? ` · ${speed}` : ''}{eta ? ` · ETA ${eta}` : ''}</div>
                      <div className="explorer-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}>
                        <span className="explorer-progress-fill" style={{ width: `${ev.state === 'paused' || ev.state === 'queued' ? 0 : Math.max(p, 2)}%` }} />
                      </div>
                    </div>
                    <div className="explorer-dl-actions">
                      {ev.state === 'paused'
                        ? <button type="button" aria-label="Resume" onClick={() => void resumeModelDownload(ev.modelId, ev.rfilename, urlFor(ev.modelId, ev.rfilename)).catch(() => {})}><Play size={13} /></button>
                        : ev.state === 'queued' || ev.state === 'started'
                          ? <button type="button" aria-label="Cancel" onClick={() => void cancelModelDownload(ev.modelId, ev.rfilename).catch(() => {})}><X size={13} /></button>
                          : <button type="button" aria-label="Pause" onClick={() => void pauseModelDownload(ev.modelId, ev.rfilename).catch(() => {})}><Pause size={13} /></button>}
                      {ev.state !== 'queued' && ev.state !== 'started' ? <button type="button" aria-label="Cancel" onClick={() => void cancelModelDownload(ev.modelId, ev.rfilename).catch(() => {})}><X size={13} /></button> : null}
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
            <div style={{ display: 'flex', gap: 8 }}>
            <div className="explorer-sort" ref={formatRef}>
              <button
                type="button" className="explorer-sort-btn"
                aria-haspopup="listbox" aria-expanded={formatOpen} aria-label="Filter by model format"
                onClick={() => setFormatOpen((v) => !v)}
              >
                {FORMAT_FILTERS.find((f) => f.value === formatFilter)?.label ?? 'All formats'}
                <ChevronsUpDown size={13} className={`explorer-sort-chev ${formatOpen ? 'open' : ''}`} />
              </button>
              {formatOpen ? (
                <div className="explorer-sort-menu" role="listbox" aria-label="Model format">
                  {FORMAT_FILTERS.map((o) => (
                    <button
                      key={o.value} type="button" role="option" aria-selected={formatFilter === o.value}
                      className={`explorer-sort-item ${formatFilter === o.value ? 'active' : ''}`}
                      onClick={() => { setFormatFilter(o.value); setFormatOpen(false) }}
                    >
                      {o.label} {formatFilter === o.value ? <Check size={12} /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
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
          </div>

          {/* Second filter row: every filter ANDs with the rest in main. */}
          <div className="explorer-filters" role="group" aria-label="Model filters">
            <FilterMenu label={quantFilter === 'all' ? 'Quant' : quantFilter} ariaLabel="Filter by quantization" value={quantFilter} options={quantOptions} onChange={setQuantFilter} />
            <FilterMenu label={PARAM_FILTERS.find((o) => o.value === paramsFilter)?.label ?? 'Size'} ariaLabel="Filter by parameter count" value={paramsFilter} options={PARAM_FILTERS} onChange={setParamsFilter} />
            <FilterMenu label={capabilityFilter === 'all' ? 'Task' : capabilityFilter} ariaLabel="Filter by capability" value={capabilityFilter} options={CAP_FILTERS.map((c) => ({ value: c, label: c === 'all' ? 'Any task' : c }))} onChange={setCapabilityFilter} />
            <FilterMenu label={licenseFilter === 'all' ? 'License' : licenseFilter} ariaLabel="Filter by license" value={licenseFilter} options={LICENSE_FILTERS.map((l) => ({ value: l, label: l === 'all' ? 'Any license' : l }))} onChange={setLicenseFilter} />
            <FilterMenu label={COMPAT_FILTERS.find((o) => o.value === compatFilter)?.label ?? 'Fit'} ariaLabel="Filter by hardware fit" value={compatFilter} options={COMPAT_FILTERS} onChange={setCompatFilter} />
            <FilterMenu label={GATED_FILTERS.find((o) => o.value === gatedFilter)?.label ?? 'Access'} ariaLabel="Filter by repository access" value={gatedFilter} options={GATED_FILTERS} onChange={setGatedFilter} />
            <FilterMenu label={DOWNLOADED_FILTERS.find((o) => o.value === downloadedFilter)?.label ?? 'Saved'} ariaLabel="Filter by download state" value={downloadedFilter} options={DOWNLOADED_FILTERS} onChange={setDownloadedFilter} />
            {hasActiveFilters ? (
              <button type="button" className="explorer-filters-clear" onClick={clearFilters}>Clear</button>
            ) : null}
          </div>
          {sortBy === 'Recommended' && debounced.trim() === '' ? (
            <div className="explorer-recommended-note" role="note">
              Recommended for your PC{hw ? ` (${hw.gpuAvailable && hw.totalVramMB ? `${Math.round(hw.totalVramMB / 1024)} GB VRAM` : 'CPU'} · ${Math.round(hw.totalRamMB / 1024)} GB RAM)` : ''} — likely fits first, then may-fit. Larger models stay browsable via other sorts.
            </div>
          ) : null}
          {notice ? (
            <div className="explorer-notice" role="status">{notice}<button type="button" className="explorer-retry" onClick={refresh}>Retry</button></div>
          ) : null}

          <div className="explorer-list" role="listbox" aria-label="Models">
            {loading && models.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="explorer-skel" style={{ ['--i' as string]: i }}>
                  <div className="explorer-skel-icon" />
                  <div className="explorer-skel-lines"><span /><span className="short" /></div>
                </div>
              ))
            ) : error && models.length === 0 ? (
              <div className="explorer-empty">{error}<button type="button" className="explorer-retry" onClick={refresh}>Retry</button></div>
            ) : models.length === 0 ? (
              <div className="explorer-empty">
                <strong>{error ?? 'No models match your filters.'}</strong>
                {hasActiveFilters ? (
                  <span className="explorer-empty-hints">
                    Try:
                    {quantFilter !== 'all' ? <button type="button" className="explorer-retry" onClick={() => setQuantFilter('all')}>removing {quantFilter}</button> : null}
                    {paramsFilter !== 'all' ? <button type="button" className="explorer-retry" onClick={() => setParamsFilter('all')}>widening size</button> : null}
                    {compatFilter !== 'all' ? <button type="button" className="explorer-retry" onClick={() => setCompatFilter('all')}>clearing fit</button> : null}
                    {downloadedFilter !== 'all' ? <button type="button" className="explorer-retry" onClick={() => setDownloadedFilter('all')}>clearing saved</button> : null}
                    <button type="button" className="explorer-retry" onClick={clearFilters}>clear all filters</button>
                  </span>
                ) : <span>No text, vision, tools, code or thinking models found.</span>}
              </div>
            ) : (
              <>
                {refreshing ? <div className="explorer-refreshing" role="status">Refreshing…</div> : null}
                {models.map((m, i) => (
                  <ModelRow key={m.id} model={m} index={i} isActive={m.id === selectedId} onSelect={setSelectedId} />
                ))}
                {nextCursor ? (
                  <button type="button" className="explorer-loadmore" disabled={loadingMore} onClick={loadMore}>
                    {loadingMore ? 'Loading…' : 'Load more'}
                  </button>
                ) : null}
              </>
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
                  <div className="explorer-format-row" aria-label="Model formats">
                    {presentFormats(active).map((f) => (
                      <span key={f} className="explorer-format-pill" title="Detected from the repository's actual files">{FORMAT_LABEL[f]}</span>
                    ))}
                    {active.gated ? (
                      <span className="explorer-gated-pill" title="This repository is gated — downloading needs Hugging Face access approval">Gated</span>
                    ) : null}
                  </div>
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
                ) : active.gated ? (
                  <>
                    <div className="explorer-empty">
                      <strong>Gated repository</strong>
                      <span>Downloading needs Hugging Face access approval — sign in with an approved account, then retry.</span>
                    </div>
                    {active.repoFiles ? <RepoFileList files={active.repoFiles} /> : null}
                  </>
                ) : active.files.length === 0 ? (
                  <>
                    <div className="explorer-empty">
                      {presentFormats(active).includes('safetensors') ? (
                        <>
                          <strong>Safetensors model</strong>
                          <span>GGUF version not available in this repository.</span>
                        </>
                      ) : (
                        <>
                          <strong>No downloadable weights</strong>
                          <span>No GGUF weights are published in this repository.</span>
                        </>
                      )}
                    </div>
                    {active.repoFiles ? <RepoFileList files={active.repoFiles} /> : null}
                  </>
                ) : (
                  <div className="explorer-filewrap" ref={fileRef}>
                    <button
                      type="button" className="explorer-filebtn"
                      aria-expanded={fileOpen} onClick={() => setFileOpen((v) => !v)}
                    >
                      <span className="explorer-format-pill">{activeFile?.format ?? 'GGUF'}</span>
                      <span className="explorer-file-name">{shortName(activeFile?.rfilename?.split('/').pop() ?? active.name, 34)}</span>
                      {activeFile?.quantization ? <span className="explorer-quant-pill">{activeFile.quantization}</span> : null}
                      {activeFile?.multipart && activeFile?.parts ? <span className="explorer-quant-pill" title="Sharded model — all parts download as one">{activeFile.parts.length} parts</span> : null}
                      <span className="explorer-file-size">{fmtSize(activeFile?.sizeBytes ?? 0)}</span>
                      {recs?.find((r) => r.index === fileIdx && r.rank === 0) ? <span className="explorer-rec-pill">Recommended</span> : null}
                      <ChevronDown size={14} className={`explorer-file-chev ${fileOpen ? 'open' : ''}`} />
                    </button>
                    {fileOpen ? (
                      <div className="explorer-filemenu" role="listbox">
                        {menuOrder.map((i) => {
                          const f = active.files[i]
                          if (!f) return null
                          const rec = recs?.find((r) => r.index === i)
                          const isRec = rec?.rank === 0
                          return (
                            <button
                              key={f.downloadUrl || f.rfilename || i} type="button" role="option" aria-selected={i === fileIdx}
                              className={`explorer-fileitem ${i === fileIdx ? 'active' : ''}`}
                              onClick={() => { setFileIdx(i); setFileOpen(false) }}
                            >
                              {i === fileIdx ? <Check size={13} className="explorer-file-check" /> : <span className="explorer-file-checkspacer" />}
                              <span className="explorer-format-pill">{f.format}</span>
                              <span className="explorer-file-name">{shortName((f.rfilename ?? '').split('/').pop() || f.format, 26)}</span>
                              {f.quantization ? <span className="explorer-quant-pill">{f.quantization}</span> : null}
                              {f.multipart && f.parts ? <span className="explorer-quant-pill" title="Sharded model — all parts download as one">{f.parts.length} parts</span> : null}
                              {f.companion ? <span className="explorer-quant-pill" title="Vision projector downloads automatically with this weight">+mmproj</span> : null}
                              {f.sourceRepo && active && f.sourceRepo !== active.id ? (
                                <span className="explorer-file-src" title="These bytes come from this quant repository, not the base model page">from {f.sourceRepo}</span>
                              ) : null}
                              {isRec ? <span className="explorer-rec-pill">Recommended</span> : null}
                              <MiniFit rec={rec} />
                              <span className="explorer-file-size">{fmtSize(f.sizeBytes ?? 0)}</span>
                              {(() => {
                                const s = active ? statusOf(active.id, f.rfilename) : undefined
                                if (s?.state === 'downloaded') return <span className="explorer-file-done" title="Downloaded — in library">✓</span>
                                if (s && (s.state === 'partial' || s.state === 'paused')) {
                                  const label = s.partsTotal ? `${s.partsPresent ?? 0}/${s.partsTotal}` : fmtSize(s.downloadedBytes)
                                  return <span className="explorer-file-partial" title="Partially downloaded — resume to finish">{label}</span>
                                }
                                return null
                              })()}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )}
                {hasNonGgufWeights ? (
                  <div className="explorer-format-note">Also contains {presentFormats(active).filter((f) => f !== 'gguf').map((f) => FORMAT_LABEL[f]).join(' + ')} weights (see Details) — only GGUF is downloadable here.</div>
                ) : null}
                <div className="explorer-fitrow"><FitBadge result={headerFit} /></div>
                <div className="explorer-downloaderow">
                  {isInstalled ? (
                    <div className="explorer-downloaded">
                      <div className="explorer-installed">✓ Downloaded</div>
                      <div className="explorer-downloaded-meta">{fmtSize(activeFile?.sizeBytes ?? 0)}</div>
                      <button type="button" className="explorer-mini-btn" onClick={() => void doOpenFolder()}>
                        <FolderOpen size={12} /> Open folder
                      </button>
                    </div>
                  ) : dl && dl.state === 'error' ? (
                    <div className="explorer-download-failed" role="alert">
                      <div className="explorer-dl-error">Download failed{dl.error ? ` — ${dl.error}` : ''}</div>
                      {dl.totalBytes
                        ? <div className="explorer-dl-meta">{fmtSize(dl.receivedBytes)} / {fmtSize(dl.totalBytes)}</div>
                        : dl.receivedBytes > 0 ? <div className="explorer-dl-meta">{fmtSize(dl.receivedBytes)} downloaded</div> : null}
                      <div className="explorer-download-actions">
                        <button type="button" className="explorer-mini-btn" onClick={() => { if (activeFile?.rfilename) { dismissDl(active.id, activeFile.rfilename); void doResume() } }}><RefreshCw size={12} /> Retry</button>
                        <button type="button" className="explorer-mini-btn explorer-mini-btn--danger" aria-label="Dismiss" onClick={() => activeFile?.rfilename && dismissDl(active.id, activeFile.rfilename)}><X size={12} /></button>
                      </div>
                    </div>
                  ) : activeStatus?.state === 'failed' && !dl ? (
                    <div className="explorer-download-failed" role="alert">
                      <div className="explorer-dl-error">Download failed{activeStatus.error ? ` — ${activeStatus.error}` : ''}</div>
                      {activeStatus.totalBytes
                        ? <div className="explorer-dl-meta">{fmtSize(activeStatus.downloadedBytes)} / {fmtSize(activeStatus.totalBytes)}</div>
                        : activeStatus.downloadedBytes > 0 ? <div className="explorer-dl-meta">{fmtSize(activeStatus.downloadedBytes)} downloaded</div> : null}
                      <div className="explorer-download-actions">
                        <button type="button" className="explorer-mini-btn" onClick={() => void doResume()}><RefreshCw size={12} /> Retry</button>
                      </div>
                    </div>
                  ) : dl ? (
                    <div className="explorer-progress-row">
                      <div className="explorer-progress explorer-progress--big" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                        <span className="explorer-progress-fill" style={{ width: `${pct ?? 4}%` }} />
                      </div>
                      <span className="explorer-progress-label">
                        {dl.state === 'paused' ? 'Paused' : dl.totalBytes ? `${pct ?? 0}%` : 'Downloading…'}
                      </span>
                      <span className="explorer-dl-meta">
                        {dl.totalBytes
                          ? `${fmtSize(dl.receivedBytes)} / ${fmtSize(dl.totalBytes)}`
                          : `${fmtSize(dl.receivedBytes)} downloaded`}
                        {fmtSpeed(dl.speedBps) ? ` · ${fmtSpeed(dl.speedBps)}` : ''}
                        {fmtEta(dl.etaSeconds) ? ` · ETA ${fmtEta(dl.etaSeconds)}` : ''}
                      </span>
                      {dl.state === 'paused'
                        ? <button type="button" className="explorer-mini-btn" onClick={() => activeFile?.rfilename && void resumeModelDownload(active.id, activeFile.rfilename, activeFile.downloadUrl ?? '', 'main').catch(() => {})}><Play size={12} /> Resume</button>
                        : <button type="button" className="explorer-mini-btn" onClick={() => activeFile?.rfilename && void pauseModelDownload(active.id, activeFile.rfilename).catch(() => {})}><Pause size={12} /> Pause</button>}
                      <button type="button" className="explorer-mini-btn explorer-mini-btn--danger" aria-label="Cancel download" onClick={() => activeFile?.rfilename && void cancelModelDownload(active.id, activeFile.rfilename).catch(() => {})}><X size={12} /></button>
                    </div>
                  ) : activeStatus && (activeStatus.state === 'partial' || activeStatus.state === 'paused' || activeStatus.state === 'queued') ? (
                    <div className="explorer-download-resume">
                      <div className="explorer-dl-meta" role="status">
                        {activeStatus.state === 'paused' ? 'Paused' : activeStatus.state === 'queued' ? 'Queued' : 'Partial download'}
                        {activeStatus.partsTotal
                          ? ` — ${activeStatus.partsPresent ?? 0} / ${activeStatus.partsTotal} files`
                          : ''}
                        {` · ${fmtSize(activeStatus.downloadedBytes)}${activeStatus.totalBytes ? ` / ${fmtSize(activeStatus.totalBytes)}` : ' downloaded'}`}
                      </div>
                      <div className="explorer-download-actions">
                        <button type="button" className="explorer-mini-btn" onClick={() => void doResume()}><Play size={12} /> Resume</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button" className="explorer-download-btn"
                      disabled={!activeFile?.downloadUrl || activeFile?.runnable === false || active.gated === true}
                      title={active.gated === true ? 'Gated repository — needs Hugging Face access approval.' : activeFile?.runnable === false ? 'Not a runnable model file — select a GGUF weight to download.' : undefined}
                      onClick={doDownload}>
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
                    {presentFormats(active).map((f) => <span key={f} className="explorer-pill">{FORMAT_LABEL[f]}</span>)}
                  </span>
                  {active.baseModel ? (
                    <>
                      <span className="explorer-meta-label">Based on</span>
                      <span className="explorer-pill" title="Base model from the repo card — GGUF rows above come from their own quant repositories">{active.baseModel}</span>
                    </>
                  ) : null}
                </div>
                <div className="explorer-meta">
                  <span className="explorer-meta-label">Capabilities</span>
                  <span className="explorer-pill-group">
                    {sortCaps(active.capabilities).map((c) => <span key={c} className={`explorer-cap ${capClass(c)}`} title={CAP_HINT[c] ?? c}><CapIcon cap={c} /> {c}</span>)}
                  </span>
                </div>
                {active.license || (active.languages && active.languages.length > 0) ? (
                  <div className="explorer-meta">
                    {active.license ? (
                      <>
                        <span className="explorer-meta-label">License</span>
                        <span className="explorer-pill">{active.license}</span>
                      </>
                    ) : null}
                    {active.languages && active.languages.length > 0 ? (
                      <>
                        <span className="explorer-meta-label">Languages</span>
                        <span className="explorer-pill-group">
                          {active.languages.slice(0, 6).map((l) => <span key={l} className="explorer-pill">{l}</span>)}
                        </span>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* README viewer: full markdown, images, code copy, expand */}
              <h3 className="explorer-section-title explorer-section-title--upper">README</h3>
              <div className="explorer-card explorer-readme">
                {active.readme
                  ? <ReadmeViewer markdown={active.readme} modelSlug={active.slug} onOpenLink={openReadmeLink} />
                  : <div className="explorer-md"><h2 className="explorer-md-h1">{active.name}</h2><p className="explorer-md-p">{active.longDescription}</p></div>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
