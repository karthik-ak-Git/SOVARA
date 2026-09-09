/** One file inside a multi-part download (shard set) or a sidecar payload. */
export interface ExploreDownloadPart {
  rfilename: string
  downloadUrl: string
  /** Exact bytes when known (HEAD); 0 when unknown. */
  sizeBytes: number
}

export interface ExploreModelFile {
  format: string          // GGUF, MLX, safetensors
  quantization?: string   // Q4_K_M, Q5_K_S, etc.
  sizeGB: number
  downloadUrl: string
  /** Repo-relative path (for the downloader). */
  rfilename?: string
  /** Exact bytes (HEAD lookup; 0 when unknown). */
  sizeBytes?: number
  /**
   * False for informational repo files (.gitattributes, README.md, …) that LM
   * Studio lists with a red badge but that cannot load on a GPU. Undefined or
   * true = runnable weight.
   */
  runnable?: boolean
  /**
   * True when this row is a sharded model (`-00001-of-0000N` parts): loading
   * needs EVERY part in `parts`. `rfilename`/`downloadUrl` point at part 1 so
   * single-file plumbing (progress keys, installed checks) keeps working.
   */
  multipart?: boolean
  /** All shard parts in order (present only when multipart). */
  parts?: ExploreDownloadPart[]
  /**
   * Vision projector (`mmproj-*.gguf`) from the same repo. Vision models need
   * it alongside the main weight to actually see images — the downloader
   * fetches it automatically with the weight.
   */
  companion?: ExploreDownloadPart
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

export type ExploreSortBy = 'recommended' | 'trending' | 'likes' | 'downloads' | 'lastModified'

export interface ExploreListParams {
  sortBy?: ExploreSortBy
  query?: string
  pipelineTag?: string
  tag?: string
}
