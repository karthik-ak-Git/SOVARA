import { describe, it, expect } from 'vitest'
import { zChatSend, zModelsLoad, zModelsProbe, zSessionId, zSessionsCreate, zLibraryDownload, zLibraryCancel, zLibraryDelete, zLibrarySetDirectory } from '../src/shared/ipc/schemas'
import { IPC_CHANNELS } from '../src/shared/ipc/channels'

describe('IPC contracts — Zod strict validation', () => {
  it('sessions:create accepts empty, title, rejects long/extra', () => {
    expect(zSessionsCreate.safeParse({}).success).toBe(true)
    expect(zSessionsCreate.safeParse({ title: 'ok' }).success).toBe(true)
    expect(zSessionsCreate.safeParse({ title: 'a'.repeat(121) }).success).toBe(false)
    expect(zSessionsCreate.safeParse({ title: 'ok', extra: 1 }).success).toBe(false)
    expect(zSessionsCreate.safeParse({ title: 123 }).success).toBe(false)
  })

  it('sessionId must be non-empty string', () => {
    expect(zSessionId.safeParse('sess-1').success).toBe(true)
    expect(zSessionId.safeParse('').success).toBe(false)
    expect(zSessionId.safeParse(123).success).toBe(false)
  })

  it('chat:send rejects missing/empty/oversized/extra', () => {
    expect(zChatSend.safeParse({ sessionId: 's1', content: 'hi' }).success).toBe(true)
    expect(zChatSend.safeParse({ sessionId: 's1', content: '' }).success).toBe(false)
    expect(zChatSend.safeParse({ sessionId: 's1', content: 'a'.repeat(32_001) }).success).toBe(false)
    expect(zChatSend.safeParse({ sessionId: 's1' }).success).toBe(false)
    expect(zChatSend.safeParse({ sessionId: '', content: 'hi' }).success).toBe(false)
    expect(zChatSend.safeParse({ sessionId: 's1', content: 'hi', extra: 1 }).success).toBe(false)
  })

  it('models:probeRuntime and load have strict schemas', () => {
    expect(zModelsProbe.safeParse('ollama').success).toBe(true)
    expect(zModelsProbe.safeParse('').success).toBe(false)
    expect(zModelsLoad.safeParse({ modelId: 'm1' }).success).toBe(true)
    expect(zModelsLoad.safeParse({}).success).toBe(false)
    expect(zModelsLoad.safeParse({ modelId: 'm1', extra: 1 }).success).toBe(false)
  })

  it('IPC channel whitelist is the single source', () => {
    const invoke = Object.entries(IPC_CHANNELS)
      .filter(([, v]) => v.type === 'invoke')
      .map(([k]) => k)
    expect(invoke).toContain('sessions:create')
    expect(invoke).toContain('sessions:getEvents')
    expect(invoke).toContain('chat:send')
    expect(invoke).toContain('system:getResources')
    expect(invoke).toContain('library:download')
    expect(invoke).toContain('library:cancelDownload')
    expect(invoke).toContain('library:delete')
    const on = Object.entries(IPC_CHANNELS)
      .filter(([, v]) => v.type === 'on')
      .map(([k]) => k)
    expect(on).toContain('events:download')
    // unknown channel must not be in whitelist
    expect(invoke).not.toContain('fs:readFile')
    expect(invoke).not.toContain('shell:exec')
  })

  it('library schemas validate download/cancel/delete/directory payloads', () => {
    const dl = { modelId: 'Qwen/Qwen3-4B-GGUF', rfilename: 'model.gguf', downloadUrl: 'https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/model.gguf' }
    expect(zLibraryDownload.safeParse(dl).success).toBe(true)
    expect(zLibraryDownload.safeParse({ ...dl, extra: 1 }).success).toBe(false)
    expect(zLibraryDownload.safeParse({ ...dl, downloadUrl: '' }).success).toBe(false)
    expect(zLibraryCancel.safeParse({ modelId: 'a', rfilename: 'b' }).success).toBe(true)
    expect(zLibraryCancel.safeParse({ modelId: '' }).success).toBe(false)
    expect(zLibraryDelete.safeParse({ path: 'C:\\models\\x.gguf' }).success).toBe(true)
    expect(zLibraryDelete.safeParse({}).success).toBe(false)
    expect(zLibrarySetDirectory.safeParse({}).success).toBe(true)
    expect(zLibrarySetDirectory.safeParse({ path: 'C:\\models' }).success).toBe(true)
  })
})
