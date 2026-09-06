import { ipcMain, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { getBackend } from '../backendComposition'
import type { SessionId } from '@shared/types/branded'
import { brand } from '@shared/types/branded'
import type { ChatStreamEvent } from '@shared/types/chat'
import { zChatCancel, zChatSend, zModelsAddRuntime, zModelsListModels, zModelsLoad, zModelsProbe, zModelsRuntimeRef, zModelsSelect, zSessionId, zSessionsCreate } from '@shared/ipc/schemas'
import { SettingsStore } from '../config/SettingsStore'
import { VoiceTranscriber } from '../services/voiceTranscriber'

// Singleton instances — lazily created on first registerIpcHandlers() call.
let settingsStore: SettingsStore | null = null
let voiceTranscriber: VoiceTranscriber | null = null

function getSettingsStore(): SettingsStore {
  if (!settingsStore) settingsStore = new SettingsStore()
  return settingsStore
}

function getVoiceTranscriber(): VoiceTranscriber {
  if (!voiceTranscriber) voiceTranscriber = new VoiceTranscriber(getSettingsStore())
  return voiceTranscriber
}

/** Mask an API key for display — show only last 4 characters. */
function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return `${'*'.repeat(key.length - 4)}${key.slice(-4)}`
}

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
    return getBackend().ports.persistence.create(parsed.data.title)
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

  ipcMain.handle('chat:send', async (_e, raw: unknown) => {
    const parsed = zChatSend.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid chat payload: ${parsed.error.message}`)
    const sid = brand<'SessionId'>(parsed.data.sessionId)
    try {
      // Real local inference via ChatService → LlmPort → loopback runtime.
      // Deltas stream back on `events:session`; the invoke resolves on
      // completion with the durable seqs.
      return await getBackend().chat.send(sid, parsed.data.content)
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

  ipcMain.handle('settings:get', async () => ({ theme: 'dark', network: { allowModelDownload: false } }))

  ipcMain.handle('settings:set', async (_e, _raw: unknown) => ({ ok: true }))

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

  // ── Settings — API keys (persisted via SettingsStore) ──
  ipcMain.handle('settings:getOpenAIKey', async () => {
    const key = getSettingsStore().getOpenAIKey()
    return { key: key ? maskKey(key) : null, configured: !!key }
  })

  ipcMain.handle('settings:setOpenAIKey', async (_e, raw: unknown) => {
    const data = raw as { key?: string }
    getSettingsStore().setOpenAIKey(data?.key ?? null)
    return { ok: true }
  })

  ipcMain.handle('settings:getOpenAIBaseUrl', async () => {
    const url = getSettingsStore().getOpenAIBaseUrl()
    return { url }
  })

  ipcMain.handle('settings:setOpenAIBaseUrl', async (_e, raw: unknown) => {
    const data = raw as { url?: string }
    getSettingsStore().setOpenAIBaseUrl(data?.url ?? null)
    return { ok: true }
  })

  // ── Voice transcription (OpenAI Whisper) ──
  ipcMain.handle('voice:transcribe', async (_e, raw: unknown) => {
    const data = raw as { audio?: string; format?: string }
    if (!data?.audio) throw new Error('voice:transcribe requires audio data')
    try {
      const result = await getVoiceTranscriber().transcribe(data.audio, data.format ?? 'webm')
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'transcription failed'
      throw new Error(msg)
    }
  })
}
