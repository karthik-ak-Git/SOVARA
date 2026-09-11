import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelChatMessage,
  createSession,
  deleteSession,
  editAndResendChatMessage,
  getActiveModel,
  getAppSettings,
  getSessionEvents,
  listSessions,
  onSessionEvents,
  regenerateChatMessage,
  renameSession,
  sendChatMessage,
  type SessionEventView,
  type SessionHeaderView,
} from '@/lib/client/api'
import type { ActiveModelState } from '@shared/types/models'

/**
 * System notification when a session finishes while it isn't focused —
 * window hidden/minimized OR a different session is being viewed. Honors
 * Settings → General → "Session completion notifications". Permission is
 * requested lazily, only when a notification is actually due.
 */
async function maybeNotifyCompletion(sessionTitle: string, sessionFocused: boolean): Promise<void> {
  if (typeof Notification === 'undefined') return
  if (typeof document !== 'undefined' && !document.hidden && sessionFocused) return
  let enabled = true
  try {
    enabled = (await getAppSettings()).sessionNotifications
  } catch {
    // settings unavailable — default to notifying rather than staying silent
  }
  if (!enabled) return
  try {
    if (Notification.permission === 'default') await Notification.requestPermission()
    if (Notification.permission !== 'granted') return
    new Notification('Sovara — reply ready', { body: sessionTitle || 'A session finished.' })
  } catch {
    // notifications are best-effort
  }
}

/**
 * Commit 7 — real local inference flow.
 * - Deltas stream in on `events:session` into transient `streamingText`
 *   (never persisted); the durable timeline still reconstructs from events.
 * - Cancel aborts the in-flight request; the log keeps a cancelled marker.
 * - Model status is fetched on mount + on demand (no polling, no keystroke
 *   probing). Duplicate submission is blocked while a send is in flight.
 */
export type ChatPhase = 'idle' | 'streaming' | 'planning' | 'loading' | 'tool'

export interface AgentExecutionState {
  taskKind: import('@shared/types/task').TaskKind | null
  phase: ChatPhase | 'selecting' | 'ready' | 'error' | 'cancelled' | 'done'
  modelId?: string
  runtimeId?: string
  detail?: string
  vramUsedMB?: number
  vramTotalMB?: number
  toolName?: string
  error?: string
  stepIndex?: number
}

export function useChatSession() {
  const [sessions, setSessions] = useState<SessionHeaderView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionEventView[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<ChatPhase>('idle')
  const [execution, setExecution] = useState<AgentExecutionState>({ taskKind: null, phase: 'idle' })
  const [streamingText, setStreamingText] = useState('')
  const [streamingReasoning, setStreamingReasoning] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<ActiveModelState>({ selection: null, available: false })
  const loadSeq = useRef(0)
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedId

  const refreshSessions = useCallback(async (): Promise<SessionHeaderView[]> => {
    const list = await listSessions()
    setSessions(list)
    return list
  }, [])

  const refreshEvents = useCallback(async (id: string, seq: number): Promise<void> => {
    const evts = await getSessionEvents(id)
    if (loadSeq.current === seq) setEvents(evts)
  }, [])

  const refreshModelStatus = useCallback(async (): Promise<void> => {
    try {
      setModel(await getActiveModel())
    } catch {
      // Model status is advisory; chat errors surface on send.
    }
  }, [])

  // Initial load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await refreshSessions()
        if (!cancelled && list.length > 0 && !selectedRef.current) {
          const first = list[0]
          if (first) {
            setSelectedId(first.id)
            const seq = ++loadSeq.current
            await refreshEvents(first.id, seq)
          }
        }
        if (!cancelled) await refreshModelStatus()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stream subscription: deltas for the selected session only, but
  // completion of ANY session refreshes + may notify (background sessions
  // finish while another project is focused — the notify setting's case).
  // Transport is SSE (/api/chat/stream); the internal server is always up.
  useEffect(() => {
    const dispose = onSessionEvents((ev) => {
      if (!ev) return
      const isSelected = ev.sessionId === selectedRef.current
      // Agent orchestration — honest states, never faked in UI
      if (ev.kind === 'task:start' || ev.kind === 'task:planning') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'planning', detail: ev.detail })
        setPhase('planning')
        return
      }
      if (ev.kind === 'model:selecting') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'selecting', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail })
        setPhase('planning')
        return
      }
      if (ev.kind === 'model:loading') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'loading', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail, vramUsedMB: ev.vramUsedMB, vramTotalMB: ev.vramTotalMB })
        setPhase('loading')
        return
      }
      if (ev.kind === 'model:ready') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'ready', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail, vramUsedMB: ev.vramUsedMB, vramTotalMB: ev.vramTotalMB })
        setPhase('streaming')
        void refreshModelStatus()
        return
      }
      if (ev.kind === 'model:failed') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'error', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail, error: ev.error })
        setError(ev.error ?? ev.detail ?? 'Model could not be loaded')
        setPhase('idle')
        return
      }
      if (ev.kind === 'step:start') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'streaming', stepIndex: ev.stepIndex, modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail })
        setPhase('streaming')
        return
      }
      if (ev.kind === 'step:end') {
        if (!isSelected) return
        setExecution((prev) => ({ ...prev, detail: ev.detail }))
        return
      }
      if (ev.kind === 'tool:start' || ev.kind === 'tool:delta' || ev.kind === 'tool:end') {
        if (!isSelected) return
        setExecution({ taskKind: null, phase: 'tool', toolName: ev.toolName, detail: ev.detail ?? ev.text, stepIndex: ev.stepIndex })
        setPhase('tool')
        return
      }
      if (ev.kind === 'task:complete') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'done', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail, stepIndex: ev.stepIndex })
        return
      }
      if (ev.kind === 'task:error') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'error', error: ev.error ?? ev.detail, detail: ev.detail, modelId: ev.modelId, runtimeId: ev.runtimeId })
        setError(ev.error ?? ev.detail ?? 'Task failed')
        setPhase('idle')
        return
      }
      if (ev.kind === 'task:cancelled') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'cancelled', detail: ev.detail })
        setStreamingText('')
        setStreamingReasoning('')
        setPhase('idle')
        const seq = ++loadSeq.current
        void refreshEvents(ev.sessionId, seq)
        return
      }
      if (ev.kind === 'reasoning-delta' && ev.text) {
        if (!isSelected) return
        setPhase('streaming')
        setStreamingReasoning((t) => t + (ev.text ?? ''))
      } else if (ev.kind === 'assistant-delta' && ev.text) {
        if (!isSelected) return
        setPhase('streaming')
        setStreamingText((t) => t + (ev.text ?? ''))
        setExecution((prev) => (prev.phase === 'loading' || prev.phase === 'planning' ? { ...prev, phase: 'streaming' } : prev))
      } else if (ev.kind === 'assistant-done' || ev.kind === 'assistant-cancelled') {
        if (isSelected) {
          setStreamingText('')
          setStreamingReasoning('')
          setPhase('idle')
          setExecution({ taskKind: null, phase: 'idle' })
          const seq = ++loadSeq.current
          void refreshEvents(ev.sessionId, seq).then(() => refreshSessions()).then((list) => {
            if (ev.kind === 'assistant-done') {
              const title = list.find((s) => s.id === ev.sessionId)?.title ?? ''
              void maybeNotifyCompletion(title, true)
            }
          })
        } else {
          // Background session: refresh the list so the sidebar updates,
          // then notify (not focused by definition).
          void refreshSessions().then((list) => {
            if (ev.kind === 'assistant-done') {
              const title = list.find((s) => s.id === ev.sessionId)?.title ?? ''
              void maybeNotifyCompletion(title, false)
            }
          })
        }
      } else if (ev.kind === 'assistant-error') {
        if (!isSelected) return
        setStreamingText('')
        setStreamingReasoning('')
        setPhase('idle')
        setExecution((prev) => ({ ...prev, phase: 'error', error: ev.error }))
        setError(ev.error ?? 'The local model interrupted the reply.')
      }
    })
    return dispose
  }, [refreshEvents, refreshSessions, refreshModelStatus])

  // Switch conversation: reconstruct from durable events.
  const switchSession = useCallback(
    async (id: string): Promise<void> => {
      if (!id) return
      const seq = ++loadSeq.current
      setSelectedId(id)
      setError(null)
      setEvents([])
      setStreamingText('')
      setStreamingReasoning('')
      setExecution({ taskKind: null, phase: 'idle' })
      setPhase('idle')
      try {
        await refreshEvents(id, seq)
      } catch (e) {
        if (loadSeq.current === seq) setError(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshEvents]
  )

  const globalSessions = sessions.filter((s) => !s.projectId)
  const projectSessions = useCallback(
    (projectId: string): SessionHeaderView[] => sessions.filter((s) => s.projectId === projectId),
    [sessions]
  )

  const handleCreate = useCallback(async (projectId?: string | null): Promise<SessionHeaderView | void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const scoped = projectSessions(projectId ?? '').length
      const base = projectId ? scoped + 1 : sessions.filter((s) => !s.projectId).length + 1
      const h = await createSession(`Session ${base}`, projectId ?? null)
      await refreshSessions()
      await switchSession(h.id)
      return h
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, sessions, projectSessions, refreshSessions, switchSession])

  const handleRename = useCallback(async (id: string, title: string): Promise<void> => {
    const clean = title.trim()
    if (!clean) return
    try {
      await renameSession(id, clean)
      await refreshSessions()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [refreshSessions])

  const handleDelete = useCallback(async (id: string): Promise<void> => {
    try {
      await deleteSession(id)
      const remaining = await refreshSessions()
      if (selectedRef.current === id) {
        // Select newest remaining in the same scope, else clear.
        const deleted = sessions.find((s) => s.id === id)
        const scope = remaining.filter((s) => (s.projectId ?? null) === (deleted?.projectId ?? null))
        if (scope[0]) {
          await switchSession(scope[0].id)
        } else {
          setSelectedId(null)
          setEvents([])
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [refreshSessions, sessions, switchSession])

  const handleSend = useCallback(
    async (content: string, opts?: { webSearch?: boolean; reasoning?: boolean }): Promise<void> => {
      const text = content.trim()
      if (text.length === 0 || busy) return
      // Empty-state send (screenshot case: "hi" typed with no conversation
      // selected) must auto-create a session instead of silently no-op'ing.
      let targetId = selectedId
      if (!targetId) {
        setBusy(true)
        setPhase('planning')
        setExecution({ taskKind: null, phase: 'planning', detail: 'classifying task' })
        setStreamingText('')
        setStreamingReasoning('')
        setError(null)
        try {
          const h = await createSession(`Session ${sessions.length + 1}`, null)
          await refreshSessions()
          targetId = h.id
          const seq = ++loadSeq.current
          setSelectedId(h.id)
          selectedRef.current = h.id
          setEvents([])
          await refreshEvents(h.id, seq)
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
          setBusy(false)
          setPhase('idle')
          return
        }
      } else {
        setBusy(true)
        setPhase('planning')
        setExecution({ taskKind: null, phase: 'planning', detail: 'classifying task' })
        setStreamingText('')
        setStreamingReasoning('')
        setError(null)
      }
      try {
        await sendChatMessage(targetId, text, opts)
        setDraft('')
        // The user may have switched sessions while the long-lived invoke
        // was in flight — never render another session's events here.
        // (The event subscription refreshes the right view on completion.)
        if (selectedRef.current === targetId) {
          const seq = ++loadSeq.current
          await refreshEvents(targetId, seq)
        }
        await refreshSessions()
      } catch (e) {
        // Keep the draft so nothing successfully-persisted is faked.
        setStreamingText('')
        setStreamingReasoning('')
        setError(e instanceof Error ? e.message : String(e))
        setExecution((prev) => (prev.phase === 'error' ? prev : { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
      } finally {
        setBusy(false)
        setPhase('idle')
      }
    },
    [selectedId, busy, sessions.length, refreshEvents, refreshSessions]
  )

  const handleCancel = useCallback(async (): Promise<void> => {
    if (!selectedId || !busy) return
    try {
      await cancelChatMessage(selectedId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [selectedId, busy])

  const handleRegenerate = useCallback(async (opts?: { reasoning?: boolean }): Promise<void> => {
    if (!selectedId || busy) return
    setBusy(true)
    setPhase('planning')
    setExecution({ taskKind: null, phase: 'planning', detail: 'regenerating' })
    setStreamingText('')
    setStreamingReasoning('')
    setError(null)
    try {
      await regenerateChatMessage(selectedId, opts)
      if (selectedRef.current === selectedId) {
        const seq = ++loadSeq.current
        await refreshEvents(selectedId, seq)
      }
      await refreshSessions()
    } catch (e) {
      setStreamingText('')
      setStreamingReasoning('')
      setError(e instanceof Error ? e.message : String(e))
      setExecution((prev) => (prev.phase === 'error' ? prev : { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setBusy(false)
      setPhase('idle')
    }
  }, [selectedId, busy, refreshEvents, refreshSessions])

  const handleEditAndResend = useCallback(
    async (content: string, opts?: { webSearch?: boolean; reasoning?: boolean }): Promise<void> => {
      const text = content.trim()
      if (!selectedId || text.length === 0 || busy) return
      setBusy(true)
      setPhase('planning')
      setExecution({ taskKind: null, phase: 'planning', detail: 'resending edited message' })
      setStreamingText('')
      setStreamingReasoning('')
      setError(null)
      try {
        await editAndResendChatMessage(selectedId, text, opts)
        if (selectedRef.current === selectedId) {
          const seq = ++loadSeq.current
          await refreshEvents(selectedId, seq)
        }
        await refreshSessions()
      } catch (e) {
        setStreamingText('')
        setStreamingReasoning('')
        setError(e instanceof Error ? e.message : String(e))
        setExecution((prev) => (prev.phase === 'error' ? prev : { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
      } finally {
        setBusy(false)
        setPhase('idle')
      }
    },
    [selectedId, busy, refreshEvents, refreshSessions]
  )

  const dismissError = useCallback(() => setError(null), [])

  /** Clear the conversation view (no tab selected) without deleting anything. */
  const clearSelection = useCallback((): void => {
    loadSeq.current += 1
    setSelectedId(null)
    setEvents([])
    setStreamingText('')
    setStreamingReasoning('')
    setExecution({ taskKind: null, phase: 'idle' })
    setPhase('idle')
    setError(null)
  }, [])

  return {
    sessions,
    globalSessions,
    projectSessions,
    selectedId,
    events,
    draft,
    setDraft,
    busy,
    phase,
    execution,
    streamingText,
    streamingReasoning,
    error,
    model,
    dismissError,
    handleCreate,
    handleRename,
    handleDelete,
    handleSend,
    handleCancel,
    handleRegenerate,
    handleEditAndResend,
    switchSession,
    clearSelection,
    refreshModelStatus,
  }
}
