/**
 * Typed HTTP client for the browser — the Next.js counterpart of the
 * Electron renderer's `lib/ipc.ts`.
 *
 * Same function names, same signatures, same return shapes; only the
 * transport changes (fetch → internal /api routes instead of
 * window.sovara.invoke → IPC). UI files therefore migrate with an import
 * change, not a rewrite. Push channels (session/download/instances) arrive
 * over SSE (EventSource) instead of webContents broadcasts.
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

const API_BASE =
  typeof process !== 'undefined' && process.env['NEXT_PUBLIC_SOVARA_API_BASE']
    ? (process.env['NEXT_PUBLIC_SOVARA_API_BASE'] as string)
    : ''

async function apiFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    // non-JSON (e.g. gateway error page)
  }
  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `request failed: ${res.status} ${path}`
    throw new Error(message)
  }
  return data as T
}

function subscribeSse<T>(url: string, callback: (event: T) => void): () => void {
  const source = new EventSource(`${API_BASE}${url}`)
  source.onmessage = (msg: MessageEvent) => {
    try {
      callback(JSON.parse(msg.data as string) as T)
    } catch {
      // ignore malformed frames / heartbeats (EventSource skips comments)
    }
  }
  source.onerror = () => {
    // EventSource auto-reconnects; a dead server just idles.
  }
  return () => source.close()
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
  return apiFetch('/api/app/info')
}

export async function listSessions(): Promise<SessionHeaderView[]> {
  return apiFetch('/api/sessions')
}

export async function createSession(title: string, projectId?: string | null): Promise<SessionHeaderView> {
  return apiFetch('/api/sessions', { method: 'POST', body: { title, projectId: projectId ?? null } })
}

export async function renameSession(sessionId: string, title: string): Promise<SessionHeaderView> {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'PATCH', body: { title } })
}

export async function deleteSession(sessionId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export async function listProjects(): Promise<ProjectView[]> {
  return apiFetch('/api/projects')
}

export async function createProject(name: string, rootPath: string): Promise<ProjectView> {
  return apiFetch('/api/projects', { method: 'POST', body: { name, rootPath } })
}

export async function renameProject(projectId: string, name: string): Promise<ProjectView> {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: { name } })
}

export async function deleteProject(projectId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' })
}

export async function pickFolder(): Promise<{ canceled: boolean; filePath: string | null }> {
  // No native folder dialog on web — callers fall back to manual path entry.
  return { canceled: true, filePath: null }
}

export async function getSessionEvents(sessionId: string): Promise<SessionEventView[]> {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/events`)
}

export async function archiveSession(sessionId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/archive`, { method: 'POST' })
}

export async function unarchiveSession(sessionId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/unarchive`, { method: 'POST' })
}

export async function listArchivedSessions(): Promise<SessionHeaderView[]> {
  return apiFetch('/api/sessions/archived')
}

export interface ChatAttachmentView {
  name: string
  type: string
  size: number
  data: string
}

export async function sendChatMessage(
  sessionId: string,
  content: string,
  opts?: { webSearch?: boolean; reasoning?: boolean; attachments?: ChatAttachmentView[] }
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  // Long-lived request: resolves when generation completes and the single
  // durable assistant event is persisted. Deltas arrive via onSessionEvents.
  return apiFetch('/api/chat', { method: 'POST', body: { sessionId, content, ...opts } })
}

export async function cancelChatMessage(sessionId: string): Promise<{ cancelled: boolean }> {
  return apiFetch('/api/chat/cancel', { method: 'POST', body: { sessionId } })
}

export async function regenerateChatMessage(sessionId: string, opts?: { reasoning?: boolean }): Promise<{ ok: boolean; assistantSeq: number }> {
  return apiFetch('/api/chat/regenerate', { method: 'POST', body: { sessionId, ...opts } })
}

export async function editAndResendChatMessage(
  sessionId: string,
  content: string,
  opts?: { webSearch?: boolean; reasoning?: boolean; attachments?: ChatAttachmentView[] }
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  return apiFetch('/api/chat/edit-resend', { method: 'POST', body: { sessionId, content, ...opts } })
}

export type { ChatStreamEvent } from '@shared/types/chat'

export function onSessionEvents(
  callback: (event: import('@shared/types/chat').ChatStreamEvent) => void
): () => void {
  // Unfiltered stream (all sessions): the callers filter by selected session
  // exactly as they did with the Electron `events:session` broadcast.
  return subscribeSse('/api/chat/stream', callback)
}

export async function listRuntimes(): Promise<ModelRuntimeEntry[]> {
  return apiFetch('/api/runtimes')
}

export async function addRuntime(input: {
  displayName: string
  endpoint: string
  type?: RuntimeType
  timeoutMs?: number
}): Promise<ModelRuntimeEntry> {
  return apiFetch('/api/runtimes', { method: 'POST', body: input })
}

export async function removeRuntime(runtimeId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/runtimes/${encodeURIComponent(runtimeId)}`, { method: 'DELETE' })
}

export async function testRuntimeConnection(runtimeId: string): Promise<RuntimeProbeResult> {
  return apiFetch(`/api/runtimes/${encodeURIComponent(runtimeId)}/probe`, { method: 'POST' })
}

export async function listDiscoveredModels(runtimeId?: string): Promise<DiscoveredModel[]> {
  return apiFetch(runtimeId ? `/api/models?runtimeId=${encodeURIComponent(runtimeId)}` : '/api/models')
}

export async function selectModel(runtimeId: string, modelId: string, opts?: { fit?: boolean }): Promise<ActiveModelState> {
  return apiFetch('/api/models/select', {
    method: 'POST',
    body: { runtimeId, modelId, ...(opts?.fit === true ? { fit: true } : {}) },
  })
}

export async function getActiveModel(): Promise<ActiveModelState> {
  return apiFetch('/api/models/active')
}

// ── Owned local runtime (Sovara's own llama.cpp sidecar, no third party) ──
export interface LocalRuntimeStatus {
  available: boolean
  version?: string
  path?: string
}

export async function probeLocalRuntime(): Promise<LocalRuntimeStatus> {
  return apiFetch('/api/models/probe', { method: 'POST', body: { runtimeId: 'local' } })
}

export interface LocalRuntimeInstallResult {
  path: string
  version: string | null
  downloaded: boolean
}

export async function ensureLocalRuntime(): Promise<LocalRuntimeInstallResult> {
  return apiFetch('/api/models/ensure-runtime', { method: 'POST', body: {} })
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
  return apiFetch(runtimeId ? `/api/registry?runtimeId=${encodeURIComponent(runtimeId)}` : '/api/registry')
}

export async function updateRegistryRow(
  id: string,
  patch: { installStatus?: RegistryInstallStatus; runtimeId?: string | null; displayName?: string }
): Promise<{ ok: boolean }> {
  return apiFetch('/api/registry', { method: 'PATCH', body: { id, patch } })
}

export async function removeRegistryRow(id: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/registry', { method: 'DELETE', body: { id } })
}

export async function removeRegistryRowsByPath(localPath: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/registry/remove-by-path', { method: 'POST', body: { localPath } })
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
  return apiFetch('/api/hardware')
}

// ── Exec permissions (AI command levels) ──
export type ExecMode = 'off' | 'ask' | 'review' | 'allow'

export async function getExecMode(): Promise<ExecMode> {
  const r = await apiFetch<{ mode: ExecMode }>('/api/exec/mode')
  return r.mode
}

export async function setExecMode(mode: ExecMode): Promise<ExecMode> {
  const r = await apiFetch<{ mode: ExecMode }>('/api/exec/mode', { method: 'PUT', body: mode })
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
  return apiFetch('/api/tools')
}

export async function dispatchTool(name: string, args?: Record<string, unknown>): Promise<ToolDispatchResult> {
  return apiFetch('/api/tools/dispatch', { method: 'POST', body: { name, args: args ?? {} } })
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
  return apiFetch('/api/settings')
}

export async function setAppSettings(patch: AppSettingsPatch): Promise<AppSettingsState> {
  return apiFetch('/api/settings', { method: 'PATCH', body: patch })
}

export async function checkForUpdatesNow(): Promise<UpdateCheckView> {
  return apiFetch('/api/settings/check-updates', { method: 'POST' })
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
  return apiFetch('/api/setup/python')
}

export async function ensurePythonSetup(): Promise<PythonStatusView> {
  return apiFetch('/api/setup/python', { method: 'POST' })
}

// ── Window controls — Electron-only; no-ops on web (controls hidden in UI) ──
export async function minimizeWindow(): Promise<void> {}
export async function maximizeWindow(): Promise<void> {}
export async function closeWindow(): Promise<void> {}

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
  return apiFetch('/api/usage/total')
}

export async function getUsageByModel(): Promise<ModelUsage[]> {
  return apiFetch('/api/usage/by-model')
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
  return apiFetch(`/api/usage/recent?limit=${limit}`)
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
  return apiFetch('/api/skills/sources')
}

export async function toggleSkillsSource(
  sourceName: string,
  enabled: boolean
): Promise<{ ok: boolean }> {
  return apiFetch('/api/skills/sources/toggle', { method: 'POST', body: { sourceName, enabled } })
}

export async function listBionicSkills(): Promise<BionicSkillView[]> {
  return apiFetch('/api/skills/bionic')
}

export async function addBionicSkill(input: { name: string; description?: string; content: string }): Promise<BionicSkillView> {
  return apiFetch('/api/skills/bionic', { method: 'POST', body: input })
}

export async function removeBionicSkill(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/skills/bionic/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function listDetailedSkills(): Promise<Array<{ name: string; path: string; skills: BionicSkillView[] }>> {
  return apiFetch('/api/skills/detailed')
}

export async function importSkillFromUrl(url: string): Promise<BionicSkillView> {
  return apiFetch('/api/skills/import', { method: 'POST', body: { url } })
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
  if (Array.isArray(raw)) return { models: raw as ExploreModel[], nextCursor: null }
  const p = raw as { models?: unknown; nextCursor?: unknown }
  return {
    models: Array.isArray(p.models) ? (p.models as ExploreModel[]) : [],
    nextCursor: typeof p.nextCursor === 'string' ? p.nextCursor : null,
  }
}

export async function listExploreModelsPage(opts: ExploreListOpts): Promise<ExploreListPage> {
  return normalizeListPage(await apiFetch('/api/explore/models', { method: 'POST', body: opts }))
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
  return apiFetch(`/api/explore/models/${encodeURIComponent(modelId)}`)
}

export async function getModelCompatibility(modelId: string): Promise<CompatibilityResult> {
  return apiFetch(`/api/explore/models/${encodeURIComponent(modelId)}/compatibility`)
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
  return apiFetch(`/api/explore/models/${encodeURIComponent(modelId)}/recommendations`)
}

export async function getHardwareProfile(): Promise<import('@shared/types/explore').HardwareInfo> {
  return apiFetch('/api/explore/hardware')
}

// ── Library (downloaded models) ──
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
  return apiFetch('/api/library')
}

export async function getLibraryDirectory(): Promise<{ path: string }> {
  return apiFetch('/api/library/directory')
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
  return apiFetch('/api/library/locations')
}

export async function setLibraryDirectory(path = ''): Promise<{ ok: boolean; path: string }> {
  return apiFetch('/api/library/directory', { method: 'POST', body: { path } })
}

export async function deleteLibraryModel(path: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/library', { method: 'DELETE', body: { path } })
}

// ── Model downloads (progress on SSE /api/library/events) ──
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
  return apiFetch('/api/library/download', { method: 'POST', body: { modelId, rfilename, downloadUrl, ...extra } })
}

export async function cancelModelDownload(modelId: string, rfilename: string): Promise<{ cancelled: boolean }> {
  return apiFetch('/api/library/cancel', { method: 'POST', body: { modelId, rfilename } })
}

export async function pauseModelDownload(modelId: string, rfilename: string): Promise<{ paused: boolean }> {
  return apiFetch('/api/library/pause', { method: 'POST', body: { modelId, rfilename } })
}

export async function resumeModelDownload(modelId: string, rfilename: string, downloadUrl: string, revision?: string): Promise<{ resumed: boolean }> {
  return apiFetch('/api/library/resume', {
    method: 'POST',
    body: { modelId, rfilename, downloadUrl, ...(revision ? { revision } : {}) },
  })
}

export async function getActiveDownloads(): Promise<Array<{ modelId: string; rfilename: string; state: string; receivedBytes?: number; totalBytes?: number | null }>> {
  return apiFetch('/api/library/downloads')
}

export async function isDownloaded(modelId: string, rfilename: string): Promise<{ downloaded: boolean }> {
  return apiFetch('/api/library/is-downloaded', { method: 'POST', body: { modelId, rfilename } })
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
  return apiFetch('/api/library/file-status', { method: 'POST', body: { modelId, rfilename, revision } })
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
  return apiFetch('/api/library/reconcile', { method: 'POST' })
}

export async function openModelFolder(modelId: string, rfilename: string, revision = 'main'): Promise<{ ok: boolean; path: string }> {
  // Web has no native file explorer: the server returns the resolved path.
  return apiFetch('/api/library/open-folder', { method: 'POST', body: { modelId, rfilename, revision } })
}

const HF_HOSTS = new Set(['huggingface.co', 'www.huggingface.co', 'cdn-lfs.huggingface.co', 'huggingface.s3.amazonaws.com', 'github.com', 'www.github.com', 'raw.githubusercontent.com'])

export async function openExternal(url: string): Promise<{ ok: boolean }> {
  // Same allowlist the Electron shell enforces — opened in a new tab.
  try {
    const u = new URL(url)
    const allowed =
      HF_HOSTS.has(u.hostname) || u.hostname.endsWith('.huggingface.co') || u.hostname.endsWith('.hf.co') || u.hostname.endsWith('github.com')
    if (u.protocol !== 'https:' || !allowed) throw new Error('URL not allowed')
    window.open(u.toString(), '_blank', 'noopener,noreferrer')
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function onDownloadEvents(callback: (event: DownloadEventView) => void): () => void {
  return subscribeSse('/api/library/events', callback)
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
  return apiFetch('/api/connections')
}

export async function addMcpServer(input: {
  name: string
  provider?: string
  transport: 'stdio' | 'http'
  command?: string
  endpoint?: string
}): Promise<McpServerView> {
  return apiFetch('/api/connections', { method: 'POST', body: input })
}

export async function installMcpFromUrl(url: string): Promise<{ server: McpServerView; steps: string[]; detectedCommand: string; localPath: string }> {
  return apiFetch('/api/connections/install', { method: 'POST', body: { url } })
}

export async function getMcpDir(): Promise<{ path: string; exists: boolean }> {
  return apiFetch('/api/connections/dir')
}

export async function openMcpFolder(): Promise<{ ok: boolean; path: string }> {
  return apiFetch('/api/connections/open-folder', { method: 'POST' })
}

export async function removeMcpServer(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/connections/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function toggleMcpServer(id: string, enabled: boolean): Promise<McpServerView> {
  return apiFetch(`/api/connections/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled } })
}

export async function probeMcpServer(id: string): Promise<McpServerView> {
  return apiFetch(`/api/connections/${encodeURIComponent(id)}/probe`, { method: 'POST' })
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
  return apiFetch('/api/voice/status')
}

export async function transcribeAudio(audioBase64: string, filename: string): Promise<VoiceTranscribeResult> {
  return apiFetch('/api/voice/transcribe', { method: 'POST', body: { audio: audioBase64, filename } })
}

// ── Validation per MODEL_HARDWARE_VALIDATION ──
import type { ValidationJob, HardwareProfileFull, ValidationStoreEntry } from '@shared/types/validation'
export type { ValidationJob, HardwareProfileFull, ValidationStoreEntry } from '@shared/types/validation'

export async function getFullHardwareProfile(): Promise<HardwareProfileFull> {
  return apiFetch('/api/hardware/profile')
}
export async function startValidation(modelId: string, libraryPath?: string, ctxLen?: number): Promise<ValidationJob> {
  return apiFetch('/api/validation', { method: 'POST', body: { modelId, libraryPath, ctxLen } })
}
export async function getValidation(jobId: string): Promise<ValidationJob> {
  return apiFetch(`/api/validation/${encodeURIComponent(jobId)}`)
}
export async function listValidations(): Promise<ValidationJob[]> {
  return apiFetch('/api/validation')
}
export async function listValidationCache(): Promise<ValidationStoreEntry[]> {
  return apiFetch('/api/validation/cache')
}

// ── Loaded instances (runtime monitoring & management) ──
import type { ModelInstance, InstanceMetrics } from '@shared/types/ports'
export type { ModelInstance, InstanceMetrics, InstanceStatus } from '@shared/types/ports'

export async function listInstances(): Promise<ModelInstance[]> {
  return apiFetch('/api/instances')
}

export async function unloadInstance(instanceId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/instances/${encodeURIComponent(instanceId)}/unload`, { method: 'POST' })
}

export async function getInstanceMetrics(instanceId: string): Promise<{ ok: boolean; vramUsedMB?: number; error?: string }> {
  return apiFetch(`/api/instances/${encodeURIComponent(instanceId)}/metrics`)
}

export interface InstanceEvent {
  type: 'status-changed' | 'metrics-updated' | 'removed'
  instanceId: string
  instance?: ModelInstance
  metrics?: InstanceMetrics
}

export function onInstanceEvents(callback: (event: InstanceEvent) => void): () => void {
  // Dormant in the current backend (no instance pushes emitted) — kept for
  // API parity so the UI subscribes exactly as before.
  return subscribeSse('/api/instances/events', callback)
}

export async function getRecentLogs(kind: 'all' | 'detection' | 'runtime' | 'app' | 'chat' = 'all'): Promise<Record<string, string[]>> {
  return apiFetch(`/api/logs?kind=${kind}`)
}
