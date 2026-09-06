import os from 'node:os'
import { app } from 'electron'
import type { PersistencePort, LlmPort, ToolPort, ModelRuntimePort, SystemResourceManagerPort, DshPort, HermesPort } from '@shared/types/ports'
import { SqlitePersistenceAdapter } from './ports/SqlitePersistenceAdapter'
import { LocalOpenAIChatAdapter } from './ports/LocalOpenAIChatAdapter'
import { ToolStubAdapter } from './ports/ToolStubAdapter'
import { DshStubAdapter } from './ports/DshStubAdapter'
import { HermesStubAdapter } from './ports/HermesStubAdapter'
import { ModelRuntimeStub } from './ports/ModelRuntimeStub'
import { SystemResourceStub } from './ports/SystemResourceStub'
import { RuntimeConfigStore } from '../config/RuntimeConfigStore'
import { ModelWorkbench } from './ModelWorkbench'
import { ChatService } from './ChatService'

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
    this.chat = new ChatService({
      persistence: this.persistenceAdapter,
      llm,
      workbench: this.workbench,
      resources,
      baseDir,
      emit: emit ?? ((): void => {}),
    })
    this.ports = {
      persistence: this.persistenceAdapter,
      llm,
      tools: new ToolStubAdapter(),
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
