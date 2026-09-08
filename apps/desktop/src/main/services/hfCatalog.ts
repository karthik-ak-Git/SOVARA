import type { ExploreModel, ExploreModelFile } from '@shared/types/explore'

const HF_API_BASE = 'https://huggingface.co/api/models'
const HF_TIMEOUT_MS = 20000

interface HfCardData {
  license?: string
  language?: string[]
  datasets?: string[]
  base_model?: string
  pipeline_tag?: string
  library_name?: string
}

interface HfModelResponse {
  id: string
  author: string
  lastModified: string
  likes: number
  downloads: number
  tags: string[]
  pipeline_tag?: string
  gated?: boolean | string
  trendingScore?: number
  usedStorage?: number
  cardData?: HfCardData
  safetensors?: { total?: number }
  siblings?: Array<{ rfilename: string }>
}

function getHfAuthHeader(): Record<string, string> {
  const token =
    process.env.HF_TOKEN ??
    process.env.HF_API_TOKEN ??
    process.env.HUGGINGFACE_TOKEN ??
    process.env.HF_ACCESS_TOKEN ??
    ''
  if (token.trim().length > 0) return { Authorization: `Bearer ${token.trim()}` }
  return {}
}

async function hfFetch(url: string, init?: { method?: string }): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HF_TIMEOUT_MS)
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'User-Agent': 'SOVARA/1.0', ...getHfAuthHeader() },
    })
  } finally {
    clearTimeout(timer)
  }
}

function detectIconType(author: string): ExploreModel['iconType'] {
  const a = author.toLowerCase()
  if (a.includes('qwen')) return 'qwen'
  if (a.includes('google') || a.includes('gemma')) return 'google'
  if (a.includes('meta') || a.includes('llama')) return 'meta'
  if (a.includes('mistral')) return 'mistral'
  if (a.includes('microsoft') || a.includes('phi') || a.includes('bonsai')) return 'microsoft'
  if (a.includes('deepseek')) return 'deepseek'
  return 'hf'
}

function extractParameters(tags: string[], modelId: string): string {
  const paramTag = tags.find((t) => /^\d+(\.\d+)?[bB]$/.test(t) || /^\d+(\.\d+)?[bB]\s/.test(t))
  if (paramTag) return paramTag.replace(/b$/i, 'B')

  const match = modelId.match(/[-/](\d+\.?\d*)[bB]/i)
  if (match) return `${match[1]}B`

  return 'Unknown'
}

function detectCapabilities(tags: string[], pipelineTag?: string, modelId?: string): string[] {
  const caps: string[] = []
  const allTags = tags.join(' ').toLowerCase()

  if (allTags.includes('vision') || allTags.includes('image') || allTags.includes('vqa') || allTags.includes('multimodal')) {
    caps.push('Vision')
  }
  if (allTags.includes('tool') || allTags.includes('function-calling') || allTags.includes('agent')) {
    caps.push('Tools')
  }
  if (allTags.includes('reasoning') || allTags.includes('chain-of-thought') || allTags.includes('cot')) {
    caps.push('Reasoning')
  }
  if (allTags.includes('code') || allTags.includes('coding') || allTags.includes('programming') ||
      (modelId && modelId.toLowerCase().includes('coder'))) {
    caps.push('Code')
  }
  if (allTags.includes('instruct') || allTags.includes('chat')) {
    caps.push('Chat')
  }
  if (allTags.includes('embedding') || allTags.includes('sentence')) {
    caps.push('Embeddings')
  }

  if (caps.length === 0 && pipelineTag === 'text-generation') {
    caps.push('Reasoning')
  }
  if (caps.length === 0 && pipelineTag) {
    const pretty = pipelineTag.replace(/-/g, ' ')
    caps.push(pretty.charAt(0).toUpperCase() + pretty.slice(1))
  }

  return caps
}

function extractArchitecture(tags: string[], modelId: string): string {
  const id = modelId.toLowerCase()
  if (id.includes('qwen')) return 'qwen3'
  if (id.includes('gemma')) return 'gemma'
  if (id.includes('llama')) return 'llama'
  if (id.includes('mistral') || id.includes('mixtral')) return 'mistral'
  if (id.includes('phi')) return 'phi'
  if (id.includes('deepseek')) return 'deepseek'
  if (id.includes('gpt')) return 'gpt'
  if (id.includes('bert')) return 'bert'

  const archTag = tags.find((t) => ['llama', 'qwen', 'gemma', 'mistral', 'phi', 'deepseek'].includes(t))
  return archTag || 'transformers'
}

function formatParams(total?: number, tags: string[] = [], modelId = ''): string {
  if (typeof total === 'number' && total > 0) {
    if (total >= 1_000_000_000) return `${(total / 1_000_000_000).toFixed(total >= 10_000_000_000 ? 0 : 1)}B`
    if (total >= 1_000_000) return `${(total / 1_000_000).toFixed(0)}M`
    return `${total}`
  }
  return extractParameters(tags, modelId)
}

function detectGgufFiles(modelId: string, siblings: Array<{ rfilename: string }>): ExploreModelFile[] {
  const files: ExploreModelFile[] = []
  const ggufFiles = siblings.filter((s) => s.rfilename.endsWith('.gguf'))

  for (const file of ggufFiles) {
    const name = file.rfilename.split('/').pop() || file.rfilename
    const quantMatch = name.match(/Q\d+_[A-Z0-9_]+/)
    files.push({
      format: 'GGUF',
      quantization: quantMatch ? quantMatch[0] : undefined,
      sizeGB: 0,
      downloadUrl: `https://huggingface.co/${modelId}/resolve/main/${file.rfilename}`,
      rfilename: file.rfilename,
      sizeBytes: 0,
    })
  }

  const hasMlx = siblings.some((s) =>
    s.rfilename.includes('mlx') || s.rfilename.endsWith('.mlx')
  )
  if (hasMlx) {
    files.push({
      format: 'MLX',
      sizeGB: 0,
      downloadUrl: '',
    })
  }

  if (files.length === 0) {
    const safetensors = siblings.filter((s) => s.rfilename.endsWith('.safetensors'))
    if (safetensors.length > 0) {
      const first = safetensors[0]
      files.push({
        format: 'safetensors',
        sizeGB: 0,
        downloadUrl: `https://huggingface.co/${modelId}/resolve/main/${first.rfilename}`,
        rfilename: first.rfilename,
        sizeBytes: 0,
      })
    }
  }

  if (files.length === 0 && ggufFiles.length === 0 && !hasMlx) {
    const ggufTag = siblings.some((s) => s.rfilename.toLowerCase().includes('gguf'))
    if (ggufTag) {
      // sibling listing may be truncated - still signal GGUF available via tag fallback
    }
  }

  return files
}

/** HEAD lookup for exact file bytes (bounded, parallel). Mutates sizes in place. */
async function fillFileSizes(files: ExploreModelFile[], maxFiles = 12): Promise<void> {
  const sized = files.filter((f) => f.downloadUrl).slice(0, maxFiles)
  await Promise.all(sized.map(async (f) => {
    try {
      const res = await hfFetch(f.downloadUrl, { method: 'HEAD' })
      const len = res.headers.get('content-length')
      const bytes = len ? parseInt(len, 10) : NaN
      if (Number.isFinite(bytes) && bytes > 0) {
        f.sizeBytes = bytes
        f.sizeGB = bytes / (1024 ** 3)
      }
    } catch {
      // size stays unknown — download still works
    }
  }))
}

function mapHfModelToExplore(hf: HfModelResponse): ExploreModel {
  const name = hf.id.split('/').pop() || hf.id
  const author = hf.author || hf.id.split('/')[0]
  const card = hf.cardData ?? {}

  return {
    id: hf.id,
    name,
    slug: hf.id,
    author,
    description: `${name} by ${author}`,
    longDescription: `${name} is a model by ${author} available on Hugging Face.`,
    downloads: hf.downloads,
    likes: hf.likes,
    staffPick: false,
    updatedAt: hf.lastModified,
    parameters: formatParams(hf.safetensors?.total, hf.tags, hf.id),
    architecture: extractArchitecture(hf.tags, hf.id),
    capabilities: detectCapabilities(hf.tags, hf.pipeline_tag, hf.id),
    files: detectGgufFiles(hf.id, hf.siblings || []),
    tags: hf.tags,
    iconType: detectIconType(author),
    ...(typeof card.license === 'string' ? { license: card.license } : {}),
    ...(Array.isArray(card.language) ? { languages: card.language } : {}),
    ...(typeof card.base_model === 'string' ? { baseModel: card.base_model } : {}),
    ...(typeof hf.pipeline_tag === 'string' ? { pipelineTag: hf.pipeline_tag } : {}),
    ...(typeof hf.gated === 'boolean' ? { gated: hf.gated } : typeof hf.gated === 'string' ? { gated: hf.gated === 'true' } : {}),
    ...(typeof hf.usedStorage === 'number' ? { repoSizeBytes: hf.usedStorage } : {}),
  }
}

/** Strip YAML frontmatter + cap length for safe display. */
export function cleanReadme(raw: string, maxChars = 12000): string {
  let text = raw.replace(/\r\n/g, '\n')
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 3)
    if (end >= 0) text = text.slice(end + 4)
  }
  text = text.trim()
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n…(truncated — view the full README on Hugging Face)` : text
}

function mapSortToHf(sortBy: string): string {
  switch (sortBy) {
    case 'trending':
      return 'trendingScore'
    case 'likes':
      return 'likes'
    case 'downloads':
      return 'downloads'
    case 'lastModified':
      return 'lastModified'
    case 'recommended':
    default:
      return 'likes'
  }
}

export interface FetchModelsOptions {
  sortBy?: string
  query?: string
  pipelineTag?: string
  tag?: string
  limit?: number
}

export async function fetchModelsFromHf(
  sortBy: string | FetchModelsOptions = 'downloads',
  query = '',
  limit = 30
): Promise<ExploreModel[]> {
  // Normalize overloaded args
  let opts: FetchModelsOptions
  if (typeof sortBy === 'object' && sortBy !== null) {
    opts = sortBy
  } else {
    opts = { sortBy: sortBy as string, query, limit }
  }
  const finalSort = opts.sortBy ?? 'recommended'
  const finalQuery = (opts.query ?? '').trim()
  const pipelineTag = (opts.pipelineTag ?? '').trim()
  const tag = (opts.tag ?? '').trim()
  const finalLimit = opts.limit ?? 30

  const params = new URLSearchParams()
  params.set('sort', mapSortToHf(finalSort))
  params.set('direction', '-1')
  params.set('limit', String(Math.min(Math.max(finalLimit, 1), 60)))

  if (finalQuery) {
    params.set('search', finalQuery)
  }

  // HF filtering: `filter` supports pipeline_tag and arbitrary tag; combine with comma
  const filters: string[] = []
  if (pipelineTag) filters.push(pipelineTag)
  if (tag) filters.push(tag)
  if (filters.length > 0) {
    params.set('filter', filters.join(','))
  }

  const url = `${HF_API_BASE}?${params.toString()}`

  let response: Response
  try {
    response = await hfFetch(url)
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'Hugging Face request timed out.' : 'Could not reach Hugging Face. Check your connection.')
  }

  if (!response.ok) {
    throw new Error(`Hugging Face API error: ${response.status}`)
  }

  const data: HfModelResponse[] = await response.json()
  return data.map(mapHfModelToExplore)
}

export async function fetchModelFromHf(modelId: string): Promise<ExploreModel> {
  const url = `${HF_API_BASE}/${modelId}`

  let response: Response
  try {
    response = await hfFetch(url)
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? 'Hugging Face request timed out.' : 'Could not reach Hugging Face. Check your connection.')
  }

  if (!response.ok) {
    throw new Error(`Hugging Face API error: ${response.status}`)
  }

  const data: HfModelResponse = await response.json()
  const model = mapHfModelToExplore(data)
  await fillFileSizes(model.files)
  // Best-effort README (raw markdown, frontmatter stripped).
  try {
    const raw = await hfFetch(`https://huggingface.co/${modelId}/raw/main/README.md`)
    if (raw.ok) model.readme = cleanReadme(await raw.text())
  } catch {
    // readme stays absent — detail renders without it
  }
  return model
}

export function sortModels(models: ExploreModel[], sortBy: string): ExploreModel[] {
  const sorted = [...models]
  switch (sortBy) {
    case 'trending':
    case 'likes':
      return sorted.sort((a, b) => b.likes - a.likes)
    case 'downloads':
      return sorted.sort((a, b) => b.downloads - a.downloads)
    case 'lastModified':
      return sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    case 'recommended':
    default:
      return sorted.sort((a, b) => {
        if (a.staffPick !== b.staffPick) return a.staffPick ? -1 : 1
        return b.likes - a.likes
      })
  }
}

export function filterModels(models: ExploreModel[], query: string): ExploreModel[] {
  if (!query.trim()) return models
  const q = query.toLowerCase()
  return models.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.author.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.tags.some((t) => t.toLowerCase().includes(q)) ||
      (m.pipelineTag && m.pipelineTag.toLowerCase().includes(q)) ||
      m.capabilities.some((c) => c.toLowerCase().includes(q))
  )
}
