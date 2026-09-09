/**
 * Explorer catalog — Hugging Face as the primary listing source.
 *
 * - List:   GET https://huggingface.co/api/models?search=&sort=trendingScore|downloads|likes|lastModified&direction=-1&limit=&expand=
 *   (valid expands: author, cardData, gated, lastModified, safetensors, siblings,
 *   likes, downloads, tags, pipeline_tag, trendingScore, createdAt — usedStorage is
 *   NOT a valid list expand and returns 400; `expand[]` bracket form is rejected)
 * - Search accepts keyword, `org/name`, or full HF URL paste; empty query +
 *   Recommended shows curated staff picks, everything else loads broadly
 *   (default 60 rows, up to 100 per sweep).
 * - Detail: full row + GGUF quant options aggregated from linked community
 *   quant repos (lmstudio-community first) + exact HEAD sizes + README.
 *
 * Scope: ONLY text / vision / tools / code / thinking (reasoning) models.
 * Everything else (text-to-image, audio, video, classification heads) is dropped.
 * Download Options lists GGUF weights only — never meta/helper files.
 */
import type { ExploreModel, ExploreModelFile, ExploreRepoFile, HardwareInfo, ModelFormat, RepoWeightFormat } from '@shared/types/explore'
import { estimateExplorerFit } from './explorerFit'
import { getHardwareProfile } from './hardwareProfile'

const HF_MODELS_API = 'https://huggingface.co/api/models'
const HF_TIMEOUT_MS = 20000

// ── Allowed families ──────────────────────────────────────────────
// Text   → pipeline text-generation / conversational / text2text-generation
// Vision → pipeline image-text-to-text
// Tools / Code / Thinking are TAG families on top of a text-capable base.
const ALLOWED_PIPELINE = new Set([
  'text-generation',
  'conversational',
  'text2text-generation',
  'image-text-to-text',
])

const BLOCKED_PIPELINE = new Set([
  'text-to-image',
  'image-to-image',
  'unconditional-image-generation',
  'image-to-video',
  'text-to-video',
  'video-classification',
  'automatic-speech-recognition',
  'text-to-speech',
  'audio-to-audio',
  'audio-classification',
  'image-classification',
  'object-detection',
  'image-segmentation',
  'depth-estimation',
  'video-text-to-text',
])

export type ExplorerCapability = 'Text' | 'Vision' | 'Tools' | 'Code' | 'Thinking'

// NOTE: no hardcoded model lists. The Recommended view is computed live from
// the user's own hardware (full + partial fits) — see recommendForHardware.
// Anything that cannot be verified against a real signal is never asserted.

interface HfCard {
  license?: string
  language?: string | string[]
  base_model?: string | string[]
  pipeline_tag?: string
}

interface HfRow {
  id: string
  author?: string
  likes?: number
  downloads?: number
  tags?: string[]
  pipeline_tag?: string
  gated?: boolean | string
  trendingScore?: number
  createdAt?: string
  lastModified?: string
  usedStorage?: number
  cardData?: HfCard
  safetensors?: { total?: number }
  gguf?: { architecture?: string; total?: number }
  config?: { model_type?: string }
  siblings?: Array<{ rfilename: string }>
}

export type ExplorerFormatFilter = 'all' | 'gguf' | 'safetensors' | 'mixed' | 'other'

export interface ExplorerListOpts {
  sortBy?: string // Recommended | trending | downloads | likes | lastModified
  query?: string // keyword, user/model, or full HF URL
  limit?: number // default 60, max 100
  /** File-list based format filter (default 'all'). */
  format?: ExplorerFormatFilter
}

/**
 * Backend-supported format filter. `gguf` keeps repos that HAVE GGUF
 * (gguf + mixed) so the local-inference workflow filters in one tap;
 * `safetensors` likewise keeps safetensors + mixed.
 */
export function matchesFormatFilter(format: ModelFormat | undefined, filter: ExplorerFormatFilter): boolean {
  if (filter === 'all') return true
  if (!format) return false
  if (filter === 'gguf') return format === 'gguf' || format === 'mixed'
  if (filter === 'safetensors') return format === 'safetensors' || format === 'mixed'
  return format === filter
}

function authHeader(): Record<string, string> {
  const t =
    process.env.HF_TOKEN ??
    process.env.HF_API_TOKEN ??
    process.env.HUGGINGFACE_TOKEN ??
    ''
  return t.trim() ? { Authorization: `Bearer ${t.trim()}` } : {}
}

async function hfGet(url: string, method = 'GET'): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HF_TIMEOUT_MS)
  try {
    return await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'SOVARA-Explorer/1.0', Accept: 'application/json', ...authHeader() },
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Search box accepts keyword, `org/name`, or a full HF URL paste. */
export function parseExplorerSearch(input: string): { kind: 'empty' | 'url' | 'id' | 'keyword'; modelId?: string; query?: string } {
  const s = (input ?? '').trim()
  if (!s) return { kind: 'empty' }
  const urlM = s.match(/^https?:\/\/(?:www\.)?huggingface\.co\/([^/\s]+\/[^/\s?#]+)/i)
  if (urlM) return { kind: 'url', modelId: urlM[1].replace(/\/$/, '') }
  const idM = s.match(/^([^/\s]+\/[^/\s]+)$/)
  if (idM && !s.includes(' ')) return { kind: 'id', modelId: s }
  return { kind: 'keyword', query: s }
}

function detectIcon(author: string): ExploreModel['iconType'] {
  const a = author.toLowerCase()
  if (a.includes('qwen')) return 'qwen'
  if (a.includes('google') || a.includes('gemma')) return 'google'
  if (a.includes('meta') || a.includes('llama')) return 'meta'
  if (a.includes('mistral')) return 'mistral'
  if (a.includes('microsoft') || a.includes('phi') || a.includes('bonsai') || a.includes('prism')) return 'microsoft'
  if (a.includes('deepseek')) return 'deepseek'
  return 'hf'
}

/** Classify into the 5 allowed families. Returns [] when the row is out of scope. */
export function classifyCapabilities(tags: string[], pipelineTag: string | undefined, modelId: string): ExplorerCapability[] {
  const pt = (pipelineTag ?? '').toLowerCase()
  if (pt && BLOCKED_PIPELINE.has(pt)) return []
  const bag = tags.join(' ').toLowerCase()
  const id = modelId.toLowerCase()
  const caps: ExplorerCapability[] = []

  const isTextBase = pt === '' || ALLOWED_PIPELINE.has(pt) || bag.includes('instruct') || bag.includes('chat') || bag.includes('conversational')
  // Vision is explicit only
  if (pt === 'image-text-to-text' || bag.includes('vision') || bag.includes('image-text') || bag.includes('multimodal') || bag.includes('vqa') || id.includes('vl') || id.includes('vision')) {
    caps.push('Vision')
  }
  if (bag.includes('function-calling') || bag.includes('function_calling') || bag.includes('tool') || bag.includes('agent') || bag.includes('tool-calling')) {
    caps.push('Tools')
  }
  if (bag.includes('code') || bag.includes('coding') || bag.includes('programming') || id.includes('coder') || id.includes('code') || id.includes('starcoder') || id.includes('wizardcoder')) {
    caps.push('Code')
  }
  if (id.includes('tool') || id.includes('functiongemma') || id.includes('nexusraven') || id.includes('hermes')) {
    caps.push('Tools')
  }
  if (
    bag.includes('reasoning') || bag.includes('thinking') || bag.includes('chain-of-thought') ||
    bag.includes('cot') || bag.includes('r1') || bag.includes('distill') || id.includes('reasoning') ||
    id.includes('thinking') || id.includes('r1')
  ) {
    caps.push('Thinking')
  }
  // Plain text-generation with none of the above still counts as Text
  if (caps.length === 0 && (pt === 'text-generation' || pt === 'conversational' || pt === 'text2text-generation' || pt === '' || isTextBase)) {
    // Only keep when pipeline is allowed (or missing → allow, detail fetch will confirm)
    if (pt === '' || ALLOWED_PIPELINE.has(pt)) caps.push('Text')
    else return []
  }
  if (caps.length === 0) return []
  // Text is implied for tool/code/thinking bases — surface it so the row always shows its base family
  if (!caps.includes('Text') && (pt === 'text-generation' || pt === 'conversational' || pt === '')) caps.unshift('Text')
  return caps
}

/** Phrase evidence mined from the model card text (README fallback when tags
 *  are silent). STRONG multi-word phrases only: single generic words like
 *  'reasoning', 'coding', 'agentic' or 'multimodal' appear in nearly every
 *  modern card and would paint every model with every capability.
 *  Scans the first 8k chars. */
const README_SIGNALS: Array<{ cap: ExplorerCapability; phrases: string[] }> = [
  { cap: 'Vision', phrases: ['vision-language', 'vision language', 'image understanding', 'understands images', 'image input', 'visual perception', 'visual reasoning', 'text and image', 'image and text', 'video input', 'see images'] },
  { cap: 'Tools', phrases: ['tool call', 'tool-call', 'toolcall', 'function call', 'function-call', 'function calling', 'tool use', 'tool-use', 'can call functions', 'function gemma'] },
  { cap: 'Code', phrases: ['code generation', 'code completion', 'humaneval', 'mbpp', 'swe-bench', 'swebench', 'write code', 'debug code', 'code understanding'] },
  { cap: 'Thinking', phrases: ['chain-of-thought', 'chain of thought', 'thinking mode', 'thinking budget', '<think>', 'reasoning effort', 'long-horizon reasoning', 'reasoning traces'] },
]

export function detectCapabilitiesFromText(text: string): ExplorerCapability[] {
  const t = text.toLowerCase().slice(0, 8000)
  const found: ExplorerCapability[] = []
  for (const { cap, phrases } of README_SIGNALS) {
    if (phrases.some((p) => t.includes(p)) && !found.includes(cap)) found.push(cap)
  }
  return found
}

const CAP_ORDER: ExplorerCapability[] = ['Vision', 'Tools', 'Thinking', 'Code', 'Text']

export function mergeCapabilities(base: ExplorerCapability[], extra: ExplorerCapability[]): ExplorerCapability[] {
  const set = new Set<ExplorerCapability>([...base, ...extra])
  return CAP_ORDER.filter((c) => set.has(c))
}

function paramsLabel(total?: number, tags: string[] = [], modelId = ''): string {
  if (typeof total === 'number' && total > 0) {
    if (total >= 1_000_000_000) return `${(total / 1_000_000_000).toFixed(total >= 10_000_000_000 ? 0 : 1)}B`
    if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(0)}M`
    return `${total}`
  }
  const tagHit = tags.find((t) => /^\d+(\.\d+)?b$/i.test(t))
  if (tagHit) return tagHit.toUpperCase()
  const m = modelId.match(/[-/](\d+\.?\d*)b\b/i)
  return m ? `${m[1]}B` : 'Unknown'
}

function archLabel(tags: string[], modelId: string, ggufArch?: string, modelType?: string): string {
  // Prefer the repo's own metadata (gguf.architecture / config.model_type) over id heuristics.
  const meta = (ggufArch || modelType || '').toLowerCase().trim()
  if (meta) {
    if (meta.includes('qwen')) return meta.includes('qwen3.5') || meta.includes('qwen3_5') ? 'qwen35' : 'qwen3'
    if (meta.includes('gemma')) return 'gemma3'
    if (meta.includes('llama')) return 'llama'
    if (meta.includes('mistral') || meta.includes('mixtral')) return 'mistral'
    if (meta.includes('phi')) return 'phi'
    if (meta.includes('deepseek')) return 'deepseek'
    if (/^[a-z0-9_.-]+$/.test(meta) && meta.length <= 32) return meta
  }
  const id = modelId.toLowerCase()
  if (id.includes('qwen')) return id.includes('qwen3.5') ? 'qwen35' : 'qwen3'
  if (id.includes('gemma')) return 'gemma3'
  if (id.includes('llama')) return 'llama'
  if (id.includes('mistral') || id.includes('mixtral')) return 'mistral'
  if (id.includes('phi')) return 'phi'
  if (id.includes('deepseek')) return 'deepseek'
  return tags.find((t) => ['llama', 'qwen', 'gemma', 'mistral', 'phi'].includes(t)) ?? 'transformers'
}

/**
 * Tolerant quantization parser. Matches a known quant token bounded by
 * separators or string ends (case-insensitive, `-`/`_` interchangeable), so
 * `model-Q4_K_M.gguf`, `model_q4km.gguf` and `Model.F16.gguf` all resolve —
 * anything else falls back to undefined and the UI shows the filename.
 * Covers Q2_K … Q8_0, F16/F32 (+FP16/FP32 aliases), BF16, IQ1–IQ4, MXFP, QAT.
 */
const KNOWN_QUANTS = [
  'Q3_K_L', 'Q3_K_M', 'Q3_K_S', 'Q4_K_M', 'Q4_K_S', 'Q5_K_M', 'Q5_K_S',
  'IQ2_XXS', 'IQ3_XXS', 'IQ2_XS', 'IQ3_XS', 'IQ4_XS', 'IQ4_NL',
  'IQ1_S', 'IQ1_M', 'IQ2_S', 'IQ2_M', 'IQ3_S', 'IQ3_M',
  'Q2_K', 'Q4_0', 'Q4_1', 'Q5_0', 'Q5_1', 'Q6_K', 'Q8_0', 'Q8_1',
  'BF16', 'F16', 'F32',
]
const QUANT_ALIAS: Record<string, string> = {
  Q4KM: 'Q4_K_M', Q4KS: 'Q4_K_S', Q5KM: 'Q5_K_M', Q5KS: 'Q5_K_S',
  Q3KM: 'Q3_K_M', Q3KS: 'Q3_K_S', Q2K: 'Q2_K', Q6K: 'Q6_K', Q80: 'Q8_0', Q40: 'Q4_0', Q50: 'Q5_0',
  FP16: 'F16', FP32: 'F32', FLOAT16: 'F16', FLOAT32: 'F32',
}

export function parseQuantization(basename: string): string | undefined {
  const norm = basename.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const padded = `_${norm}_`
  for (const q of KNOWN_QUANTS) {
    if (padded.includes(`_${q}_`)) return q
  }
  for (const [alias, q] of Object.entries(QUANT_ALIAS)) {
    if (padded.includes(`_${alias}_`)) return q
  }
  const mx = norm.match(/MXFP\d+/)
  if (mx && padded.includes(`_${mx[0]}_`)) return mx[0]
  const qat = norm.match(/QAT[A-Z0-9]*/)
  if (qat && padded.includes(`_${qat[0]}_`)) return qat[0]
  return undefined
}

/** Filenames that are helpers, not runnable weights (projectors, drafts, shards). */
function isAuxWeightFile(rfilename: string): boolean {
  const b = rfilename.split('/').pop()?.toLowerCase() ?? ''
  return b.includes('mmproj') || b.includes('mtp') || b.includes('imatrix') || b.includes('draft') || b.includes('shiakai')
}

/**
 * Sibling kind for Download Options rows (GGUF weights only):
 * - weight: runnable `.gguf` (excluding projector/draft/shard helpers)
 * - aux: helper weights (mmproj, imatrix, drafts) — hidden
 * - meta: informational files (.gitattributes, README.md, …) — hidden
 *
 * NOTE: safetensors / .bin / .pth siblings are `meta` HERE on purpose — this
 * classifier drives the GGUF-only download pipeline. Use `weightFormatOf` /
 * `classifyRepoFormat` for the format-aware repo view.
 */
export function classifySibling(rfilename: string): 'weight' | 'aux' | 'meta' {
  const b = (rfilename.split('/').pop() ?? '').toLowerCase()
  if (b.endsWith('.gguf')) return isAuxWeightFile(rfilename) ? 'aux' : 'weight'
  if (isAuxWeightFile(rfilename)) return 'aux'
  return 'meta'
}

// ── Format-aware repo inspection (files are the source of truth) ──

/**
 * Weight format of ONE repo file from its extension — never from the repo
 * name, README, or tags. Returns null for non-weight files. Sharded
 * safetensors (`model-00001-of-00002.safetensors`) and `.safetensors.index.json`
 * (an index, not weights) are handled: shards count, index files don't.
 */
export function weightFormatOf(rfilename: string): RepoWeightFormat | null {
  const b = (rfilename.split('/').pop() ?? '').toLowerCase()
  if (!b || b.endsWith('.safetensors.index.json')) return null
  if (b.endsWith('.gguf')) return 'gguf'
  if (b.endsWith('.safetensors')) return 'safetensors'
  if (/\.(bin|pth|pt|ckpt|onnx|h5|hdf5|msgpack|ot)$/.test(b)) return 'other'
  return null
}

/** Non-aux weight files: helper projectors/drafts never decide the format. */
export function listRepoWeightFiles(siblings: Array<{ rfilename: string }>): Array<{ rfilename: string; format: RepoWeightFormat }> {
  const out: Array<{ rfilename: string; format: RepoWeightFormat }> = []
  for (const s of siblings ?? []) {
    const f = weightFormatOf(s.rfilename)
    if (!f) continue
    if (f === 'gguf' && isAuxWeightFile(s.rfilename)) continue
    out.push({ rfilename: s.rfilename, format: f })
  }
  return out
}

/**
 * Repo-level format from the actual sibling files. Exactly one weight kind
 * → that kind; several → `mixed`. Null = no weight files at all → callers
 * must NOT present the repo as a downloadable model.
 */
export function classifyRepoFormat(siblings: Array<{ rfilename: string }>): ModelFormat | null {
  const kinds = new Set(listRepoWeightFiles(siblings).map((w) => w.format))
  if (kinds.size === 0) return null
  if (kinds.size === 1) return [...kinds][0]
  return 'mixed'
}

/** HF `gated` is boolean, occasionally a mode string — any truthy value gates. */
export function normalizeGated(gated: unknown): boolean {
  if (typeof gated === 'string') {
    const s = gated.trim().toLowerCase()
    return s !== '' && s !== 'false' && s !== 'open' && s !== 'null'
  }
  return gated === true
}

function iso(raw?: string): string {
  if (raw) { const d = new Date(raw); if (!isNaN(d.getTime())) return d.toISOString() }
  return new Date().toISOString()
}

function toExplore(hf: HfRow): ExploreModel | null {
  const tags = Array.isArray(hf.tags) ? hf.tags : []
  const caps = classifyCapabilities(tags, hf.pipeline_tag, hf.id)
  if (caps.length === 0) return null
  // Format comes from the actual repo files — and a repo with NO weight
  // files at all is not a downloadable model (never listed with fake files).
  const repoFormat = classifyRepoFormat(hf.siblings ?? [])
  if (!repoFormat) return null
  const author = hf.author || hf.id.split('/')[0] || 'unknown'
  const name = hf.id.split('/').pop() || hf.id
  // List rows carry runnable GGUF weights only (meta/helper files hidden;
  // shard parts never stand alone — detail groups them into sets).
  // Safetensors-only repos keep files=[] — the UI shows their format with
  // NO GGUF download button instead of pretending.
  const files: ExploreModelFile[] = []
  for (const s of hf.siblings ?? []) {
    if (classifySibling(s.rfilename) !== 'weight') continue
    const base = s.rfilename.split('/').pop() ?? s.rfilename
    if (parseShard(base)) continue
    files.push({
      format: 'GGUF',
      quantization: quantOf(base),
      sizeGB: 0,
      downloadUrl: `https://huggingface.co/${hf.id}/resolve/main/${s.rfilename}`,
      rfilename: s.rfilename,
      sizeBytes: 0,
      runnable: true,
      sourceRepo: hf.id,
    })
  }
  // Seed single-file size from repo storage so badges render before HEAD lookups.
  if (files.length === 1 && typeof hf.usedStorage === 'number' && hf.usedStorage > 0) {
    files[0].sizeBytes = hf.usedStorage
    files[0].sizeGB = hf.usedStorage / 1024 ** 3
  }
  const card = hf.cardData ?? {}
  const uiCaps = caps.map((c) => (c === 'Thinking' ? 'Reasoning' : c))
  const languages = Array.isArray(card.language) ? card.language : typeof card.language === 'string' ? [card.language] : undefined
  const baseModel = Array.isArray(card.base_model) ? card.base_model[0] : card.base_model
  return {
    id: hf.id,
    name,
    slug: hf.id,
    author,
    description: `${name} by ${author}`,
    longDescription: `${name} is a ${caps.join('/').toLowerCase()} model by ${author} on Hugging Face.`,
    downloads: typeof hf.downloads === 'number' ? hf.downloads : 0,
    likes: typeof hf.likes === 'number' ? hf.likes : 0,
    // No curated picks: the Recommended view is hardware-computed instead.
    staffPick: false,
    format: repoFormat,
    updatedAt: iso(hf.lastModified ?? hf.createdAt),
    parameters: paramsLabel(hf.safetensors?.total, tags, hf.id),
    architecture: archLabel(tags, hf.id, hf.gguf?.architecture, hf.config?.model_type),
    capabilities: uiCaps,
    files,
    tags,
    iconType: detectIcon(author),
    ...(typeof card.license === 'string' ? { license: card.license } : {}),
    ...(languages ? { languages } : {}),
    ...(typeof baseModel === 'string' ? { baseModel } : {}),
    ...(typeof hf.pipeline_tag === 'string' ? { pipelineTag: hf.pipeline_tag } : {}),
    // Gated comes back boolean (sometimes a 'true'/'manual'/'auto' string);
    // normalize so the UI can honestly mark gated repos.
    gated: normalizeGated(hf.gated),
    ...(typeof hf.usedStorage === 'number' ? { repoSizeBytes: hf.usedStorage } : {}),
  }
}

export function cleanExplorerReadme(raw: string, max = 12000): string {
  let t = raw.replace(/\r\n/g, '\n')
  if (t.startsWith('---\n')) { const e = t.indexOf('\n---', 3); if (e >= 0) t = t.slice(e + 4) }
  t = t.trim()
  return t.length > max ? `${t.slice(0, max)}\n\n…(truncated — open on web for full README)` : t
}

function sortParam(sortBy?: string): string {
  switch ((sortBy ?? 'Recommended').toLowerCase()) {
    case 'trending': return 'trendingScore'
    case 'recommended': return 'trendingScore'
    case 'downloads': return 'downloads'
    case 'likes': return 'likes'
    case 'lastmodified': return 'lastModified'
    default: return 'trendingScore'
  }
}

/** Raw HF rows for one server sort — keyword / sort, broad sweeps up to 100 rows. */
async function fetchHfRows(query: string, serverSort: string, limit: number): Promise<HfRow[]> {
  const params = new URLSearchParams()
  params.set('sort', serverSort)
  params.set('direction', '-1')
  params.set('limit', String(Math.min(Math.max(limit, 1), 100)))
  const q = query.trim()
  if (q) params.set('search', q)
  // Ask HF for the fields the Explorer needs (siblings keep GGUF file rows).
  // NOTE: `expand` (repeated param) with only server-valid keys — `usedStorage`
  // and `expand[]` bracket form with invalid keys return 400.
  for (const f of ['author', 'cardData', 'gated', 'lastModified', 'safetensors', 'siblings', 'likes', 'downloads', 'tags', 'pipeline_tag', 'trendingScore', 'createdAt']) {
    params.append('expand', f)
  }
  const res = await hfGet(`${HF_MODELS_API}?${params.toString()}`).catch((e) => {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'Hugging Face timed out.' : 'Could not reach Hugging Face.')
  })
  if (!res.ok) throw new Error(`Hugging Face error ${res.status}`)
  const rows = (await res.json()) as HfRow[]
  return Array.isArray(rows) ? rows : []
}

function toExploreMany(rows: HfRow[], limit: number, format: ExplorerFormatFilter = 'all'): ExploreModel[] {
  const out: ExploreModel[] = []
  for (const r of rows) {
    if (out.length >= limit) break
    const m = toExplore(r)
    if (m && matchesFormatFilter(m.format, format)) out.push(m)
  }
  return out
}

/** Core HF search — keyword / sort, broad sweeps up to 100 rows. */
async function searchHf(query: string, sortBy: string | undefined, limit: number, format: ExplorerFormatFilter = 'all'): Promise<ExploreModel[]> {
  return toExploreMany(await fetchHfRows(query, sortParam(sortBy), limit), limit, format)
}

/**
 * Developer-usage score: what lots of developers actually use and endorse,
 * with momentum as a tiebreak — log-scaled so a 1M-download workhorse beats
 * a flash-in-the-pan newcomer, while likes keep quality in the mix.
 */
export function usageScore(downloads: number, likes: number, trendingScore: number): number {
  const log = (n: number): number => Math.log10(Math.max(0, n) + 1)
  return 0.5 * log(downloads) + 0.3 * log(likes) + 0.2 * log(trendingScore)
}

function rankByUsage(rows: HfRow[]): HfRow[] {
  const seen = new Map<string, HfRow>()
  for (const r of rows) {
    if (!r || typeof r.id !== 'string' || seen.has(r.id)) continue
    seen.set(r.id, r)
  }
  return [...seen.values()].sort((a, b) =>
    usageScore(b.downloads ?? 0, b.likes ?? 0, b.trendingScore ?? 0) -
    usageScore(a.downloads ?? 0, a.likes ?? 0, a.trendingScore ?? 0),
  )
}

/**
 * Trending = top models developers actually use: merge the momentum,
 * downloads, and likes sweeps, then rank by developer-usage score.
 */
async function searchTrending(query: string, limit: number, format: ExplorerFormatFilter = 'all'): Promise<ExploreModel[]> {
  const q = query.trim()
  const lists: HfRow[][] = q
    ? [await fetchHfRows(q, 'trendingScore', limit)]
    : await Promise.all([
      fetchHfRows('', 'trendingScore', 100),
      fetchHfRows('', 'downloads', 100),
      fetchHfRows('', 'likes', 100),
    ])
  return toExploreMany(rankByUsage(lists.flat()), limit, format)
}

async function fetchOne(modelId: string): Promise<ExploreModel | null> {
  const res = await hfGet(`${HF_MODELS_API}/${modelId}`).catch(() => null)
  if (!res || !res.ok) return null
  const row = (await res.json()) as HfRow
  return toExplore(row)
}

/** Billions of params from a resolved label ("27B" → 27, "Unknown" → 0). */
function parseParamsB(label: string): number {
  const m = (label ?? '').match(/([\d.]+)\s*B/i)
  return m ? parseFloat(m[1]) : 0
}

/**
 * Hardware-aware Recommended: sweep trending, estimate each model's typical
 * Q4-GGUF footprint from its params (same 0.62 GB/B factor as the fit
 * engine), run it through the real fit estimator, and keep FULL fits first,
 * PARTIAL fits next, most-downloaded first inside each tier. Models that
 * won't fit — or whose size can't be verified — are left out instead of
 * guessed. `hwOverride` exists for tests; production uses the live profile.
 */
async function recommendForHardware(limit: number, hwOverride?: HardwareInfo): Promise<ExploreModel[]> {
  const sweep = await searchHf('', 'trending', 100)
  let hw: HardwareInfo
  if (hwOverride) {
    hw = hwOverride
  } else {
    try {
      hw = getHardwareProfile()
    } catch {
      hw = { totalRamMB: 16 * 1024, freeRamMB: 8 * 1024, gpuAvailable: false }
    }
  }
  const ranked: Array<{ m: ExploreModel; tier: number }> = []
  for (const m of sweep) {
    // Recommended is the local-inference view: only repos with runnable
    // GGUF options qualify (safetensors-only can never load locally).
    if (m.files.length === 0) continue
    const pb = parseParamsB(m.parameters)
    if (!(pb > 0)) continue // size unverifiable — exclude, never guess
    const probe: ExploreModelFile = { format: 'GGUF', sizeGB: pb * 0.62, sizeBytes: 0, downloadUrl: '', runnable: true }
    const r = estimateExplorerFit(probe, m, hw)
    const tier = r.fit === 'fullGPUOffload' || r.fit === 'fitWithoutGPU' ? 0 : r.fit === 'partialGPUOffload' ? 1 : -1
    if (tier < 0) continue
    ranked.push({ m, tier })
  }
  ranked.sort((a, b) => a.tier - b.tier || b.m.downloads - a.m.downloads)
  return ranked.slice(0, limit).map((x) => x.m)
}

/**
 * Public listing — Hugging Face primary:
 * 1. Full HF URL or org/name paste → exact model (single row).
 * 2. Empty query + Recommended → models that FULLY or PARTIALLY fit this
 *    machine (computed live from RAM/VRAM, most-downloaded first per tier).
 * 3. Else broad keyword/trending sweep (default 60, max 100), 5 families only.
 */
export async function listExplorerModels(opts: ExplorerListOpts = {}, hwOverride?: HardwareInfo): Promise<ExploreModel[]> {
  const sortBy = opts.sortBy ?? 'Recommended'
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 100)
  const format: ExplorerFormatFilter = opts.format ?? 'all'
  const parsed = parseExplorerSearch(opts.query ?? '')

  if (parsed.kind === 'url' || parsed.kind === 'id') {
    // Exact lookup bypasses the format filter — the detail view shows the
    // repo's true format (even safetensors-only) instead of hiding it.
    const one = await fetchOne(parsed.modelId as string).catch(() => null)
    if (one) return [one]
    // Fall through to keyword search when the id does not resolve
    return searchHf(parsed.modelId as string, sortBy, limit, format)
  }

  if (parsed.kind === 'empty' && sortBy.toLowerCase() === 'recommended') {
    // Recommended is inherently GGUF (local inference); a non-GGUF format
    // filter yields the honest empty set rather than a fake list.
    const recs = await recommendForHardware(limit, hwOverride)
    return recs.filter((m) => matchesFormatFilter(m.format, format))
  }

  // Trending = what developers actually use (usage-blended rank), not the raw
  // server trend score. Recommended stays hardware-aware (fits this machine).
  if (sortBy.toLowerCase() === 'trending') {
    return searchTrending(parsed.kind === 'keyword' ? (parsed.query as string) : '', limit, format)
  }

  return searchHf(parsed.kind === 'keyword' ? (parsed.query as string) : '', sortBy, limit, format)
}

// ── HF weight-file backend caches ────────────────────────────────────
const SIB_TTL_MS = 15 * 60 * 1000
const sibCache = new Map<string, { at: number; v: { repoId: string; siblings: Array<{ rfilename: string }>; downloads: number } }>()
const HEAD_TTL_MS = 60 * 60 * 1000
const headCache = new Map<string, { at: number; bytes: number }>()

async function fetchHfSiblings(repoId: string): Promise<{ repoId: string; siblings: Array<{ rfilename: string }>; downloads: number }> {
  const hit = sibCache.get(repoId.toLowerCase())
  if (hit && Date.now() - hit.at < SIB_TTL_MS) return hit.v
  const res = await hfGet(`${HF_MODELS_API}/${repoId}`).catch(() => null)
  if (!res || !res.ok) return { repoId, siblings: [], downloads: 0 }
  const row = (await res.json().catch(() => null)) as HfRow | null
  if (!row) return { repoId, siblings: [], downloads: 0 }
  const v = { repoId, siblings: row.siblings ?? [], downloads: typeof row.downloads === 'number' ? row.downloads : 0 }
  sibCache.set(repoId.toLowerCase(), { at: Date.now(), v })
  return v
}

/** HEAD byte size with a 1h cache (failures are not cached → retried next time). */
async function headBytes(url: string): Promise<number> {
  const hit = headCache.get(url)
  if (hit && Date.now() - hit.at < HEAD_TTL_MS) return hit.bytes
  try {
    const head = await hfGet(url, 'HEAD')
    const len = head.headers.get('content-length')
    const n = len ? parseInt(len, 10) : NaN
    if (Number.isFinite(n) && n > 0) {
      headCache.set(url, { at: Date.now(), bytes: n })
      return n
    }
  } catch { /* fall through */ }
  return 0
}

/**
 * Community GGUF quants for a base repo (Download Options aggregates quant
 * files from quant repos, e.g. Qwen3.8-27B → Q4_K_M 17.74 GB). Matches repos
 * whose card base_model/tags reference the base model and that actually
 * publish .gguf siblings. Bounded: 12 search hits, max 4 repos.
 */
async function fetchQuantRepos(baseId: string): Promise<Array<{ repoId: string; siblings: Array<{ rfilename: string }>; downloads: number }>> {
  const baseShort = (baseId.split('/').pop() ?? baseId).toLowerCase()
  const params = new URLSearchParams()
  params.set('sort', 'downloads')
  params.set('direction', '-1')
  params.set('limit', '12')
  params.set('search', `${baseShort} GGUF`)
  for (const f of ['likes', 'downloads', 'tags', 'pipeline_tag', 'siblings', 'cardData']) params.append('expand', f)
  const res = await hfGet(`${HF_MODELS_API}?${params.toString()}`).catch(() => null)
  if (!res || !res.ok) return []
  const rows = (await res.json()) as HfRow[]
  const out: Array<{ repoId: string; siblings: Array<{ rfilename: string }>; downloads: number }> = []
  for (const r of rows) {
    if (r.id.toLowerCase() === baseId.toLowerCase()) continue
    const ggufs = (r.siblings ?? []).filter((s) => s.rfilename.toLowerCase().endsWith('.gguf'))
    if (ggufs.length === 0) continue
    const bm = r.cardData?.base_model
    const bases = Array.isArray(bm) ? bm : bm ? [bm] : []
    const tags = (r.tags ?? []).map((t) => t.toLowerCase())
    const linked =
      bases.some((b) => b.toLowerCase().includes(baseShort) || baseId.toLowerCase().includes(b.toLowerCase())) ||
      tags.includes(`base_model:${baseId.toLowerCase()}`) ||
      r.id.toLowerCase().includes(baseShort)
    if (!linked) continue
    out.push({ repoId: r.id, siblings: ggufs, downloads: typeof r.downloads === 'number' ? r.downloads : 0 })
    if (out.length >= 4) break
  }
  // Curated publishers first (LM Studio's own community quants carry the clean
  // Q4_K_M / Q6_K / Q8_0 sets), then by downloads.
  const prio = (id: string): number => {
    const l = id.toLowerCase()
    if (l.startsWith('lmstudio-community/')) return 0
    if (l.startsWith('ggml-org/')) return 1
    if (l.startsWith('bartowski/')) return 2
    if (l.startsWith('unsloth/')) return 3
    return 4
  }
  return out.sort((a, b) => prio(a.repoId) - prio(b.repoId) || b.downloads - a.downloads)
}

/** Shard suffix: `-00001-of-00004.gguf` (dash/underscore variants). */
const SHARD_RE = /[-_]?(\d+)[-_]?of[-_]?(\d+)\.gguf$/i

/** A runnable weight is never a metadata fragment: floor at 20 MB. */
export const MIN_RUNNABLE_GGUF_BYTES = 20 * 1024 * 1024

/** Split a basename into a shard group stem + part index/total (null when whole). */
export function parseShard(basename: string): { stem: string; idx: number; total: number } | null {
  const m = basename.match(SHARD_RE)
  if (!m) return null
  const total = parseInt(m[2], 10)
  if (!(total >= 2)) return null
  return { stem: basename.slice(0, m.index), idx: parseInt(m[1], 10), total }
}

export interface ExactPickOpts {
  /** Known byte sizes keyed `${repoId}\n${rfilename}` (lowercased). */
  sizes?: Map<string, number>
  /** Attach the repo's vision projector when the model sees images. */
  vision?: boolean
}

function sizeKey(repoId: string, rfilename: string): string {
  return `${repoId.toLowerCase()}\n${rfilename.toLowerCase()}`
}

function ggufUrl(repoId: string, rfilename: string): string {
  return `https://huggingface.co/${repoId}/resolve/main/${rfilename}`
}

function quantOf(basename: string): string | undefined {
  return parseQuantization(basename)
}

/**
 * Pick the EXACT runnable options from ONE repo (the primary — callers try
 * repos in priority order and keep the first repo that yields anything, so
 * quant labels never mix files from different publishers):
 * - whole single-file weights ≥ 20 MB (fragments can never load),
 * - complete shard sets (`-00001-of-0000N`, every part present) as ONE row
 *   with the summed size — individual shards are never listed alone,
 * - meta/helper files (.gitattributes, README.md, mmproj, imatrix) hidden.
 * Shard-part files, fragments, and informational files are excluded by
 * construction, not by label. Max 10 rows.
 */
export function pickQuantOptions(
  repos: Array<{ repoId: string; siblings: Array<{ rfilename: string }> }>,
  opts: ExactPickOpts = {},
): ExploreModelFile[] {
  const PREF = ['Q4_K_M', 'Q4_K_S', 'Q5_K_M', 'Q5_K_S', 'Q6_K', 'Q8_0', 'Q4_0', 'Q5_0', 'Q3_K_M', 'Q2_K']
  const sizes = opts.sizes ?? new Map<string, number>()
  for (const repo of repos) {
    const rows = buildRepoOptions(repo.repoId, repo.siblings, sizes, opts.vision ?? false, PREF)
    if (rows.length > 0) return rows
  }
  return []
}

function buildRepoOptions(
  repoId: string,
  siblings: Array<{ rfilename: string }>,
  sizes: Map<string, number>,
  vision: boolean,
  pref: string[],
): ExploreModelFile[] {
  const bytesOf = (rfilename: string): number => sizes.get(sizeKey(repoId, rfilename)) ?? 0
  // Group shard parts by stem; everything else is a single candidate.
  const sets = new Map<string, Array<{ rfilename: string; idx: number; total: number }>>()
  const singles: string[] = []
  for (const s of siblings) {
    if (classifySibling(s.rfilename) !== 'weight') continue
    const base = s.rfilename.split('/').pop() ?? s.rfilename
    const sh = parseShard(base)
    if (sh) {
      const g = sets.get(sh.stem) ?? []
      g.push({ rfilename: s.rfilename, idx: sh.idx, total: sh.total })
      sets.set(sh.stem, g)
    } else {
      singles.push(s.rfilename)
    }
  }
  const out: ExploreModelFile[] = []
  const pushSingle = (rfilename: string): void => {
    if (out.length >= 10) return
    const n = bytesOf(rfilename)
    if (n > 0 && n < MIN_RUNNABLE_GGUF_BYTES) return // fragment, not a model
    const base = rfilename.split('/').pop() ?? rfilename
    out.push({
      format: 'GGUF',
      quantization: quantOf(base),
      sizeGB: n / 1024 ** 3,
      downloadUrl: ggufUrl(repoId, rfilename),
      rfilename,
      sizeBytes: n,
      runnable: true,
      sourceRepo: repoId,
    })
  }
  const pushSet = (stem: string, parts: Array<{ rfilename: string; idx: number; total: number }>): void => {
    if (out.length >= 10) return
    const total = parts[0].total
    const seen = new Set(parts.map((p) => p.idx))
    if (parts.length !== total || seen.size !== total) return // incomplete set: unloadable
    for (let i = 1; i <= total; i++) if (!seen.has(i)) return
    const ordered = [...parts].sort((a, b) => a.idx - b.idx)
    const partRows = ordered.map((p) => {
      const n = bytesOf(p.rfilename)
      return { rfilename: p.rfilename, downloadUrl: ggufUrl(repoId, p.rfilename), sizeBytes: n }
    })
    const sum = partRows.reduce((a, p) => a + p.sizeBytes, 0)
    const first = ordered[0].rfilename
    out.push({
      format: 'GGUF',
      quantization: quantOf(stem),
      sizeGB: sum / 1024 ** 3,
      downloadUrl: ggufUrl(repoId, first),
      rfilename: first,
      sizeBytes: sum,
      runnable: true,
      sourceRepo: repoId,
      multipart: true,
      parts: partRows,
    })
  }
  // Preferred quants first — singles and complete sets compete by quant name.
  const singleQuants = new Map<string, string[]>()
  for (const r of singles) {
    const b = (r.split('/').pop() ?? '').toUpperCase()
    const hit = pref.find((q) => b.includes(`-${q}.GGUF`) || b.endsWith(`_${q}.GGUF`) || b.includes(`-${q}-`) || b.includes(`_${q}_`))
    const k = hit ?? ''
    const g = singleQuants.get(k) ?? []
    g.push(r)
    singleQuants.set(k, g)
  }
  const setQuants = new Map<string, Array<{ stem: string; parts: Array<{ rfilename: string; idx: number; total: number }> }>>()
  for (const [stem, parts] of sets) {
    const up = stem.toUpperCase()
    const hit = pref.find((q) => up.includes(`-${q}-`) || up.includes(`_${q}_`) || up.endsWith(`-${q}`) || up.endsWith(`_${q}`) || up.includes(`-${q}.`) || up === q)
    const k = hit ?? quantOf(stem) ?? ''
    const g = setQuants.get(k) ?? []
    g.push({ stem, parts })
    setQuants.set(k, g)
  }
  for (const q of pref) {
    for (const r of singleQuants.get(q) ?? []) { pushSingle(r); if (out.length >= 10) return out }
    for (const s of setQuants.get(q) ?? []) { pushSet(s.stem, s.parts); if (out.length >= 10) return out }
  }
  // Remaining singles (unknown/new quant names), then remaining sets.
  for (const r of singleQuants.get('') ?? []) { pushSingle(r); if (out.length >= 10) return out }
  for (const s of setQuants.get('') ?? []) { pushSet(s.stem, s.parts); if (out.length >= 10) return out }
  if (vision) attachProjector(out, repoId, siblings, sizes)
  return out
}

/** Vision projector from the same repo (Q8_0 > BF16 > first found). */
function findProjector(siblings: Array<{ rfilename: string }>): string | null {
  const cands = siblings.map((s) => s.rfilename).filter((f) => f.toLowerCase().includes('mmproj') && f.toLowerCase().endsWith('.gguf'))
  if (cands.length === 0) return null
  return cands.find((f) => /q8_0/i.test(f)) ?? cands.find((f) => /bf16/i.test(f)) ?? cands[0]
}

function attachProjector(out: ExploreModelFile[], repoId: string, siblings: Array<{ rfilename: string }>, sizes: Map<string, number>): void {
  const mm = findProjector(siblings)
  if (!mm) return
  const n = sizes.get(sizeKey(repoId, mm)) ?? 0
  const companion = { rfilename: mm, downloadUrl: ggufUrl(repoId, mm), sizeBytes: n }
  for (const f of out) {
    if (f.runnable !== false && !f.companion) f.companion = companion
  }
}

/**
 * HEAD every weight sibling of one repo — GGUF, safetensors and other
 * weights alike (bounded, cached) — so shard totals, the 20 MB fragment
 * floor and the repo inventory use real bytes. Then build exact rows.
 */
async function sizeAndPick(
  repoId: string,
  siblings: Array<{ rfilename: string }>,
  sizes: Map<string, number>,
  vision: boolean,
): Promise<ExploreModelFile[]> {
  const weights = siblings.filter((s) => weightFormatOf(s.rfilename) !== null).slice(0, 40)
  await Promise.all(
    weights.map(async (s) => {
      const k = sizeKey(repoId, s.rfilename)
      if (!sizes.has(k)) sizes.set(k, await headBytes(ggufUrl(repoId, s.rfilename)))
    }),
  )
  return pickQuantOptions([{ repoId, siblings }], { sizes, vision })
}

/**
 * Full weight inventory of the BASE repo for the detail view (read-only —
 * only `files` rows are downloadable). Sizes come from the shared HEAD map
 * filled by sizeAndPick, so this costs zero extra fetches.
 */
function buildRepoInventory(
  repoId: string,
  siblings: Array<{ rfilename: string }>,
  sizes: Map<string, number>,
): ExploreRepoFile[] {
  return listRepoWeightFiles(siblings).map((w) => {
    const base = w.rfilename.split('/').pop() ?? w.rfilename
    return {
      rfilename: w.rfilename,
      format: w.format,
      quantization: parseQuantization(base),
      sizeBytes: sizes.get(sizeKey(repoId, w.rfilename)) ?? 0,
    }
  })
}

async function pickExactForModel(
  modelId: string,
  baseSiblings: Array<{ rfilename: string }>,
  quantRepos: Array<{ repoId: string; siblings: Array<{ rfilename: string }> }>,
  vision: boolean,
  sizes: Map<string, number>,
): Promise<ExploreModelFile[]> {
  const cands: Array<{ repoId: string; siblings: Array<{ rfilename: string }> }> = []
  // Base repo always first: its weights get HEAD-sized for the inventory even
  // when it holds no GGUF (pickQuantOptions then yields [] and we move on).
  cands.push({ repoId: modelId, siblings: baseSiblings })
  for (const q of quantRepos.slice(0, 4)) cands.push(q)
  for (const c of cands.slice(0, 5)) {
    const rows = await sizeAndPick(c.repoId, c.siblings, sizes, vision)
    if (rows.length > 0) return rows
  }
  return []
}

// ── Built-model cache + in-flight dedup ──────────────────────────────
// The renderer fires model + compatibility + recommendations per click —
// all three share one build; repeat opens within 5 min cost zero fetches.
const MODEL_TTL_MS = 5 * 60 * 1000
const modelCache = new Map<string, { at: number; model: ExploreModel }>()
const modelInflight = new Map<string, Promise<ExploreModel>>()

export function clearExplorerModelCache(): void {
  modelCache.clear()
  modelInflight.clear()
  sibCache.clear()
  headCache.clear()
}

/** Detail: full row + GGUF quant options + exact HEAD sizes + README. */
export async function getExplorerModel(modelId: string): Promise<ExploreModel> {
  const id = (modelId ?? '').trim().replace(/\/$/, '')
  if (!id.includes('/')) throw new Error(`“${modelId}” is not a model id (expected owner/name).`)
  const hit = modelCache.get(id)
  if (hit && Date.now() - hit.at < MODEL_TTL_MS) return hit.model
  let p = modelInflight.get(id)
  if (!p) {
    p = buildExplorerModel(id)
      .then((m) => { modelCache.set(id, { at: Date.now(), model: m }); return m })
      .finally(() => { modelInflight.delete(id) })
    modelInflight.set(id, p)
  }
  return p
}

async function buildExplorerModel(id: string): Promise<ExploreModel> {
  const res = await hfGet(`${HF_MODELS_API}/${id}`).catch((e) => {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'Hugging Face timed out.' : 'Could not reach Hugging Face.')
  })
  if (!res.ok) throw new Error(`Hugging Face error ${res.status}`)
  const row = (await res.json()) as HfRow
  const mapped = toExplore(row)
  if (!mapped) throw new Error('Model is not a text/vision/tools/code/reasoning model.')
  // EXACT runnable options only: the base repo first (covers GGUF-native
  // repos pasted directly), then linked community quant repos in priority
  // order. First repo with a complete single weight or shard set wins — quant
  // labels never mix files from different publishers, shard parts are never
  // listed alone, and sub-20 MB fragments are dropped.
  // A safetensors-only base repo is NOT downloadable GGUF: its own files stay
  // empty while community GGUF rows (each tagged with its source repo) may
  // still offer runnable options — association without merging.
  const sizes = new Map<string, number>()
  const vision = mapped.capabilities.some((c) => c.toLowerCase().includes('vision'))
  mapped.files = await pickExactForModel(mapped.id, row.siblings ?? [], await fetchQuantRepos(mapped.id), vision, sizes)
  // Repo format + full weight inventory from the BASE repo's own files.
  mapped.format = classifyRepoFormat(row.siblings ?? []) ?? mapped.format
  mapped.repoFiles = buildRepoInventory(mapped.id, row.siblings ?? [], sizes)
  // README lives on main or master depending on the repo
  for (const branch of ['main', 'master']) {
    try {
      const readme = await hfGet(`https://huggingface.co/${id}/raw/${branch}/README.md`)
      if (readme.ok) { mapped.readme = cleanExplorerReadme(await readme.text()); break }
    } catch { /* try next branch */ }
  }
  // Second evidence pass: the card text often states capabilities the tags
  // omit (tool calling, benchmarks, chain-of-thought) — merge them in.
  if (mapped.readme) {
    const extra = detectCapabilitiesFromText(mapped.readme)
    if (extra.length > 0) {
      const baseCaps = mapped.capabilities.map((c) => (c === 'Reasoning' ? 'Thinking' : c) as ExplorerCapability)
      mapped.capabilities = mergeCapabilities(baseCaps, extra).map((c) => (c === 'Thinking' ? 'Reasoning' : c))
    }
  }
  return mapped
}
