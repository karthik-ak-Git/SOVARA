import os from 'node:os'
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
import { isExecMode, type ExecMode } from '../services/execPermissions'

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
  private readonly runtimeConfig: RuntimeConfigStore

  constructor(baseDir?: string, emit?: (event: import('@shared/types/chat').ChatStreamEvent) => void) {
    this.persistenceAdapter = new SqlitePersistenceAdapter(baseDir)
    const resources = new SystemResourceStub()
    this.runtimeConfig = new RuntimeConfigStore(baseDir)
    this.workbench = new ModelWorkbench(this.runtimeConfig, resources, baseDir)
    const llm = new LocalOpenAIChatAdapter()
    const webRuntime = createWebRuntime(() => this.getWebSearchConfig().enabled)
    this.chat = new ChatService({
      persistence: this.persistenceAdapter,
      llm,
      workbench: this.workbench,
      resources,
      baseDir,
      emit: emit ?? ((): void => {}),
      webSearch: (query: string) => this.runWebSearchForChat(query, webRuntime),
    })
    this.ports = {
      persistence: this.persistenceAdapter,
      llm,
      tools: new ToolStubAdapter(webRuntime),
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
