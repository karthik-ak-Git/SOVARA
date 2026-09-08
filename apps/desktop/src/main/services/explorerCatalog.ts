/**
 * Explorer catalog — fresh LM Studio-parity Hugging Face listing.
 *
 * Sources (LM Studio only, no git history):
 * - HF public API: GET https://huggingface.co/api/models?search=&sort=trendingScore|downloads|likes|lastModified&direction=-1&limit=&filter=&expand[]=
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
  'qwen/qwen3.8-27b',
  'prismml/bonsai-27b',
  'google/gemma-4-12b',
  'google/gemma-4-26b-a4b',
  'google/gemma-4-31b',
  'google/gemma-4-12b-qat',
  'google/gemma-4-31b-qat',
  'qwen/qwen3.6-27b',
  'google/gemma-4-4b',
  'google/gemma-4-2b',
]

interface HfCard {
  license?: string
  language?: string | string[]
  base_model?: string
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
  if (bag.includes('code') || bag.includes('coding') || bag.includes('programming') || id.includes('coder') || id.includes('code')) {
    caps.push('Code')
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

function archLabel(tags: string[], modelId: string): string {
  const id = modelId.toLowerCase()
  if (id.includes('qwen')) return id.includes('qwen3.5') ? 'qwen35' : 'qwen3'
  if (id.includes('gemma')) return 'gemma3'
  if (id.includes('llama')) return 'llama'
  if (id.includes('mistral') || id.includes('mixtral')) return 'mistral'
  if (id.includes('phi')) return 'phi'
  if (id.includes('deepseek')) return 'deepseek'
  return tags.find((t) => ['llama', 'qwen', 'gemma', 'mistral', 'phi'].includes(t)) ?? 'transformers'
}

function ggufFiles(modelId: string, siblings: Array<{ rfilename: string }>): ExploreModelFile[] {
  const out: ExploreModelFile[] = []
  for (const s of siblings.filter((x) => x.rfilename.toLowerCase().endsWith('.gguf'))) {
    const base = s.rfilename.split('/').pop() ?? s.rfilename
    const q = base.match(/Q\d+_[A-Z0-9_]+/i)
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
  // Seed single-file size from repo storage so badges render before HEAD lookups
  if (files.length === 1 && typeof hf.usedStorage === 'number' && hf.usedStorage > 0) {
    files[0].sizeBytes = hf.usedStorage
    files[0].sizeGB = hf.usedStorage / 1024 ** 3
  }
  let finalFiles = files
  if (finalFiles.length === 0 && typeof hf.usedStorage === 'number' && hf.usedStorage > 512 * 1024 * 1024) {
    finalFiles = [{ format: 'safetensors', sizeGB: hf.usedStorage / 1024 ** 3, sizeBytes: hf.usedStorage, downloadUrl: `https://huggingface.co/${hf.id}/tree/main`, rfilename: 'model.safetensors' }]
  }
  const card = hf.cardData ?? {}
  const uiCaps = caps.map((c) => (c === 'Thinking' ? 'Reasoning' : c))
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
    architecture: archLabel(tags, hf.id),
    capabilities: uiCaps,
    files: finalFiles,
    tags,
    iconType: detectIcon(author),
    ...(typeof card.license === 'string' ? { license: card.license } : {}),
    ...(typeof card.base_model === 'string' ? { baseModel: card.base_model } : {}),
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
  // Ask HF for the fields LM Studio needs (keeps siblings for GGUF file rows)
  for (const f of ['downloads', 'likes', 'trendingScore', 'pipeline_tag', 'tags', 'gated', 'createdAt', 'lastModified', 'siblings', 'usedStorage']) {
    params.append('expand[]', f)
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

  if (parsed.kind === 'empty' && sortParam(sortBy) === 'trendingScore') {
    // Staff picks first — parallel, bounded, order-preserving
    const settled = await Promise.all(STAFF_PICKS.map((id) => fetchOne(id)))
    const picks = settled.filter((m): m is ExploreModel => m !== null)
    if (picks.length > 0) return picks.slice(0, Math.max(limit, picks.length))
  }

  return searchHf(parsed.kind === 'keyword' ? (parsed.query as string) : '', sortBy, limit)
}

/** Detail: full row + exact GGUF byte sizes (HEAD) + README. */
export async function getExplorerModel(modelId: string): Promise<ExploreModel> {
  const res = await hfGet(`${HF_MODELS_API}/${modelId}`).catch((e) => {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'Hugging Face timed out.' : 'Could not reach Hugging Face.')
  })
  if (!res.ok) throw new Error(`Hugging Face error ${res.status}`)
  const row = (await res.json()) as HfRow
  const mapped = toExplore(row)
  if (!mapped) throw new Error('Model is not a text/vision/tools/code/reasoning model.')
  // HEAD sizes for real 17.74 GB labels
  await Promise.all(
    mapped.files.filter((f) => f.downloadUrl).slice(0, 12).map(async (f) => {
      try {
        const head = await hfGet(f.downloadUrl, 'HEAD')
        const len = head.headers.get('content-length')
        const n = len ? parseInt(len, 10) : NaN
        if (Number.isFinite(n) && n > 0) { f.sizeBytes = n; f.sizeGB = n / 1024 ** 3 }
      } catch { /* keep seeded size */ }
    }),
  )
  try {
    const readme = await hfGet(`https://huggingface.co/${modelId}/raw/main/README.md`)
    if (readme.ok) mapped.readme = cleanExplorerReadme(await readme.text())
  } catch { /* no readme */ }
  return mapped
}
