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
  content: string
): Promise<{ ok: boolean; userSeq: number; assistantSeq: number }> {
  // Long-lived invoke: resolves when generation completes and the single
  // durable assistant event is persisted. Deltas arrive via onSessionEvents.
  return (await sovara().invoke('chat:send', { sessionId, content })) as {
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

export async function scanSkills(): Promise<SkillsSource[]> {
  return (await sovara().invoke('skills:scan')) as SkillsSource[]
}

export async function toggleSkillsSource(
  sourceName: string,
  enabled: boolean
): Promise<{ ok: boolean }> {
  return (await sovara().invoke('skills:toggle', { sourceName, enabled })) as { ok: boolean }
}

// ── Explore (HuggingFace catalog) ──
export interface ExploreModelFile {
  format: string
  quantization?: string
  sizeGB: number
  downloadUrl: string
}

export interface ExploreModel {
  id: string
  name: string
  slug: string
  author: string
  description: string
  longDescription: string
  downloads: number
  likes: number
  staffPick: boolean
  updatedAt: string
  parameters: string
  architecture: string
  capabilities: string[]
  files: ExploreModelFile[]
  tags: string[]
  iconType: 'hf' | 'google' | 'meta' | 'mistral' | 'qwen' | 'microsoft' | 'deepseek'
}

export interface CompatibilityResult {
  fitsInMemory: boolean
  estimatedRamUsageGB: number
  estimatedVramUsageGB?: number
  message: string
  severity: 'good' | 'tight' | 'too-large'
}

export async function listExploreModels(sortBy?: string, query?: string): Promise<ExploreModel[]> {
  return (await sovara().invoke('explore:listModels', { sortBy, query })) as ExploreModel[]
}

export async function getExploreModel(modelId: string): Promise<ExploreModel> {
  return (await sovara().invoke('explore:getModel', { modelId })) as ExploreModel
}

export async function getModelCompatibility(modelId: string): Promise<CompatibilityResult> {
  return (await sovara().invoke('explore:getCompatibility', { modelId })) as CompatibilityResult
}

// ── Library (downloaded models) ──
export interface LibraryModel {
  id: string
  name: string
  slug: string
  sizeGB: number
  format: string
  quantization?: string
  capabilities: string[]
  lastUsed?: string
}

export async function listLibraryModels(): Promise<LibraryModel[]> {
  return (await sovara().invoke('library:listModels')) as LibraryModel[]
}

export async function getLibraryDirectory(): Promise<{ path: string }> {
  return (await sovara().invoke('library:getDirectory')) as { path: string }
}

export async function setLibraryDirectory(path: string): Promise<{ ok: boolean }> {
  return (await sovara().invoke('library:setDirectory', { path })) as { ok: boolean }
}
