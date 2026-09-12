/** One file inside a multi-part download (shard set) or a sidecar payload. */
export interface ExploreDownloadPart {
  rfilename: string
  downloadUrl: string
  /** Exact bytes when known (HEAD); 0 when unknown. */
  sizeBytes: number
}

/**
 * Weight format of ONE repo file, from its extension — never from the repo
 * name, README, or tags. `other` covers .bin / .pth / .pt / .ckpt / .onnx /
 * .h5 / .msgpack weights.
 */
export type RepoWeightFormat = 'gguf' | 'safetensors' | 'other'

/**
 * Repo-level format from the ACTUAL sibling files: exactly one weight kind
 * present → that kind; more than one → `mixed`. Repos with no weight files
 * are never listed as downloadable models (callers skip them).
 */
export type ModelFormat = 'gguf' | 'safetensors' | 'mixed' | 'other'

/**
 * One weight file in the repo inventory (detail only). Safetensors/other
 * entries are informational — only GGUF rows in `files` are downloadable
 * (no silent safetensors→GGUF conversion).
 */
export interface ExploreRepoFile {
  rfilename: string
  format: RepoWeightFormat
  quantization?: string
  /** Exact bytes when HEAD-resolved; 0/undefined when unknown. */
  sizeBytes?: number
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
   * Which Hub repo this row's bytes actually come from. Download Options
   * aggregates community quant repos onto a base model page — this keeps the
   * association honest instead of merging repos silently.
   */
  sourceRepo?: string
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
  /** ISO creation date (falls back to updatedAt when the API omits it). */
  createdAt: string
  /** Raw HF trendingScore when the listing provided it (ranking input only). */
  trendingScore?: number
  parameters: string       // "7B", "27B", "70B"
  architecture: string     // "llama", "qwen3", "gemma", "mistral"
  capabilities: string[]   // Vision, Tools, Reasoning, Code
  files: ExploreModelFile[]
  tags: string[]
  iconType: 'hf' | 'google' | 'meta' | 'mistral' | 'qwen' | 'microsoft' | 'deepseek'
  /**
   * Repo-level format from actual sibling files (gguf/safetensors/mixed/
   * other). Always set by the catalog; a Safetensors-only repo carries
   * `format: 'safetensors'` with an empty `files` (no fake GGUF button).
   */
  format?: ModelFormat
  /** Detail-only fields (explore:getModel). Absent on list rows. */
  license?: string
  languages?: string[]
  baseModel?: string
  pipelineTag?: string
  gated?: boolean
  repoSizeBytes?: number
  /** Full weight-file inventory (detail only, all formats, read-only). */
  repoFiles?: ExploreRepoFile[]
  readme?: string
  /** List-row fit tier from the backend fit engine (estimate only). */
  fitTier?: ExplorerFitTier
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

/** Precomputed list-row fit tier (estimate — detail badges stay authoritative). */
export type ExplorerFitTier = 'likely' | 'possible' | 'unlikely' | 'unknown'

/** Format filter the backend actually supports (HF file-list based). */
export type ExploreFormatFilter = 'all' | 'gguf' | 'safetensors' | 'mixed' | 'other'

export interface ExploreListParams {
  sortBy?: ExploreSortBy
  query?: string
  pipelineTag?: string
  tag?: string
  format?: ExploreFormatFilter
}
