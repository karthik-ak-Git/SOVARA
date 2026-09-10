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
import { onSessionEvents } from '../lib/ipc'
import type { ChatStreamEvent } from '@shared/types/chat'

export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'cancelling' | 'error'

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
  status: ChatStatus
  error: string | null
  composerText: string
  model: ActiveModelState
  // Derived convenience
  selectedModelId?: string

  // Actions
  setActiveSession: (id: string | null) => void
  setComposerText: (text: string) => void
  loadSessions: () => Promise<SessionHeaderView[]>
  loadEvents: (sessionId: string) => Promise<void>
  createSession: (projectId?: string | null) => Promise<SessionHeaderView | void>
  switchSession: (id: string) => Promise<void>
  sendMessage: (content: string, opts?: { webSearch?: boolean }) => Promise<void>
  cancelGeneration: () => Promise<void>
  regenerate: () => Promise<void>
  editAndResend: (content: string, opts?: { webSearch?: boolean }) => Promise<void>
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
  status: 'idle',
  error: null,
  composerText: '',
  model: { selection: null, available: false },

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
      set({ sessions: list, activeSessionId: h.id, events: [], streamingText: '', status: 'idle' })
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
    set({ activeSessionId: id, error: null, events: [], streamingText: '', status: 'idle' })
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
    set({ status: 'sending', streamingText: '', error: null })
    try {
      // Optimistic streaming phase
      set({ status: 'streaming' })
      await sendMessage(activeSessionId, text, opts)
      set({ composerText: '' })
      const seq = ++loadSeq
      const evts = await fetchSessionEvents(activeSessionId)
      if (loadSeq === seq) set({ events: evts, streamingText: '', status: 'idle' })
      const list = await fetchSessions()
      set({ sessions: list })
    } catch (e) {
      set({ streamingText: '', error: e instanceof Error ? e.message : String(e), status: 'error' })
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
    set({ status: 'sending', streamingText: '', error: null })
    try {
      set({ status: 'streaming' })
      await regenerateResponse(activeSessionId)
      const seq = ++loadSeq
      const evts = await fetchSessionEvents(activeSessionId)
      if (loadSeq === seq) set({ events: evts, streamingText: '', status: 'idle' })
      const list = await fetchSessions()
      set({ sessions: list })
    } catch (e) {
      set({ streamingText: '', error: e instanceof Error ? e.message : String(e), status: 'error' })
    } finally {
      if (get().status === 'streaming' || get().status === 'sending') set({ status: 'idle' })
    }
  },

  editAndResend: async (content, opts) => {
    const { activeSessionId, status } = get()
    const text = content.trim()
    if (!activeSessionId || !text || status === 'streaming' || status === 'sending') return
    set({ status: 'sending', streamingText: '', error: null })
    try {
      set({ status: 'streaming' })
      await editAndResend(activeSessionId, text, opts)
      set({ composerText: '' })
      const seq = ++loadSeq
      const evts = await fetchSessionEvents(activeSessionId)
      if (loadSeq === seq) set({ events: evts, streamingText: '', status: 'idle' })
      const list = await fetchSessions()
      set({ sessions: list })
    } catch (e) {
      set({ streamingText: '', error: e instanceof Error ? e.message : String(e), status: 'error' })
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
    set({ activeSessionId: null, events: [], streamingText: '', status: 'idle', error: null })
  },

  _handleStreamEvent: (ev) => {
    const { activeSessionId } = get()
    const isSelected = ev.sessionId === activeSessionId
    if (ev.kind === 'assistant-delta' && ev.text) {
      if (!isSelected) return
      set((s) => ({ streamingText: s.streamingText + (ev.text ?? ''), status: 'streaming' as ChatStatus }))
    } else if (ev.kind === 'assistant-done' || ev.kind === 'assistant-cancelled') {
      if (isSelected) {
        set({ streamingText: '', status: 'idle' })
        const seq = ++loadSeq
        void fetchSessionEvents(ev.sessionId).then((evts) => {
          if (loadSeq === seq) set({ events: evts })
        })
        void fetchSessions().then((list) => set({ sessions: list }))
      } else {
        void fetchSessions().then((list) => set({ sessions: list }))
      }
    } else if (ev.kind === 'assistant-error') {
      if (!isSelected) return
      set({ streamingText: '', error: ev.error ?? 'The local model interrupted the reply.', status: 'error' })
    }
  },
}))

// Global stream subscription — single instance for the store lifecycle
export function initChatStoreStream(): () => void {
  if (streamDispose) return streamDispose
  if (typeof window === 'undefined' || !window.sovara) return () => {}
  streamDispose = onSessionEvents((ev) => {
    if (!ev) return
    useChatStore.getState()._handleStreamEvent(ev as ChatStreamEvent)
  })
  return streamDispose
}

// Auto-init when imported in renderer (no-op in tests without window.sovara)
if (typeof window !== 'undefined') {
  // defer to next tick so window.sovara is ready after preload
  setTimeout(() => {
    try { initChatStoreStream() } catch { /* noop */ }
  }, 0)
}
