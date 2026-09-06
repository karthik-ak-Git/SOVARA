import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelChatMessage,
  createSession,
  getActiveModel,
  getSessionEvents,
  listSessions,
  onSessionEvents,
  sendChatMessage,
  type SessionEventView,
  type SessionHeaderView,
} from '@renderer/lib/ipc'
import type { ActiveModelState } from '@shared/types/models'

/**
 * Commit 7 — real local inference flow.
 * - Deltas stream in on `events:session` into transient `streamingText`
 *   (never persisted); the durable timeline still reconstructs from events.
 * - Cancel aborts the in-flight request; the log keeps a cancelled marker.
 * - Model status is fetched on mount + on demand (no polling, no keystroke
 *   probing). Duplicate submission is blocked while a send is in flight.
 */
export type ChatPhase = 'idle' | 'streaming'

export function useChatSession() {
  const [sessions, setSessions] = useState<SessionHeaderView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionEventView[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<ChatPhase>('idle')
  const [streamingText, setStreamingText] = useState('')
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

  // Stream subscription: deltas for the selected session only.
  useEffect(() => {
    if (!window.sovara) return
    const dispose = onSessionEvents((ev) => {
      if (!ev || ev.sessionId !== selectedRef.current) return
      if (ev.kind === 'assistant-delta' && ev.text) {
        setPhase('streaming')
        setStreamingText((t) => t + (ev.text ?? ''))
      } else if (ev.kind === 'assistant-done' || ev.kind === 'assistant-cancelled') {
        const id = selectedRef.current
        setStreamingText('')
        setPhase('idle')
        if (id) {
          const seq = ++loadSeq.current
          void refreshEvents(id, seq).then(() => refreshSessions())
        }
      } else if (ev.kind === 'assistant-error') {
        setStreamingText('')
        setPhase('idle')
        setError(ev.error ?? 'The local model interrupted the reply.')
      }
    })
    return dispose
  }, [refreshEvents, refreshSessions])

  // Switch conversation: reconstruct from durable events.
  const switchSession = useCallback(
    async (id: string): Promise<void> => {
      if (!id) return
      const seq = ++loadSeq.current
      setSelectedId(id)
      setError(null)
      setEvents([])
      setStreamingText('')
      setPhase('idle')
      try {
        await refreshEvents(id, seq)
      } catch (e) {
        if (loadSeq.current === seq) setError(e instanceof Error ? e.message : String(e))
      }
    },
    [refreshEvents]
  )

  const handleCreate = useCallback(async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const h = await createSession(`Session ${sessions.length + 1}`)
      await refreshSessions()
      await switchSession(h.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [busy, sessions.length, refreshSessions, switchSession])

  const handleSend = useCallback(
    async (content: string): Promise<void> => {
      const text = content.trim()
      if (!selectedId || text.length === 0 || busy) return
      setBusy(true)
      setPhase('streaming')
      setStreamingText('')
      setError(null)
      try {
        await sendChatMessage(selectedId, text)
        setDraft('')
        const seq = ++loadSeq.current
        await refreshEvents(selectedId, seq)
        await refreshSessions()
      } catch (e) {
        // Keep the draft so nothing successfully-persisted is faked.
        setStreamingText('')
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
        setPhase('idle')
      }
    },
    [selectedId, busy, refreshEvents, refreshSessions]
  )

  const handleCancel = useCallback(async (): Promise<void> => {
    if (!selectedId || !busy) return
    try {
      await cancelChatMessage(selectedId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [selectedId, busy])

  const dismissError = useCallback(() => setError(null), [])

  return {
    sessions,
    selectedId,
    events,
    draft,
    setDraft,
    busy,
    phase,
    streamingText,
    error,
    model,
    dismissError,
    handleCreate,
    handleSend,
    handleCancel,
    switchSession,
    refreshModelStatus,
  }
}
