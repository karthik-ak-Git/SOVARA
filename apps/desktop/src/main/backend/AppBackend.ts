import os from 'node:os'
import { app } from 'electron'
import type { PersistencePort, LlmPort, ToolPort, ModelRuntimePort, SystemResourceManagerPort, DshPort, HermesPort } from '@shared/types/ports'
import { SqlitePersistenceAdapter } from './ports/SqlitePersistenceAdapter'
import { LlmStubAdapter } from './ports/LlmStubAdapter'
import { ToolStubAdapter } from './ports/ToolStubAdapter'
import { DshStubAdapter } from './ports/DshStubAdapter'
import { HermesStubAdapter } from './ports/HermesStubAdapter'
import { ModelRuntimeStub } from './ports/ModelRuntimeStub'
import { SystemResourceStub } from './ports/SystemResourceStub'

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

  constructor(baseDir?: string) {
    this.persistenceAdapter = new SqlitePersistenceAdapter(baseDir)
    this.ports = {
      persistence: this.persistenceAdapter,
      llm: new LlmStubAdapter(),
      tools: new ToolStubAdapter(),
      dsh: new DshStubAdapter(),
      hermes: new HermesStubAdapter(),
      models: new ModelRuntimeStub(),
      resources: new SystemResourceStub()
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
  }
}
