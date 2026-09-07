import type { ExploreModel, ExploreModelFile } from '@shared/types/explore'

const HF_API_BASE = 'https://huggingface.co/api/models'

interface HfModelResponse {
  id: string
  author: string
  lastModified: string
  likes: number
  downloads: number
  tags: string[]
  pipeline_tag?: string
  siblings?: Array<{ rfilename: string }>
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

  if (allTags.includes('vision') || allTags.includes('image') || allTags.includes('vqa')) {
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

  if (caps.length === 0 && pipelineTag === 'text-generation') {
    caps.push('Reasoning')
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

function detectGgufFiles(siblings: Array<{ rfilename: string }>): ExploreModelFile[] {
  const files: ExploreModelFile[] = []
  const ggufFiles = siblings.filter((s) => s.rfilename.endsWith('.gguf'))

  for (const file of ggufFiles) {
    const name = file.rfilename.split('/').pop() || file.rfilename
    const quantMatch = name.match(/Q[0-9]+_[A-Z]+_[A-Z]+/)
    files.push({
      format: 'GGUF',
      quantization: quantMatch ? quantMatch[0] : undefined,
      sizeGB: 0,
      downloadUrl: `https://huggingface.co/${file.rfilename}`,
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
      files.push({
        format: 'safetensors',
        sizeGB: 0,
        downloadUrl: `https://huggingface.co/${safetensors[0].rfilename}`,
      })
    }
  }

  return files
}

function mapHfModelToExplore(hf: HfModelResponse): ExploreModel {
  const name = hf.id.split('/').pop() || hf.id
  const author = hf.author || hf.id.split('/')[0]

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
    parameters: extractParameters(hf.tags, hf.id),
    architecture: extractArchitecture(hf.tags, hf.id),
    capabilities: detectCapabilities(hf.tags, hf.pipeline_tag, hf.id),
    files: detectGgufFiles(hf.siblings || []),
    tags: hf.tags,
    iconType: detectIconType(author),
  }
}

export async function fetchModelsFromHf(
  sortBy: string = 'downloads',
  query: string = '',
  limit: number = 30
): Promise<ExploreModel[]> {
  const params = new URLSearchParams()
  params.set('sort', sortBy === 'recommended' || sortBy === 'likes' ? 'likes' : sortBy)
  params.set('direction', '-1')
  params.set('limit', String(limit))

  if (query) {
    params.set('search', query)
  }

  if (sortBy === 'recommended') {
    params.set('sort', 'likes')
  }

  const url = `${HF_API_BASE}?${params.toString()}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'SOVARA/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`Hugging Face API error: ${response.status}`)
  }

  const data: HfModelResponse[] = await response.json()
  return data.map(mapHfModelToExplore)
}

export async function fetchModelFromHf(modelId: string): Promise<ExploreModel> {
  const url = `${HF_API_BASE}/${modelId}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'SOVARA/1.0',
    },
  })

  if (!response.ok) {
    throw new Error(`Hugging Face API error: ${response.status}`)
  }

  const data: HfModelResponse = await response.json()
  return mapHfModelToExplore(data)
}

export function sortModels(models: ExploreModel[], sortBy: string): ExploreModel[] {
  const sorted = [...models]
  switch (sortBy) {
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
      m.tags.some((t) => t.includes(q))
  )
}
