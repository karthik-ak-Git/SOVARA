/**
 * Typed IPC wrapper for the renderer (Commit 5 chat + Commit 6 workbench).
 * Renderer must never touch the filesystem, subprocesses, Electron APIs,
 * databases, or the network directly. Every call below goes through the
 * preload whitelist (`window.sovara.invoke`) and is validated in Main with Zod.
 */

import type {
  ActiveModelState,
  DiscoveredModel,
  ModelRuntimeEntry,
  RuntimeProbeResult,
  RuntimeType,
} from '@shared/types/models'

export interface SessionHeaderView {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  archived?: number | null
  projectId?: string | null
}

export interface ProjectView {
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

function sovara(): Window['sovara'] {
  if (!window.sovara) throw new Error('sovara bridge unavailable')
  return window.sovara
}

export async function listSessions(): Promise<SessionHeaderView[]> {
  return (await sovara().invoke('sessions:list')) as SessionHeaderView[]
}

export async function createSession(title: string, projectId?: string | null): Promise<SessionHeaderView> {
  return (await sovara().invoke('sessions:create', { title, projectId: projectId ?? null })) as SessionHeaderView
}

export async function renameSession(sessionId: string, title: string): Promise<SessionHeaderView> {
  return (await sovara().invoke('sessions:rename', { sessionId, title })) as SessionHeaderView
}

export async function deleteSession(sessionId: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('sessions:delete', sessionId)) as { ok: boolean }
}

export async function listProjects(): Promise<ProjectView[]> {
  return (await sovara().invoke('projects:list')) as ProjectView[]
}

export async function createProject(name: string, rootPath: string): Promise<ProjectView> {
  return (await sovara().invoke('projects:create', { name, rootPath })) as ProjectView
}

export async function renameProject(projectId: string, name: string): Promise<ProjectView> {
  return (await sovara().invoke('projects:rename', { projectId, name })) as ProjectView
}

export async function deleteProject(projectId: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('projects:delete', { projectId })) as { ok: boolean }
}

export async function pickFolder(): Promise<{ canceled: boolean; filePath: string | null }> {
  return (await sovara().invoke('dialog:pickFolder')) as { canceled: boolean; filePath: string | null }
}

export async function getSessionEvents(sessionId: string): Promise<SessionEventView[]> {
  return (await sovara().invoke('sessions:getEvents', sessionId)) as SessionEventView[]
}

export async function archiveSession(sessionId: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('sessions:archive', { sessionId })) as { ok: boolean }
}

export async function unarchiveSession(sessionId: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('sessions:unarchive', { sessionId })) as { ok: boolean }
}

export async function listArchivedSessions(): Promise<SessionHeaderView[]> {
  return (await sovara().invoke('sessions:listArchived')) as SessionHeaderView[]
}

export async function sendChatMessage(
  sessionId: string,
  content: string,
  opts?: { webSearch?: boolean }
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  // Long-lived invoke: resolves when generation completes and the single
  // durable assistant event is persisted. Deltas arrive via onSessionEvents.
  return (await sovara().invoke('chat:send', { sessionId, content, ...opts })) as {
    ok: boolean
    userSeq: number
    assistantSeq: number
  }
}

export async function cancelChatMessage(sessionId: string): Promise<{ cancelled: boolean }> {
  return (await sovara().invoke('chat:cancel', { sessionId })) as { cancelled: boolean }
}

export type { ChatStreamEvent } from '@shared/types/chat'

export function onSessionEvents(callback: (event: import('@shared/types/chat').ChatStreamEvent) => void): () => void {
  return sovara().on('events:session', (...args: unknown[]) => {
    callback(args[0] as import('@shared/types/chat').ChatStreamEvent)
  })
}

export async function listRuntimes(): Promise<ModelRuntimeEntry[]> {
  return (await sovara().invoke('models:listRuntimes')) as ModelRuntimeEntry[]
}

export async function addRuntime(input: {
  displayName: string
  endpoint: string
  type?: RuntimeType
  timeoutMs?: number
}): Promise<ModelRuntimeEntry> {
  return (await sovara().invoke('models:addRuntime', input)) as ModelRuntimeEntry
}

export async function removeRuntime(runtimeId: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('models:removeRuntime', { runtimeId })) as { ok: boolean }
}

export async function testRuntimeConnection(runtimeId: string): Promise<RuntimeProbeResult> {
  return (await sovara().invoke('models:testConnection', { runtimeId })) as RuntimeProbeResult
}

export async function listDiscoveredModels(runtimeId?: string): Promise<DiscoveredModel[]> {
  return (await sovara().invoke('models:listModels', runtimeId ? { runtimeId } : {})) as DiscoveredModel[]
}

export async function selectModel(runtimeId: string, modelId: string): Promise<ActiveModelState> {
  return (await sovara().invoke('models:selectModel', { runtimeId, modelId })) as ActiveModelState
}

export async function getActiveModel(): Promise<ActiveModelState> {
  return (await sovara().invoke('models:getActiveModel')) as ActiveModelState
}

// ── Local model library registry (SQLite-backed inventory) ──
export type RegistryInstallStatus = 'installed' | 'missing' | 'unregistered'
export type DownloadRowStatus = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'verifying'

export interface ModelRegistryView {
  id: string
  sourceProvider: string
  repository: string
  revision: string
  rfilename: string
  format: string | null
  quantization: string | null
  architecture: string | null
  parameterCount: string | null
  contextLength: number | null
  license: string | null
  localPath: string
  fileSizeBytes: number | null
  downloadStatus: DownloadRowStatus
  installStatus: RegistryInstallStatus
  runtimeId: string | null
  displayName: string
  discoveredAt: number
  updatedAt: number
  extraJson: string | null
}

export async function listRegistryRows(runtimeId?: string): Promise<ModelRegistryView[]> {
  return (await sovara().invoke('models:listRegistry', runtimeId ? { runtimeId } : {})) as ModelRegistryView[]
}

export async function updateRegistryRow(
  id: string,
  patch: { installStatus?: RegistryInstallStatus; runtimeId?: string | null; displayName?: string }
): Promise<{ ok: boolean }> {
  return (await sovara().invoke('models:updateRegistry', { id, patch })) as { ok: boolean }
}

export async function removeRegistryRow(id: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('models:removeRegistry', { id })) as { ok: boolean }
}

export async function removeRegistryRowsByPath(localPath: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('models:removeRegistryByPath', { localPath })) as { ok: boolean }
}

export interface SystemResourcesView {
  cpu: { logicalCores: number; loadAvg1: number }
  ram: { totalMB: number; freeMB: number; usedByAppMB: number }
  gpu: { available: boolean; name?: string; driverVersion?: string }
  vram: { totalMB?: number; freeMB?: number; usedByModelsMB?: number }
  disk: { path: string; totalMB: number; freeMB: number }
  models: { instances: unknown[]; totalVramUsedMB?: number }
  limits: { maxConcurrentModels: number; maxVramBudgetMB?: number; maxRamBudgetMB?: number }
}

export async function getSystemResources(): Promise<SystemResourcesView> {
  return (await sovara().invoke('system:getResources')) as SystemResourcesView
}

// ── Exec permissions (AI command levels) ──
export type ExecMode = 'off' | 'ask' | 'review' | 'allow'

export async function getExecMode(): Promise<ExecMode> {
  const r = (await sovara().invoke('exec:getMode')) as { mode: ExecMode }
  return r.mode
}

export async function setExecMode(mode: ExecMode): Promise<ExecMode> {
  const r = (await sovara().invoke('exec:setMode', mode)) as { mode: ExecMode }
  return r.mode
}

export interface ToolDispatchResult {
  ok: boolean
  blocked?: boolean
  reason?: 'disabled' | 'needs-approval'
  message?: string
  autoApproved?: boolean
  result?: string
}

export interface ToolDefinitionView {
  name: string
  toolset: string
  description: string
  parameters: Record<string, unknown>
}

export async function listTools(): Promise<ToolDefinitionView[]> {
  return (await sovara().invoke('tools:list')) as ToolDefinitionView[]
}

export async function dispatchTool(name: string, args?: Record<string, unknown>): Promise<ToolDispatchResult> {
  return (await sovara().invoke('tools:dispatch', { name, args: args ?? {} })) as ToolDispatchResult
}

// ── General settings (Settings → General) + update feed ──
export interface AppSettingsState {
  theme: string
  sidebarBackground: string
  inlineDiffLayout: string
  renameAfterFork: boolean
  globalWorkspaceRoot: string
  allowModelDownload: boolean
  autoUpdates: boolean
  sessionNotifications: boolean
  updateFeedUrl: string
  updateChannel: string
  lastUpdateCheckAt: number | null
  lastUpdateStatus: string | null
  rootModel: string
  visionModel: string
  webSearch: boolean
  explorationAgents: boolean
  customAutoReview: boolean
  customInstructions: string
  version: string
}

export interface AppSettingsPatch {
  theme?: string
  sidebarBackground?: string
  inlineDiffLayout?: string
  renameAfterFork?: boolean
  globalWorkspaceRoot?: string
  allowModelDownload?: boolean
  autoUpdates?: boolean
  sessionNotifications?: boolean
  updateFeedUrl?: string
  updateChannel?: string
  rootModel?: string
  visionModel?: string
  webSearch?: boolean
  explorationAgents?: boolean
  customAutoReview?: boolean
  customInstructions?: string
}

export interface UpdateCheckView {
  status: 'current' | 'available' | 'no-feed' | 'error'
  current: string
  latest: string | null
  message: string
}

export async function getAppSettings(): Promise<AppSettingsState> {
  return (await sovara().invoke('settings:get')) as AppSettingsState
}

export async function setAppSettings(patch: AppSettingsPatch): Promise<AppSettingsState> {
  return (await sovara().invoke('settings:set', patch)) as AppSettingsState
}

export async function checkForUpdatesNow(): Promise<UpdateCheckView> {
  return (await sovara().invoke('updates:checkNow')) as UpdateCheckView
}

// ── First-run setup (Python env for sidecars) ──
export type PythonPhase = 'idle' | 'checking' | 'installing-deps' | 'installing-browsers' | 'ready' | 'no-python' | 'error'

export interface PythonStatusView {
  phase: PythonPhase
  message: string
  pythonExe: string | null
  source: 'system' | 'venv' | null
}

export async function getPythonSetupStatus(): Promise<PythonStatusView> {
  return (await sovara().invoke('setup:getPythonStatus')) as PythonStatusView
}

export async function ensurePythonSetup(): Promise<PythonStatusView> {
  return (await sovara().invoke('setup:ensurePython')) as PythonStatusView
}

// ── Window controls (frameless window) ──
export async function minimizeWindow(): Promise<void> {
  await sovara().invoke('window:minimize')
}

export async function maximizeWindow(): Promise<void> {
  await sovara().invoke('window:maximize')
}

export async function closeWindow(): Promise<void> {
  await sovara().invoke('window:close')
}

// ── Usage stats ──
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ModelUsage {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestCount: number
}

export async function getTotalUsage(): Promise<TokenUsage> {
  return (await sovara().invoke('usage:getTotal')) as TokenUsage
}

export async function getUsageByModel(): Promise<ModelUsage[]> {
  return (await sovara().invoke('usage:getByModel')) as ModelUsage[]
}

// ── Skills scanning ──
export interface SkillsSource {
  name: string
  path: string
  skillCount: number
  enabled: boolean
}

export interface BionicSkillView {
  id: string
  name: string
  description: string
  path: string
}

export async function scanSkills(): Promise<SkillsSource[]> {
  return (await sovara().invoke('skills:scan')) as SkillsSource[]
}

export async function toggleSkillsSource(
  sourceName: string,
  enabled: boolean
): Promise<{ ok: boolean }> {
  return (await sovara().invoke('skills:toggle', { sourceName, enabled })) as { ok: boolean }
}

export async function listBionicSkills(): Promise<BionicSkillView[]> {
  return (await sovara().invoke('skills:listBionic')) as BionicSkillView[]
}

export async function addBionicSkill(input: { name: string; description?: string; content: string }): Promise<BionicSkillView> {
  return (await sovara().invoke('skills:addBionic', input)) as BionicSkillView
}

export async function removeBionicSkill(id: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('skills:removeBionic', { id })) as { ok: boolean }
}

export async function listDetailedSkills(): Promise<Array<{ name: string; path: string; skills: BionicSkillView[] }>> {
  return (await sovara().invoke('skills:listDetailed')) as Array<{ name: string; path: string; skills: BionicSkillView[] }>
}

export async function importSkillFromUrl(url: string): Promise<BionicSkillView> {
  return (await sovara().invoke('skills:importFromUrl', { url })) as BionicSkillView
}

// ── Explore (HuggingFace catalog) ──
import type { ExploreModelFile, ExploreModel, CompatibilityResult } from '@shared/types/explore'
export type { ExploreModelFile, ExploreModel, CompatibilityResult, ExploreRepoFile, ModelFormat, ExploreFormatFilter, ExplorerFitTier, HardwareInfo } from '@shared/types/explore'

export interface ExploreListOpts {
  sortBy?: string
  query?: string
  pipelineTag?: string
  tag?: string
  limit?: number
  format?: 'all' | 'gguf' | 'safetensors' | 'mixed' | 'other'
  quants?: string[]
  params?: 'all' | 'lt3' | 'b3to7' | 'b7to14' | 'b14to32' | 'b32to70' | 'gt70'
  licenses?: string[]
  capabilities?: string[]
  gated?: 'all' | 'accessible' | 'gated'
  downloaded?: 'all' | 'downloaded' | 'available'
  compat?: 'all' | 'likely' | 'possible' | 'unlikely' | 'unknown'
  cursor?: string
}

export interface ExploreListPage {
  models: ExploreModel[]
  nextCursor: string | null
}

function normalizeListPage(raw: unknown): ExploreListPage {
  // Back-compat: older main builds return a bare array.
  if (Array.isArray(raw)) return { models: raw as ExploreModel[], nextCursor: null }
  const p = raw as { models?: unknown; nextCursor?: unknown }
  return {
    models: Array.isArray(p.models) ? (p.models as ExploreModel[]) : [],
    nextCursor: typeof p.nextCursor === 'string' ? p.nextCursor : null,
  }
}

export async function listExploreModelsPage(opts: ExploreListOpts): Promise<ExploreListPage> {
  return normalizeListPage(await sovara().invoke('explore:listModels', opts))
}

export async function listExploreModels(
  sortBy?: string | ExploreListOpts,
  query?: string
): Promise<ExploreModel[]> {
  if (typeof sortBy === 'object' && sortBy !== null) {
    return (await listExploreModelsPage(sortBy)).models
  }
  return (await listExploreModelsPage({ sortBy, query })).models
}

export async function getExploreModel(modelId: string): Promise<ExploreModel> {
  return (await sovara().invoke('explore:getModel', { modelId })) as ExploreModel
}

export async function getModelCompatibility(modelId: string): Promise<CompatibilityResult> {
  return (await sovara().invoke('explore:getCompatibility', { modelId })) as CompatibilityResult
}

export interface FileRecommendationView {
  file: ExploreModelFile
  index: number
  estimatedRamGB: number
  severity: 'good' | 'tight' | 'too-large'
  rank: number
  reason: string
}

export async function getFileRecommendations(modelId: string): Promise<FileRecommendationView[]> {
  return (await sovara().invoke('explore:getRecommendations', { modelId })) as FileRecommendationView[]
}

export async function getHardwareProfile(): Promise<import('@shared/types/explore').HardwareInfo> {
  return (await sovara().invoke('explore:getHardwareProfile')) as import('@shared/types/explore').HardwareInfo
}

// ── Library (downloaded models) ──
export interface LibraryModel {
  name: string
  file: string
  sizeBytes: number
  path: string
  modifiedAt: number
}

export async function listLibraryModels(): Promise<LibraryModel[]> {
  return (await sovara().invoke('library:listModels')) as LibraryModel[]
}

export async function getLibraryDirectory(): Promise<{ path: string }> {
  return (await sovara().invoke('library:getDirectory')) as { path: string }
}

export async function setLibraryDirectory(path = ''): Promise<{ ok: boolean; path: string }> {
  return (await sovara().invoke('library:setDirectory', { path })) as { ok: boolean; path: string }
}

export async function deleteLibraryModel(path: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('library:delete', { path })) as { ok: boolean }
}

// ── Model downloads (progress on events:download) ──
export type DownloadState = 'queued' | 'started' | 'progress' | 'paused' | 'done' | 'error' | 'cancelled'

export interface DownloadEventView {
  modelId: string
  rfilename: string
  state: DownloadState
  receivedBytes: number
  totalBytes: number | null
  error?: string
  speedBps?: number
  etaSeconds?: number
}

export interface DownloadExtra {
  parts?: Array<{ rfilename: string; downloadUrl: string; sizeBytes?: number }>
  companion?: { rfilename: string; downloadUrl: string; sizeBytes?: number }
  revision?: string
  format?: string
  quantization?: string
  license?: string
  gated?: boolean
}

export async function downloadModelFile(
  modelId: string,
  rfilename: string,
  downloadUrl: string,
  extra?: DownloadExtra
): Promise<{ ok: boolean; resumed: boolean }> {
  return (await sovara().invoke('library:download', { modelId, rfilename, downloadUrl, ...extra })) as {
    ok: boolean
    resumed: boolean
  }
}

export async function cancelModelDownload(modelId: string, rfilename: string): Promise<{ cancelled: boolean }> {
  return (await sovara().invoke('library:cancelDownload', { modelId, rfilename })) as { cancelled: boolean }
}

export async function pauseModelDownload(modelId: string, rfilename: string): Promise<{ paused: boolean }> {
  return (await sovara().invoke('library:pauseDownload', { modelId, rfilename })) as { paused: boolean }
}

export async function resumeModelDownload(modelId: string, rfilename: string, downloadUrl: string, revision?: string): Promise<{ resumed: boolean }> {
  return (await sovara().invoke('library:resumeDownload', { modelId, rfilename, downloadUrl, ...(revision ? { revision } : {}) })) as { resumed: boolean }
}

export async function getActiveDownloads(): Promise<Array<{ modelId: string; rfilename: string; state: string; receivedBytes?: number; totalBytes?: number | null }>> {
  return (await sovara().invoke('library:getActiveDownloads')) as Array<{ modelId: string; rfilename: string; state: string; receivedBytes?: number; totalBytes?: number | null }>
}

export async function isDownloaded(modelId: string, rfilename: string): Promise<{ downloaded: boolean }> {
  return (await sovara().invoke('library:isDownloaded', { modelId, rfilename })) as { downloaded: boolean }
}

export type ModelFileState = 'downloaded' | 'partial' | 'paused' | 'queued' | 'downloading' | 'failed' | 'missing'

export interface ModelFileStatus {
  state: ModelFileState
  downloadedBytes: number
  totalBytes: number | null
  destPath?: string
  error?: string
  partsPresent?: number
  partsTotal?: number
  companionMissing?: boolean
  source: 'registry' | 'filesystem' | 'none'
}

export async function getModelFileStatus(modelId: string, rfilename: string, revision = 'main'): Promise<ModelFileStatus> {
  return (await sovara().invoke('library:getFileStatus', { modelId, rfilename, revision })) as ModelFileStatus
}

export interface ReconcileReport {
  checked: number
  fixed: number
  adopted: number
  unregistered: string[]
  orphanPartials: string[]
  missing: string[]
}

export async function reconcileLibrary(): Promise<ReconcileReport> {
  return (await sovara().invoke('library:reconcile')) as ReconcileReport
}

export async function openModelFolder(modelId: string, rfilename: string, revision = 'main'): Promise<{ ok: boolean; path: string }> {
  return (await sovara().invoke('library:openFolder', { modelId, rfilename, revision })) as { ok: boolean; path: string }
}

export async function openExternal(url: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('shell:openExternal', { url })) as { ok: boolean }
}

export function onDownloadEvents(callback: (event: DownloadEventView) => void): () => void {
  return sovara().on('events:download', (...args: unknown[]) => {
    callback(args[0] as DownloadEventView)
  })
}

// ── MCP servers (Connected Apps) — global MCP folder + AI URL install ──
export interface McpServerView {
  id: string
  name: string
  provider: string
  transport: 'stdio' | 'http'
  command?: string
  endpoint?: string
  enabled: boolean
  createdAt: number
  status?: 'connected' | 'disconnected' | 'error' | 'probing' | 'installing'
  lastError?: string
  url?: string
  localPath?: string
}

export async function listMcpServers(): Promise<McpServerView[]> {
  return (await sovara().invoke('mcp:list')) as McpServerView[]
}

export async function addMcpServer(input: {
  name: string
  provider?: string
  transport: 'stdio' | 'http'
  command?: string
  endpoint?: string
}): Promise<McpServerView> {
  return (await sovara().invoke('mcp:add', input)) as McpServerView
}

export async function installMcpFromUrl(url: string): Promise<{ server: McpServerView; steps: string[]; detectedCommand: string; localPath: string }> {
  return (await sovara().invoke('mcp:installFromUrl', { url })) as { server: McpServerView; steps: string[]; detectedCommand: string; localPath: string }
}

export async function getMcpDir(): Promise<{ path: string; exists: boolean }> {
  return (await sovara().invoke('mcp:getDir')) as { path: string; exists: boolean }
}

export async function openMcpFolder(): Promise<{ ok: boolean; path: string }> {
  return (await sovara().invoke('mcp:openFolder')) as { ok: boolean; path: string }
}

export async function removeMcpServer(id: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('mcp:remove', { id })) as { ok: boolean }
}

export async function toggleMcpServer(id: string, enabled: boolean): Promise<McpServerView> {
  return (await sovara().invoke('mcp:toggle', { id, enabled })) as McpServerView
}

export async function probeMcpServer(id: string): Promise<McpServerView> {
  return (await sovara().invoke('mcp:probe', { id })) as McpServerView
}

// ── Voice transcription (local faster-whisper) ──
export interface VoiceTranscribeResult {
  ok: boolean
  text?: string
  raw?: string
  language?: string
  duration?: number
  transcribeTime?: number
  error?: string
}

export async function getVoiceStatus(): Promise<{ ready: boolean }> {
  return (await sovara().invoke('voice:status')) as { ready: boolean }
}

export async function transcribeAudio(audioBase64: string, filename: string): Promise<VoiceTranscribeResult> {
  return (await sovara().invoke('voice:transcribe', { audio: audioBase64, filename })) as VoiceTranscribeResult
}

// ── Validation per MODEL_HARDWARE_VALIDATION ──
import type { ValidationJob, HardwareProfileFull, ValidationStoreEntry } from '@shared/types/validation'
export type { ValidationJob, HardwareProfileFull, ValidationStoreEntry } from '@shared/types/validation'

export async function getFullHardwareProfile(): Promise<HardwareProfileFull> {
  return (await sovara().invoke('validation:getFullProfile')) as HardwareProfileFull
}
export async function startValidation(modelId: string, libraryPath?: string, ctxLen?: number): Promise<ValidationJob> {
  return (await sovara().invoke('validation:start', { modelId, libraryPath, ctxLen })) as ValidationJob
}
export async function getValidation(jobId: string): Promise<ValidationJob> {
  return (await sovara().invoke('validation:get', { jobId })) as ValidationJob
}
export async function listValidations(): Promise<ValidationJob[]> {
  return (await sovara().invoke('validation:list')) as ValidationJob[]
}
export async function listValidationCache(): Promise<ValidationStoreEntry[]> {
  return (await sovara().invoke('validation:storeList')) as ValidationStoreEntry[]
}

// ── Loaded instances (runtime monitoring & management) ──
import type { ModelInstance, InstanceMetrics } from '@shared/types/ports'
export type { ModelInstance, InstanceMetrics, InstanceStatus } from '@shared/types/ports'

export async function listInstances(): Promise<ModelInstance[]> {
  return (await sovara().invoke('instances:list')) as ModelInstance[]
}

export async function unloadInstance(instanceId: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('instances:unload', { instanceId })) as { ok: boolean }
}

export async function getInstanceMetrics(instanceId: string): Promise<{ ok: boolean; vramUsedMB?: number; error?: string }> {
  return (await sovara().invoke('instances:getMetrics', { instanceId })) as { ok: boolean; vramUsedMB?: number; error?: string }
}

export interface InstanceEvent {
  type: 'status-changed' | 'metrics-updated' | 'removed'
  instanceId: string
  instance?: ModelInstance
  metrics?: InstanceMetrics
}

export function onInstanceEvents(callback: (event: InstanceEvent) => void): () => void {
  return sovara().on('events:instances', (...args: unknown[]) => {
    callback(args[0] as InstanceEvent)
  })
}
