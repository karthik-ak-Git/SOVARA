import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { PersistencePort, LlmPort, ToolPort, ModelRuntimePort, SystemResourceManagerPort, DshPort, HermesPort } from '@shared/types/ports'
import { SqlitePersistenceAdapter } from './ports/SqlitePersistenceAdapter'
import { LocalOpenAIChatAdapter } from './ports/LocalOpenAIChatAdapter'
import { ToolStubAdapter, createWebRuntime } from './ports/ToolStubAdapter'
import { DshStubAdapter } from './ports/DshStubAdapter'
import { HermesStubAdapter } from './ports/HermesStubAdapter'
import { ModelRuntimeStub } from './ports/ModelRuntimeStub'
import { SystemResourceStub } from './ports/SystemResourceStub'
import { RuntimeConfigStore } from '../config/RuntimeConfigStore'
import { ModelWorkbench } from './ModelWorkbench'
import { ChatService } from './ChatService'
import { ValidationRunner } from '../services/modelValidationRunner'
import { ValidationStore } from '../services/validationStore'
import { getFullHardwareProfile } from '../services/hardwareProfile'
import { isExecMode, type ExecMode } from '../services/execPermissions'
import { listMcpServers, addMcpServer, removeMcpServer, toggleMcpServer, probeMcpServer, getMcpDirPath, ensureMcpDir, installMcpFromUrl, type McpServer } from '../services/mcpStore'
import { loadEnabledSkillsContent } from '../services/skillsScanner'
import {
  resolveLibraryDir, setLibraryDir, scanLibrary, startDownload, startModelSetDownload,
  cancelDownload, pauseDownload, resumeDownload, getActiveDownloads, isDownloaded, deleteLibraryEntry,
  type DownloadEvent, type LibraryEntry,
} from '../services/modelDownloads'

export const DEFAULT_UPDATE_FEED_URL = 'https://api.github.com/repos/karthik-ak-Git/SOVARA/releases'

export interface AppBackendPorts {
  persistence: PersistencePort
  llm: LlmPort
  tools: ToolPort
  dsh: DshPort
  hermes: HermesPort
  models: ModelRuntimePort
  resources: SystemResourceManagerPort
}

/**
 * Composition root — owns all ports. Phase 1: every AI/runtime port is a stub.
 * Only persistence has a real (in-memory) impl; Commit 3 promotes it to SQLite+JSONL.
 */
export class AppBackend {
  public readonly ports: AppBackendPorts
  private readonly persistenceAdapter: SqlitePersistenceAdapter
  /** Commit 6 — registry/probe/select facet (lifecycle stays stubbed). */
  public readonly workbench: ModelWorkbench
  /** Commit 7 — real local inference orchestration behind LlmPort. */
  public readonly chat: ChatService
  /** Validation per MODEL_HARDWARE_VALIDATION spec — isolated-pool estimator + real load/infer */
  public readonly validation: ValidationRunner
  public readonly validationStore: ValidationStore
  private readonly runtimeConfig: RuntimeConfigStore

  constructor(baseDir?: string, emit?: (event: import('@shared/types/chat').ChatStreamEvent) => void) {
    this.persistenceAdapter = new SqlitePersistenceAdapter(baseDir)
    const resources = new SystemResourceStub()
    this.runtimeConfig = new RuntimeConfigStore(baseDir)
    this.workbench = new ModelWorkbench(this.runtimeConfig, resources, baseDir)
    this.validation = new ValidationRunner()
    this.validationStore = new ValidationStore(baseDir)
    const llm = new LocalOpenAIChatAdapter()
    const webRuntime = createWebRuntime(() => this.getWebSearchConfig().enabled)
    // Ensure global workspace + MCP folder exist (ponytail: one folder, no config UI needed)
    this.ensureGlobalWorkspace()
    try { this.ensureMcpDir() } catch {}
    this.chat = new ChatService({
      persistence: this.persistenceAdapter,
      llm,
      workbench: this.workbench,
      resources,
      baseDir,
      emit: emit ?? ((): void => {}),
      webSearch: (query: string) => this.runWebSearchForChat(query, webRuntime),
      getGlobalWorkspace: () => this.getGlobalWorkspace(),
      getProjectWorkspace: (projectId: string | null) => {
        if (!projectId) return null
        try {
          const p = (this.persistenceAdapter as unknown as { getProjectSync: (id: string) => { rootPath: string } | null }).getProjectSync(projectId)
          return p?.rootPath ?? null
        } catch {
          return null
        }
      },
      getMcpContext: () => {
        try {
          const servers = listMcpServers(this.runtimeConfig).filter((s) => s.enabled && s.status === 'connected')
          if (servers.length === 0) return null
          const tools = servers.map((s) => {
            const tool = `mcp_${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32)}`
            return `${tool} → ${s.name} (${s.provider}, ${s.transport})`
          }).join(', ')
          return `MCP tools available (call via tools/call): ${tools}. Global workspace: ${this.getGlobalWorkspace()}.`
        } catch {
          return null
        }
      },
      getSkillsContext: async () => {
        try {
          return await loadEnabledSkillsContent(this.runtimeConfig)
        } catch {
          return null
        }
      },
    })
    this.ports = {
      persistence: this.persistenceAdapter,
      llm,
      tools: new ToolStubAdapter(webRuntime, () => listMcpServers(this.runtimeConfig)),
      dsh: new DshStubAdapter(),
      hermes: new HermesStubAdapter(),
      models: new ModelRuntimeStub(),
      resources
    }
  }

  getInfo(): { name: string; version: string; electron: string; node: string; platform: NodeJS.Platform; arch: string } {
    return {
      name: 'Sovara',
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch
    }
  }
  getSystem(): { cpus: number; totalMemMB: number; freeMemMB: number; homedir: string; userData: string } {
    return {
      cpus: os.cpus().length,
      totalMemMB: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemMB: Math.round(os.freemem() / (1024 * 1024)),
      homedir: os.homedir(),
      userData: app.getPath('userData')
    }
  }

  // ── Model library (global download directory + HF downloads) ──
  getLibraryDir(): string {
    return resolveLibraryDir(this.runtimeConfig, app.getPath('userData'))
  }

  setLibraryDir(dir: string): string {
    return setLibraryDir(this.runtimeConfig, dir)
  }

  scanLibrary(): LibraryEntry[] {
    return scanLibrary(this.getLibraryDir())
  }

  startModelDownload(
    modelId: string,
    rfilename: string,
    downloadUrl: string,
    emit: (event: DownloadEvent) => void,
    extra?: { parts?: Array<{ rfilename: string; downloadUrl: string; sizeBytes?: number }>; companion?: { rfilename: string; downloadUrl: string; sizeBytes?: number } }
  ): Promise<{ ok: true; resumed: boolean }> {
    // Shard sets download sequentially as one job with aggregate progress;
    // everything else takes the classic single-file path.
    if (extra?.parts && extra.parts.length >= 2) {
      return startModelSetDownload(this.runtimeConfig, app.getPath('userData'), modelId, extra.parts, extra.companion, emit)
    }
    const first = startDownload(this.runtimeConfig, app.getPath('userData'), modelId, rfilename, downloadUrl, emit)
    if (extra?.companion) {
      // Vision projector sidecar: quiet companion job with its own event row.
      void startDownload(this.runtimeConfig, app.getPath('userData'), modelId, extra.companion.rfilename, extra.companion.downloadUrl, emit).catch(() => {})
    }
    return first
  }

  cancelModelDownload(modelId: string, rfilename: string): boolean {
    return cancelDownload(modelId, rfilename)
  }

  pauseModelDownload(modelId: string, rfilename: string): boolean {
    return pauseDownload(modelId, rfilename)
  }

  resumeModelDownload(
    modelId: string,
    rfilename: string,
    downloadUrl: string,
    emit: (event: DownloadEvent) => void
  ): boolean {
    return resumeDownload(this.runtimeConfig, app.getPath('userData'), modelId, rfilename, downloadUrl, emit)
  }

  getActiveDownloads(): Array<{ modelId: string; rfilename: string; state: string }> {
    return getActiveDownloads()
  }

  isDownloaded(modelId: string, rfilename: string): boolean {
    return isDownloaded(this.getLibraryDir(), modelId, rfilename)
  }

  deleteLibraryEntry(entryPath: string): void {
    return deleteLibraryEntry(this.getLibraryDir(), entryPath)
  }

  // ── Validation per MODEL_HARDWARE_VALIDATION (DETECT→PROFILE→ESTIMATE→PRE→LOAD→INFER→MEASURE→VALIDATE) ──
  getFullHardwareProfile(): import('@shared/types/validation').HardwareProfileFull {
    return getFullHardwareProfile()
  }

  async startValidation(modelId: string, libraryPath?: string, ctxLen?: number): Promise<import('@shared/types/validation').ValidationJob> {
    // Resolve libraryPath if not provided: try to find file in library by modelId
    let resolvedPath = libraryPath
    let exploreModel: import('@shared/types/explore').ExploreModel | undefined
    if (!resolvedPath) {
      // Try to locate downloaded file first
      const lib = this.scanLibrary()
      const hit = lib.find((e) => e.name === modelId.replace(/\//g, '__') || e.path.includes(modelId.split('/').pop() ?? ''))
      if (hit) resolvedPath = hit.path
    }
    // For cache check we could short-circuit, but spec says background job, so always run
    const job = await this.validation.start(modelId, resolvedPath, exploreModel, { ctxLen })
    // Persist result on completion (fire-and-forget watcher)
    const poll = setInterval(() => {
      const j = this.validation.getJob(job.jobId)
      if (!j) { clearInterval(poll); return }
      if (j.status === 'VERIFIED' || j.status === 'VERIFIED_WITH_LIMITATIONS' || j.status === 'LOAD_FAILED' || j.status === 'INFERENCE_FAILED' || j.status === 'ESTIMATED_INCOMPATIBLE') {
        clearInterval(poll)
        if (j.result && j.hardware && j.modelProfile) {
          try { this.validationStore.put(j.result, j.hardware, j.modelProfile) } catch {}
        }
      }
    }, 400)
    // safety clear after 2min
    setTimeout(() => clearInterval(poll), 130_000)
    return job
  }

  getValidation(jobId: string): import('@shared/types/validation').ValidationJob | null {
    return this.validation.getJob(jobId) ?? null
  }

  listValidations(): import('@shared/types/validation').ValidationJob[] {
    return this.validation.listJobs()
  }

  listValidationCache(): import('@shared/types/validation').ValidationStoreEntry[] {
    return this.validationStore.list()
  }

  /** AI command permission level (persisted, default 'ask'). */
  getExecMode(): ExecMode {
    const raw = this.runtimeConfig.getExecMode()
    return isExecMode(raw) ? raw : 'ask'
  }

  setExecMode(mode: ExecMode): ExecMode {
    if (!isExecMode(mode)) throw new Error(`invalid exec mode: ${String(mode)}`)
    this.runtimeConfig.setExecMode(mode)
    return mode
  }

  /** Real packaged version (electron-builder stamps package.json version). */
  getAppVersion(): string {
    return app.getVersion()
  }

  // ── General settings (Settings → General), all persisted in app_meta ──
  getAppSettings(): {
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
  } {
    const get = (k: string): string | null => this.runtimeConfig.getAppSetting(k)
    const lastCheck = get('last_update_check_at')
    return {
      theme: get('theme') ?? 'dark',
      sidebarBackground: get('sidebar_background') ?? 'solid',
      inlineDiffLayout: get('inline_diff_layout') ?? 'unified',
      renameAfterFork: (get('rename_after_fork') ?? '1') === '1',
      globalWorkspaceRoot: get('global_workspace_root') ?? this.ensureGlobalWorkspace(),
      allowModelDownload: get('allow_model_download') === '1',
      autoUpdates: (get('auto_updates') ?? '1') === '1',
      sessionNotifications: (get('session_notifications') ?? '1') === '1',
      updateFeedUrl: get('update_feed_url') ?? DEFAULT_UPDATE_FEED_URL,
      updateChannel: get('update_channel') ?? 'stable',
      lastUpdateCheckAt: lastCheck !== null && /^\d+$/.test(lastCheck) ? parseInt(lastCheck, 10) : null,
      lastUpdateStatus: get('last_update_status'),
      rootModel: get('root_model') ?? 'no-default',
      visionModel: get('vision_model') ?? 'off',
      webSearch: get('web_search') === '1',
      explorationAgents: (get('exploration_agents') ?? '1') === '1',
      customAutoReview: get('custom_auto_review') === '1',
      customInstructions: get('custom_instructions') ?? '',
    }
  }

  setAppSettings(patch: {
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
  }): ReturnType<AppBackend['getAppSettings']> {
    const set = (k: string, v: string): void => this.runtimeConfig.setAppSetting(k, v)
    if (patch.theme !== undefined) {
      if (!['dark', 'light', 'system'].includes(patch.theme)) throw new Error('invalid theme')
      set('theme', patch.theme)
    }
    if (patch.sidebarBackground !== undefined) {
      if (!['solid', 'translucent'].includes(patch.sidebarBackground)) throw new Error('invalid sidebarBackground')
      set('sidebar_background', patch.sidebarBackground)
    }
    if (patch.inlineDiffLayout !== undefined) {
      if (!['unified', 'split'].includes(patch.inlineDiffLayout)) throw new Error('invalid inlineDiffLayout')
      set('inline_diff_layout', patch.inlineDiffLayout)
    }
    if (patch.renameAfterFork !== undefined) set('rename_after_fork', patch.renameAfterFork ? '1' : '0')
    if (patch.globalWorkspaceRoot !== undefined) {
      const clean = patch.globalWorkspaceRoot.trim().slice(0, 1024)
      if (clean !== '') {
        if (!path.isAbsolute(clean)) throw new Error('global workspace must be absolute path')
        fs.mkdirSync(clean, { recursive: true })
      }
      set('global_workspace_root', clean)
    }
    if (patch.allowModelDownload !== undefined) set('allow_model_download', patch.allowModelDownload ? '1' : '0')
    if (patch.autoUpdates !== undefined) set('auto_updates', patch.autoUpdates ? '1' : '0')
    if (patch.sessionNotifications !== undefined) set('session_notifications', patch.sessionNotifications ? '1' : '0')
    if (patch.updateChannel !== undefined) {
      if (!['stable', 'beta'].includes(patch.updateChannel)) throw new Error('invalid update channel')
      set('update_channel', patch.updateChannel)
    }
    if (patch.updateFeedUrl !== undefined) {
      const feed = patch.updateFeedUrl.trim().slice(0, 2048)
      if (feed !== '') {
        let url: URL
        try {
          url = new URL(feed)
        } catch {
          throw new Error('update feed URL is not valid')
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('update feed must be an http(s) URL')
      }
      set('update_feed_url', feed)
    }
    if (patch.rootModel !== undefined) set('root_model', patch.rootModel.trim().slice(0, 256))
    if (patch.visionModel !== undefined) set('vision_model', patch.visionModel.trim().slice(0, 256))
    if (patch.webSearch !== undefined) set('web_search', patch.webSearch ? '1' : '0')
    if (patch.explorationAgents !== undefined) set('exploration_agents', patch.explorationAgents ? '1' : '0')
    if (patch.customAutoReview !== undefined) set('custom_auto_review', patch.customAutoReview ? '1' : '0')
    if (patch.customInstructions !== undefined) set('custom_instructions', patch.customInstructions.slice(0, 4000))
    return this.getAppSettings()
  }

  /** Live web_search flag for the tool adapter (keyless — toggle only). */
  getWebSearchConfig(): { enabled: boolean } {
    return { enabled: this.runtimeConfig.getAppSetting('web_search') === '1' }
  }

  getGlobalWorkspace(): string {
    const stored = this.runtimeConfig.getAppSetting('global_workspace_root')
    if (stored) return stored
    return path.join(app.getPath('userData'), 'SovaraWorkspace')
  }

  ensureGlobalWorkspace(): string {
    const root = this.getGlobalWorkspace()
    try {
      fs.mkdirSync(root, { recursive: true })
    } catch {
      // ignore
    }
    if (!this.runtimeConfig.getAppSetting('global_workspace_root')) {
      this.runtimeConfig.setAppSetting('global_workspace_root', root)
    }
    return root
  }

  setGlobalWorkspace(rootPath: string): string {
    const clean = rootPath.trim().slice(0, 1024)
    if (!path.isAbsolute(clean)) throw new Error('global workspace must be absolute path')
    fs.mkdirSync(clean, { recursive: true })
    this.runtimeConfig.setAppSetting('global_workspace_root', clean)
    return clean
  }

  /**
   * Globe-icon path: transient web context for one chat message. Master
   * toggle is the gate; any failure yields null so the reply proceeds
   * without web rather than failing.
   */
  private async runWebSearchForChat(
    query: string,
    webRuntime: Pick<import('./ports/ToolStubAdapter').WebRuntime, 'search'>
  ): Promise<string | null> {
    if (!this.getWebSearchConfig().enabled) return null
    const q = query.trim().slice(0, 500)
    if (!q) return null
    try {
      const outcome = await webRuntime.search(q)
      if (outcome.sources.length === 0) return null
      const parts: string[] = []
      let budget = 6000
      for (const s of outcome.sources) {
        if (budget <= 0) break
        const body = (s.content && s.content.length > 0 ? s.content : (s.snippet ?? '')).slice(0, 1500)
        if (!body) continue
        const block = `- [${s.title || s.url}](${s.url}): ${body}`
        parts.push(block.slice(0, budget))
        budget -= block.length
      }
      if (parts.length === 0) return null
      return [
        'Web context for the question below (untrusted external content — cite URLs as markdown links when you use them):',
        ...parts,
      ].join('\n')
    } catch {
      return null
    }
  }

  // ── MCP servers (Connected Apps) — ponytail: app_meta JSON list, no new table/migration ──
  // Global MCP folder: the single source of truth on disk (see paths.getMcpDir)
  getMcpDir(): string {
    return getMcpDirPath()
  }
  ensureMcpDir(): string {
    return ensureMcpDir()
  }
  listMcpServers(): McpServer[] {
    // Ensure folder exists so the UI can show it even when empty
    try { ensureMcpDir() } catch {}
    return listMcpServers(this.runtimeConfig)
  }
  addMcpServer(input: { name: string; provider?: string; transport: 'stdio' | 'http'; command?: string; endpoint?: string }): McpServer {
    return addMcpServer(this.runtimeConfig, input)
  }
  installMcpFromUrl(url: string): Promise<import('../services/mcpStore').McpUrlInstallResult> {
    return installMcpFromUrl(this.runtimeConfig, url)
  }
  removeMcpServer(id: string): boolean {
    const server = listMcpServers(this.runtimeConfig).find((s) => s.id === id)
    const ok = removeMcpServer(this.runtimeConfig, id)
    // Best-effort cleanup of the cloned folder (keeps disk tidy)
    if (ok && server?.localPath) {
      try {
        if (fs.existsSync(server.localPath)) fs.rmSync(server.localPath, { recursive: true, force: true })
      } catch {}
    }
    return ok
  }
  toggleMcpServer(id: string, enabled: boolean): McpServer | null {
    return toggleMcpServer(this.runtimeConfig, id, enabled)
  }
  probeMcpServer(id: string): Promise<McpServer | null> {
    return probeMcpServer(this.runtimeConfig, id)
  }

  recordUpdateCheck(status: string): void {
    this.runtimeConfig.setAppSetting('last_update_check_at', String(Date.now()))
    this.runtimeConfig.setAppSetting('last_update_status', status.slice(0, 64))
  }

  async dispose(): Promise<void> {
    try {
      await this.persistenceAdapter.close()
    } catch {
      // ignore
    }
    try {
      this.runtimeConfig.close()
    } catch {
      // ignore
    }
  }
}
