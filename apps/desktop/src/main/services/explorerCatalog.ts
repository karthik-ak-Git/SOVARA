/**
 * Explorer catalog — LM Studio model catalog as the source of truth.
 *
 * Source: https://lmstudio.ai/models (server-rendered, no key, no auth).
 * - List:   GET /models → family cards (slug, name, downloads, sizes, dates,
 *           capability chips: lm-yellow=Vision, lm-blue=Tools, lm-green=Reasoning)
 * - Family: GET /models/{slug} → downloadable variants `owner/name` + sizes +
 *           stars + base HF repo link
 * - Variant: GET /models/{owner}/{name} → embedded `artifact` JSON (downloads,
 *           likes, dates, revision) + config YAML booleans (`vision`, `reasoning`,
 *           `trainedForToolUse`, `contextLengths`, `paramsStrings`,
 *           `minMemoryUsageBytes`, `architectures`, `compatibilityTypes`) +
 *           Sources (HF repo per format: GGUF / MLX)
 * - Download dropdown on the site is only a deep-link (`/deeplink`) + CLI
 *   (`lms get owner/name`) — no direct file URLs. Actual weight files are
 *   enumerated from the variant's GGUF Source repo via the HF file API.
 *
 * Hugging Face is therefore used ONLY as the weight-file backend (siblings
 * listing, HEAD sizes, README raw). Every user-facing field — capabilities,
 * params, arch, memory, context, downloads — comes from LM Studio curation.
 */
import type { ExploreModel, ExploreModelFile } from '@shared/types/explore'

const LM_BASE = 'https://lmstudio.ai'
const LM_TIMEOUT_MS = 25000
const LM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SOVARA-Explorer/1.0'

const HF_MODELS_API = 'https://huggingface.co/api/models'
const HF_TIMEOUT_MS = 20000

// ── LM fetch + TTL cache ─────────────────────────────────────────────
// List page ~1 MB, variant pages ~1 MB; cache aggressively so repeat
// opens/searches never refetch (51 families + variants on first sweep).
const lmCache = new Map<string, { at: number; body: string }>()
const LM_TTL_MS = 30 * 60 * 1000

export function clearLmCache(): void {
  lmCache.clear()
}

async function lmGetText(url: string): Promise<string> {
  const hit = lmCache.get(url)
  if (hit && Date.now() - hit.at < LM_TTL_MS) return hit.body
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), LM_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': LM_UA, Accept: 'text/html' },
    }).catch((e) => {
      throw new Error(e instanceof Error && e.name === 'AbortError' ? 'LM Studio catalog timed out.' : 'Could not reach lmstudio.ai.')
    })
    if (!res.ok) {
      const err = new Error(`LM Studio catalog error ${res.status}`) as Error & { status?: number }
      err.status = res.status
      throw err
    }
    const body = await res.text()
    lmCache.set(url, { at: Date.now(), body })
    return body
  } finally {
    clearTimeout(timer)
  }
}

// ── Small parsers (exported for tests) ───────────────────────────────
/** "1.2M" / "3.4K" / "102" → number. */
export function parseLmCount(raw: string): number {
  const s = (raw ?? '').trim().replace(/,/g, '')
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i)
  if (!m) return 0
  const mult = m[2]?.toUpperCase() === 'B' ? 1e9 : m[2]?.toUpperCase() === 'M' ? 1e6 : m[2]?.toUpperCase() === 'K' ? 1e3 : 1
  return Math.round(parseFloat(m[1]) * mult)
}

/** "16.10 GB" / "850 MB" / "900 KB" → GB. */
export function parseLmSizeGB(raw: string): number {
  const m = (raw ?? '').trim().match(/^([\d.]+)\s*([KMGT]?B)$/i)
  if (!m) return 0
  const n = parseFloat(m[1])
  const u = m[2].toUpperCase()
  if (u === 'TB') return n * 1024
  if (u === 'GB') return n
  if (u === 'MB') return n / 1024
  return n / 1024 ** 2
}

/** "25 days ago" / "3 months ago" / "1 year ago" / "5 hours ago" → ISO date. */
export function parseLmUpdatedAgo(raw: string): string {
  const m = (raw ?? '').trim().match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i)
  if (!m) return new Date().toISOString()
  const n = parseInt(m[1], 10)
  const unit = m[2].toLowerCase()
  const ms = unit.startsWith('minute') ? n * 60e3 : unit.startsWith('hour') ? n * 3600e3 : unit.startsWith('week') ? n * 7 * 86400e3 : unit.startsWith('month') ? n * 30 * 86400e3 : unit.startsWith('year') ? n * 365 * 86400e3 : n * 86400e3
  return new Date(Date.now() - ms).toISOString()
}

/**
 * Extract the embedded `artifact` object from LM RSC payloads.
 * The JSON sits inside an escaped JS string, so EVERY quote — structural
 * ones included — is written `\"`. The scan therefore treats `\"` as a
 * plain quote toggle and `\\` as an escaped backslash; bare braces outside
 * strings count toward depth. The slice is unescaped before JSON.parse,
 * which validates the boundary (null on failure).
 */
export function extractLmArtifact(html: string): Record<string, unknown> | null {
  const marker = '\\"artifact\\"'
  const mi = html.indexOf(marker)
  if (mi < 0) return null
  let i = mi + marker.length
  while (i < html.length && html[i] !== '{') i++
  if (i >= html.length) return null
  let depth = 0
  let inStr = false
  let start = -1
  for (let j = i; j < html.length; j++) {
    const ch = html[j]
    if (ch === '\\' && j + 1 < html.length) {
      const nx = html[j + 1]
      if (nx === '"') { inStr = !inStr; j++; continue }
      if (nx === '\\') { j++; continue }
    }
    if (inStr) {
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') { if (depth === 0) start = j; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) {
        const raw = html.slice(start, j + 1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        try {
          return JSON.parse(raw) as Record<string, unknown>
        } catch {
          return null
        }
      }
    }
  }
  return null
}

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

// Recommended view = lmstudio.ai/models page order (LM's own curation).
// Kept as a fallback seed; live page order wins whenever reachable.
export const STAFF_PICKS: string[] = [
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
  'google/gemma-4-12b',
  'google/gemma-4-31b',
  'deepseek-ai/deepseek-r1-distill-qwen-7b',
  'meta-llama/llama-3.1-8b-instruct',
  'mistralai/mistral-7b-instruct-v0.3',
  'microsoft/phi-4-reasoning',
  'qwen/qwen2.5-vl-7b-instruct',
  'mistralai/codestral-22b',
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

/**
 * Explorer search accepts keyword, `owner/name`, an lmstudio.ai model URL
 * paste (`/models/{owner}/{name}` or family `/models/{slug}`), or a legacy
 * Hugging Face URL paste (resolved best-effort against LM sources).
 */
export function parseExplorerSearch(input: string): { kind: 'empty' | 'url' | 'id' | 'family' | 'keyword'; modelId?: string; slug?: string; query?: string } {
  const s = (input ?? '').trim()
  if (!s) return { kind: 'empty' }
  const lmVariant = s.match(/^https?:\/\/(?:www\.)?lmstudio\.ai\/models\/([^/\s]+\/[^/\s?#]+)/i)
  if (lmVariant) return { kind: 'url', modelId: lmVariant[1].replace(/\/$/, '') }
  const lmFamily = s.match(/^https?:\/\/(?:www\.)?lmstudio\.ai\/models\/([^/\s?#]+)/i)
  if (lmFamily) return { kind: 'family', slug: lmFamily[1].replace(/\/$/, '') }
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

// ── LM Studio catalog provider ───────────────────────────────────────
export interface LmFamilyCard {
  slug: string
  name: string
  downloadable: boolean
  cloud: boolean
  sizes: string[]
  downloads: number
  likes: number
  updatedAgo: string
  /** Capability chip colors: lm-yellow=Vision, lm-blue=Tools, lm-green=Reasoning. */
  chips: string[]
  description: string
}

export interface LmVariantRow {
  id: string // owner/name
  sizeGB: number
  stars: number
}

/** Parse family cards from the /models list HTML. */
export function parseLmFamilies(html: string): LmFamilyCard[] {
  const out: LmFamilyCard[] = []
  const re = /<a data-model-page-([^>]*?)href="\/models\/([a-z0-9][a-z0-9._-]*)"([\s\S]*?)<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = m[1]
    const slug = m[2]
    const card = m[3]
    const nameM = card.match(/text-lg font-medium">([^<]{1,80})/)
    if (!nameM) continue
    const chips = [...new Set([...card.matchAll(/--(lm-[a-z]+)/g)].map((x) => x[1]))]
    const sizes = [...new Set([...card.matchAll(/title="Model size: ([^"]+?)"/g)].map((x) => x[1].replace(/\s*parameters$/, '').trim()))]
    const dlM = card.match(/data-model-page-downloads="(\d+)"/)
    const likesM = card.match(/polygon points="12 2 15\.09[\s\S]{0,500}?<span class="font-medium">([\d,]+)<\/span>/)
    const updM = card.match(/Updated <!-- -->([^<]+)</)
    const descM = card.match(/<div[^>]*>([^<]{30,600})<\/div><\/div><div class="flex flex-row items-center justify-between/)
    out.push({
      slug,
      name: nameM[1].trim(),
      downloadable: attrs.includes('data-model-page-has-downloads="true"'),
      cloud: attrs.includes('data-model-page-has-cloud="true"'),
      sizes,
      downloads: dlM ? parseInt(dlM[1], 10) : 0,
      likes: likesM ? parseInt(likesM[1].replace(/,/g, ''), 10) : 0,
      updatedAgo: updM ? updM[1].trim() : '',
      chips,
      description: descM ? descM[1].trim() : '',
    })
  }
  return out
}

/** Parse downloadable variant rows from a family page (/models/{slug}). */
export function parseLmFamilyVariants(html: string): LmVariantRow[] {
  const out: LmVariantRow[] = []
  const re = /href="\/models\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)">\1<\/a>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const id = m[1]
    const tail = html.slice(m.index, m.index + 900)
    const sizeM = tail.match(/>(\d[\d.]* [KMGT]B)</)
    const starsM = tail.match(/data-model-page-stars="(\d+)"/)
    if (!out.some((r) => r.id.toLowerCase() === id.toLowerCase())) {
      out.push({ id, sizeGB: sizeM ? parseLmSizeGB(sizeM[1]) : 0, stars: starsM ? parseInt(starsM[1], 10) : 0 })
    }
  }
  return out
}

export interface LmVariantConfig {
  vision: boolean
  reasoning: boolean
  toolUse: boolean
  params: string[]
  arch: string[]
  formats: string[]
  minMemoryBytes: number
  contextLengths: number[]
  sources: Array<{ repo: string; format: string }>
}

/** Parse variant detail (/models/{owner}/{name}): artifact JSON + config + sources. */
export function parseLmVariant(html: string): { artifact: Record<string, unknown>; config: LmVariantConfig } | null {
  const artifact = extractLmArtifact(html)
  if (!artifact || typeof artifact.identifier !== 'string') return null
  const bool = (key: string): boolean => new RegExp(`${key}:\\s*true(?:\\s|\\\\|$)`).test(html)
  const listAfter = (key: string): string[] => {
    const m = html.match(new RegExp(`${key}:((?:\\\\n\\s*-\\s*[^\\\\\\s]+)+)`))
    if (!m) return []
    return [...m[1].matchAll(/-\s*([^\s\\]+)/g)].map((x) => x[1])
  }
  const ctxM = html.match(/contextLengths:\\n\s*-\s*(\d+)/)
  const memM = html.match(/minMemoryUsageBytes:\s*(\d+)/)
  const sources: Array<{ repo: string; format: string }> = []
  const seen = new Set<string>()
  for (const sm of html.matchAll(/https:\/\/huggingface\.co\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)) {
    const repo = sm[1]
    if (seen.has(repo.toLowerCase())) continue
    seen.add(repo.toLowerCase())
    const tail = html.slice(sm.index, sm.index + 1500)
    const fmtM = tail.match(/>(GGUF|MLX|safetensors)<\/p>/)
    let format = fmtM ? fmtM[1] : ''
    if (!format) format = /-gguf$/i.test(repo) ? 'GGUF' : /-mlx/i.test(repo) ? 'MLX' : ''
    sources.push({ repo, format })
  }
  return {
    artifact,
    config: {
      vision: bool('vision'),
      reasoning: bool('reasoning'),
      toolUse: bool('trainedForToolUse'),
      params: listAfter('paramsStrings'),
      arch: listAfter('architectures'),
      formats: listAfter('compatibilityTypes'),
      minMemoryBytes: memM ? parseInt(memM[1], 10) : 0,
      contextLengths: ctxM ? [parseInt(ctxM[1], 10)] : [],
      sources,
    },
  }
}

/** Family page extras: ld+json description + base HF repo link. */
export function parseLmFamilyMeta(html: string): { description: string; baseRepo: string } {
  const descM = html.match(/"@type":"CreativeWork"[^}]*?"description":"((?:[^"\\]|\\.)*)"/)
  const hfM = html.match(/https:\/\/huggingface\.co\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/)
  return {
    description: descM ? descM[1].replace(/\\"/g, '"').slice(0, 600) : '',
    baseRepo: hfM ? hfM[1] : '',
  }
}

/** Capabilities from LM curated booleans + id knowledge + Text baseline. */
export function capsFromLm(detail: { vision: boolean; reasoning: boolean; toolUse: boolean }, modelId: string): ExplorerCapability[] {
  const caps: ExplorerCapability[] = []
  if (detail.vision) caps.push('Vision')
  if (detail.toolUse) caps.push('Tools')
  if (detail.reasoning) caps.push('Thinking')
  const id = modelId.toLowerCase()
  if (['coder', 'codestral', 'devstral', 'starcoder', 'wizardcoder', 'codegemma', 'codeqwen'].some((k) => id.includes(k)) && !caps.includes('Code')) {
    caps.push('Code')
  }
  if (caps.length === 0) return ['Text']
  return mergeCapabilities(['Text'], caps)
}

function shortLmDesc(s: string, max = 140): string {
  const t = (s ?? '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function toExploreVariant(
  family: LmFamilyCard,
  familyOrder: number,
  row: LmVariantRow,
  artifact: Record<string, unknown>,
  config: LmVariantConfig,
  familyMeta: { description: string; baseRepo: string },
): ExploreModel {
  const [owner, ...rest] = row.id.split('/')
  const name = rest.join('/') || row.id
  const caps = capsFromLm(config, row.id)
  const uiCaps = caps.map((c) => (c === 'Thinking' ? 'Reasoning' : c))
  const params = config.params[0] ?? ''
  const desc = (artifact.description as string) || familyMeta.description || family.description || `${name} by ${owner}`
  const memGB = config.minMemoryBytes > 0 ? Math.round(config.minMemoryBytes / 1e9) : 0
  const ctx = config.contextLengths[0] ?? 0
  const extras = [
    memGB > 0 ? `Needs ≥${memGB} GB RAM` : '',
    ctx > 0 ? `${Math.round(ctx / 1000)}K context` : '',
    config.formats.length > 0 ? config.formats.join('/') : '',
  ].filter(Boolean).join(' · ')
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    id: row.id,
    name,
    slug: row.id,
    author: owner || 'unknown',
    description: shortLmDesc(desc),
    longDescription: extras ? `${desc}\n\n${extras}.` : desc,
    downloads: num(artifact.downloadCount),
    likes: num(artifact.likeCount),
    staffPick: familyOrder < 10,
    updatedAt: iso(str(artifact.updatedAt)),
    parameters: params || paramsLabel(undefined, [], row.id),
    architecture: config.arch[0] ?? archLabel([], row.id),
    capabilities: uiCaps,
    files: [],
    tags: [...config.arch, ...config.formats, ...config.params],
    iconType: detectIcon(owner || ''),
    ...(familyMeta.baseRepo ? { baseModel: familyMeta.baseRepo } : {}),
  }
}

// ── Cached LM sweeps ─────────────────────────────────────────────────
let lmFamiliesCache: Promise<LmFamilyCard[]> | null = null

function fetchLmFamilies(): Promise<LmFamilyCard[]> {
  if (!lmFamiliesCache) {
    lmFamiliesCache = lmGetText(`${LM_BASE}/models`).then((html) => parseLmFamilies(html).filter((f) => f.downloadable))
    lmFamiliesCache.catch(() => { lmFamiliesCache = null })
  }
  return lmFamiliesCache
}

const lmFamilyVariantsCache = new Map<string, Promise<{ family: LmFamilyCard; order: number; rows: LmVariantRow[]; meta: { description: string; baseRepo: string } }>>()

function fetchLmFamily(slug: string, family: LmFamilyCard, order: number): Promise<{ family: LmFamilyCard; order: number; rows: LmVariantRow[]; meta: { description: string; baseRepo: string } }> {
  let p = lmFamilyVariantsCache.get(slug)
  if (!p) {
    p = lmGetText(`${LM_BASE}/models/${slug}`).then((html) => ({
      family,
      order,
      rows: parseLmFamilyVariants(html),
      meta: parseLmFamilyMeta(html),
    }))
    p.catch(() => { lmFamilyVariantsCache.delete(slug) })
    lmFamilyVariantsCache.set(slug, p)
  }
  return p
}

async function fetchAllLmVariants(): Promise<Array<{ family: LmFamilyCard; order: number; row: LmVariantRow; meta: { description: string; baseRepo: string } }>> {
  const families = await fetchLmFamilies()
  const settled = await Promise.all(families.map((f, i) => fetchLmFamily(f.slug, f, i).catch(() => null)))
  const out: Array<{ family: LmFamilyCard; order: number; row: LmVariantRow; meta: { description: string; baseRepo: string } }> = []
  for (const s of settled) {
    if (!s) continue
    for (const row of s.rows) out.push({ family: s.family, order: s.order, row, meta: s.meta })
  }
  return out
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

function iso(raw?: string): string {
  if (raw) { const d = new Date(raw); if (!isNaN(d.getTime())) return d.toISOString() }
  return new Date().toISOString()
}

/**
 * List row from LM family + variant data (no per-variant detail fetch —
 * downloads/likes/dates are family-level, matching LM's own cards).
 */
function toExploreRow(
  family: LmFamilyCard,
  order: number,
  row: LmVariantRow,
  meta: { description: string; baseRepo: string },
): ExploreModel {
  const [owner, ...rest] = row.id.split('/')
  const name = rest.join('/') || row.id
  const caps: ExplorerCapability[] = []
  if (family.chips.includes('lm-yellow')) caps.push('Vision')
  if (family.chips.includes('lm-blue')) caps.push('Tools')
  if (family.chips.includes('lm-green')) caps.push('Thinking')
  const id = row.id.toLowerCase()
  if (['coder', 'codestral', 'devstral', 'starcoder', 'wizardcoder', 'codegemma', 'codeqwen'].some((k) => id.includes(k)) && !caps.includes('Code')) {
    caps.push('Code')
  }
  const merged = caps.length === 0 ? (['Text'] as ExplorerCapability[]) : mergeCapabilities(['Text'], caps)
  const uiCaps = merged.map((c) => (c === 'Thinking' ? 'Reasoning' : c))
  const desc = family.description || meta.description || `${name} by ${owner}`
  return {
    id: row.id,
    name,
    slug: row.id,
    author: owner || 'unknown',
    description: shortLmDesc(desc),
    longDescription: desc,
    downloads: family.downloads,
    likes: row.stars > 0 ? row.stars : family.likes,
    staffPick: order < 10,
    updatedAt: family.updatedAgo ? parseLmUpdatedAgo(family.updatedAgo) : new Date().toISOString(),
    parameters: family.sizes[0] ?? paramsLabel(undefined, [], row.id),
    architecture: archLabel([], row.id),
    capabilities: uiCaps,
    files: [],
    tags: [...family.sizes],
    iconType: detectIcon(owner || ''),
    ...(meta.baseRepo ? { baseModel: meta.baseRepo } : {}),
  }
}

export function cleanExplorerReadme(raw: string, max = 12000): string {
  let t = raw.replace(/\r\n/g, '\n')
  if (t.startsWith('---\n')) { const e = t.indexOf('\n---', 3); if (e >= 0) t = t.slice(e + 4) }
  t = t.trim()
  return t.length > max ? `${t.slice(0, max)}\n\n…(truncated — open on web for full README)` : t
}

type LmEntry = { family: LmFamilyCard; order: number; row: LmVariantRow; meta: { description: string; baseRepo: string } }

function scoreLmEntry(e: LmEntry, tokens: string[], fullQuery: string): number {
  const hay = `${e.row.id} ${e.family.name} ${e.family.description} ${e.meta.description}`.toLowerCase()
  let score = 0
  for (const t of tokens) if (hay.includes(t)) score++
  if (fullQuery && e.row.id.toLowerCase().includes(fullQuery)) score += 2
  if (fullQuery && e.family.slug.toLowerCase().includes(fullQuery)) score += 2
  return score
}

function sortLmEntries(entries: LmEntry[], sortBy: string): LmEntry[] {
  const arr = [...entries]
  switch (sortBy) {
    case 'downloads':
    case 'trending':
      arr.sort((a, b) => b.family.downloads - a.family.downloads || a.order - b.order)
      break
    case 'likes':
      arr.sort((a, b) => (b.row.stars || b.family.likes) - (a.row.stars || a.family.likes) || a.order - b.order)
      break
    case 'lastmodified':
      // Family card order approximates recency poorly; keep stable LM order.
      break
    default:
      break // Recommended = lmstudio.ai/models page order
  }
  return arr
}

/**
 * Public listing — LM Studio catalog as source:
 * 1. lmstudio.ai URL or `owner/name` paste → exact variant (single row).
 * 2. Family URL paste → that family's variants.
 * 3. Empty query + Recommended → catalog page order (LM curation).
 * 4. Else fuzzy keyword search over variants, LM order preserved.
 */
export async function listExplorerModels(opts: ExplorerListOpts = {}): Promise<ExploreModel[]> {
  const sortBy = (opts.sortBy ?? 'Recommended').toLowerCase()
  const limit = opts.limit ?? 30
  const parsed = parseExplorerSearch(opts.query ?? '')

  if (parsed.kind === 'url' || parsed.kind === 'id') {
    const lmId = parsed.modelId as string
    const one = await getExplorerModel(lmId).catch(() => null)
    if (one) return [one]
    // Legacy HF paste (e.g. unsloth/...-GGUF): fall back to a fuzzy search on
    // the repo short name instead of failing outright.
    const short = lmId.split('/').pop()?.replace(/[-_](gguf|mlx|q[248](_[a-z0-9]+)?|iq[a-z0-9_]+|bf16|f16|8bit|4bit).*$/i, '') ?? lmId
    const fuzzy = await listExplorerModels({ sortBy: opts.sortBy, limit, query: short }).catch((): ExploreModel[] => [])
    if (fuzzy.length > 0) return fuzzy
    throw new Error(`“${lmId}” is not in the LM Studio catalog — try a keyword search.`)
  }

  if (parsed.kind === 'family') {
    const families = await fetchLmFamilies()
    const hit = families.find((f) => f.slug.toLowerCase() === (parsed.slug as string).toLowerCase())
    if (!hit) throw new Error(`“${parsed.slug}” is not in the LM Studio catalog.`)
    const order = families.indexOf(hit)
    const fam = await fetchLmFamily(hit.slug, hit, order)
    return fam.rows.map((row) => toExploreRow(hit, order, row, fam.meta)).slice(0, limit)
  }

  const all = await fetchAllLmVariants()
  let entries = all
  if (parsed.kind === 'keyword') {
    const q = (parsed.query as string).toLowerCase()
    const tokens = q.split(/[^a-z0-9.]+/).filter((t) => t.length > 1)
    entries = all
      .map((e) => ({ e, s: scoreLmEntry(e, tokens, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.e.order - b.e.order)
      .map((x) => x.e)
    entries = sortBy === 'recommended' ? entries : sortLmEntries(entries, sortBy)
  } else if (sortBy !== 'recommended') {
    entries = sortLmEntries(entries, sortBy)
  }
  return entries.slice(0, limit).map((e) => toExploreRow(e.family, e.order, e.row, e.meta))
}

/**
 * HF weight-file backend: sibling listing for one repo.
 * HF is used ONLY here (file enumeration) — every user-facing field comes
 * from the LM Studio catalog. Never called for listing/search.
 */
async function fetchHfSiblings(repoId: string): Promise<{ repoId: string; siblings: Array<{ rfilename: string }>; downloads: number }> {
  const res = await hfGet(`${HF_MODELS_API}/${repoId}`).catch(() => null)
  if (!res || !res.ok) return { repoId, siblings: [], downloads: 0 }
  const row = (await res.json().catch(() => null)) as HfRow | null
  if (!row) return { repoId, siblings: [], downloads: 0 }
  return { repoId, siblings: row.siblings ?? [], downloads: typeof row.downloads === 'number' ? row.downloads : 0 }
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
  const push = (repoId: string, rfilename: string, runnable: boolean): void => {
    if (out.length >= 10 || used.has(rfilename)) return
    used.add(rfilename)
    const base = rfilename.split('/').pop() ?? rfilename
    const q = base.match(QUANT_RE)
    out.push({
      // LM Studio shows the GGUF pill on every repo row, weights and meta alike.
      format: 'GGUF',
      quantization: runnable ? q ? q[0].toUpperCase() : undefined : undefined,
      sizeGB: 0,
      downloadUrl: `https://huggingface.co/${repoId}/resolve/main/${rfilename}`,
      rfilename,
      sizeBytes: 0,
      runnable,
    })
  }
  for (const quant of PREF) {
    for (const repo of repos) {
      const hit = repo.siblings.find((s) => {
        if (classifySibling(s.rfilename) !== 'weight') return false
        const b = (s.rfilename.split('/').pop() ?? '').toUpperCase()
        return b.includes(`-${quant}.GGUF`) || b.endsWith(`_${quant}.GGUF`)
      })
      if (hit) { push(repo.repoId, hit.rfilename, true); break }
    }
  }
  // Fill remaining slots with other runnable weights (still skipping helpers
  // and informational files — Download Options lists GGUF weights only).
  for (const repo of repos) {
    for (const s of repo.siblings) {
      if (out.length >= 10) break
      if (classifySibling(s.rfilename) !== 'weight') continue
      push(repo.repoId, s.rfilename, true)
    }
    if (out.length >= 10) break
  }
  return out
}

/**
 * Sibling kind for Download Options rows (GGUF weights only):
 * - weight: runnable `.gguf` (excluding projector/draft/shard helpers)
 * - aux: helper weights (mmproj, imatrix, drafts) — hidden
 * - meta: informational files (.gitattributes, README.md, …) — hidden
 */
export function classifySibling(rfilename: string): 'weight' | 'aux' | 'meta' {
  const b = (rfilename.split('/').pop() ?? '').toLowerCase()
  if (b.endsWith('.gguf')) return isAuxWeightFile(rfilename) ? 'aux' : 'weight'
  if (isAuxWeightFile(rfilename)) return 'aux'
  return 'meta'
}

/**
 * Detail is already LM-curated at every layer, so the legacy overlay is now
 * an identity (kept for export compatibility).
 */
export async function overlayLmStudioDetails(model: ExploreModel): Promise<ExploreModel> {
  return model
}

/**
 * Detail for one LM variant (`owner/name`):
 * LM artifact + config (caps, params, arch, memory, context, sources) with
 * GGUF quant files enumerated from the variant's GGUF Source repo on HF
 * (LM's own download dropdown is only a deep-link/CLI hook — the site
 * publishes no direct file URLs; LM Studio's app resolves the same way).
 */
export async function getExplorerModel(modelId: string): Promise<ExploreModel> {
  const id = (modelId ?? '').trim().replace(/\/$/, '')
  if (!id.includes('/')) throw new Error(`“${modelId}” is not an LM Studio model id (expected owner/name).`)
  let html: string
  try {
    html = await lmGetText(`${LM_BASE}/models/${id}`)
  } catch (e) {
    if (e instanceof Error && (e as Error & { status?: number }).status === 404) {
      throw new Error(`“${id}” is not in the LM Studio catalog.`)
    }
    throw e instanceof Error ? e : new Error('Could not reach lmstudio.ai.')
  }
  const parsed = parseLmVariant(html)
  if (!parsed) throw new Error(`“${id}” is not in the LM Studio catalog.`)
  const [owner] = id.split('/')
  const stubFamily: LmFamilyCard = {
    slug: '', name: owner, downloadable: true, cloud: false, sizes: [],
    downloads: 0, likes: 0, updatedAgo: '', chips: [], description: '',
  }
  const mapped = toExploreVariant(stubFamily, 99, { id, sizeGB: 0, stars: 0 }, parsed.artifact, parsed.config, { description: '', baseRepo: '' })
  // Prefer the variant's own GGUF Source repo; fall back to scanning all
  // sources for a repo that actually publishes .gguf files.
  const ggufSources = parsed.config.sources.filter((s) => s.format === 'GGUF')
  const candidates = [...ggufSources.map((s) => s.repo), ...parsed.config.sources.map((s) => s.repo)]
  let picked: { repoId: string; siblings: Array<{ rfilename: string }>; downloads: number } | null = null
  for (const repo of candidates.slice(0, 4)) {
    const hit = await fetchHfSiblings(repo)
    if (hit.siblings.some((s) => s.rfilename.toLowerCase().endsWith('.gguf'))) { picked = hit; break }
    if (!picked) picked = hit
  }
  if (picked) {
    mapped.files.push(...pickQuantOptions([picked]))
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
  // README from the picked source repo (main or master branch)
  const readmeRepo = picked?.repoId ?? ''
  if (readmeRepo) {
    for (const branch of ['main', 'master']) {
      try {
        const readme = await hfGet(`https://huggingface.co/${readmeRepo}/raw/${branch}/README.md`)
        if (readme.ok) { mapped.readme = cleanExplorerReadme(await readme.text()); break }
      } catch { /* try next branch */ }
    }
  }
  // Second evidence pass: strong card phrases (tool calling, benchmarks,
  // chain-of-thought) merge into the LM-curated capabilities.
  if (mapped.readme) {
    const extra = detectCapabilitiesFromText(mapped.readme)
    if (extra.length > 0) {
      const baseCaps = mapped.capabilities.map((c) => (c === 'Reasoning' ? 'Thinking' : c) as ExplorerCapability)
      mapped.capabilities = mergeCapabilities(baseCaps, extra).map((c) => (c === 'Thinking' ? 'Reasoning' : c))
    }
  }
  return mapped
}
