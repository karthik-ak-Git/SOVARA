/**
 * In-process event hub for the internal server.
 *
 * Replaces Electron's `BrowserWindow.webContents.send(...)` broadcast used in
 * `apps/desktop/src/main/ipc/handlers.ts`:
 *   - `events:session`   → chat stream pushes (transient deltas, never persisted)
 *   - `events:download`  → model download progress
 *   - `events:instances` → runtime instance status/metrics
 *
 * API routes subscribe per-request and forward matching events as SSE.
 * Single Node process = single hub instance (module-scoped singleton).
 */

import type { ChatStreamEvent } from '@shared/types/chat'

export type HubChannel = 'session' | 'download' | 'instances'

export interface DownloadBroadcast {
  modelId: string
  rfilename: string
  state: string
  receivedBytes: number
  totalBytes: number | null
  error?: string
  speedBps?: number
  etaSeconds?: number
}

export interface InstanceBroadcast {
  type: 'status-changed' | 'metrics-updated' | 'removed'
  instanceId: string
  instance?: unknown
  metrics?: unknown
}

type Listener = (payload: unknown) => void

const listeners = new Map<HubChannel, Set<Listener>>()

function setFor(channel: HubChannel): Set<Listener> {
  let set = listeners.get(channel)
  if (!set) {
    set = new Set()
    listeners.set(channel, set)
  }
  return set
}

export function publish(channel: HubChannel, payload: unknown): void {
  const set = listeners.get(channel)
  if (!set || set.size === 0) return
  for (const fn of [...set]) {
    try {
      fn(payload)
    } catch {
      // A dead SSE connection must never break generation.
    }
  }
}

export function subscribe(channel: HubChannel, fn: Listener): () => void {
  setFor(channel).add(fn)
  return () => {
    setFor(channel).delete(fn)
  }
}

/** Emit facet wired into AppBackend/ChatService/AgentOrchestrator. */
export function broadcastChat(event: ChatStreamEvent): void {
  publish('session', event)
}

/** Emit facet wired into model download progress callbacks. */
export function broadcastDownload(event: DownloadBroadcast): void {
  publish('download', event)
}

/** Emit facet for runtime instance changes (polled/pushed by routes). */
export function broadcastInstance(event: InstanceBroadcast): void {
  publish('instances', event)
}

/**
 * Subscribe to one session's chat stream only. Resolves the unsubscribe fn.
 * Mirrors the renderer's `onSessionEvents` filter (`ev.sessionId === selected`).
 */
export function subscribeSession(
  sessionId: string,
  fn: (event: ChatStreamEvent) => void
): () => void {
  return subscribe('session', (payload) => {
    const ev = payload as ChatStreamEvent
    if (ev && ev.sessionId === sessionId) fn(ev)
  })
}
