/**
 * Internal-server composition root.
 *
 * Owns the single `AppBackend` instance reused from the proven Electron-main
 * implementation (`apps/desktop/src/main/backend/AppBackend.ts`) — the ONE
 * source of truth for persistence, model runtime, inference, agents, skills,
 * MCP, validation, and downloads. No logic is duplicated here; this module
 * only adapts lifecycle (lazy singleton + sidecar init + SSE emit wiring)
 * from Electron's `index.ts` / `backendComposition.ts` / `handlers.ts`.
 */

import 'server-only'
import type { AppBackend } from '@sovara-main/backend/AppBackend'
import { broadcastChat, broadcastDownload } from './events'

let backend: AppBackend | null = null
let sidecarsStarted = false

function startSidecars(): void {
  if (sidecarsStarted) return
  sidecarsStarted = true
  // Fire-and-forget, mirroring Electron's index.ts startup. Sidecars are
  // best-effort: the server must boot even when Python/voice/crawl fail.
  void (async () => {
    try {
      const [{ initPythonEnv }, { initVoiceServer }, { initCrawlServer }] = await Promise.all([
        import('@sovara-main/services/pythonEnv'),
        import('@sovara-main/services/voiceServer'),
        import('@sovara-main/services/crawlServer'),
      ])
      try {
        initPythonEnv()
      } catch {}
      try {
        initVoiceServer()
      } catch {}
      try {
        initCrawlServer()
      } catch {}
    } catch {}
  })()
}

export async function getBackend(): Promise<AppBackend> {
  if (!backend) {
    const { AppBackend: Backend } = await import('@sovara-main/backend/AppBackend')
    // SOVARA_DATA_DIR override keeps dev/test data isolated (see paths.ts).
    backend = new Backend(process.env['SOVARA_DATA_DIR'] || undefined, broadcastChat)
    try {
      backend.chat.setEmit(broadcastChat)
    } catch {}
    try {
      backend.orchestrator.setEmit(broadcastChat)
    } catch {}
    startSidecars()
  }
  return backend
}

/** Download emit facet: forwards progress to SSE subscribers. */
export function downloadEmit(event: {
  modelId: string
  rfilename: string
  state: string
  receivedBytes: number
  totalBytes: number | null
  error?: string
  speedBps?: number
  etaSeconds?: number
}): void {
  broadcastDownload(event)
}
