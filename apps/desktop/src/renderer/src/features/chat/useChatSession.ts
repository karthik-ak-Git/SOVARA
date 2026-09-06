import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createSession,
  getSessionEvents,
  listSessions,
  sendChatMessage,
  type SessionEventView,
  type SessionHeaderView,
} from '@renderer/lib/ipc'

/**
 * Commit 5 — durable conversation flow.
 * - Sessions persist via PersistencePort (SQLite+JSONL).
 * - Timeline is always reconstructed from session events.
 * - Failed persistence never masquerades as a durable message: the draft
 *   is kept and a UI error is surfaced.
 * - Duplicate submission is blocked while a send is in flight.
 */
export function useChatSession() {
  const [sessions, setSessions] = useState<SessionHeaderView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [events, setEvents] = useState<SessionEventView[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const refreshSessions = useCallback(async (): Promise<SessionHeaderView[]> => {
    const list = await listSessions()
    setSessions(list)
    return list
  }, [])

  const refreshEvents = useCallback(async (id: string, seq: number): Promise<void> => {
    const evts = await getSessionEvents(id)
    if (loadSeq.current === seq) setEvents(evts)
  }, [])

  // Initial load.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await refreshSessions()
        if (!cancelled && list.length > 0 && !selectedId) {
          const first = list[0]
          if (first) {
            setSelectedId(first.id)
            const seq = ++loadSeq.current
            await refreshEvents(first.id, seq)
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switch conversation: reconstruct from durable events.
  const switchSession = useCallback(
    async (id: string): Promise<void> => {
      const seq = ++loadSeq.current
      setSelectedId(id)
      setError(null)
      setEvents([])
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
      setError(null)
      try {
        await sendChatMessage(selectedId, text)
        setDraft('')
        const seq = ++loadSeq.current
        await refreshEvents(selectedId, seq)
        await refreshSessions()
      } catch (e) {
        // Keep the draft so nothing successfully-persisted is faked.
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [selectedId, busy, refreshEvents, refreshSessions]
  )

  const dismissError = useCallback(() => setError(null), [])

  return {
    sessions,
    selectedId,
    events,
    draft,
    setDraft,
    busy,
    error,
    dismissError,
    handleCreate,
    handleSend,
    switchSession,
  }
}
