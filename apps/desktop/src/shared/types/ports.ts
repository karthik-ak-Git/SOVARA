import type { InstanceId, ModelId, SessionId } from './branded'

// ── Local model catalogue (runtime-agnostic) ──
export interface LocalModel {
  id: ModelId
  displayName: string
  path?: string
  source: 'sovara' | 'ollama' | 'lmstudio' | 'vllm' | 'custom'
  format: 'gguf' | 'safetensors' | 'unknown'
  params?: string
  quant?: string
  discoveredAt?: number
}

export type InstanceStatus = 'loaded' | 'loading' | 'generating' | 'idle' | 'unloading' | 'unloaded' | 'error' | 'failed' | 'crashed'

export interface ModelInstance {
  id: InstanceId
  modelId: ModelId
  runtimeId: string
  status: InstanceStatus
  ctxLen: number
  port?: number
  pid?: number
  startedAt?: number
  /** Live resource metrics — undefined when unavailable (e.g. macOS Metal). */
  metrics?: InstanceMetrics
}

export interface InstanceMetrics {
  gpuUtilization?: number   // 0–100 percent
  vramUsedMB?: number       // megabytes
  cpuUsage?: number         // 0–100 percent
  ramUsedMB?: number        // megabytes
  tokensPerSec?: number     // throughput
  lastUpdatedAt?: number    // Date.now() timestamp
}

export interface ModelRuntimePort {
  listLocalModels(): Promise<LocalModel[]>
  load(modelId: ModelId, opts: { ctxLen?: number; gpu?: 'auto' | 'cpu' | number; runtimeId?: string }): Promise<ModelInstance>
  unload(instanceId: InstanceId): Promise<void>
  health(instanceId: InstanceId): Promise<{ ok: boolean; vramUsedMB?: number; error?: string }>
  baseUrl(instanceId: InstanceId): string
  listInstances(): Promise<ModelInstance[]>
  probeRuntime(runtimeId: string): Promise<{ available: boolean; version?: string; path?: string }>
}

// ── LLM (Commit 7: real local inference behind the same boundary) ──
export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}
export interface LlmChunk {
  type: 'text-delta' | 'done'
  text?: string
  /** Delivery note, e.g. 'non-stream-fallback'. Never content. */
  note?: string
  /** Token usage from the API response (available on 'done' chunk). */
  usage?: LlmUsage
}
export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}
export interface LlmChatRequest {
  /** Loopback base URL, revalidated by the adapter at request time. */
  endpoint: string
  /** Remote model id (without the `<runtimeId>:` prefix). */
  model: string
  messages: LlmChatMessage[]
  timeoutMs: number
  stream: boolean
  signal?: AbortSignal
}
export interface LlmPort {
  /** Legacy stub facet (Commit 5 mock). Real path is streamChat. */
  stream(prompt: string): AsyncIterable<LlmChunk>
  /** Real local inference. Throws ChatInferenceError (classified) on failure. */
  streamChat(request: LlmChatRequest): AsyncIterable<LlmChunk>
}

// ── Tool registry (Phase 1 stub) ──
export interface ToolDefinition {
  name: string
  toolset: string
  description: string
  parameters: Record<string, unknown>
}
export interface ToolPort {
  list(): ToolDefinition[]
  dispatch(name: string, args: Record<string, unknown>): Promise<string>
}

// ── Persistence — real in Phase 1 (append-only, seq-contiguous) ──
export interface SessionHeader {
  id: SessionId
  title: string
  createdAt: number
  updatedAt: number
  archived?: number | null
  /** Null/undefined = normal global chat; set = project-scoped chat (folder access + separate memory). */
  projectId?: string | null
}
export interface ProjectHeader {
  id: string
  name: string
  rootPath: string
  createdAt: number
  updatedAt: number
}
export interface SessionEventView {
  seq: number
  time: number
  type: string
  data: unknown
}
export interface PersistencePort {
  create(title?: string, projectId?: string | null): Promise<SessionHeader>
  list(projectId?: string | null): Promise<SessionHeader[]>
  listArchived(): Promise<SessionHeader[]>
  get(id: SessionId): Promise<SessionHeader | null>
  rename(id: SessionId, title: string): Promise<SessionHeader>
  /** Permanent delete — removes DB row + session files (events JSONL, attachments). */
  deletePermanently(id: SessionId): Promise<void>
  createProject(name: string, rootPath: string): Promise<ProjectHeader>
  listProjects(): Promise<ProjectHeader[]>
  renameProject(id: string, name: string): Promise<ProjectHeader>
  deleteProject(id: string): Promise<void>
  archive(id: SessionId): Promise<void>
  unarchive(id: SessionId): Promise<void>
  appendEvent(sessionId: SessionId, type: string, data: unknown): Promise<SessionEventView>
  getEvents(sessionId: SessionId): Promise<SessionEventView[]>
  insertTokenUsage(row: { sessionId: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number }): void
  getTotalUsage(): { promptTokens: number; completionTokens: number; totalTokens: number }
  getUsageByModel(): Array<{ model: string; promptTokens: number; completionTokens: number; totalTokens: number; requestCount: number }>
  getRecentUsage?(limit?: number): Array<{ sessionId: string; model: string; promptTokens: number; completionTokens: number; totalTokens: number; timestamp: number }>
}

// ── System resources (Phase 1: contract + stub) ──
export interface SystemResources {
  cpu: { logicalCores: number; loadAvg1: number }
  ram: { totalMB: number; freeMB: number; usedByAppMB: number }
  gpu: { available: boolean; name?: string; driverVersion?: string }
  vram: { totalMB?: number; freeMB?: number; usedByModelsMB?: number }
  disk: { path: string; totalMB: number; freeMB: number }
  models: { instances: ModelInstance[]; totalVramUsedMB?: number }
  limits: { maxConcurrentModels: number; maxVramBudgetMB?: number; maxRamBudgetMB?: number }
}
export type ResourcePressureLevel = 'ok' | 'warn' | 'critical'
export interface ResourcePressure {
  level: ResourcePressureLevel
  reason?: string
  blocking?: boolean
}
export interface SystemResourceManagerPort {
  getSnapshot(): Promise<SystemResources>
  checkBeforeLoad(model: LocalModel, opts?: { ctxLen?: number }): Promise<ResourcePressure>
  getLimits(): Promise<SystemResources['limits']>
  setLimits(partial: Partial<SystemResources['limits']>): Promise<void>
}

// ── Placeholders for future ports (interface-shaped, no impl) ──
export type KnowledgePort = Record<string, never>
export type HermesPort = { available: false; reason: string }
export type DshPort = { available: false; reason: string }
