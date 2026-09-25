import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * AppBackend is the composition root: it wires the tool adapter, the agent
 * orchestrator and the subagent runner together. A mistake in that wiring only
 * shows up as a failed app boot, so the constructor itself is under test here.
 */

const tmpDirs: string[] = []
function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-backend-'))
  tmpDirs.push(dir)
  return dir
}

const appPath = vi.hoisted(() => ({ value: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return appPath.value
      return appPath.value
    },
    getVersion: () => '1.1.4',
    getAppPath: () => appPath.value,
    isPackaged: false,
    on: () => undefined,
    whenReady: async () => undefined,
    quit: () => undefined,
  },
  ipcMain: { handle: () => undefined, on: () => undefined },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openExternal: async () => undefined },
  nativeTheme: { shouldUseDarkColors: false },
  contextBridge: { exposeInMainWorld: () => undefined },
}))

vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      allowPrerelease: false,
      channel: null,
      setFeedURL: () => undefined,
      checkForUpdates: async () => null,
      downloadUpdate: async () => [],
      quitAndInstall: () => undefined,
      on: () => undefined,
    },
  },
}))

describe('AppBackend composition (subagent wiring)', () => {
  beforeEach(() => {
    appPath.value = mkTmp()
  })

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  it('constructs successfully and exposes a wired subagent runner', async () => {
    const { AppBackend } = await import('../src/main/backend/AppBackend')
    const backend = new AppBackend(appPath.value, () => {})

    // The runner must exist and be attached to the tool catalog, otherwise the
    // model can never delegate and the failure is silent.
    expect(backend.subagents).toBeDefined()
    expect(typeof backend.subagents.dispatch).toBe('function')
    expect(typeof backend.orchestrator.isGenerating).toBe('function')

    // invoke_subagent must be advertised to the model, with a usable schema.
    const def = backend.ports.tools.list().find((t) => t.name === 'invoke_subagent')
    expect(def).toBeDefined()
    expect(def?.parameters.required).toContain('description')

    await backend.dispose()
  })

  it('reports subagent-unavailable instead of crashing when no runner is configured', async () => {
    const { ToolStubAdapter } = await import('../src/main/backend/ports/ToolStubAdapter')
    // Default constructor: no subagent port injected (the unit-test seam).
    const tools = new ToolStubAdapter()
    const out = JSON.parse(await tools.dispatch('invoke_subagent', { description: 'do a thing' }))
    expect(out.ok).toBe(false)
    expect(out.code).toBe('SUBAGENT_UNAVAILABLE')
  })

  it('rejects an empty subagent description before dispatching', async () => {
    const { ToolStubAdapter } = await import('../src/main/backend/ports/ToolStubAdapter')
    const dispatch = vi.fn()
    const tools = new ToolStubAdapter(undefined, undefined, () => appPath.value, undefined, false, {
      dispatch,
    } as never)
    const out = JSON.parse(await tools.dispatch('invoke_subagent', { description: '   ' }))
    expect(out.code).toBe('INVALID_ARGUMENTS')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('returns the real subagent answer through the tool adapter', async () => {
    const { ToolStubAdapter } = await import('../src/main/backend/ports/ToolStubAdapter')
    const done = Promise.resolve({ status: 'succeeded', result: 'config lives in src/config.ts', durationMs: 12 })
    const dispatch = vi.fn((_input: Record<string, unknown>) => ({ jobId: 'sub_test', done }))
    const tools = new ToolStubAdapter(undefined, undefined, () => appPath.value, undefined, false, {
      dispatch,
    } as never)
    ;(tools as unknown as { _setSession: (id: string) => void })._setSession('sess-9')

    const out = JSON.parse(await tools.dispatch('invoke_subagent', {
      role: 'explore',
      description: 'find the config',
    }))

    // The answer must be the child's real output, not a status-only stub.
    expect(out.ok).toBe(true)
    expect(out.answer).toBe('config lives in src/config.ts')
    expect(out.jobId).toBe('sub_test')
    // The job must be attributed to the owning session.
    expect(dispatch.mock.calls[0][0]).toMatchObject({
      parentSessionId: 'sess-9',
      role: 'explore',
      description: 'find the config',
    })
  })

  it('surfaces a failed subagent as an explicit failure, never a fake success', async () => {
    const { ToolStubAdapter } = await import('../src/main/backend/ports/ToolStubAdapter')
    const done = Promise.resolve({ status: 'failed', error: 'model resident and busy', durationMs: 9 })
    const tools = new ToolStubAdapter(undefined, undefined, () => appPath.value, undefined, false, {
      dispatch: vi.fn(() => ({ jobId: 'sub_x', done })),
    } as never)
    ;(tools as unknown as { _setSession: (id: string) => void })._setSession('sess-1')

    const out = JSON.parse(await tools.dispatch('invoke_subagent', { description: 'x' }))
    expect(out.ok).toBe(false)
    expect(out.code).toBe('SUBAGENT_FAILED')
    expect(out.answer).toBeUndefined()
    expect(out.error).toMatch(/busy/)
  })

  it('never registers invoke_subagent in the timed tool-infrastructure registry', async () => {
    // That registry enforces a 30s default timeout, which would silently kill
    // long subagent runs. The tool must stay on the direct dispatch seam.
    const { ToolStubAdapter } = await import('../src/main/backend/ports/ToolStubAdapter')
    const tools = new ToolStubAdapter()
    const def = tools.list().find((t) => t.name === 'invoke_subagent')
    expect(def).toBeDefined()
    // A fresh infrastructure instance must not have claimed the tool.
    const { getToolInfrastructure } = await import('../src/main/backend/tools')
    const infra = getToolInfrastructure()
    await infra.initialize()
    expect(infra.getRegistry().has('invoke_subagent')).toBe(false)
  })
})
