import { ipcMain, BrowserWindow, dialog, shell, clipboard } from 'electron'
import { execSync } from 'node:child_process'
import { z } from 'zod'
import { getBackend } from '../backendComposition'
import type { SessionId } from '@shared/types/branded'
import { brand } from '@shared/types/branded'
import type { ChatStreamEvent } from '@shared/types/chat'
import { zChatCancel, zChatSend, zChatRegenerate, zChatEditResend, zArtifactOpen, zClipboardWrite, zModelsAddRuntime, zModelsListModels, zModelsProbe, zModelsRuntimeRef, zModelsSelect, zProjectCreate, zProjectId, zProjectRename, zSessionArchive, zSessionId, zSessionRename, zSessionsCreate, zExecMode, zSettingsSet, zToolDispatch, zMcpAdd, zMcpInstallFromUrl, zMcpId, zMcpToggle, zSkillImportFromUrl, zInstanceId, zUsageGetRecent, zGitStatus, zGitDiff, zGitFileContent, zWikiBuildGraph } from '@shared/ipc/schemas'
import { getSessionsDir, getSovaraDataDir } from '../storage/paths'
import path from 'node:path'
import fs from 'node:fs'
import { gateDispatch } from '../services/execPermissions'
import { registerTerminalIpc } from '../services/ptyHost'
import {
  StudioStore,
  zStudioAgentCreate,
  zStudioAgentUpdate,
  zStudioId,
  zStudioKnowledgeAdd,
  zStudioMemoryAdd,
  zStudioWorkflowCreate,
  zStudioWorkflowUpdate,
  zStudioEvalRecord,
  zStudioPermissionsSet,
  zStudioVersionSave,
} from '../services/agentStudio'
import { checkForUpdates } from '../services/updateFeed'
import { scanSkillsSources, listBionicSkills, createBionicSkill, deleteBionicSkill, setSkillsSourceEnabled, listDetailedSkillsForSources, importSkillFromUrl } from '../services/skillsScanner'
import { migrateLegacyRuntime } from '../services/llamaRuntime'
import { diagnoseLlamaExecutable, getLlamaRuntimeDir, getLegacyLlamaRuntimeDir, unblockRuntimeDir, getLlamaServerPath, ensureLlamaRuntime } from '../services/llamaRuntime'
import { zSkillsToggle, zBionicSkillAdd, zBionicSkillId, zExploreListModels, zExploreGetModel, zExploreGetCompatibility, zExploreGetRecommendations, zLibrarySetDirectory, zLibraryRegisterExternal, zLibraryDownload, zLibraryCancel, zLibraryDelete, zLibraryIsDownloaded, zLibraryFileRef, zShellOpenExternal, zShellShowItemInFolder, zModelsEnsureRuntime } from '@shared/ipc/schemas'
import { listExplorerModelsCached, getExplorerModel, getCachedHardwareProfile } from '../services/explorerCatalog'
import { fitExplorerFiles, toCompatibility } from '../services/explorerFit'
import type { HardwareInfo } from '@shared/types/explore'
import { detectLocalRuntimes } from '../services/localRuntimeDetector'

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

/** Prefix a user-facing error code exactly once (inner layers may pre-prefix). */
function prefixed(raw: string, prefix: string): string {
  return raw.toLowerCase().startsWith(prefix.toLowerCase()) ? raw : `${prefix}${raw}`
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
  // Orchestrator is the Chat execution surface — keep emit in sync
  try { getBackend().orchestrator.setEmit(broadcastChat) } catch { /* tests */ }
  // Clipboard write goes through Main: renderer's navigator.clipboard is
  // focus/permission sensitive under contextIsolation and fails silently —
  // the Electron clipboard API is deterministic.
  ipcMain.handle('clipboard:write', async (_e, raw: unknown) => {
    const parsed = zClipboardWrite.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid clipboard:write payload: ${parsed.error.message}`)
    clipboard.writeText(parsed.data.text)
    return { ok: true }
  })

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
    if (!parsed.success) {
      console.error(`[SOVARA][IPC][chat:send] invalid payload: ${parsed.error.message}`, raw)
      throw new Error(`invalid chat payload: ${parsed.error.message}`)
    }
    const sid = brand<'SessionId'>(parsed.data.sessionId)
    console.log(`[SOVARA][IPC] chat:send sid=${parsed.data.sessionId} len=${parsed.data.content.length} webSearch=${!!parsed.data.webSearch} reasoning=${!!parsed.data.reasoning} attachments=${parsed.data.attachments?.length ?? 0}`)
    try {
      // Agent orchestration surface: task → router → runtime → stream.
      // Deltas stream back on `events:session`; invoke resolves when the
      // durable assistant event is persisted. Keeps Chat thin.
      const backend = getBackend()
      // Prefer orchestrator when available (Phase 1+ seam). Falls back to
      // legacy ChatService for tests that mock ChatService directly.
      const target: { execute?: Function; send?: Function } = (backend as unknown as { orchestrator?: { execute: Function } }).orchestrator ?? backend.chat
      const sendOpts = { webSearch: parsed.data.webSearch, reasoning: parsed.data.reasoning, attachments: parsed.data.attachments }
      const res = await (target.execute
        ? (target as { execute: (sid: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }> }).execute(sid, parsed.data.content, sendOpts)
        : (target as { send: (sid: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }> }).send(sid, parsed.data.content, { webSearch: parsed.data.webSearch, reasoning: parsed.data.reasoning }))
      console.log(`[SOVARA][IPC] chat:send ok sid=${parsed.data.sessionId} userSeq=${res.userSeq} assistantSeq=${res.assistantSeq}`)
      return res
    } catch (e) {
      console.error(`[SOVARA][IPC][chat:send][ERROR] sid=${parsed.data.sessionId} ${e instanceof Error ? e.message : String(e)}`)
      // Map orchestrator codes to user-facing strings the UI already handles.
      // Single-prefix: inner messages may already carry the code prefix.
      const raw = e instanceof Error ? e.message : 'chat failed'
      const code = (e as { code?: string })?.code
      if (code === 'no-model-available') throw new Error(prefixed(raw, 'no-active-model: '))
      if (code === 'resource-blocked') throw new Error(prefixed(raw, 'resource-pressure: '))
      if (code === 'resource-pressure') throw new Error(prefixed(raw, 'resource-pressure: '))
      if (code === 'model-load-failed') throw new Error(prefixed(raw, 'model-load-failed: '))
      // Bare Errors from the adapter (no code) that are resource-fit → prefix honestly.
      if (!code && /resource-pressure|insufficient VRAM|needs ~\d+|cannot fit this GPU/i.test(raw) && !/max concurrent|model\(s\) already resident|eligible for eviction/i.test(raw)) {
        throw new Error(prefixed(raw, 'resource-pressure: '))
      }
      if (code === 'runtime-unavailable') throw new Error(prefixed(raw, 'runtime-unavailable: '))
      if (code === 'llm-failed') throw new Error(prefixed(raw, 'runtime-unavailable: '))
      // Graceful empty-reply should already have been converted to ack in orchestrator — but if it slips, make it retryable not a handler crash
      if (raw.includes('invalid-response') && raw.includes('empty reply')) throw new Error('runtime-unavailable: the local model returned an empty reply — try /compact or a shorter prompt')
      throw new Error(raw)
    }
  })

  // ── Generated artifacts: open with the OS default app. The path must
  // resolve inside the sessions root (no traversal, no symlinks out) and
  // carry an artifact extension — anything else is refused honestly. ──
  ipcMain.handle('artifacts:open', async (_e, raw: unknown) => {
    const parsed = zArtifactOpen.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid artifacts:open payload: ${parsed.error.message}`)
    try {
      // Primary: sessions dir (existing contract). Also allow workspace files
      // (D:\data\rewards\dashboard.html) so deterministic harness output can be opened.
      const rawPath = path.resolve(parsed.data.path)
      let real: string
      try {
        real = fs.realpathSync(rawPath)
      } catch {
        // fallback for not-yet-realpathed (sessions symlink case)
        const root = path.resolve(getSessionsDir())
        const resolved = path.resolve(root, path.relative(root, rawPath))
        real = fs.realpathSync(resolved)
      }
      const allowed = ['.pdf', '.xlsx', '.docx', '.pptx', '.ppt', '.txt', '.md', '.csv', '.json', '.py', '.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.sh', '.sql', '.rs', '.go', '.java']
      if (!allowed.includes(path.extname(real).toLowerCase())) throw new Error('artifact type not allowed')
      if (!fs.statSync(real).isFile()) throw new Error('artifact not found')
      const sessionsRoot = path.resolve(getSessionsDir())
      const insideSessions = real === sessionsRoot || real.startsWith(sessionsRoot + path.sep)
      let insideWorkspace = false
      if (!insideSessions) {
        // Allow files inside the visually-selected workspace — resolved globally, no hard-coded paths.
        // Uses the same project/global resolution the chat harness uses (getProjectWorkspace / getGlobalWorkspace)
        // plus enumeration of all persisted projects so any selected project is authorized.
        try {
          const backend = getBackend()
          const bAny = backend as unknown as {
            getGlobalWorkspace?: () => string
            runtimeConfig?: { getAppSetting?: (k: string) => string | null }
          }
          const candidates: string[] = []
          try { const g = bAny.getGlobalWorkspace?.(); if (g) candidates.push(path.resolve(g)) } catch {}
          try { const g2 = bAny.runtimeConfig?.getAppSetting?.('global_workspace_root'); if (g2) candidates.push(path.resolve(g2)) } catch {}
          try {
            const rows = await backend.ports.persistence.listProjects()
            for (const r of rows as Array<{ rootPath?: string }>) {
              if (r.rootPath) candidates.push(path.resolve(r.rootPath))
            }
          } catch {}
          for (const c of candidates) {
            try {
              const norm = path.resolve(c)
              if (real === norm || real.startsWith(norm + path.sep)) { insideWorkspace = true; break }
            } catch {}
          }
        } catch { /* ignore */ }
      }
      if (!insideSessions && !insideWorkspace) throw new Error('artifact path not allowed')
      await shell.openPath(real)
      return { ok: true, path: real }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'could not open artifact')
    }
  })

  ipcMain.handle('chat:cancel', async (_e, raw: unknown) => {
    // No session ref = legacy probe call; treat as a no-op success.
    if (raw === undefined) return { ok: true, cancelled: false }
    const parsed = zChatCancel.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid cancel payload: ${parsed.error.message}`)
    const sid = brand<'SessionId'>(parsed.data.sessionId)
    // Cancel must propagate to the orchestrator (real stream abort), not just hide spinner
    const backend = getBackend()
    const orch = (backend as unknown as { orchestrator?: { cancel: (s: SessionId) => { cancelled: boolean } } }).orchestrator
    const legacy = backend.chat.cancel(sid)
    const viaOrch = orch ? orch.cancel(sid) : { cancelled: false }
    return { cancelled: legacy.cancelled || viaOrch.cancelled }
  })

  ipcMain.handle('chat:approve', async (_e, raw: unknown) => {
    const { zChatApprove } = await import('@shared/ipc/schemas')
    const parsed = zChatApprove.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid approve payload: ${parsed.error.message}`)
    const backend = getBackend()
    const orch = (backend as any).orchestrator
    if (orch) {
      orch.resolveToolApproval(parsed.data.toolCallId, parsed.data.approved, parsed.data.modifiedArgs)
    }
    return { ok: true }
  })

  ipcMain.handle('chat:regenerate', async (_e, raw: unknown) => {
    const parsed = zChatRegenerate.safeParse(raw)
    if (!parsed.success) {
      console.error(`[SOVARA][IPC][chat:regenerate] invalid payload: ${parsed.error.message}`, raw)
      throw new Error(`invalid regenerate payload: ${parsed.error.message}`)
    }
    const sid = brand<'SessionId'>(parsed.data.sessionId)
    console.log(`[SOVARA][IPC] chat:regenerate sid=${parsed.data.sessionId} reasoning=${!!parsed.data.reasoning}`)
    try {
      const backend = getBackend()
      const target: { regenerate?: Function; execute?: Function } = (backend as unknown as { orchestrator?: unknown }).orchestrator ?? backend.chat
      const res = await (target as { regenerate: (s: SessionId, o?: unknown) => Promise<{ assistantSeq: number }> }).regenerate(sid, { reasoning: parsed.data.reasoning })
      console.log(`[SOVARA][IPC] chat:regenerate ok sid=${parsed.data.sessionId} assistantSeq=${res.assistantSeq}`)
      return res
    } catch (e) {
      console.error(`[SOVARA][IPC][chat:regenerate][ERROR] sid=${parsed.data.sessionId} ${e instanceof Error ? e.message : String(e)}`)
      const raw = e instanceof Error ? e.message : 'regenerate failed'
      const code = (e as { code?: string })?.code
      if (code === 'no-model-available') throw new Error(prefixed(raw, 'no-active-model: '))
      if (code === 'resource-blocked') throw new Error(prefixed(raw, 'resource-pressure: '))
      if (code === 'resource-pressure') throw new Error(prefixed(raw, 'resource-pressure: '))
      if (code === 'model-load-failed') throw new Error(prefixed(raw, 'model-load-failed: '))
      if (!code && /resource-pressure|insufficient VRAM|needs ~\d+|cannot fit this GPU/i.test(raw) && !/max concurrent|model\(s\) already resident|eligible for eviction/i.test(raw)) {
        throw new Error(prefixed(raw, 'resource-pressure: '))
      }
      if (code === 'runtime-unavailable') throw new Error(prefixed(raw, 'runtime-unavailable: '))
      if (code === 'llm-failed') throw new Error(prefixed(raw, 'runtime-unavailable: '))
      throw new Error(raw)
    }
  })

  ipcMain.handle('chat:editResend', async (_e, raw: unknown) => {
    const parsed = zChatEditResend.safeParse(raw)
    if (!parsed.success) {
      console.error(`[SOVARA][IPC][chat:editResend] invalid payload: ${parsed.error.message}`, raw)
      throw new Error(`invalid editResend payload: ${parsed.error.message}`)
    }
    const sid = brand<'SessionId'>(parsed.data.sessionId)
    console.log(`[SOVARA][IPC] chat:editResend sid=${parsed.data.sessionId} len=${parsed.data.content.length} reasoning=${!!parsed.data.reasoning}`)
    try {
      const backend = getBackend() as unknown as { orchestrator?: { editAndResend?: Function; execute?: Function }; chat?: { editAndResend?: Function; send?: Function; execute?: Function } }
      const orch = backend.orchestrator
      const chat = backend.chat
      const resendOpts = { webSearch: parsed.data.webSearch, reasoning: parsed.data.reasoning, attachments: parsed.data.attachments }
      // Prefer explicit editAndResend; fall back to execute/send (append-only) so edit never crashes. Never read .execute of undefined.
      if (orch?.editAndResend) {
        const res = await (orch.editAndResend as (s: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }>)(sid, parsed.data.content, resendOpts)
        console.log(`[SOVARA][IPC] chat:editResend ok via orchestrator sid=${parsed.data.sessionId} userSeq=${res.userSeq}`)
        return res
      }
      if (chat?.editAndResend) {
        const res = await (chat.editAndResend as (s: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }>)(sid, parsed.data.content, resendOpts)
        console.log(`[SOVARA][IPC] chat:editResend ok via chat sid=${parsed.data.sessionId} userSeq=${res.userSeq}`)
        return res
      }
      if (orch?.execute) {
        const res = await (orch.execute as (s: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }>)(sid, parsed.data.content, resendOpts)
        console.log(`[SOVARA][IPC] chat:editResend fallback via orchestrator.execute sid=${parsed.data.sessionId} userSeq=${res.userSeq}`)
        return res
      }
      if (chat?.send) {
        const res = await (chat.send as (s: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }>)(sid, parsed.data.content, resendOpts)
        console.log(`[SOVARA][IPC] chat:editResend fallback via chat.send sid=${parsed.data.sessionId} userSeq=${res.userSeq}`)
        return res
      }
      // Last resort: try backend.chat as generic
      const fallback = (backend as unknown as { chat?: unknown }).chat
      if (fallback && typeof (fallback as { execute?: unknown }).execute === 'function') {
        const res = await ((fallback as { execute: (s: SessionId, c: string, o?: unknown) => Promise<{ userSeq: number; assistantSeq: number }> }).execute)(sid, parsed.data.content, resendOpts)
        console.log(`[SOVARA][IPC] chat:editResend fallback generic execute sid=${parsed.data.sessionId} userSeq=${res.userSeq}`)
        return res
      }
      throw new Error('editResend unavailable: no chat handler')
    } catch (e) {
      console.error(`[SOVARA][IPC][chat:editResend][ERROR] sid=${parsed.data.sessionId} ${e instanceof Error ? e.message : String(e)}`)
      const raw = e instanceof Error ? e.message : 'editResend failed'
      const code = (e as { code?: string })?.code
      if (code === 'no-model-available') throw new Error(prefixed(raw, 'no-active-model: '))
      if (code === 'resource-blocked') throw new Error(prefixed(raw, 'resource-pressure: '))
      if (code === 'model-load-failed') throw new Error(prefixed(raw, 'model-load-failed: '))
      if (code === 'runtime-unavailable') throw new Error(prefixed(raw, 'runtime-unavailable: '))
      if (code === 'llm-failed') throw new Error(prefixed(raw, 'runtime-unavailable: '))
      if (raw.includes('invalid-response') && raw.includes('empty reply')) throw new Error('runtime-unavailable: the local model returned an empty reply — try /compact or a shorter prompt (editResend)')
      // Never surface raw "Cannot read properties of undefined" to UI — map to user-friendly retryable error
      if (raw.includes('Cannot read properties')) throw new Error('editResend failed: chat service not ready, please retry')
      throw new Error(raw)
    }
  })

  ipcMain.handle('models:probeRuntime', async (_e, raw: unknown) => {
    const parsed = zModelsProbe.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid runtimeId: ${parsed.error.message}`)
    return getBackend().ports.models.probeRuntime(parsed.data)
  })

  // ── Owned runtime install (one-time pinned llama.cpp CUDA build) ──
  // Progress streams on `events:download` under modelId `__sovara_runtime__`;
  // the invoke resolves with the verified binary path + version.
  ipcMain.handle('models:ensureRuntime', async (_e, raw: unknown) => {
    const parsed = zModelsEnsureRuntime.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid ensureRuntime payload: ${parsed.error.message}`)
    try {
      return await getBackend().ensureLocalRuntime((p) => {
        broadcastDownload({
          modelId: '__sovara_runtime__',
          rfilename: 'llama-server (CUDA)',
          state: p.phase === 'ready' ? 'done' : p.phase === 'downloading' ? 'progress' : 'started',
          receivedBytes: p.receivedBytes,
          totalBytes: p.totalBytes,
        })
      })
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'runtime install failed')
    }
  })

  ipcMain.handle('models:diagnoseRuntime', async () => {
    try {
      return await diagnoseLlamaExecutable(undefined)
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'diagnose failed')
    }
  })

  ipcMain.handle('models:unblockRuntime', async () => {
    try {
      // 1) Migrate legacy @-path → %LOCALAPPDATA%\Sovara (fixes spawn UNKNOWN from @)
      const mig = await migrateLegacyRuntime(undefined)
      // 2) Unblock BOTH dirs (legacy may still be the live exe until reinstall)
      const dir = getLlamaRuntimeDir(undefined)
      const un = await unblockRuntimeDir(dir)
      try {
        const legacyDir = getLegacyLlamaRuntimeDir(undefined)
        if (legacyDir) await unblockRuntimeDir(legacyDir).catch(() => ({ unblocked: false, detail: '' }))
      } catch { /* ignore */ }
      // Unblock whichever exe is actually resolved too
      const liveExe = getLlamaServerPath(undefined)
      if (liveExe) {
        try { await unblockRuntimeDir(liveExe.substring(0, liveExe.lastIndexOf('\\')) || dir) } catch { /* ignore */ }
      }
      const diag = await diagnoseLlamaExecutable(undefined)
      return { ...un, dir, migrated: mig.migrated, migrateDetail: mig.detail, diag }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'unblock failed')
    }
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
      return await getBackend().workbench.selectModel(parsed.data.runtimeId, parsed.data.modelId, { fit: parsed.data.fit })
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
    const args = parsed.data.args as Record<string, unknown> & { _forceApprove?: boolean; sessionId?: string; _permissionScope?: string }
    const mode = getBackend().getExecMode()
    const force = args._forceApprove === true
    // Resolve session→project for scoped allowlist (same as orchestrator)
    let projForGate: string | null = null
    const sessForGate = typeof args['sessionId'] === 'string' ? (args['sessionId'] as string) : undefined
    if (sessForGate) {
      try {
        const hdr: any = await getBackend().ports.persistence.get(brand<'SessionId'>(sessForGate) as never).catch(() => null)
        projForGate = hdr?.projectId ?? null
      } catch {}
    }
    // Persist scoped approval for _forceApprove with scope (e.g., "always allow in conversation")
    try {
      const scope = (args as any)._permissionScope as string | undefined
      if (force && scope && scope !== 'once') {
        const { rememberApproval } = await import('../services/execPermissions')
        const clean: Record<string, unknown> = { ...(args as Record<string, unknown>) }
        delete (clean as any)._forceApprove; delete (clean as any)._permissionScope; delete (clean as any).sessionId
        rememberApproval(parsed.data.name, clean, scope as any, sessForGate, projForGate)
      }
    } catch {}
    const wsRoot = projForGate ? (getBackend().getProjectWorkspace(projForGate) ?? getBackend().getGlobalWorkspace()) : getBackend().getGlobalWorkspace()
    const verdict = gateDispatch(mode, parsed.data.name, args as Record<string, unknown>, sessForGate, projForGate, wsRoot)
    if (!verdict.allowed && !force) {
      return { ok: false, blocked: true, reason: verdict.reason, message: verdict.message, toolName: parsed.data.name, toolArgs: parsed.data.args }
    }
    const cleanArgs = { ...args }
    delete (cleanArgs as Record<string, unknown>)._forceApprove

    const sessId = typeof cleanArgs['sessionId'] === 'string' ? (cleanArgs['sessionId'] as string) : null
    if (sessId) {
      delete cleanArgs['sessionId']
      try {
        await getBackend().ports.persistence.appendEvent(brand<'SessionId'>(sessId), 'tool/call' as never, { name: parsed.data.name, args: cleanArgs } as never)
      } catch {}
    }

    const result = await getBackend().ports.tools.dispatch(
      parsed.data.name,
      cleanArgs
    )

    if (sessId) {
      try {
        await getBackend().ports.persistence.appendEvent(brand<'SessionId'>(sessId), 'tool/result' as never, { name: parsed.data.name, content: result } as never)
      } catch {}
    }

    return { ok: true, autoApproved: (verdict.allowed ? verdict.autoApproved : false) || force, result }
  })

  // ── Usage stats ──
  ipcMain.handle('usage:getTotal', async () => {
    const res = getBackend().ports.persistence.getTotalUsage()
    return res
  })

  ipcMain.handle('usage:getByModel', async () => {
    return getBackend().ports.persistence.getUsageByModel()
  })

  ipcMain.handle('usage:getRecent', async (_e, raw: unknown) => {
    const parsed = zUsageGetRecent.safeParse(raw ?? {})
    if (!parsed.success) throw new Error(`invalid usage:getRecent payload: ${parsed.error.message}`)
    const limit = parsed.data.limit ?? 20
    return getBackend().ports.persistence.getRecentUsage?.(limit) ?? []
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
    // Env is built ONCE per listing (one cached hardware read, one registry
    // read) so local filters stay synchronous and N+1-free in the catalog.
    const backend = getBackend()
    const hw = getCachedHardwareProfile()
    return listExplorerModelsCached({
      sortBy: parsed.data.sortBy ?? 'Recommended',
      query: scopeQuery,
      limit: parsed.data.limit ?? 30,
      format: parsed.data.format ?? 'all',
      quants: parsed.data.quants ?? [],
      params: parsed.data.params ?? 'all',
      licenses: parsed.data.licenses ?? [],
      capabilities: parsed.data.capabilities ?? [],
      gated: parsed.data.gated ?? 'all',
      downloaded: parsed.data.downloaded ?? 'all',
      compat: parsed.data.compat ?? 'all',
      cursor: parsed.data.cursor,
    }, undefined, { hw, installedByRepo: backend.listInstalledWeightKeys() })
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
    // Cached profile: the three IPCs fired per detail click share one read.
    const hw: HardwareInfo = getCachedHardwareProfile()
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
    const hw: HardwareInfo = getCachedHardwareProfile()
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
    // Shared 30s cache: the renderer's mount-time read warms the same
    // profile every listing/detail IPC reuses (one probe burst, not N).
    return getCachedHardwareProfile()
  })

  ipcMain.handle('runtime:detectExternal', async () => {
    return detectLocalRuntimes()
  })

  // ── Library (downloaded models) ──
  ipcMain.handle('library:listModels', async () => {
    return getBackend().scanLibrary()
  })

  ipcMain.handle('library:getDirectory', async () => {
    return { path: getBackend().getLibraryDir(), externalDirs: getBackend().getExternalModelDirs() }
  })
  ipcMain.handle('library:registerExternal', async (_e, raw: unknown) => {
    const parsed = zLibraryRegisterExternal.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid library:registerExternal payload: ${parsed.error.message}`)
    try {
      const dirs = getBackend().registerExternalModelDir(parsed.data.path)
      return { ok: true, path: parsed.data.path, externalDirs: dirs, libraryDir: getBackend().getLibraryDir() }
    } catch (e) { throw new Error(e instanceof Error ? e.message : 'could not register external directory') }
  })

  ipcMain.handle('library:revealInFolder', async (_e, raw: unknown) => {
    const p = typeof raw === 'string' ? raw : (raw as { path?: string })?.path
    if (!p) throw new Error('missing path')
    try { if (fs.statSync(p).isDirectory()) { shell.openPath(p); return { ok: true } } } catch {}
    shell.showItemInFolder(p)
    return { ok: true }
  })
  ipcMain.handle('library:detectLocations', async () => {
    const t0 = Date.now()
    const res = getBackend().detectModelLocations()
    console.info(`[ipc] library:detectLocations -> ${res.length} locations in ${Date.now() - t0}ms`, res.map((r) => `${r.kind}:${r.path} exists=${r.exists} count=${r.modelCount}`).join(' | '))
    return res
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

  ipcMain.handle('shell:showItemInFolder', async (_e, raw: unknown) => {
    const parsed = zShellShowItemInFolder.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid shell:showItemInFolder payload: ${parsed.error.message}`)
    try {
      shell.showItemInFolder(parsed.data.path)
      return { ok: true }
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'could not show file')
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

  ipcMain.handle('logs:getRecent', async (_e, raw: unknown) => {
    const kind = (raw as { kind?: string })?.kind ?? 'all'
    const tail = (file: string, n = 40): string[] => {
      try { const t = fs.readFileSync(file,'utf8').trim().split('\n').slice(-n); return t.filter(Boolean) } catch { return [] }
    }
    let dir: string; try { dir = path.join(getSovaraDataDir(undefined),'logs') } catch { dir = path.join(require('node:os').tmpdir(),'sovara-logs') }
    const out: Record<string,string[]> = {}
    if (kind==='all' || kind==='detection') out.detection = tail(path.join(dir,'detection.log'), 30)
    if (kind==='all' || kind==='runtime') out.runtime = tail(path.join(dir,'runtime.log'), 30)
    if (kind==='all' || kind==='app') out.app = tail(path.join(dir,'app.log'), 30)
    if (kind==='all' || kind==='chat') out.chat = tail(path.join(dir,'chat.log'), 50)
    void kind
    return out
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

  // ── Git status / diff for right-rail Files Changed (full sync, not synthetic) ──
  ipcMain.handle('git:status', async (_e, raw: unknown) => {
    const parsed = zGitStatus.safeParse(raw ?? {})
    const workspaceRoot = (parsed.success ? parsed.data.workspaceRoot : undefined) || (getBackend() as unknown as { getGlobalWorkspace?: () => string }).getGlobalWorkspace?.() || process.cwd()
    const cwd = path.resolve(workspaceRoot)
    try {
      const porcelain = execSync('git status --porcelain', { cwd, encoding: 'utf8', timeout: 4000 })
      const files = porcelain.split('\n').filter(Boolean).map((line) => {
        const staged = line[0] !== ' ' && line[0] !== '?' && line[0] !== '!'
        const code = line.slice(0, 2)
        const filePath = line.slice(3).trim()
        return { path: filePath, code, staged }
      })
      let statRaw = ''
      try { statRaw = execSync('git diff --stat --no-color; echo "---STAGED---"; git diff --cached --stat --no-color', { cwd, encoding: 'utf8', timeout: 4000 }) } catch { statRaw = '' }
      return { ok: true, cwd, files, statRaw }
    } catch (e) {
      return { ok: false, cwd, files: [], error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:diff', async (_e, raw: unknown) => {
    const parsed = zGitDiff.safeParse(raw ?? {})
    const { workspaceRoot, filePath } = parsed.success ? parsed.data : ({} as { workspaceRoot?: string; filePath?: string })
    const cwd = path.resolve(workspaceRoot || (getBackend() as unknown as { getGlobalWorkspace?: () => string }).getGlobalWorkspace?.() || process.cwd())
    const file = String(filePath || '').trim()
    if (!file) throw new Error('missing filePath')
    try {
      // Try unstaged diff first, then staged, then HEAD
      let diff = ''
      try { diff = execSync(`git diff --no-color -U3 -- "${file.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf8', timeout: 4000 }) } catch {}
      if (!diff) {
        try { diff = execSync(`git diff --cached --no-color -U3 -- "${file.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf8', timeout: 4000 }) } catch {}
      }
      if (!diff) {
        try { diff = execSync(`git show HEAD:"${file.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf8', timeout: 4000 }); diff = `--- a/${file}\n+++ b/${file}\n@@ -0,0 +1,${diff.split('\n').length} @@\n${diff.split('\n').map((l) => `+${l}`).join('\n')}` } catch {}
      }
      // Also get file contents for renderers
      let content = ''
      let oldContent: string | null = null
      try { content = fs.readFileSync(path.join(cwd, file), 'utf8') } catch {}
      try { oldContent = execSync(`git show HEAD:"${file.replace(/"/g, '\\"')}"`, { cwd, encoding: 'utf8', timeout: 4000 }) } catch { oldContent = null }
      const ext = path.extname(file).toLowerCase()
      const isMarkdown = ext === '.md' || file.toLowerCase().endsWith('readme.md')
      const isHtml = ext === '.html' || ext === '.htm'
      const isImage = ['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.ico'].includes(ext)
      let imageDataUrl: string | null = null
      if (isImage) {
        try {
          const buf = fs.readFileSync(path.join(cwd, file))
          const b64 = buf.toString('base64')
          const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png'
          imageDataUrl = `data:${mime};base64,${b64.slice(0, 600000)}`
        } catch {}
      }
      return { ok: true, cwd, file, diff, content: content.slice(0, 80000), oldContent: oldContent ? oldContent.slice(0, 80000) : null, isMarkdown, isHtml, isImage, imageDataUrl } as any
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('git:fileContent', async (_e, raw: unknown) => {
    const parsed = zGitFileContent.safeParse(raw ?? {})
    const { workspaceRoot, filePath } = parsed.success ? parsed.data : ({} as { workspaceRoot?: string; filePath?: string })
    const cwd = path.resolve(workspaceRoot || (getBackend() as unknown as { getGlobalWorkspace?: () => string }).getGlobalWorkspace?.() || process.cwd())
    const file = String(filePath || '').trim()
    try {
      const abs = path.join(cwd, file)
      const content = fs.readFileSync(abs, 'utf8')
      return { ok: true, content: content.slice(0, 100000) }
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
  })

  // ── Wiki Knowledge Graph — read wiki folder, build nodes/edges, sync with chat context (no hardcode) ──
  ipcMain.handle('wiki:buildGraph', async (_e, raw: unknown) => {
    const parsed = zWikiBuildGraph.safeParse(raw ?? {})
    const workspaceRoot = (parsed.success ? parsed.data.workspaceRoot : undefined) || (getBackend() as unknown as { getGlobalWorkspace?: () => string }).getGlobalWorkspace?.() || process.cwd()
    const tryDirs = [
      path.join(path.resolve(workspaceRoot), 'wiki'),
      path.join(getSovaraDataDir(undefined), 'wiki'),
      path.join(process.cwd(), 'test/llm_wiki/wiki'),
      path.join(path.resolve(workspaceRoot), '.llm-wiki/wiki'),
    ]
    let wikiDir: string | null = null
    for (const d of tryDirs) { try { if (fs.existsSync(d) && fs.statSync(d).isDirectory()) { wikiDir = d; break } } catch {} }
    if (!wikiDir) return { ok: true, nodes: [], edges: [], wikiDir: null, hint: 'No wiki folder found — create wiki/*.md with YAML frontmatter and [[wikilinks]]' }
    const nodes: Array<{ id: string; label: string; type: string; path: string; linkCount: number }> = []
    const edges: Array<{ source: string; target: string; weight: number }> = []
    const fileMap = new Map<string, string>() // lower label → id
    const scan = (dir: string, rel: string) => {
      let entries: fs.Dirent[] = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        const rpath = path.join(rel, ent.name).replace(/\\/g, '/')
        if (ent.isDirectory()) scan(full, rpath)
        else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
          let content = ''
          try { content = fs.readFileSync(full, 'utf8') } catch { continue }
          const fm = content.match(/^---\n([\s\S]*?)\n---/)
          let type = 'other'
          let title = ent.name.replace(/\.md$/i, '')
          if (rpath.includes('entities/')) type = 'entity'
          else if (rpath.includes('concepts/')) type = 'concept'
          else if (rpath.includes('sources/')) type = 'source'
          else if (rpath === 'index.md') type = 'other'
          else if (rpath === 'overview.md') type = 'overview'
          if (fm) {
            const mType = fm[1].match(/type:\s*(\w+)/i)
            if (mType) type = mType[1].toLowerCase()
            const mTitle = fm[1].match(/title:\s*\"?([^\n\"]+)\"?/i)
            if (mTitle) title = mTitle[1].trim()
          }
          const id = rpath
          nodes.push({ id, label: title, type, path: rpath, linkCount: 0 })
          fileMap.set(title.toLowerCase(), id)
          fileMap.set(ent.name.replace(/\.md$/i, '').toLowerCase(), id)
        }
      }
    }
    scan(wikiDir, '')
    // Second pass: wikilinks [[...]] → edges
    for (const n of nodes) {
      try {
        const full = path.join(wikiDir, n.path)
        const content = fs.readFileSync(full, 'utf8')
        const links = Array.from(content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)).map((m) => m[1].trim().toLowerCase())
        for (const link of links) {
          const targetId = fileMap.get(link) ?? nodes.find((x) => x.label.toLowerCase() === link || x.id.toLowerCase().includes(link))?.id
          if (targetId && targetId !== n.id) {
            edges.push({ source: n.id, target: targetId, weight: 1 })
            const src = nodes.find((x) => x.id === n.id); if (src) src.linkCount++
            const tgt = nodes.find((x) => x.id === targetId); if (tgt) tgt.linkCount++
          }
        }
      } catch {}
    }
    // Ensure at least Wiki Log / Wiki Index hubs if empty
    if (nodes.length === 0) return { ok: true, nodes: [], edges: [], wikiDir, hint: 'wiki folder empty — add markdown files to wiki/' }
    return { ok: true, nodes, edges, wikiDir }
  })
  // Persistent shell terminals (right-rail Terminal) — see services/ptyHost.
  registerTerminalIpc(ipcMain, (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      try {
        win.webContents.send(channel, payload)
      } catch {
        // ignore dead renderers
      }
    }
  })

  // ── Agent Studio (real backends for the Agents page) ──
  // StudioStore opens the shared app database (studio_* tables, created
  // idempotently) — the same file the persistence adapter uses.
  let studioStore: StudioStore | null = null
  const getStudioStore = (): StudioStore => {
    if (!studioStore) studioStore = new StudioStore()
    return studioStore
  }
  const studioId = (raw: unknown, channel: string): string => {
    const parsed = zStudioId.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid ${channel} payload: ${parsed.error.message}`)
    return parsed.data.id
  }
  const studioAgentId = (raw: unknown, channel: string): string => {
    const parsed = z.object({ agentId: z.string().min(1).max(128) }).strict().safeParse(raw)
    if (!parsed.success) throw new Error(`invalid ${channel} payload: ${parsed.error.message}`)
    return parsed.data.agentId
  }
  ipcMain.handle('agents:list', async () => getStudioStore().listAgents())
  ipcMain.handle('agents:create', async (_e, raw: unknown) => {
    const parsed = zStudioAgentCreate.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:create payload: ${parsed.error.message}`)
    return getStudioStore().createAgent(parsed.data)
  })
  ipcMain.handle('agents:update', async (_e, raw: unknown) => {
    const parsed = z.object({ id: z.string().min(1).max(128), patch: zStudioAgentUpdate }).strict().safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:update payload: ${parsed.error.message}`)
    return getStudioStore().updateAgent(parsed.data.id, parsed.data.patch)
  })
  ipcMain.handle('agents:duplicate', async (_e, raw: unknown) => getStudioStore().duplicateAgent(studioId(raw, 'agents:duplicate')))
  ipcMain.handle('agents:remove', async (_e, raw: unknown) => ({ ok: getStudioStore().removeAgent(studioId(raw, 'agents:remove')) }))
  ipcMain.handle('agents:archive', async (_e, raw: unknown) => {
    const parsed = z.object({ id: z.string().min(1).max(128), archived: z.boolean() }).strict().safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:archive payload: ${parsed.error.message}`)
    return getStudioStore().archiveAgent(parsed.data.id, parsed.data.archived)
  })
  ipcMain.handle('agents:knowledge:list', async (_e, raw: unknown) => getStudioStore().listKnowledge(studioAgentId(raw, 'agents:knowledge:list')))
  ipcMain.handle('agents:knowledge:add', async (_e, raw: unknown) => {
    const parsed = zStudioKnowledgeAdd.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:knowledge:add payload: ${parsed.error.message}`)
    return getStudioStore().addKnowledge(parsed.data.agentId, { name: parsed.data.name, sizeBytes: parsed.data.sizeBytes, mime: parsed.data.mime })
  })
  ipcMain.handle('agents:knowledge:remove', async (_e, raw: unknown) => ({ ok: getStudioStore().removeKnowledge(studioId(raw, 'agents:knowledge:remove')) }))
  ipcMain.handle('agents:memory:list', async (_e, raw: unknown) => getStudioStore().listMemories(studioAgentId(raw, 'agents:memory:list')))
  ipcMain.handle('agents:memory:add', async (_e, raw: unknown) => {
    const parsed = zStudioMemoryAdd.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:memory:add payload: ${parsed.error.message}`)
    return getStudioStore().addMemory(parsed.data.agentId, { content: parsed.data.content, source: parsed.data.source })
  })
  ipcMain.handle('agents:memory:remove', async (_e, raw: unknown) => ({ ok: getStudioStore().removeMemory(studioId(raw, 'agents:memory:remove')) }))
  ipcMain.handle('agents:workflows:list', async (_e, raw: unknown) => getStudioStore().listWorkflows(studioAgentId(raw, 'agents:workflows:list')))
  ipcMain.handle('agents:workflows:create', async (_e, raw: unknown) => {
    const parsed = zStudioWorkflowCreate.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:workflows:create payload: ${parsed.error.message}`)
    return getStudioStore().createWorkflow(parsed.data.agentId, { name: parsed.data.name, trigger: parsed.data.trigger, steps: parsed.data.steps })
  })
  ipcMain.handle('agents:workflows:update', async (_e, raw: unknown) => {
    const parsed = z.object({ id: z.string().min(1).max(128), patch: zStudioWorkflowUpdate }).strict().safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:workflows:update payload: ${parsed.error.message}`)
    return getStudioStore().updateWorkflow(parsed.data.id, parsed.data.patch)
  })
  ipcMain.handle('agents:workflows:remove', async (_e, raw: unknown) => ({ ok: getStudioStore().removeWorkflow(studioId(raw, 'agents:workflows:remove')) }))
  ipcMain.handle('agents:evals:list', async (_e, raw: unknown) => getStudioStore().listEvals(studioAgentId(raw, 'agents:evals:list')))
  ipcMain.handle('agents:evals:record', async (_e, raw: unknown) => {
    const parsed = zStudioEvalRecord.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:evals:record payload: ${parsed.error.message}`)
    return getStudioStore().recordEval(parsed.data.agentId, { prompt: parsed.data.prompt, status: parsed.data.status, latencyMs: parsed.data.latencyMs })
  })
  ipcMain.handle('agents:versions:list', async (_e, raw: unknown) => getStudioStore().listVersions(studioAgentId(raw, 'agents:versions:list')))
  ipcMain.handle('agents:versions:save', async (_e, raw: unknown) => {
    const parsed = zStudioVersionSave.safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:versions:save payload: ${parsed.error.message}`)
    return getStudioStore().saveVersion(parsed.data.agentId, parsed.data.note)
  })
  ipcMain.handle('agents:permissions:get', async (_e, raw: unknown) => getStudioStore().getPermissions(studioAgentId(raw, 'agents:permissions:get')))
  ipcMain.handle('agents:permissions:set', async (_e, raw: unknown) => {
    const parsed = z.object({ agentId: z.string().min(1).max(128), patch: zStudioPermissionsSet }).strict().safeParse(raw)
    if (!parsed.success) throw new Error(`invalid agents:permissions:set payload: ${parsed.error.message}`)
    return getStudioStore().setPermissions(parsed.data.agentId, parsed.data.patch)
  })
}
