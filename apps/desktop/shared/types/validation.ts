/**
 * MODEL_HARDWARE_VALIDATION spec — sections 16, 21, 30
 * Isolated-pool principle: VRAM and RAM never summed.
 */

export type ValidationStatus =
  | 'NOT_TESTED'
  | 'ESTIMATED_COMPATIBLE'
  | 'ESTIMATED_INCOMPATIBLE'
  | 'TESTING'
  | 'LOAD_FAILED'
  | 'INFERENCE_FAILED'
  | 'VERIFIED'
  | 'VERIFIED_WITH_LIMITATIONS'

export type ValidationPhase =
  | 'DETECTING_HARDWARE'
  | 'ANALYZING_MODEL'
  | 'ESTIMATING_RESOURCES'
  | 'PRECHECK'
  | 'LOADING_MODEL'
  | 'WARMING_UP'
  | 'RUNNING_INFERENCE'
  | 'MEASURING_RESOURCES'
  | 'STABILITY_TEST'
  | 'COMPLETED'
  | 'FAILED'

export type LoadFailureReason =
  | 'OUT_OF_MEMORY'
  | 'OUT_OF_VRAM'
  | 'UNSUPPORTED_BACKEND'
  | 'UNSUPPORTED_ARCHITECTURE'
  | 'INVALID_MODEL'
  | 'CORRUPTED_MODEL'
  | 'RUNTIME_INITIALIZATION_FAILED'
  | 'DRIVER_ERROR'
  | 'CONTEXT_INITIALIZATION_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN_RUNTIME_ERROR'
  | 'PRECHECK_REJECTED'

export interface HardwareProfileFull {
  os: string
  osVersion: string
  architecture: string
  cpu: { name: string; cores: number; threads: number; instructionSets?: string[] }
  memory: { ram_total_mb: number; ram_available_mb: number; ram_used_mb: number }
  gpu: { name?: string; vendor?: string; vram_total_mb?: number; vram_available_mb?: number; driverVersion?: string }
  backend: { name: string; available: boolean; version?: string }
  disk?: { path: string; totalMB: number; freeMB: number }
}

export interface ModelProfile {
  modelId: string
  libraryPath?: string
  architecture: string
  format: 'GGUF' | 'safetensors' | 'MLX' | 'unknown'
  parameters?: string
  paramsCount?: number
  fileSizeMB: number
  contextLength: number
  runtime: string
  quantization?: string
  supportedBackends?: string[]
}

export interface ResourceEstimate {
  fileSizeMB: number
  runtimeOverheadMB: number
  kvCacheMB: number
  totalEstimatedMB: number
  safetyMarginMB: number
  requiredMB: number
}

export interface ValidationJob {
  jobId: string
  modelId: string
  libraryPath?: string
  status: ValidationStatus
  phase: ValidationPhase
  progress: number // 0-100
  hardware?: HardwareProfileFull
  modelProfile?: ModelProfile
  estimate?: ResourceEstimate
  precheck?: { passed: boolean; reason?: string }
  load?: { success: boolean; loadTimeMs?: number; peakRamMB?: number; peakVramMB?: number; backendUsed?: string; gpuOffload?: boolean; reason?: LoadFailureReason; error?: string }
  inference?: { success: boolean; latencyMs?: number; outputValid?: boolean; error?: string }
  performance?: { firstLatencyMs?: number; avgLatencyMs?: number; p50Ms?: number; p95Ms?: number; peakRamMB?: number; peakVramMB?: number; throughputTokensPerSec?: number }
  stability?: { runs: number; successes: number; rate: number }
  result?: ValidationResult
  createdAt: number
  updatedAt: number
  error?: string
}

export interface ValidationResult {
  status: ValidationStatus
  modelId: string
  modelHash?: string
  hardware: { cpu: string; gpu?: string; ram_mb: number; vram_mb?: number }
  runtime: { name: string; version?: string }
  backend: string
  model_loaded: boolean
  inference_success: boolean
  stable: boolean
  peak_vram_mb?: number
  peak_ram_mb?: number
  latency_ms?: number
  gpu_offload: boolean
  reason?: string
  tested_at: string
  limitations?: string[]
}

export interface ValidationStoreEntry extends ValidationResult {
  fingerprint: string
  storedAt: number
}
