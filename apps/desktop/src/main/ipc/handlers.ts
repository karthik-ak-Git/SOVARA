import { ipcMain, BrowserWindow, dialog, shell } from 'electron'
import { z } from 'zod'
import { getBackend } from '../backendComposition'
import type { SessionId } from '@shared/types/branded'
import { brand } from '@shared/types/branded'
import type { ChatStreamEvent } from '@shared/types/chat'
import { zChatCancel, zChatSend, zModelsAddRuntime, zModelsListModels, zModelsLoad, zModelsProbe, zModelsRegistryList, zModelsRegistryPath, zModelsRegistryRef, zModelsRegistryUpdate, zModelsRuntimeRef, zModelsSelect, zProjectCreate, zProjectId, zProjectRename, zSessionArchive, zSessionId, zSessionRename, zSessionsCreate, zExecMode, zSettingsSet, zToolDispatch, zMcpAdd, zMcpInstallFromUrl, zMcpId, zMcpToggle, zSkillImportFromUrl, zInstanceId } from '@shared/ipc/schemas'
import { gateDispatch } from '../services/execPermissions'
import { checkForUpdates } from '../services/updateFeed'
import { getPythonStatus, ensurePythonEnv } from '../services/pythonEnv'
import { scanSkillsSources, listBionicSkills, createBionicSkill, deleteBionicSkill, setSkillsSourceEnabled, listDetailedSkillsForSources, importSkillFromUrl } from '../services/skillsScanner'
import { transcribeAudio, isVoiceReady, startVoiceServer } from '../services/voiceServer'
import { zSkillsToggle, zBionicSkillAdd, zBionicSkillId, zExploreListModels, zExploreGetModel, zExploreGetCompatibility, zExploreGetRecommendations, zLibrarySetDirectory, zLibraryDownload, zLibraryCancel, zLibraryDelete, zLibraryIsDownloaded, zLibraryFileRef, zShellOpenExternal, zValidationStart, zValidationGet } from '@shared/ipc/schemas'
import { listExplorerModels, getExplorerModel } from '../services/explorerCatalog'
import { fitExplorerFiles, toCompatibility } from '../services/explorerFit'
import { getHardwareProfile } from '../services/hardwareProfile'
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

  ipcMain.handle('models:listRegistry', async (_e, raw: unknown) => {
    const parsed = zModelsRegistryList.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid list payload: ${parsed.error.message}`)
    return getBackend().workbench.listRegistryRows(parsed.data.runtimeId)
  })

  ipcMain.handle('models:updateRegistry', async (_e, raw: unknown) => {
    const parsed = zModelsRegistryUpdate.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid registry update: ${parsed.error.message}`)
    getBackend().workbench.updateRegistryRow(parsed.data.id, parsed.data.patch)
    return { ok: true }
  })

  ipcMain.handle('models:removeRegistry', async (_e, raw: unknown) => {
    const parsed = zModelsRegistryRef.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid registry ref: ${parsed.error.message}`)
    getBackend().workbench.removeRegistryRow(parsed.data.id)
    return { ok: true }
  })

  ipcMain.handle('models:removeRegistryByPath', async (_e, raw: unknown) => {
    const parsed = zModelsRegistryPath.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid registry path: ${parsed.error.message}`)
    getBackend().workbench.removeRegistryRowsByPath(parsed.data.localPath)
    return { ok: true }
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

  ipcMain.handle('skills:listDetailed', async () => {
    return listDetailedSkillsForSources((getBackend() as unknown as { runtimeConfig: { getAppSetting: (k: string) => string | null } }).runtimeConfig)
  })

  ipcMain.handle('skills:importFromUrl', async (_e, raw: unknown) => {
    const parsed = zSkillImportFromUrl.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid skills:importFromUrl payload: ${parsed.error.message}`)
    try {
      return await importSkillFromUrl(parsed.data.url)
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'skill import failed')
    }
  })

  // ── Explore (HuggingFace catalog) ──
  ipcMain.handle('explore:listModels', async (_e, raw: unknown) => {
    const parsed = zExploreListModels.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid explore:listModels payload: ${parsed.error.message}`)
    // Fresh LM Studio-parity catalog: 5 families only (text/vision/tools/code/thinking).
    // Legacy pipelineTag/tag filters are folded into the query scope — text families only.
    const scopeQuery = [parsed.data.query ?? '', parsed.data.pipelineTag ?? '', parsed.data.tag ?? '']
      .map((s) => s.trim()).filter(Boolean).join(' ')
    return listExplorerModels({
      sortBy: parsed.data.sortBy ?? 'Recommended',
      query: scopeQuery,
      limit: parsed.data.limit ?? 30,
      format: parsed.data.format ?? 'all',
    })
  })

  ipcMain.handle('explore:getModel', async (_e, raw: unknown) => {
    const parsed = zExploreGetModel.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid explore:getModel payload: ${parsed.error.message}`)
    return getExplorerModel(parsed.data.modelId)
  })

  ipcMain.handle('explore:getCompatibility', async (_e, raw: unknown) => {
    const parsed = zExploreGetCompatibility.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid explore:getCompatibility payload: ${parsed.error.message}`)
    const model = await getExplorerModel(parsed.data.modelId)
    const hw: HardwareInfo = getHardwareProfile()
    // Default badge = the TOP RECOMMENDED file (LM Studio preselects the
    // recommended quant), not files[0] — per-file state then follows selection.
    const fits = fitExplorerFiles(model, hw)
    const top = fits.find((f) => f.isRecommended) ?? fits[0]
    if (!top) return { fitsInMemory: false, estimatedRamUsageGB: 0, message: 'No downloadable files.', severity: 'too-large' as const }
    return toCompatibility(top)
  })

  ipcMain.handle('explore:getRecommendations', async (_e, raw: unknown) => {
    const parsed = zExploreGetRecommendations.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid explore:getRecommendations payload: ${parsed.error.message}`)
    const model = await getExplorerModel(parsed.data.modelId)
    const hw: HardwareInfo = getHardwareProfile()
    // New fit rows mapped to the legacy FileRecommendationView shape the renderer expects.
    return fitExplorerFiles(model, hw).map((r, rank) => ({
      file: model.files[r.index],
      index: r.index,
      estimatedRamGB: r.needGB,
      severity: r.fit === 'willNotFit' ? 'too-large' as const : r.fit === 'partialGPUOffload' ? 'tight' as const : 'good' as const,
      rank,
      reason: r.message,
    }))
  })

  ipcMain.handle('explore:getHardwareProfile', async () => {
    return getHardwareProfile()
  })

  ipcMain.handle('validation:getFullProfile', async () => {
    return getBackend().getFullHardwareProfile()
  })

  ipcMain.handle('validation:start', async (_e, raw: unknown) => {
    const parsed = zValidationStart.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid validation:start payload: ${parsed.error.message}`)
    return getBackend().startValidation(parsed.data.modelId, parsed.data.libraryPath, parsed.data.ctxLen)
  })

  ipcMain.handle('validation:get', async (_e, raw: unknown) => {
    const parsed = zValidationGet.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid validation:get payload: ${parsed.error.message}`)
    const job = getBackend().getValidation(parsed.data.jobId)
    if (!job) throw new Error('unknown job')
    return job
  })

  ipcMain.handle('validation:list', async () => {
    return getBackend().listValidations()
  })

  ipcMain.handle('validation:storeList', async () => {
    return getBackend().listValidationCache()
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
        broadcastDownload,
        { parts: parsed.data.parts, companion: parsed.data.companion, revision: parsed.data.revision, format: parsed.data.format, quantization: parsed.data.quantization, license: parsed.data.license, gated: parsed.data.gated }
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

  ipcMain.handle('library:pauseDownload', async (_e, raw: unknown) => {
    const parsed = zLibraryCancel.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:pauseDownload payload: ${parsed.error.message}`)
    return { paused: getBackend().pauseModelDownload(parsed.data.modelId, parsed.data.rfilename) }
  })

  ipcMain.handle('library:resumeDownload', async (_e, raw: unknown) => {
    const parsed = zLibraryDownload.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:resumeDownload payload: ${parsed.error.message}`)
    return { resumed: getBackend().resumeModelDownload(parsed.data.modelId, parsed.data.rfilename, parsed.data.downloadUrl, broadcastDownload, parsed.data.revision) }
  })

  ipcMain.handle('library:getActiveDownloads', async () => {
    return getBackend().getActiveDownloads()
  })

  ipcMain.handle('library:isDownloaded', async (_e, raw: unknown) => {
    const parsed = zLibraryIsDownloaded.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:isDownloaded payload: ${parsed.error.message}`)
    return { downloaded: getBackend().isDownloaded(parsed.data.modelId, parsed.data.rfilename) }
  })

  ipcMain.handle('library:getFileStatus', async (_e, raw: unknown) => {
    const parsed = zLibraryFileRef.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:getFileStatus payload: ${parsed.error.message}`)
    return getBackend().getFileStatus(parsed.data.modelId, parsed.data.rfilename, parsed.data.revision)
  })

  ipcMain.handle('library:reconcile', async () => {
    return getBackend().reconcileLibrary()
  })

  ipcMain.handle('library:openFolder', async (_e, raw: unknown) => {
    const parsed = zLibraryFileRef.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:openFolder payload: ${parsed.error.message}`)
    try {
      const dir = getBackend().getModelFolder(parsed.data.modelId, parsed.data.rfilename, parsed.data.revision)
      await shell.openPath(dir)
      return { ok: true, path: dir }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'could not open model folder')
    }
  })

  ipcMain.handle('shell:openExternal', async (_e, raw: unknown) => {
    const parsed = zShellOpenExternal.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid shell:openExternal payload: ${parsed.error.message}`)
    try {
      const u = new URL(parsed.data.url)
      const hfBase = 'huggingface' + '.co'
      const allowed = u.hostname === hfBase || u.hostname.endsWith('.' + hfBase) || u.hostname.endsWith('.hf.co') || u.hostname === 'github.com' || u.hostname.endsWith('github.com')
      if (u.protocol !== 'https:' || !allowed) throw new Error('URL not allowed')
      await shell.openExternal(u.toString())
      return { ok: true }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'could not open URL')
    }
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

  // ── MCP servers (Connected Apps) — global MCP folder + AI URL install ──
  ipcMain.handle('mcp:list', async () => {
    return getBackend().listMcpServers()
  })
  ipcMain.handle('mcp:add', async (_e, raw: unknown) => {
    const parsed = zMcpAdd.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid mcp:add payload: ${parsed.error.message}`)
    return getBackend().addMcpServer(parsed.data)
  })
  ipcMain.handle('mcp:installFromUrl', async (_e, raw: unknown) => {
    const parsed = zMcpInstallFromUrl.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid mcp:installFromUrl payload: ${parsed.error.message}`)
    try {
      return await getBackend().installMcpFromUrl(parsed.data.url)
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'mcp install failed')
    }
  })
  ipcMain.handle('mcp:getDir', async () => {
    return { path: getBackend().getMcpDir(), exists: true }
  })
  ipcMain.handle('mcp:openFolder', async () => {
    const dir = getBackend().ensureMcpDir()
    await shell.openPath(dir)
    return { ok: true, path: dir }
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

  // ── Loaded instances (runtime monitoring & management) ──
  ipcMain.handle('instances:list', async () => {
    return getBackend().ports.models.listInstances()
  })

  ipcMain.handle('instances:unload', async (_e, raw: unknown) => {
    const parsed = zInstanceId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid instances:unload payload: ${parsed.error.message}`)
    try {
      await getBackend().ports.models.unload(parsed.data.instanceId as import('@shared/types/branded').InstanceId)
      return { ok: true }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'unload failed')
    }
  })

  ipcMain.handle('instances:getMetrics', async (_e, raw: unknown) => {
    const parsed = zInstanceId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid instances:getMetrics payload: ${parsed.error.message}`)
    try {
      return await getBackend().ports.models.health(parsed.data.instanceId as import('@shared/types/branded').InstanceId)
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'health check failed')
    }
  })
}
