export interface ExploreModelFile {
  format: string          // GGUF, MLX, safetensors
  quantization?: string   // Q4_K_M, Q5_K_S, etc.
  sizeGB: number
  downloadUrl: string
  /** Repo-relative path (for the downloader). */
  rfilename?: string
  /** Exact bytes (HEAD lookup; 0 when unknown). */
  sizeBytes?: number
}

export interface ExploreModel {
  id: string
  name: string
  slug: string             // org/model-name on HuggingFace
  author: string
  description: string
  longDescription: string
  downloads: number
  likes: number
  staffPick: boolean
  updatedAt: string        // ISO date
  parameters: string       // "7B", "27B", "70B"
  architecture: string     // "llama", "qwen3", "gemma", "mistral"
  capabilities: string[]   // Vision, Tools, Reasoning, Code
  files: ExploreModelFile[]
  tags: string[]
  iconType: 'hf' | 'google' | 'meta' | 'mistral' | 'qwen' | 'microsoft' | 'deepseek'
  /** Detail-only fields (explore:getModel). Absent on list rows. */
  license?: string
  languages?: string[]
  baseModel?: string
  pipelineTag?: string
  gated?: boolean
  repoSizeBytes?: number
  readme?: string
}

export interface HardwareInfo {
  totalRamMB: number
  freeRamMB: number
  totalVramMB?: number
  freeVramMB?: number
  gpuName?: string
  gpuAvailable: boolean
}

export interface CompatibilityResult {
  fitsInMemory: boolean
  estimatedRamUsageGB: number
  estimatedVramUsageGB?: number
  message: string
  severity: 'good' | 'tight' | 'too-large'
}

export type ExploreSortBy = 'recommended' | 'likes' | 'downloads' | 'lastModified'
