import { ipcMain, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { getBackend } from '../backendComposition'
import type { SessionId } from '@shared/types/branded'
import { brand } from '@shared/types/branded'
import type { ChatStreamEvent } from '@shared/types/chat'
import { zChatCancel, zChatSend, zModelsAddRuntime, zModelsListModels, zModelsLoad, zModelsProbe, zModelsRuntimeRef, zModelsSelect, zProjectCreate, zProjectId, zProjectRename, zSessionArchive, zSessionId, zSessionRename, zSessionsCreate, zExecMode, zSettingsSet, zToolDispatch, zMcpAdd, zMcpId, zMcpToggle } from '@shared/ipc/schemas'
import { gateDispatch } from '../services/execPermissions'
import { checkForUpdates } from '../services/updateFeed'
import { getPythonStatus, ensurePythonEnv } from '../services/pythonEnv'
import { scanSkillsSources, listBionicSkills, createBionicSkill, deleteBionicSkill, setSkillsSourceEnabled } from '../services/skillsScanner'
import { transcribeAudio, isVoiceReady, startVoiceServer } from '../services/voiceServer'
import { zSkillsToggle, zBionicSkillAdd, zBionicSkillId, zExploreListModels, zExploreGetModel, zExploreGetCompatibility, zLibrarySetDirectory, zLibraryDownload, zLibraryCancel, zLibraryDelete } from '@shared/ipc/schemas'
import { fetchModelsFromHf, fetchModelFromHf, sortModels, filterModels } from '../services/hfCatalog'
import { estimateCompatibility } from '../services/hardwareCheck'
import type { HardwareInfo } from '@shared/types/explore'

/** Push channel for transient chat stream events (deltas are never persisted). */
function broadcastChat(event: ChatStreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send('events:session', event)
      } catch {
        // ignore dead renderers
      }
    }
  }
}

/** Push channel for model download progress (throttled at the source). */
function broadcastDownload(event: import('../services/modelDownloads').DownloadEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      try {
        win.webContents.send('events:download', event)
      } catch {
        // ignore dead renderers
      }
    }
  }
}

export function registerIpcHandlers(): void {
  getBackend().chat.setEmit(broadcastChat)
  ipcMain.handle('app:getInfo', async () => {
    return getBackend().getInfo()
  })

  ipcMain.handle('app:getSystem', async () => {
    return getBackend().getSystem()
  })

  ipcMain.handle('system:getResources', async () => {
    return getBackend().ports.resources.getSnapshot()
  })

  ipcMain.handle('sessions:list', async () => {
    return getBackend().ports.persistence.list()
  })

  ipcMain.handle('sessions:create', async (_e, raw: unknown) => {
    const parsed = zSessionsCreate.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid sessions:create payload: ${parsed.error.message}`)
    return getBackend().ports.persistence.create(parsed.data.title, parsed.data.projectId ?? null)
  })

  ipcMain.handle('sessions:rename', async (_e, raw: unknown) => {
    const parsed = zSessionRename.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid sessions:rename payload: ${parsed.error.message}`)
    return getBackend().ports.persistence.rename(brand<'SessionId'>(parsed.data.sessionId), parsed.data.title)
  })

  ipcMain.handle('sessions:delete', async (_e, raw: unknown) => {
    const parsed = zSessionId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid session id: ${parsed.error.message}`)
    await getBackend().ports.persistence.deletePermanently(brand<'SessionId'>(parsed.data))
    return { ok: true }
  })

  ipcMain.handle('projects:list', async () => {
    return getBackend().ports.persistence.listProjects()
  })

  ipcMain.handle('projects:create', async (_e, raw: unknown) => {
    const parsed = zProjectCreate.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid projects:create payload: ${parsed.error.message}`)
    return getBackend().ports.persistence.createProject(parsed.data.name, parsed.data.rootPath)
  })

  ipcMain.handle('projects:rename', async (_e, raw: unknown) => {
    const parsed = zProjectRename.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid projects:rename payload: ${parsed.error.message}`)
    return getBackend().ports.persistence.renameProject(parsed.data.projectId, parsed.data.name)
  })

  ipcMain.handle('projects:delete', async (_e, raw: unknown) => {
    const parsed = zProjectId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid projects:delete payload: ${parsed.error.message}`)
    await getBackend().ports.persistence.deleteProject(parsed.data.projectId)
    return { ok: true }
  })

  ipcMain.handle('sessions:get', async (_e, raw: unknown) => {
    const parsed = zSessionId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid session id: ${parsed.error.message}`)
    return getBackend().ports.persistence.get(brand<'SessionId'>(parsed.data))
  })

  ipcMain.handle('sessions:getEvents', async (_e, raw: unknown) => {
    const parsed = zSessionId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid session id: ${parsed.error.message}`)
    return getBackend().ports.persistence.getEvents(brand<'SessionId'>(parsed.data))
  })

  ipcMain.handle('sessions:archive', async (_e, raw: unknown) => {
    const parsed = zSessionArchive.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid archive payload: ${parsed.error.message}`)
    await getBackend().ports.persistence.archive(brand<'SessionId'>(parsed.data.sessionId))
    return { ok: true }
  })

  ipcMain.handle('sessions:unarchive', async (_e, raw: unknown) => {
    const parsed = zSessionArchive.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid unarchive payload: ${parsed.error.message}`)
    await getBackend().ports.persistence.unarchive(brand<'SessionId'>(parsed.data.sessionId))
    return { ok: true }
  })

  ipcMain.handle('sessions:listArchived', async () => {
    return getBackend().ports.persistence.listArchived()
  })

  ipcMain.handle('chat:send', async (_e, raw: unknown) => {
    const parsed = zChatSend.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid chat payload: ${parsed.error.message}`)
    const sid = brand<'SessionId'>(parsed.data.sessionId)
    try {
      // Real local inference via ChatService → LlmPort → loopback runtime.
      // Deltas stream back on `events:session`; the invoke resolves on
      // completion with the durable seqs. Globe flag adds web context.
      return await getBackend().chat.send(sid, parsed.data.content, { webSearch: parsed.data.webSearch })
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'chat failed')
    }
  })

  ipcMain.handle('chat:cancel', async (_e, raw: unknown) => {
    // No session ref = legacy probe call; treat as a no-op success.
    if (raw === undefined) return { ok: true, cancelled: false }
    const parsed = zChatCancel.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid cancel payload: ${parsed.error.message}`)
    return getBackend().chat.cancel(brand<'SessionId'>(parsed.data.sessionId))
  })

  ipcMain.handle('models:listLocal', async () => getBackend().ports.models.listLocalModels())

  ipcMain.handle('models:probeRuntime', async (_e, raw: unknown) => {
    const parsed = zModelsProbe.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid runtimeId: ${parsed.error.message}`)
    return getBackend().ports.models.probeRuntime(parsed.data)
  })

  ipcMain.handle('models:load', async (_e, raw: unknown) => {
    const parsed = zModelsLoad.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid load payload: ${parsed.error.message}`)
    // @ts-expect-error — branded string compat in stub
    return getBackend().ports.models.load(parsed.data.modelId, {})
  })

  // ── Commit 6 workbench facet — explicit channels, strict schemas ──
  ipcMain.handle('models:listRuntimes', async () => {
    return getBackend().workbench.listRuntimes()
  })

  ipcMain.handle('models:addRuntime', async (_e, raw: unknown) => {
    const parsed = zModelsAddRuntime.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid runtime payload: ${parsed.error.message}`)
    return getBackend().workbench.addRuntime(parsed.data)
  })

  ipcMain.handle('models:removeRuntime', async (_e, raw: unknown) => {
    const parsed = zModelsRuntimeRef.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid runtime ref: ${parsed.error.message}`)
    const removed = getBackend().workbench.removeRuntime(parsed.data.runtimeId)
    if (!removed) throw new Error('unknown runtime')
    return { ok: true }
  })

  ipcMain.handle('models:testConnection', async (_e, raw: unknown) => {
    const parsed = zModelsRuntimeRef.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid runtime ref: ${parsed.error.message}`)
    try {
      return await getBackend().workbench.probeRuntime(parsed.data.runtimeId)
    } catch (e) {
      // Unknown runtime only — probe failures arrive inside the result.
      throw new Error(e instanceof Error ? e.message : 'probe failed')
    }
  })

  ipcMain.handle('models:listModels', async (_e, raw: unknown) => {
    const parsed = zModelsListModels.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid list payload: ${parsed.error.message}`)
    try {
      return await getBackend().workbench.listModels(parsed.data.runtimeId)
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'list failed')
    }
  })

  ipcMain.handle('models:selectModel', async (_e, raw: unknown) => {
    const parsed = zModelsSelect.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid selection: ${parsed.error.message}`)
    try {
      return await getBackend().workbench.selectModel(parsed.data.runtimeId, parsed.data.modelId)
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'selection failed')
    }
  })

  ipcMain.handle('models:getActiveModel', async () => {
    return getBackend().workbench.getActiveModel()
  })

  ipcMain.handle('settings:get', async () => {
    return { ...getBackend().getAppSettings(), version: getBackend().getAppVersion() }
  })

  ipcMain.handle('settings:set', async (_e, raw: unknown) => {
    const parsed = zSettingsSet.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid settings payload: ${parsed.error.message}`)
    return { ...getBackend().setAppSettings(parsed.data), version: getBackend().getAppVersion() }
  })

  ipcMain.handle('app:getVersion', async () => {
    return { version: getBackend().getAppVersion() }
  })

  ipcMain.handle('updates:checkNow', async () => {
    const backend = getBackend()
    const settings = backend.getAppSettings()
    const result = await checkForUpdates(settings.updateFeedUrl, backend.getAppVersion())
    backend.recordUpdateCheck(result.status)
    return result
  })

  // ── First-run setup — Python env for the sidecars (what the .exe provisions) ──
  ipcMain.handle('setup:getPythonStatus', async () => {
    return getPythonStatus()
  })

  ipcMain.handle('setup:ensurePython', async () => {
    return ensurePythonEnv()
  })

  // ── Exec permissions — the AI command levels, enforced on every dispatch ──
  ipcMain.handle('exec:getMode', async () => {
    return { mode: getBackend().getExecMode() }
  })

  ipcMain.handle('exec:setMode', async (_e, raw: unknown) => {
    const parsed = zExecMode.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid exec mode: ${parsed.error.message}`)
    return { mode: getBackend().setExecMode(parsed.data) }
  })

  ipcMain.handle('tools:list', async () => {
    return getBackend().ports.tools.list()
  })

  ipcMain.handle('tools:dispatch', async (_e, raw: unknown) => {
    const parsed = zToolDispatch.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid tools:dispatch payload: ${parsed.error.message}`)
    const mode = getBackend().getExecMode()
    const verdict = gateDispatch(mode, parsed.data.name)
    if (!verdict.allowed) {
      return { ok: false, blocked: true, reason: verdict.reason, message: verdict.message }
    }
    const result = await getBackend().ports.tools.dispatch(
      parsed.data.name,
      parsed.data.args as Record<string, unknown>
    )
    return { ok: true, autoApproved: verdict.autoApproved, result }
  })

  // ── Usage stats ──
  ipcMain.handle('usage:getTotal', async () => {
    return getBackend().ports.persistence.getTotalUsage()
  })

  ipcMain.handle('usage:getByModel', async () => {
    return getBackend().ports.persistence.getUsageByModel()
  })

  // ── Window controls (frameless window) ──
  ipcMain.handle('window:minimize', async (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize()
    return { ok: true }
  })

  ipcMain.handle('window:maximize', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win) {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    }
    return { ok: true }
  })

  ipcMain.handle('window:close', async (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close()
    return { ok: true }
  })

  // ── Folder picker dialog ──
  ipcMain.handle('dialog:pickFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'], title: 'Select project folder' }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return { canceled: true, filePath: null }
    return { canceled: false, filePath: result.filePaths[0] }
  })

  // ── Skills scanning ──
  ipcMain.handle('skills:scan', async () => {
    return scanSkillsSources((getBackend() as unknown as { runtimeConfig: { getAppSetting: (k: string) => string | null } }).runtimeConfig)
  })

  ipcMain.handle('skills:toggle', async (_e, raw: unknown) => {
    const parsed = zSkillsToggle.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid skills:toggle payload: ${parsed.error.message}`)
    const store = (getBackend() as unknown as { runtimeConfig: { getAppSetting: (k: string) => string | null; setAppSetting: (k: string, v: string) => void } }).runtimeConfig
    setSkillsSourceEnabled(store, parsed.data.sourceName, parsed.data.enabled)
    return { ok: true, sourceName: parsed.data.sourceName, enabled: parsed.data.enabled }
  })

  ipcMain.handle('skills:listBionic', async () => {
    return listBionicSkills()
  })

  ipcMain.handle('skills:addBionic', async (_e, raw: unknown) => {
    const parsed = zBionicSkillAdd.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid skills:addBionic payload: ${parsed.error.message}`)
    return createBionicSkill(parsed.data)
  })

  ipcMain.handle('skills:removeBionic', async (_e, raw: unknown) => {
    const parsed = zBionicSkillId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid skills:removeBionic payload: ${parsed.error.message}`)
    const ok = await deleteBionicSkill(parsed.data.id)
    if (!ok) throw new Error('skill not found')
    return { ok: true }
  })

  // ── Explore (HuggingFace catalog) ──
  ipcMain.handle('explore:listModels', async (_e, raw: unknown) => {
    const parsed = zExploreListModels.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid explore:listModels payload: ${parsed.error.message}`)
    const models = await fetchModelsFromHf({
      sortBy: parsed.data.sortBy ?? 'recommended',
      query: parsed.data.query ?? '',
      pipelineTag: parsed.data.pipelineTag ?? '',
      tag: parsed.data.tag ?? '',
    })
    return models
  })

  ipcMain.handle('explore:getModel', async (_e, raw: unknown) => {
    const parsed = zExploreGetModel.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid explore:getModel payload: ${parsed.error.message}`)
    return fetchModelFromHf(parsed.data.modelId)
  })

  ipcMain.handle('explore:getCompatibility', async (_e, raw: unknown) => {
    const parsed = zExploreGetCompatibility.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid explore:getCompatibility payload: ${parsed.error.message}`)
    const model = await fetchModelFromHf(parsed.data.modelId)
    // Get hardware info from system resources
    const resources = await getBackend().ports.resources.getSnapshot()
    const hw: HardwareInfo = {
      totalRamMB: resources.ram.totalMB,
      freeRamMB: resources.ram.freeMB,
      totalVramMB: resources.vram.totalMB,
      freeVramMB: resources.vram.freeMB,
      gpuName: resources.gpu.name,
      gpuAvailable: resources.gpu.available,
    }
    return estimateCompatibility(model, hw)
  })

  // ── Library (downloaded models) ──
  ipcMain.handle('library:listModels', async () => {
    return getBackend().scanLibrary()
  })

  ipcMain.handle('library:getDirectory', async () => {
    return { path: getBackend().getLibraryDir() }
  })

  ipcMain.handle('library:setDirectory', async (_e, raw: unknown) => {
    const parsed = zLibrarySetDirectory.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid library:setDirectory payload: ${parsed.error.message}`)
    try {
      // Explicit path wins (tests/automation); otherwise ask with a dialog.
      const explicit = parsed.data.path.trim()
      if (explicit) return { ok: true, path: getBackend().setLibraryDir(explicit) }
      const picked = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      if (picked.canceled || picked.filePaths.length === 0) return { ok: false, path: getBackend().getLibraryDir() }
      return { ok: true, path: getBackend().setLibraryDir(picked.filePaths[0] as string) }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'could not change directory')
    }
  })

  ipcMain.handle('library:download', async (_e, raw: unknown) => {
    const parsed = zLibraryDownload.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:download payload: ${parsed.error.message}`)
    try {
      return await getBackend().startModelDownload(
        parsed.data.modelId,
        parsed.data.rfilename,
        parsed.data.downloadUrl,
        broadcastDownload
      )
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'could not start download')
    }
  })

  ipcMain.handle('library:cancelDownload', async (_e, raw: unknown) => {
    const parsed = zLibraryCancel.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:cancelDownload payload: ${parsed.error.message}`)
    return { cancelled: getBackend().cancelModelDownload(parsed.data.modelId, parsed.data.rfilename) }
  })

  ipcMain.handle('library:delete', async (_e, raw: unknown) => {
    const parsed = zLibraryDelete.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:delete payload: ${parsed.error.message}`)
    try {
      getBackend().deleteLibraryEntry(parsed.data.path)
      return { ok: true }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'could not delete model file')
    }
  })

  // ── MCP servers (Connected Apps) ──
  ipcMain.handle('mcp:list', async () => {
    return getBackend().listMcpServers()
  })
  ipcMain.handle('mcp:add', async (_e, raw: unknown) => {
    const parsed = zMcpAdd.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid mcp:add payload: ${parsed.error.message}`)
    return getBackend().addMcpServer(parsed.data)
  })
  ipcMain.handle('mcp:remove', async (_e, raw: unknown) => {
    const parsed = zMcpId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid mcp:remove payload: ${parsed.error.message}`)
    const ok = getBackend().removeMcpServer(parsed.data.id)
    if (!ok) throw new Error('unknown mcp server')
    return { ok: true }
  })
  ipcMain.handle('mcp:toggle', async (_e, raw: unknown) => {
    const parsed = zMcpToggle.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid mcp:toggle payload: ${parsed.error.message}`)
    const server = getBackend().toggleMcpServer(parsed.data.id, parsed.data.enabled)
    if (!server) throw new Error('unknown mcp server')
    return server
  })
  ipcMain.handle('mcp:probe', async (_e, raw: unknown) => {
    const parsed = zMcpId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid mcp:probe payload: ${parsed.error.message}`)
    const server = await getBackend().probeMcpServer(parsed.data.id)
    if (!server) throw new Error('unknown mcp server')
    return server
  })

  // ── Voice transcription (local faster-whisper) ──
  ipcMain.handle('voice:status', async () => {
    return { ready: isVoiceReady() }
  })

  ipcMain.handle('voice:transcribe', async (_e, raw: unknown) => {
    const parsed = (await import('@shared/ipc/schemas')).zVoiceTranscribe.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid voice:transcribe payload: ${parsed.error.message}`)
    try {
      const buf = Buffer.from(parsed.data.audio, 'base64')
      const result = await transcribeAudio(buf, parsed.data.filename)
      return { ok: true, ...result }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
