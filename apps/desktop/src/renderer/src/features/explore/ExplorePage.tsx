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
        // LM Studio preselects the TOP RECOMMENDED quant (rank 0) even when it
        // does not fit — the badge states that honestly instead of hiding it.
        const best = r.find((x) => x.rank === 0) ?? r[0]
        if (best) setFileIdx(best.index)
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

  // Download events — error rows STAY visible with their message + retry so a
  // failed GGUF fetch is diagnosable instead of vanishing at 0%.
  useEffect(() => {
    const dispose = onDownloadEvents((ev) => {
      setDownloads((prev) => {
        const next = { ...prev }
        const k = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'cancelled') delete next[k]
        else next[k] = ev
        return next
      })
      if (ev.state === 'done') setInstalled((p) => ({ ...p, [ev.rfilename]: true }))
    })
    void getActiveDownloads().catch(() => {})
    return dispose
  }, [])

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
  const pct = dl && dl.totalBytes ? Math.min(100, Math.round((dl.receivedBytes / dl.totalBytes) * 100)) : null
  const isInstalled = activeFile?.rfilename ? Boolean(installed[activeFile.rfilename]) : false
  const dlCount = Object.keys(downloads).length
  const openReadmeLink = useCallback((url: string): void => {
    void openExternal(url).catch(() => window.open(url, '_blank', 'noopener'))
  }, [])

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
                        {retryUrl ? <button type="button" aria-label="Retry download" title="Retry" onClick={() => { dismissDl(ev.modelId, ev.rfilename); void downloadModelFile(ev.modelId, ev.rfilename, retryUrl).catch(() => {}) }}><RefreshCw size={13} /></button> : null}
                        <button type="button" aria-label="Dismiss" onClick={() => dismissDl(ev.modelId, ev.rfilename)}><X size={13} /></button>
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={`${ev.modelId}\n${ev.rfilename}`} className="explorer-dl-row">
                    <div className="explorer-dl-info">
                      <div className="explorer-dl-name">{(ev.rfilename ?? '').split('/').pop()}</div>
                      <div className="explorer-dl-meta">{stateLabel}{ev.totalBytes ? ` · ${fmtSize(ev.receivedBytes)} / ${fmtSize(ev.totalBytes)}` : ev.receivedBytes > 0 ? ` · ${fmtSize(ev.receivedBytes)}` : ''}</div>
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
                const caps = sortCaps(m.capabilities.filter((c) => ['Vision', 'Tools', 'Reasoning', 'Code'].includes(c))).slice(0, 3)
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
                    <span className="explorer-row-caps">
                      {caps.length > 0 ? caps.map((c) => <span key={c} className="explorer-row-cap" title={CAP_HINT[c] ?? c}><CapIcon cap={c} /></span>) : null}
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
                              {isRec ? <span className="explorer-rec-pill">Recommended</span> : null}
                              <MiniFit rec={rec} />
                              <span className="explorer-file-size">{fmtSize(f.sizeBytes ?? 0)}</span>
                              {installed[f.rfilename ?? ''] ? <span className="explorer-file-done" title="In library">✓</span> : null}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )}
                <div className="explorer-fitrow"><FitBadge result={headerFit} /></div>
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
                        ? <button type="button" className="explorer-mini-btn" onClick={() => activeFile?.rfilename && void resumeModelDownload(active.id, activeFile.rfilename, activeFile.downloadUrl ?? '').catch(() => {})}><Play size={12} /> Resume</button>
                        : <button type="button" className="explorer-mini-btn" onClick={() => activeFile?.rfilename && void pauseModelDownload(active.id, activeFile.rfilename).catch(() => {})}><Pause size={12} /> Pause</button>}
                      <button type="button" className="explorer-mini-btn explorer-mini-btn--danger" aria-label="Cancel download" onClick={() => activeFile?.rfilename && void cancelModelDownload(active.id, activeFile.rfilename).catch(() => {})}><X size={12} /></button>
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
