import { ipcMain } from 'electron'
import { z } from 'zod'
import { getBackend } from '../backendComposition'
import type { SessionId } from '@shared/types/branded'
import { brand } from '@shared/types/branded'
import { zChatSend, zModelsLoad, zModelsProbe, zSessionId, zSessionsCreate } from '@shared/ipc/schemas'

export function registerIpcHandlers(): void {
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

    // 1. Append user message event
    const userEv = await getBackend().ports.persistence.appendEvent(sid, 'user/message', { content: parsed.data.content })

    // 2. Generate deterministic mock assistant response via LlmStubAdapter
    const chunks: string[] = []
    for await (const chunk of getBackend().ports.llm.stream(parsed.data.content)) {
      if (chunk.type === 'text-delta' && chunk.text) {
        chunks.push(chunk.text)
      }
      if (chunk.type === 'done') break
    }
    const mockText = chunks.join('') || '[Phase 1 stub — no LLM wired]'

    // 3. Append assistant message event
    const assistantEv = await getBackend().ports.persistence.appendEvent(sid, 'assistant/message', { content: mockText })

    return { ok: true, userSeq: userEv.seq, assistantSeq: assistantEv.seq }
  })

  ipcMain.handle('chat:cancel', async () => ({ ok: true }))

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

  ipcMain.handle('settings:get', async () => ({ theme: 'dark', network: { allowModelDownload: false } }))

  ipcMain.handle('settings:set', async (_e, _raw: unknown) => ({ ok: true }))
}
