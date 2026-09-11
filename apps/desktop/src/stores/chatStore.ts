/**
 * Zustand chatStore — focused UI state for the Chat workspace.
 * Calls chatApi (typed IPC) for persistence/inference, never touches fs/electron directly.
 * Derives visible messages from session events via deriveMessages().
 */
import { create } from 'zustand'
import type { ActiveModelState } from '@shared/types/models'
import type { SessionHeaderView, SessionEventView } from '../features/chat/lib/chatApi'
import {
  fetchSessions,
  fetchSessionEvents,
  createChatSession,
  sendMessage,
  cancelGeneration,
  regenerateResponse,
  editAndResend,
  fetchActiveModel,
} from '../features/chat/lib/chatApi'
import { onSessionEvents } from '@/lib/client/api'
import type { ChatStreamEvent } from '@shared/types/chat'
import type { TaskKind } from '@shared/types/task'

export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'cancelling' | 'error'

export interface AgentExecutionView {
  taskKind: TaskKind | null
  phase: 'idle' | 'planning' | 'selecting' | 'loading' | 'ready' | 'streaming' | 'tool' | 'done' | 'error' | 'cancelled'
  modelId?: string
  runtimeId?: string
  detail?: string
  stepIndex?: number
  toolName?: string
  vramUsedMB?: number
  vramTotalMB?: number
  error?: string
}

export interface ChatError {
  message: string
  code?: string
}

interface ChatStore {
  // Data
  sessions: SessionHeaderView[]
  activeSessionId: string | null
  events: SessionEventView[]
  streamingText: string
  streamingReasoning: string
  status: ChatStatus
  error: string | null
  composerText: string
  model: ActiveModelState
  // Derived convenience
  selectedModelId?: string
  // Agent execution surface — honest backend states, never faked
  execution: AgentExecutionView

  // Actions
  setActiveSession: (id: string | null) => void
  setComposerText: (text: string) => void
  loadSessions: () => Promise<SessionHeaderView[]>
  loadEvents: (sessionId: string) => Promise<void>
  createSession: (projectId?: string | null) => Promise<SessionHeaderView | void>
  switchSession: (id: string) => Promise<void>
  sendMessage: (content: string, opts?: { webSearch?: boolean; reasoning?: boolean }) => Promise<void>
  cancelGeneration: () => Promise<void>
  regenerate: () => Promise<void>
  editAndResend: (content: string, opts?: { webSearch?: boolean; reasoning?: boolean }) => Promise<void>
  dismissError: () => void
  refreshModelStatus: () => Promise<void>
  clearSelection: () => void
  // internal stream handler
  _handleStreamEvent: (ev: ChatStreamEvent) => void
}

let streamDispose: (() => void) | null = null
let loadSeq = 0

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  events: [],
  streamingText: '',
  streamingReasoning: '',
  status: 'idle',
  error: null,
  composerText: '',
  model: { selection: null, available: false },
  execution: { taskKind: null, phase: 'idle' },

  setActiveSession: (id) => set({ activeSessionId: id }),

  setComposerText: (text) => set({ composerText: text.slice(0, 32_000) }),

  loadSessions: async () => {
    const list = await fetchSessions()
    set({ sessions: list })
    return list
  },

  loadEvents: async (sessionId) => {
    const seq = ++loadSeq
    const evts = await fetchSessionEvents(sessionId)
    if (loadSeq === seq) set({ events: evts })
  },

  createSession: async (projectId) => {
    const { sessions, status } = get()
    if (status === 'streaming' || status === 'sending') return
    set({ status: 'sending', error: null })
    try {
      const scoped = sessions.filter((s) => (s.projectId ?? null) === (projectId ?? null)).length
      const title = `Session ${scoped + 1}`
      const h = await createChatSession(title, projectId ?? null)
      const list = await fetchSessions()
      set({ sessions: list, activeSessionId: h.id, events: [], streamingText: '', streamingReasoning: '', execution: { taskKind: null, phase: 'idle' }, status: 'idle' })
      await get().loadEvents(h.id)
      return h
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), status: 'error' })
    } finally {
      if (get().status === 'sending') set({ status: 'idle' })
    }
  },

  switchSession: async (id) => {
    if (!id) return
    const seq = ++loadSeq
    set({ activeSessionId: id, error: null, events: [], streamingText: '', streamingReasoning: '', execution: { taskKind: null, phase: 'idle' }, status: 'idle' })
    try {
      const evts = await fetchSessionEvents(id)
      if (loadSeq === seq) set({ events: evts })
    } catch (e) {
      if (loadSeq === seq) set({ error: e instanceof Error ? e.message : String(e), status: 'error' })
    }
  },

  sendMessage: async (content, opts) => {
    const { activeSessionId, status } = get()
    const text = content.trim()
    if (!activeSessionId || !text || status === 'streaming' || status === 'sending') return
    set({ status: 'sending', streamingText: '', streamingReasoning: '', error: null, execution: { taskKind: null, phase: 'planning' } })
    try {
      // Optimistic streaming phase — real state now driven by orchestrator events
      set({ status: 'streaming' })
      await sendMessage(activeSessionId, text, opts)
      set({ composerText: '' })
      const seq = ++loadSeq
      const evts = await fetchSessionEvents(activeSessionId)
      if (loadSeq === seq) set({ events: evts, streamingText: '', streamingReasoning: '', execution: { taskKind: null, phase: 'idle' }, status: 'idle' })
      const list = await fetchSessions()
      set({ sessions: list })
    } catch (e) {
      set({ streamingText: '', streamingReasoning: '', error: e instanceof Error ? e.message : String(e), status: 'error', execution: { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) } })
    } finally {
      if (get().status === 'streaming' || get().status === 'sending') set({ status: 'idle' })
    }
  },

  cancelGeneration: async () => {
    const { activeSessionId, status } = get()
    if (!activeSessionId || (status !== 'streaming' && status !== 'sending')) return
    set({ status: 'cancelling' })
    try {
      await cancelGeneration(activeSessionId)
      // stream event will clear streamingText and set idle; keep cancelling until then
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), status: 'error' })
    }
  },

  regenerate: async () => {
    const { activeSessionId, status } = get()
    if (!activeSessionId || status === 'streaming' || status === 'sending') return
    set({ status: 'sending', streamingText: '', streamingReasoning: '', error: null, execution: { taskKind: null, phase: 'planning' } })
    try {
      set({ status: 'streaming' })
      await regenerateResponse(activeSessionId)
      const seq = ++loadSeq
      const evts = await fetchSessionEvents(activeSessionId)
      if (loadSeq === seq) set({ events: evts, streamingText: '', streamingReasoning: '', execution: { taskKind: null, phase: 'idle' }, status: 'idle' })
      const list = await fetchSessions()
      set({ sessions: list })
    } catch (e) {
      set({ streamingText: '', streamingReasoning: '', error: e instanceof Error ? e.message : String(e), status: 'error', execution: { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) } })
    } finally {
      if (get().status === 'streaming' || get().status === 'sending') set({ status: 'idle' })
    }
  },

  editAndResend: async (content, opts) => {
    const { activeSessionId, status } = get()
    const text = content.trim()
    if (!activeSessionId || !text || status === 'streaming' || status === 'sending') return
    set({ status: 'sending', streamingText: '', streamingReasoning: '', error: null, execution: { taskKind: null, phase: 'planning' } })
    try {
      set({ status: 'streaming' })
      await editAndResend(activeSessionId, text, opts)
      set({ composerText: '' })
      const seq = ++loadSeq
      const evts = await fetchSessionEvents(activeSessionId)
      if (loadSeq === seq) set({ events: evts, streamingText: '', streamingReasoning: '', execution: { taskKind: null, phase: 'idle' }, status: 'idle' })
      const list = await fetchSessions()
      set({ sessions: list })
    } catch (e) {
      set({ streamingText: '', streamingReasoning: '', error: e instanceof Error ? e.message : String(e), status: 'error', execution: { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) } })
    } finally {
      if (get().status === 'streaming' || get().status === 'sending') set({ status: 'idle' })
    }
  },

  dismissError: () => set({ error: null, status: 'idle' }),

  refreshModelStatus: async () => {
    try {
      const m = await fetchActiveModel()
      set({ model: m, selectedModelId: m.selection?.modelId })
    } catch {
      // advisory
    }
  },

  clearSelection: () => {
    loadSeq += 1
    set({ activeSessionId: null, events: [], streamingText: '', streamingReasoning: '', execution: { taskKind: null, phase: 'idle' }, status: 'idle', error: null })
  },

  _handleStreamEvent: (ev) => {
    const { activeSessionId } = get()
    const isSelected = ev.sessionId === activeSessionId
    // Agent execution events — honest backend states, never faked in UI
    if (ev.kind === 'task:start' || ev.kind === 'task:planning') {
      if (!isSelected) return
      set({ execution: { taskKind: (ev.taskKind as TaskKind) ?? null, phase: 'planning', detail: ev.detail }, status: 'streaming' as ChatStatus })
      return
    }
    if (ev.kind === 'model:selecting') {
      if (!isSelected) return
      set({ execution: { taskKind: (ev.taskKind as TaskKind) ?? get().execution.taskKind, phase: 'selecting', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail }, status: 'streaming' as ChatStatus })
      return
    }
    if (ev.kind === 'model:loading') {
      if (!isSelected) return
      set({ execution: { taskKind: (ev.taskKind as TaskKind) ?? get().execution.taskKind, phase: 'loading', modelId: ev.modelId, runtimeId: ev.runtimeId, vramUsedMB: ev.vramUsedMB, vramTotalMB: ev.vramTotalMB, detail: ev.detail }, status: 'streaming' as ChatStatus })
      return
    }
    if (ev.kind === 'model:ready') {
      if (!isSelected) return
      set({ execution: { taskKind: (ev.taskKind as TaskKind) ?? get().execution.taskKind, phase: 'ready', modelId: ev.modelId, runtimeId: ev.runtimeId, vramUsedMB: ev.vramUsedMB, vramTotalMB: ev.vramTotalMB, detail: ev.detail }, status: 'streaming' as ChatStatus })
      // refresh model pill when orchestrator switches
      void fetchActiveModel().then((m) => set({ model: m, selectedModelId: m.selection?.modelId })).catch(() => {})
      return
    }
    if (ev.kind === 'model:failed') {
      if (!isSelected) return
      set({ execution: { taskKind: (ev.taskKind as TaskKind) ?? get().execution.taskKind, phase: 'error', modelId: ev.modelId, runtimeId: ev.runtimeId, error: ev.error ?? ev.detail, detail: ev.detail }, error: ev.error ?? ev.detail ?? 'Model could not be loaded', status: 'error' as ChatStatus })
      return
    }
    if (ev.kind === 'step:start') {
      if (!isSelected) return
      set({ execution: { taskKind: (ev.taskKind as TaskKind) ?? get().execution.taskKind, phase: 'streaming', stepIndex: ev.stepIndex, modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail }, status: 'streaming' as ChatStatus })
      return
    }
    if (ev.kind === 'step:end') {
      if (!isSelected) return
      // keep streaming phase until final done
      set((s) => ({ execution: { ...s.execution, detail: ev.detail } }))
      return
    }
    if (ev.kind === 'tool:start' || ev.kind === 'tool:delta' || ev.kind === 'tool:end') {
      if (!isSelected) return
      set({ execution: { taskKind: get().execution.taskKind, phase: 'tool', toolName: ev.toolName, detail: ev.detail ?? ev.text, stepIndex: ev.stepIndex }, status: 'streaming' as ChatStatus })
      return
    }
    if (ev.kind === 'task:complete') {
      if (!isSelected) return
      set((s) => ({ execution: { taskKind: (ev.taskKind as TaskKind) ?? s.execution.taskKind, phase: 'done', modelId: ev.modelId ?? s.execution.modelId, runtimeId: ev.runtimeId ?? s.execution.runtimeId, detail: ev.detail, stepIndex: ev.stepIndex } }))
      return
    }
    if (ev.kind === 'task:error') {
      if (!isSelected) return
      set({ execution: { taskKind: (ev.taskKind as TaskKind) ?? get().execution.taskKind, phase: 'error', error: ev.error ?? ev.detail, detail: ev.detail, modelId: ev.modelId, runtimeId: ev.runtimeId }, error: ev.error ?? ev.detail ?? 'Task failed', status: 'error' as ChatStatus })
      return
    }
    if (ev.kind === 'task:cancelled') {
      if (!isSelected) return
      set({ execution: { taskKind: (ev.taskKind as TaskKind) ?? get().execution.taskKind, phase: 'cancelled', detail: ev.detail }, status: 'idle' as ChatStatus })
      return
    }
    if (ev.kind === 'reasoning-delta' && ev.text) {
      if (!isSelected) return
      set((s) => ({ streamingReasoning: s.streamingReasoning + (ev.text ?? ''), status: 'streaming' as ChatStatus }))
      return
    }
    if (ev.kind === 'assistant-delta' && ev.text) {
      if (!isSelected) return
      set((s) => ({ streamingText: s.streamingText + (ev.text ?? ''), status: 'streaming' as ChatStatus, execution: { ...s.execution, phase: 'streaming' } }))
    } else if (ev.kind === 'assistant-done' || ev.kind === 'assistant-cancelled') {
      if (isSelected) {
        set({ streamingText: '', streamingReasoning: '', status: 'idle', execution: { taskKind: null, phase: 'idle' } })
        const seq = ++loadSeq
        void fetchSessionEvents(ev.sessionId).then((evts) => {
          if (loadSeq === seq) set({ events: evts })
        })
        void fetchSessions().then((list) => set({ sessions: list }))
        void fetchActiveModel().then((m) => set({ model: m, selectedModelId: m.selection?.modelId })).catch(() => {})
      } else {
        void fetchSessions().then((list) => set({ sessions: list }))
      }
    } else if (ev.kind === 'assistant-error') {
      if (!isSelected) return
      set({ streamingText: '', streamingReasoning: '', error: ev.error ?? 'The local model interrupted the reply.', status: 'error', execution: { taskKind: null, phase: 'error', error: ev.error } })
    }
  },
}))

// Global stream subscription — single instance for the store lifecycle.
// Transport is SSE (/api/chat/stream); the internal server is always up.
export function initChatStoreStream(): () => void {
  if (streamDispose) return streamDispose
  if (typeof window === 'undefined') return () => {}
  streamDispose = onSessionEvents((ev) => {
    if (!ev) return
    useChatStore.getState()._handleStreamEvent(ev as ChatStreamEvent)
  })
  return streamDispose
}

// Auto-init when imported in the browser.
if (typeof window !== 'undefined') {
  // defer to next tick so the app shell mounts first
  setTimeout(() => {
    try { initChatStoreStream() } catch { /* noop */ }
  }, 0)
}
