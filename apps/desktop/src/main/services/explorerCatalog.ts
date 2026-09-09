/**
 * Explorer catalog — fresh LM Studio-parity Hugging Face listing.
 *
 * Sources (LM Studio only, no git history):
 * - HF public API: GET https://huggingface.co/api/models?search=&sort=trendingScore|downloads|likes|lastModified&direction=-1&limit=&expand=
 *   (valid expands: author, cardData, gated, lastModified, safetensors, siblings,
 *   likes, downloads, tags, pipeline_tag, trendingScore, createdAt — usedStorage is
 *   NOT a valid list expand and returns 400)
 * - LM Studio docs: in-app downloader searches HF by keyword, `user/model`, or full HF URL paste;
 *   staff picks shown when query empty (lmstudio.ai/models + `lms get` fuzzyFindStaffPicks).
 * - HF x LM Studio guide: trending GGUF entry https://huggingface.co/models?library=gguf&sort=trending
 *
 * Scope: ONLY text / vision / tools / code / thinking (reasoning) models.
 * Everything else (text-to-image, audio, video, classification heads) is dropped.
 */
import type { ExploreModel, ExploreModelFile } from '@shared/types/explore'

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

// Curated staff picks (mirrors lmstudio.ai/models trending order, screenshot order).
// Fetched individually so the Recommended view is stable even when HF trending shifts.
export const STAFF_PICKS: string[] = [
  'Qwen/Qwen3.8-27B',
  'prismml/bonsai-27b',
  'google/gemma-4-12b',
  'google/gemma-4-26b-a4b',
  'google/gemma-4-31b',
  'google/gemma-4-12b-qat',
  'google/gemma-4-31b-qat',
  'Qwen/Qwen3.6-27B',
  'google/gemma-4-4b',
  'google/gemma-4-2b',
]

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

export interface ExplorerListOpts {
  sortBy?: string // Recommended | trending | downloads | likes | lastModified
  query?: string // keyword, user/model, or full HF URL
  limit?: number
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

/** LM Studio search box accepts keyword, `org/name`, or a full HF URL paste. */
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
  // Curated family knowledge: well-known lines whose HF tags under-report
  // capabilities (e.g. unsloth GGUF quants carry no code/tool tags at all).
  for (const fam of KNOWN_FAMILIES) {
    if (fam.match.some((m) => id.includes(m))) {
      for (const c of fam.add) if (!caps.includes(c)) caps.push(c)
    }
  }
  if (caps.length === 0) return []
  // Text is implied for tool/code/thinking bases — surface it so the row always shows its base family
  if (!caps.includes('Text') && (pt === 'text-generation' || pt === 'conversational' || pt === '')) caps.unshift('Text')
  return caps
}

// Curated family knowledge (id substrings → ensured capabilities).
const KNOWN_FAMILIES: Array<{ match: string[]; add: ExplorerCapability[] }> = [
  { match: ['coder', 'codestral', 'devstral', 'starcoder', 'wizardcoder', 'deepseek-coder', 'starcoder2', 'codegemma', 'codeqwen'], add: ['Code', 'Tools'] },
  { match: ['qwen2-vl', 'qwen2.5-vl', 'qwen3-vl', 'qwen3.8', 'gemma-3', 'gemma-4', 'llama-3.2-vision', 'llama-3.2-11b', 'llama-3.2-90b', 'mistral-small-3.1', 'phi-4-multimodal', 'minicpm-v', 'llava', 'janus', 'qwen-vl'], add: ['Vision'] },
  { match: ['deepseek-r1', 'qwq', 'qwen3-thinking', 'phi-4-reasoning', 'magistral', 'r1-distill', 'open-reasoner', 's1-', 'nemotron-thinking'], add: ['Thinking'] },
  { match: ['gpt-oss'], add: ['Tools', 'Thinking'] },
  { match: ['functiongemma', 'granite-4', 'glm-4', 'hermes-2-pro', 'hermes-3', 'nexusraven', 'toolace', 'firefunction', 'hammer2'], add: ['Tools'] },
]

/** Phrase evidence mined from the model card text (README fallback when tags
 *  are silent). Multi-word phrases only where a bare word false-positives
 *  (e.g. 'code' inside 'encode'). Scans the first 8k chars. */
const README_SIGNALS: Array<{ cap: ExplorerCapability; phrases: string[] }> = [
  { cap: 'Vision', phrases: ['vision-language', 'vision language', 'image understanding', 'understands images', 'image input', 'multimodal', 'visual perception', 'visual reasoning', 'text and image', 'image and text', 'video input', 'see images'] },
  { cap: 'Tools', phrases: ['tool call', 'tool-call', 'toolcall', 'function call', 'function-call', 'function calling', 'tool use', 'tool-use', 'can call functions', 'agentic', 'function gemma'] },
  { cap: 'Code', phrases: ['coding', 'code generation', 'programmer', 'software engineering', 'software engineer', 'code completion', 'humaneval', 'mbpp', 'swe-bench', 'write code', 'debug code', 'code understanding', 'programming'] },
  { cap: 'Thinking', phrases: ['reasoning', 'chain-of-thought', 'chain of thought', 'thinking mode', 'thinking budget', '<think>', 'reasoning effort', 'long-horizon reasoning', 'self-reflect', 'reasoning traces'] },
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

const QUANT_RE = /(Q\d+_[A-Z0-9_]+|IQ\d+_[A-Z0-9_]+|MXFP\d+(?:_[A-Z0-9_]+)?|QAT[^/]*)/i

function ggufFiles(modelId: string, siblings: Array<{ rfilename: string }>): ExploreModelFile[] {
  const out: ExploreModelFile[] = []
  for (const s of siblings.filter((x) => x.rfilename.toLowerCase().endsWith('.gguf'))) {
    const base = s.rfilename.split('/').pop() ?? s.rfilename
    const q = base.match(QUANT_RE)
    out.push({
      format: 'GGUF',
      quantization: q ? q[0].toUpperCase() : undefined,
      sizeGB: 0,
      downloadUrl: `https://huggingface.co/${modelId}/resolve/main/${s.rfilename}`,
      rfilename: s.rfilename,
      sizeBytes: 0,
    })
  }
  if (siblings.some((s) => s.rfilename.toLowerCase().includes('mlx') || s.rfilename.toLowerCase().endsWith('.mlx'))) {
    out.push({ format: 'MLX', sizeGB: 0, downloadUrl: '' })
  }
  return out
}

function iso(raw?: string): string {
  if (raw) { const d = new Date(raw); if (!isNaN(d.getTime())) return d.toISOString() }
  return new Date().toISOString()
}

function toExplore(hf: HfRow): ExploreModel | null {
  const tags = Array.isArray(hf.tags) ? hf.tags : []
  const caps = classifyCapabilities(tags, hf.pipeline_tag, hf.id)
  if (caps.length === 0) return null
  const author = hf.author || hf.id.split('/')[0] || 'unknown'
  const name = hf.id.split('/').pop() || hf.id
  const files = ggufFiles(hf.id, hf.siblings ?? [])
  // Seed single-file size from repo storage so badges render before HEAD lookups.
  // NOTE: never synthesize fake file entries (e.g. model.safetensors → /tree/main
  // is an HTML page, not a download — it produced bogus 448 KB rows). Repos
  // without downloadable weights keep an empty list; detail aggregation fills
  // GGUF quants from community repos instead.
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
    staffPick: STAFF_PICKS.includes(hf.id),
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
    ...(typeof hf.gated === 'boolean' ? { gated: hf.gated } : {}),
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

/** Core HF search — keyword / pipeline filters, LM Studio query shape. */
async function searchHf(query: string, sortBy: string | undefined, limit: number): Promise<ExploreModel[]> {
  const params = new URLSearchParams()
  params.set('sort', sortParam(sortBy))
  params.set('direction', '-1')
  params.set('limit', String(Math.min(Math.max(limit, 1), 100)))
  const q = query.trim()
  if (q) params.set('search', q)
  // Ask HF for the fields LM Studio needs (siblings keep GGUF file rows).
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
  const out: ExploreModel[] = []
  for (const r of rows) { const m = toExplore(r); if (m) out.push(m) }
  return out
}

async function fetchOne(modelId: string): Promise<ExploreModel | null> {
  const res = await hfGet(`${HF_MODELS_API}/${modelId}`).catch(() => null)
  if (!res || !res.ok) return null
  const row = (await res.json()) as HfRow
  return toExplore(row)
}

/**
 * Public listing — LM Studio behavior:
 * 1. Full HF URL or org/name paste → exact model (single row).
 * 2. Empty query + Recommended → staff picks in curated order.
 * 3. Else keyword search, filtered to the 5 families.
 */
export async function listExplorerModels(opts: ExplorerListOpts = {}): Promise<ExploreModel[]> {
  const sortBy = opts.sortBy ?? 'Recommended'
  const limit = opts.limit ?? 30
  const parsed = parseExplorerSearch(opts.query ?? '')

  if (parsed.kind === 'url' || parsed.kind === 'id') {
    const one = await fetchOne(parsed.modelId as string)
    if (one) return [one]
    // Fall through to keyword search when the id does not resolve
    return searchHf(parsed.modelId as string, sortBy, limit)
  }

  if (parsed.kind === 'empty' && (sortBy ?? 'Recommended').toLowerCase() === 'recommended') {
    // Staff picks first — parallel, bounded, order-preserving.
    // Misses (renamed/gated repos) are skipped; empty result falls through to live trending.
    const settled = await Promise.all(STAFF_PICKS.map((id) => fetchOne(id)))
    const picks = settled.filter((m): m is ExploreModel => m !== null)
    if (picks.length > 0) return picks.slice(0, Math.max(limit, picks.length))
  }

  return searchHf(parsed.kind === 'keyword' ? (parsed.query as string) : '', sortBy, limit)
}

/**
 * Community GGUF quants for a base repo (LM Studio behaviour: Download Options
 * aggregate quant files from quant repos, e.g. Qwen3.8-27B → Q4_K_M 17.74 GB).
 * Matches repos whose card base_model/tags reference the base model and that
 * actually publish .gguf siblings. Bounded: 12 search hits, max 3 repos.
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

/** Filenames that are helpers, not runnable weights (projectors, drafts, shards). */
function isAuxWeightFile(rfilename: string): boolean {
  const b = rfilename.split('/').pop()?.toLowerCase() ?? ''
  return b.includes('mmproj') || b.includes('mtp') || b.includes('imatrix') || b.includes('draft') || b.includes('shiakai')
}

/**
 * Pick the LM Studio-style quant menu: preferred K-quants first
 * (Q4_K_M → Q8_0), skipping projector/draft/shard helpers, max 10 files.
 */
function pickQuantOptions(repos: Array<{ repoId: string; siblings: Array<{ rfilename: string }> }>): ExploreModelFile[] {
  const PREF = ['Q4_K_M', 'Q4_K_S', 'Q5_K_M', 'Q5_K_S', 'Q6_K', 'Q8_0', 'Q4_0', 'Q5_0', 'Q3_K_M', 'Q2_K']
  const out: ExploreModelFile[] = []
  const used = new Set<string>()
  const push = (repoId: string, rfilename: string): void => {
    if (out.length >= 10 || used.has(rfilename)) return
    used.add(rfilename)
    const base = rfilename.split('/').pop() ?? rfilename
    const q = base.match(QUANT_RE)
    out.push({
      format: 'GGUF',
      quantization: q ? q[0].toUpperCase() : undefined,
      sizeGB: 0,
      downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${rfilename}`,
      rfilename,
      sizeBytes: 0,
    })
  }
  for (const quant of PREF) {
    for (const repo of repos) {
      const hit = repo.siblings.find((s) => {
        if (isAuxWeightFile(s.rfilename)) return false
        const b = (s.rfilename.split('/').pop() ?? '').toUpperCase()
        return b.includes(`-${quant}.GGUF`) || b.endsWith(`_${quant}.GGUF`)
      })
      if (hit) { push(repo.repoId, hit.rfilename); break }
    }
  }
  // Fill remaining slots with other runnable weights (still skipping helpers)
  for (const repo of repos) {
    for (const s of repo.siblings) {
      if (out.length >= 10) break
      if (isAuxWeightFile(s.rfilename)) continue
      push(repo.repoId, s.rfilename)
    }
    if (out.length >= 10) break
  }
  return out
}

// ── LM Studio curated catalog overlay ─────────────────────────────────
// Source: lmstudio-ai/model-catalog — the curated descriptors behind LM
// Studio's Discover content (description, author, numParameters, arch,
// trainedFor, per-file sizes). HF stays the base + fallback so models the
// catalog doesn't cover (e.g. 2025+ releases) still resolve fully.
const LM_CATALOG_URL = 'https://raw.githubusercontent.com/lmstudio-ai/model-catalog/main/catalog.json'

interface LmCatalogEntry {
  name?: string
  description?: string
  author?: { name?: string; url?: string; blurb?: string }
  numParameters?: string
  arch?: string
  trainedFor?: string
  resources?: { canonicalUrl?: string; paperUrl?: string; downloadUrl?: string }
}

let lmCatalogIndex: Promise<Map<string, LmCatalogEntry>> | null = null

function loadLmCatalog(): Promise<Map<string, LmCatalogEntry>> {
  if (!lmCatalogIndex) {
    lmCatalogIndex = (async () => {
      const idx = new Map<string, LmCatalogEntry>()
      const res = await hfGet(LM_CATALOG_URL).catch(() => null)
      if (!res || !res.ok) return idx
      const arr = (await res.json().catch((): unknown[] => [])) as LmCatalogEntry[]
      if (!Array.isArray(arr)) return idx
      for (const e of arr) {
        if (!e || typeof e !== 'object') continue
        for (const u of [e.resources?.canonicalUrl, e.resources?.downloadUrl]) {
          const m = (u ?? '').match(/^https?:\/\/(?:www\.)?huggingface\.co\/([^/\s]+\/[^/\s?#]+)/i)
          const repo = m ? m[1].toLowerCase() : null
          if (repo && !idx.has(repo)) idx.set(repo, e)
        }
      }
      return idx
    })().catch(() => new Map<string, LmCatalogEntry>())
  }
  return lmCatalogIndex
}

/** Overlay LM Studio curated details onto an HF-mapped model (HF fallback). */
export async function overlayLmStudioDetails(model: ExploreModel): Promise<ExploreModel> {
  try {
    const idx = await loadLmCatalog()
    const hit = idx.get(model.id.toLowerCase())
    if (!hit) return model
    const next: ExploreModel = { ...model, files: [...model.files], capabilities: [...model.capabilities] }
    if (hit.description) {
      next.longDescription = hit.description
      next.description = hit.description.length > 140 ? `${hit.description.slice(0, 139)}…` : hit.description
    }
    if (hit.numParameters) next.parameters = hit.numParameters
    if (hit.arch) next.architecture = hit.arch
    if (hit.trainedFor && /chat|instruct/i.test(hit.trainedFor) && !next.capabilities.includes('Chat')) {
      next.capabilities = [...next.capabilities, 'Chat']
    }
    return next
  } catch {
    return model
  }
}

/** Detail: full row + exact GGUF byte sizes (HEAD) + README. */
export async function getExplorerModel(modelId: string): Promise<ExploreModel> {
  const res = await hfGet(`${HF_MODELS_API}/${modelId}`).catch((e) => {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'Hugging Face timed out.' : 'Could not reach Hugging Face.')
  })
  if (!res.ok) throw new Error(`Hugging Face error ${res.status}`)
  const row = (await res.json()) as HfRow
  const base = toExplore(row)
  if (!base) throw new Error('Model is not a text/vision/tools/code/reasoning model.')
  // Curated LM Studio details first (description/arch/params), HF underneath.
  const mapped = await overlayLmStudioDetails(base)
  // Base repos (e.g. Qwen/Qwen3.8-27B) ship safetensors only — pull the GGUF
  // quant options LM Studio shows from linked community quant repos
  // (lmstudio-community first: the clean Q4_K_M / Q6_K / Q8_0 sets).
  if (!mapped.files.some((f) => f.format === 'GGUF')) {
    const quantRepos = await fetchQuantRepos(mapped.id)
    mapped.files.push(...pickQuantOptions(quantRepos))
  }
  // HEAD sizes for real 17.74 GB labels (resolve URLs only — never pages)
  await Promise.all(
    mapped.files.filter((f) => f.downloadUrl.includes('/resolve/')).slice(0, 12).map(async (f) => {
      try {
        const head = await hfGet(f.downloadUrl, 'HEAD')
        const len = head.headers.get('content-length')
        const n = len ? parseInt(len, 10) : NaN
        if (Number.isFinite(n) && n > 0) { f.sizeBytes = n; f.sizeGB = n / 1024 ** 3 }
      } catch { /* keep seeded size */ }
    }),
  )
  // README lives on main or master depending on the repo
  for (const branch of ['main', 'master']) {
    try {
      const readme = await hfGet(`https://huggingface.co/${modelId}/raw/${branch}/README.md`)
      if (readme.ok) { mapped.readme = cleanExplorerReadme(await readme.text()); break }
    } catch { /* try next branch */ }
  }
  // Second evidence pass: the card text often states capabilities the tags
  // omit (tool calling, coding, vision, reasoning) — merge them in.
  if (mapped.readme) {
    const extra = detectCapabilitiesFromText(mapped.readme)
    if (extra.length > 0) {
      const base = mapped.capabilities.map((c) => (c === 'Reasoning' ? 'Thinking' : c) as ExplorerCapability)
      mapped.capabilities = mergeCapabilities(base, extra).map((c) => (c === 'Thinking' ? 'Reasoning' : c))
    }
  }
  return mapped
}
