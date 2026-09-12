/**
 * Typed IPC client for the Electron renderer.
 * All calls go through window.sovara.invoke (preload bridge).
 * Falls back to throwing when IPC is unavailable (e.g. vitest without mock).
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

function ipcInvoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const w = window as unknown as { sovara?: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }
  if (!w.sovara?.invoke) throw new Error(`IPC unavailable: ${channel}`)
  return w.sovara.invoke(channel, ...args) as Promise<T>
}

function ipcOn<T>(channel: string, callback: (event: T) => void): () => void {
  const w = window as unknown as { sovara?: { on: (c: string, cb: (...a: unknown[]) => void) => () => void } }
  if (!w.sovara?.on) return () => {}
  return w.sovara.on(channel, (...args: unknown[]) => callback(args[0] as T))
}

export interface AppInfoView {
  name: string
  version: string
  electron: string | null
  runtime: string
  node: string
  platform: string
  arch: string
}

export async function getAppInfo(): Promise<AppInfoView> {
  return ipcInvoke('app:getInfo')
}

export async function listSessions(): Promise<SessionHeaderView[]> {
  return ipcInvoke('sessions:list')
}

export async function createSession(title: string, projectId?: string | null): Promise<SessionHeaderView> {
  return ipcInvoke('sessions:create', { title, projectId: projectId ?? null })
}

export async function renameSession(sessionId: string, title: string): Promise<SessionHeaderView> {
  return ipcInvoke('sessions:rename', { sessionId, title })
}

export async function deleteSession(sessionId: string): Promise<{ ok: boolean }> {
  return ipcInvoke('sessions:delete', sessionId)
}

export async function listProjects(): Promise<ProjectView[]> {
  return ipcInvoke('projects:list')
}

export async function createProject(name: string, rootPath: string): Promise<ProjectView> {
  return ipcInvoke('projects:create', { name, rootPath })
}

export async function renameProject(projectId: string, name: string): Promise<ProjectView> {
  return ipcInvoke('projects:rename', { projectId, name })
}

export async function deleteProject(projectId: string): Promise<{ ok: boolean }> {
  return ipcInvoke('projects:delete', { projectId })
}

export async function pickFolder(): Promise<{ canceled: boolean; filePath: string | null }> {
  return ipcInvoke('dialog:pickFolder')
}

export async function getSessionEvents(sessionId: string): Promise<SessionEventView[]> {
  return ipcInvoke('sessions:getEvents', sessionId)
}

export async function archiveSession(sessionId: string): Promise<{ ok: boolean }> {
  return ipcInvoke('sessions:archive', { sessionId })
}

export async function unarchiveSession(sessionId: string): Promise<{ ok: boolean }> {
  return ipcInvoke('sessions:unarchive', { sessionId })
}

export async function listArchivedSessions(): Promise<SessionHeaderView[]> {
  return ipcInvoke('sessions:listArchived')
}

export interface ChatAttachmentView {
  name: string
  type: string
  size: number
  /** data: URL (base64) as produced by FileReader.readAsDataURL. */
  data: string
}

export async function sendChatMessage(
  sessionId: string,
  content: string,
  opts?: { webSearch?: boolean; reasoning?: boolean; attachments?: ChatAttachmentView[] }
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  return ipcInvoke('chat:send', { sessionId, content, ...opts })
}

export async function openArtifact(filePath: string): Promise<{ ok: boolean; path: string }> {
  return ipcInvoke('artifacts:open', { path: filePath })
}

export async function cancelChatMessage(sessionId: string): Promise<{ cancelled: boolean }> {
  return ipcInvoke('chat:cancel', { sessionId })
}

export async function regenerateChatMessage(sessionId: string, opts?: { reasoning?: boolean }): Promise<{ ok: boolean; assistantSeq: number }> {
  return ipcInvoke('chat:regenerate', { sessionId, ...opts })
}

export async function editAndResendChatMessage(
  sessionId: string,
  content: string,
  opts?: { webSearch?: boolean; reasoning?: boolean; attachments?: ChatAttachmentView[] }
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  return ipcInvoke('chat:editResend', { sessionId, content, ...opts })
}

export type { ChatStreamEvent } from '@shared/types/chat'

export function onSessionEvents(
  callback: (event: import('@shared/types/chat').ChatStreamEvent) => void
): () => void {
  return ipcOn('events:session', callback)
}

export async function listRuntimes(): Promise<ModelRuntimeEntry[]> {
  return ipcInvoke('models:listRuntimes')
}

export async function addRuntime(input: {
  displayName: string
  endpoint: string
  type?: RuntimeType
  timeoutMs?: number
}): Promise<ModelRuntimeEntry> {
  return ipcInvoke('models:addRuntime', input)
}

export async function removeRuntime(runtimeId: string): Promise<{ ok: boolean }> {
  return ipcInvoke('models:removeRuntime', { runtimeId })
}

export async function testRuntimeConnection(runtimeId: string): Promise<RuntimeProbeResult> {
  return ipcInvoke('models:testConnection', { runtimeId })
}

export async function listDiscoveredModels(runtimeId?: string): Promise<DiscoveredModel[]> {
  return ipcInvoke('models:listModels', runtimeId ? { runtimeId } : {})
}

export async function selectModel(runtimeId: string, modelId: string, opts?: { fit?: boolean }): Promise<ActiveModelState> {
  return ipcInvoke('models:selectModel', { runtimeId, modelId, ...(opts ?? {}) })
}

export async function getActiveModel(): Promise<ActiveModelState> {
  return ipcInvoke('models:getActiveModel')
}

export interface LocalRuntimeStatus {
  available: boolean
  version?: string
  path?: string
}

export async function probeLocalRuntime(): Promise<LocalRuntimeStatus> {
  return ipcInvoke('models:probeRuntime', 'local')
}

export interface LocalRuntimeInstallResult {
  path: string
  version: string | null
  downloaded: boolean
}

export async function ensureLocalRuntime(): Promise<LocalRuntimeInstallResult> {
  return ipcInvoke('models:ensureRuntime', {})
}

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
  return ipcInvoke('models:listRegistry', runtimeId ? { runtimeId } : {})
}

export async function updateRegistryRow(
  id: string,
  patch: { installStatus?: RegistryInstallStatus; runtimeId?: string | null; displayName?: string }
): Promise<{ ok: boolean }> {
  return ipcInvoke('models:updateRegistry', { id, patch })
}

export async function removeRegistryRow(id: string): Promise<{ ok: boolean }> {
  return ipcInvoke('models:removeRegistry', { id })
}

export async function removeRegistryRowsByPath(localPath: string): Promise<{ ok: boolean }> {
  return ipcInvoke('models:removeRegistryByPath', { localPath })
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
  return ipcInvoke('system:getResources')
}

export interface SystemInfoView {
  cpus: number
  totalMemMB: number
  freeMemMB: number
  homedir: string
  userData: string
}

export async function getSystemInfo(): Promise<SystemInfoView> {
  return ipcInvoke('app:getSystem')
}

export type ExecMode = 'off' | 'ask' | 'review' | 'allow'

export async function getExecMode(): Promise<ExecMode> {
  const r = await ipcInvoke<{ mode: ExecMode }>('exec:getMode')
  return r.mode
}

export async function setExecMode(mode: ExecMode): Promise<ExecMode> {
  const r = await ipcInvoke<{ mode: ExecMode }>('exec:setMode', mode)
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
  return ipcInvoke('tools:list')
}

export async function dispatchTool(name: string, args?: Record<string, unknown>): Promise<ToolDispatchResult> {
  return ipcInvoke('tools:dispatch', { name, args: args ?? {} })
}

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
  return ipcInvoke('settings:get')
}

export async function setAppSettings(patch: AppSettingsPatch): Promise<AppSettingsState> {
  return ipcInvoke('settings:set', patch)
}

export async function checkForUpdatesNow(): Promise<UpdateCheckView> {
  return ipcInvoke('updates:checkNow')
}

export type PythonPhase = 'idle' | 'checking' | 'installing-deps' | 'installing-browsers' | 'ready' | 'no-python' | 'error'

export interface PythonStatusView {
  phase: PythonPhase
  message: string
  pythonExe: string | null
  source: 'system' | 'venv' | null
}

export async function getPythonSetupStatus(): Promise<PythonStatusView> {
  return ipcInvoke('setup:getPythonStatus')
}

export async function ensurePythonSetup(): Promise<PythonStatusView> {
  return ipcInvoke('setup:ensurePython')
}

export async function minimizeWindow(): Promise<void> {
  await ipcInvoke('window:minimize')
}
export async function maximizeWindow(): Promise<void> {
  await ipcInvoke('window:maximize')
}
export async function closeWindow(): Promise<void> {
  await ipcInvoke('window:close')
}

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
  return ipcInvoke('usage:getTotal')
}

export async function getUsageByModel(): Promise<ModelUsage[]> {
  return ipcInvoke('usage:getByModel')
}

export interface RecentUsageRow {
  sessionId: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  timestamp: number
}

export async function getRecentUsage(limit = 20): Promise<RecentUsageRow[]> {
  return ipcInvoke('usage:getRecent', { limit })
}

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
  return ipcInvoke('skills:scan')
}

export async function toggleSkillsSource(
  sourceName: string,
  enabled: boolean
): Promise<{ ok: boolean }> {
  return ipcInvoke('skills:toggle', { sourceName, enabled })
}

export async function listBionicSkills(): Promise<BionicSkillView[]> {
  return ipcInvoke('skills:listBionic')
}

export async function addBionicSkill(input: { name: string; description?: string; content: string }): Promise<BionicSkillView> {
  return ipcInvoke('skills:addBionic', input)
}

export async function removeBionicSkill(id: string): Promise<{ ok: boolean }> {
  return ipcInvoke('skills:removeBionic', { id })
}

export async function listDetailedSkills(): Promise<Array<{ name: string; path: string; skills: BionicSkillView[] }>> {
  return ipcInvoke('skills:listDetailed')
}

export async function importSkillFromUrl(url: string): Promise<BionicSkillView> {
  return ipcInvoke('skills:importFromUrl', { url })
}

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

export async function listExploreModelsPage(opts: ExploreListOpts): Promise<ExploreListPage> {
  return ipcInvoke('explore:listModels', opts)
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
  return ipcInvoke('explore:getModel', { modelId })
}

export async function getModelCompatibility(modelId: string): Promise<CompatibilityResult> {
  return ipcInvoke('explore:getCompatibility', { modelId })
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
  return ipcInvoke('explore:getRecommendations', { modelId })
}

export async function getHardwareProfile(): Promise<import('@shared/types/explore').HardwareInfo> {
  return ipcInvoke('explore:getHardwareProfile')
}

export interface LibraryModel {
  name: string
  file: string
  sizeBytes: number
  path: string
  modifiedAt: number
  source?: 'registry' | 'filesystem'
  installStatus?: RegistryInstallStatus
  downloadStatus?: DownloadRowStatus
  runtimeId?: string | null
}

export async function listLibraryModels(): Promise<LibraryModel[]> {
  return ipcInvoke('library:listModels')
}

export async function getLibraryDirectory(): Promise<{ path: string }> {
  return ipcInvoke('library:getDirectory')
}

export type DetectedModelLocationKind = 'lmstudio' | 'ollama'

export interface DetectedModelLocation {
  kind: DetectedModelLocationKind
  name: string
  path: string
  exists: boolean
  modelCount: number
}

export async function detectLibraryLocations(): Promise<DetectedModelLocation[]> {
  return ipcInvoke('library:detectLocations')
}

export async function setLibraryDirectory(path = ''): Promise<{ ok: boolean; path: string }> {
  return ipcInvoke('library:setDirectory', { path })
}

export async function deleteLibraryModel(path: string): Promise<{ ok: boolean }> {
  return ipcInvoke('library:delete', { path })
}

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
  return ipcInvoke('library:download', { modelId, rfilename, downloadUrl, ...extra })
}

export async function cancelModelDownload(modelId: string, rfilename: string): Promise<{ cancelled: boolean }> {
  return ipcInvoke('library:cancelDownload', { modelId, rfilename })
}

export async function pauseModelDownload(modelId: string, rfilename: string): Promise<{ paused: boolean }> {
  return ipcInvoke('library:pauseDownload', { modelId, rfilename })
}

export async function resumeModelDownload(modelId: string, rfilename: string, downloadUrl: string, revision?: string): Promise<{ resumed: boolean }> {
  return ipcInvoke('library:resumeDownload', { modelId, rfilename, downloadUrl, ...(revision ? { revision } : {}) })
}

export async function getActiveDownloads(): Promise<Array<{ modelId: string; rfilename: string; state: string; receivedBytes?: number; totalBytes?: number | null }>> {
  return ipcInvoke('library:getActiveDownloads')
}

export async function isDownloaded(modelId: string, rfilename: string): Promise<{ downloaded: boolean }> {
  return ipcInvoke('library:isDownloaded', { modelId, rfilename })
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
  return ipcInvoke('library:getFileStatus', { modelId, rfilename, revision })
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
  return ipcInvoke('library:reconcile')
}

export async function openModelFolder(modelId: string, rfilename: string, revision = 'main'): Promise<{ ok: boolean; path: string }> {
  return ipcInvoke('library:openFolder', { modelId, rfilename, revision })
}

const HF_HOSTS = new Set(['huggingface.co', 'www.huggingface.co', 'cdn-lfs.huggingface.co', 'huggingface.s3.amazonaws.com', 'github.com', 'www.github.com', 'raw.githubusercontent.com'])

export async function openExternal(url: string): Promise<{ ok: boolean }> {
  try {
    const u = new URL(url)
    const allowed =
      HF_HOSTS.has(u.hostname) || u.hostname.endsWith('.huggingface.co') || u.hostname.endsWith('.hf.co') || u.hostname.endsWith('github.com')
    if (u.protocol !== 'https:' || !allowed) throw new Error('URL not allowed')
    await ipcInvoke('shell:openExternal', { url: u.toString() })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function onDownloadEvents(callback: (event: DownloadEventView) => void): () => void {
  return ipcOn('events:download', callback)
}

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
  return ipcInvoke('mcp:list')
}

export async function addMcpServer(input: {
  name: string
  provider?: string
  transport: 'stdio' | 'http'
  command?: string
  endpoint?: string
}): Promise<McpServerView> {
  return ipcInvoke('mcp:add', input)
}

export async function installMcpFromUrl(url: string): Promise<{ server: McpServerView; steps: string[]; detectedCommand: string; localPath: string }> {
  return ipcInvoke('mcp:installFromUrl', { url })
}

export async function getMcpDir(): Promise<{ path: string; exists: boolean }> {
  return ipcInvoke('mcp:getDir')
}

export async function openMcpFolder(): Promise<{ ok: boolean; path: string }> {
  return ipcInvoke('mcp:openFolder')
}

export async function removeMcpServer(id: string): Promise<{ ok: boolean }> {
  return ipcInvoke('mcp:remove', { id })
}

export async function toggleMcpServer(id: string, enabled: boolean): Promise<McpServerView> {
  return ipcInvoke('mcp:toggle', { id, enabled })
}

export async function probeMcpServer(id: string): Promise<McpServerView> {
  return ipcInvoke('mcp:probe', { id })
}

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
  return ipcInvoke('voice:status')
}

export async function transcribeAudio(audioBase64: string, filename: string): Promise<VoiceTranscribeResult> {
  return ipcInvoke('voice:transcribe', { audio: audioBase64, filename })
}

import type { ValidationJob, HardwareProfileFull, ValidationStoreEntry } from '@shared/types/validation'
export type { ValidationJob, HardwareProfileFull, ValidationStoreEntry } from '@shared/types/validation'

export async function getFullHardwareProfile(): Promise<HardwareProfileFull> {
  return ipcInvoke('validation:getFullProfile')
}
export async function startValidation(modelId: string, libraryPath?: string, ctxLen?: number): Promise<ValidationJob> {
  return ipcInvoke('validation:start', { modelId, libraryPath, ctxLen })
}
export async function getValidation(jobId: string): Promise<ValidationJob> {
  return ipcInvoke('validation:get', { jobId })
}
export async function listValidations(): Promise<ValidationJob[]> {
  return ipcInvoke('validation:list')
}
export async function listValidationCache(): Promise<ValidationStoreEntry[]> {
  return ipcInvoke('validation:storeList')
}

import type { ModelInstance, InstanceMetrics } from '@shared/types/ports'
export type { ModelInstance, InstanceMetrics, InstanceStatus } from '@shared/types/ports'

export async function listInstances(): Promise<ModelInstance[]> {
  return ipcInvoke('instances:list')
}

export async function unloadInstance(instanceId: string): Promise<{ ok: boolean }> {
  return ipcInvoke('instances:unload', { instanceId })
}

export async function getInstanceMetrics(instanceId: string): Promise<{ ok: boolean; vramUsedMB?: number; error?: string }> {
  return ipcInvoke('instances:getMetrics', { instanceId })
}

export interface InstanceEvent {
  type: 'status-changed' | 'metrics-updated' | 'removed'
  instanceId: string
  instance?: ModelInstance
  metrics?: InstanceMetrics
}

export function onInstanceEvents(callback: (event: InstanceEvent) => void): () => void {
  return ipcOn('events:instances', callback)
}

export async function getRecentLogs(kind: 'all' | 'detection' | 'runtime' | 'app' | 'chat' = 'all'): Promise<Record<string, string[]>> {
  return ipcInvoke('logs:getRecent', { kind })
}
