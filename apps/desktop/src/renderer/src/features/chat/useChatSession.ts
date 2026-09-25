'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { archiveSession,
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
} from '@/lib/client/api'
import type { SessionHeaderView } from '@/lib/client/api'
import type { SessionHeaderView as SessionHeaderViewRef } from '@/lib/client/api'
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
export type ChatPhase = 'idle' | 'streaming' | 'planning' | 'reading' | 'prompting' | 'thinking' | 'loading' | 'tool' | 'artifact'

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
  /** Attachment file name for the reading stage. */
  fileName?: string
  /** Generated artifact absolute path (artifact:ready). */
  artifactPath?: string
  /** Generated artifact kind: 'pdf' | 'xlsx' | 'docx' | 'code'. */
  artifactKind?: string
  toolCallId?: string
  args?: Record<string, unknown>
  /** clarify tool: guided questions awaiting user answers (renders ClarifyWizardCard). */
  clarifyQuestions?: Array<{ id: string; question: string; options: string[]; allowOther?: boolean }>
}

export function isSessionAvailable(sessions: SessionHeaderView[], id: string | null): boolean {
  return !!id && sessions.some((session) => session.id === id)
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
      if (ev.kind === 'task:reading') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'reading', fileName: ev.fileName, detail: ev.detail })
        setPhase('reading')
        return
      }
      if (ev.kind === 'task:prompting') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'prompting', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail })
        setPhase('prompting')
        return
      }
      if (ev.kind === 'task:thinking') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'thinking', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail })
        setPhase('thinking')
        return
      }
      if (ev.kind === 'artifact:writing' || ev.kind === 'artifact:ready') {
        if (!isSelected) return
        setExecution((prev) => ({
          ...prev,
          taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? prev.taskKind,
          phase: 'artifact',
          modelId: ev.modelId ?? prev.modelId,
          runtimeId: ev.runtimeId ?? prev.runtimeId,
          fileName: ev.fileName ?? prev.fileName,
          artifactPath: ev.artifactPath ?? prev.artifactPath,
          artifactKind: ev.artifactKind ?? prev.artifactKind,
          detail: ev.detail ?? prev.detail,
        }))
        setPhase('artifact')
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
        // Optimistically mark unavailable — backend getActiveModel won't flip
        // availability for local file-exists models, but the pill must not show
        // "Ready" after a confirmed load failure.
        setModel((prev) => (prev ? { ...prev, available: false } : prev))
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
        // Keep the terminal/sidebar live while the backend is still running.
        // These provisional events are replaced by the durable session events
        // on assistant-done; they are never treated as persisted evidence.
        if (ev.kind === 'tool:start' || ev.kind === 'tool:end') {
          const liveId = ev.toolCallId ?? `live-${ev.toolName ?? 'tool'}-${Date.now()}`
          setEvents((prev) => {
            const data = { toolCallId: liveId, name: ev.toolName, args: ev.args ?? {}, status: ev.kind === 'tool:start' ? 'started' : 'completed' }
            const alreadyCall = prev.some((e) => e.type === 'tool/call' && (e.data as { toolCallId?: string } | null)?.toolCallId === liveId)
            const alreadyResult = prev.some((e) => e.type === 'tool/result' && (e.data as { toolCallId?: string } | null)?.toolCallId === liveId)
            if (ev.kind === 'tool:start' && alreadyCall) return prev
            if (ev.kind === 'tool:end' && alreadyResult) return prev
            const additions: SessionEventView[] = []
            if (ev.kind === 'tool:end' && !alreadyCall) additions.push({ seq: prev.length > 0 ? prev[prev.length - 1].seq + 1 : 0, time: Date.now(), type: 'tool/call', data })
            additions.push({ seq: (prev[prev.length - 1]?.seq ?? -1) + 1 + (additions.length ? 1 : 0), time: Date.now(), type: ev.kind === 'tool:start' ? 'tool/call' : 'tool/result', data: ev.kind === 'tool:end' ? { ...data, content: ev.detail ?? ev.text ?? '' } : data })
            return [...prev, ...additions]
          })
        }
        return
      }
      if (ev.kind === 'agent:needs-approval') {
        if (!isSelected) return
        setExecution({ taskKind: null, phase: 'tool', toolName: ev.toolName, detail: 'Waiting for permission...', toolCallId: ev.toolCallId, args: ev.args })
        return
      }
      if (ev.kind === 'agent:clarify') {
        if (!isSelected) return
        setExecution({
          taskKind: null,
          phase: 'tool',
          toolName: 'clarify',
          detail: 'Waiting for your answers...',
          toolCallId: ev.toolCallId,
          clarifyQuestions: ev.questions ?? [],
        })
        return
      }
      if (ev.kind === 'task:complete') {
        if (!isSelected) return
        setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'done', modelId: ev.modelId, runtimeId: ev.runtimeId, detail: ev.detail, stepIndex: ev.stepIndex })
        return
      }
      if (ev.kind === 'vision:model-required' as any) {
        if (!isSelected) return
        const msg = (ev as any).detail || 'Vision model required for image understanding'
        setExecution({ taskKind: (ev as any).taskKind ?? null, phase: 'error', error: msg, detail: msg })
        setError(`${msg} — open Models → Vision to load a vision model (e.g., Unlimited-OCR, Qwen-VL, LLaVA)`)
        setPhase('idle')
        // Emit global event for App.tsx to open vision loader prompt
        try { window.dispatchEvent(new CustomEvent('sovara:vision-model-required', { detail: { message: msg } })) } catch {}
        return
      }
      if (ev.kind === 'task:error') {
        if (!isSelected) return
        // Surface vision-model-required as a distinct actionable error
        const detail: string = (ev as any).detail || ev.error || 'Task failed'
        if (detail.includes('vision-model-required')) {
          setExecution({ taskKind: (ev.taskKind as AgentExecutionState['taskKind']) ?? null, phase: 'error', error: detail, detail })
          setError(`${detail} — open Models → Vision to load a vision model`)
          setPhase('idle')
          try { window.dispatchEvent(new CustomEvent('sovara:vision-model-required', { detail: { message: detail } })) } catch {}
          return
        }
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
        setPhase((p) => (p === 'thinking' ? p : 'streaming'))
        setExecution((prev) => (prev.phase === 'thinking' ? prev : { ...prev, phase: 'streaming' }))
        setStreamingReasoning((t) => t + (ev.text ?? ''))
      } else if (ev.kind === 'assistant-delta' && ev.text) {
        if (!isSelected) return
        setPhase('streaming')
        setStreamingText((t) => t + (ev.text ?? ''))
        setExecution((prev) =>
          prev.phase === 'loading' || prev.phase === 'planning' || prev.phase === 'reading' || prev.phase === 'prompting' || prev.phase === 'thinking'
            ? { ...prev, phase: 'streaming' }
            : prev
        )
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

  const handleArchive = useCallback(async (id: string): Promise<void> => {
    try {
      await archiveSession(id)
      const remaining = await refreshSessions()
      if (selectedRef.current === id) {
        const archived = sessions.find((s) => s.id === id)
        const scope = remaining.filter((s) => (s.projectId ?? null) === (archived?.projectId ?? null))
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

  // --- Compressor: English-only, token-aware /compact ---
  const estimateTokens = (chars: number): number => Math.ceil(chars / 4)
  const getTotalChars = (): number => events.reduce((n, e) => {
    const c = (e.data as { content?: string })?.content ?? ''
    return n + (typeof c === 'string' ? c.length : 0)
  }, 0)
  const handleCompact = useCallback(async (): Promise<void> => {
    if (!selectedId || events.length <= 6) {
      setError('Nothing to compact — conversation is short.')
      setTimeout(() => setError(null), 2500)
      return
    }
    setError('Compressing context…')
    try {
      await sendChatMessage(selectedId, '/compact', { reasoning: false })
      setTimeout(() => setError(null), 2000)
    } catch {
      setError('Failed to compress context.')
      setTimeout(() => setError(null), 2500)
    }
  }, [selectedId, events])

  const handleSend = useCallback(
    async (content: string, opts?: { webSearch?: boolean; reasoning?: boolean; attachments?: import('@/lib/client/api').ChatAttachmentView[]; projectId?: string | null }): Promise<void> => {
      const text = content.trim()
      if (text.length === 0 || busy) return
      
      // Slash commands
      if (text === '/compact' || text.startsWith('/compact ')) {
        await handleCompact()
        setDraft('')
        return
      }
      let finalSendText = text
      if (text.startsWith('/skill')) {
        const parts = text.split(' ')
        const target = parts[1]
        if (target && target.startsWith('http')) {
          try {
            setBusy(true)
            setPhase('tool')
            setExecution({ taskKind: 'tool-use', phase: 'tool', toolName: 'import_skill', detail: `Importing skill from ${target}` })
            const res = await window.sovara.invoke('skills:importFromUrl', { url: target })
            setError(`Skill imported successfully: ${(res as any).name || target}`)
          } catch (err: any) {
            setError(`Failed to import skill: ${err.message || String(err)}`)
          } finally {
            setBusy(false)
            setPhase('idle')
            setDraft('')
          }
          setTimeout(() => setError(null), 3000)
          return
        } else if (target) {
          const rest = parts.slice(2).join(' ')
          finalSendText = rest.trim() ? `Please use the '${target}' skill to: ${rest}` : `Please read and apply the '${target}' skill.`
        } else {
          setError('Usage: /skill <https://url-to-skill> OR /skill <name>')
          setTimeout(() => setError(null), 3000)
          return
        }
      }
      if (text.startsWith('/help') || text.startsWith('/mcp')) {
        setError('/compact — keep context under 8192 tokens\n/skill <url> — import a skill\nFor MCP, configure via Settings UI.')
        setTimeout(() => setError(null), 4000)
        setDraft('')
        return
      }

      // Auto-compact when approaching context limit (~80% of 8192 tokens ≈ 6400 tokens ≈ 25600 chars)
      const totalChars = getTotalChars() + finalSendText.length
      if (estimateTokens(totalChars) > 6400) {
        // Fire compact before send to keep prompt in English and within budget
        await handleCompact()
      }
      const selectedSessionId = isSessionAvailable(sessions, selectedId) ? selectedId : null
      if (selectedId && !selectedSessionId) {
        // A tab can outlive its database row after an app update, a deleted
        // session, or a user-data directory switch. Never send to that stale
        // id: create a fresh session and preserve the user's message instead.
        console.warn(`[ChatSession] stale session ${selectedId}; starting a new conversation`)
        setSelectedId(null)
        selectedRef.current = null
        setEvents([])
      }
      let targetId = selectedSessionId
      if (!targetId) {
        setBusy(true)
        setPhase('planning')
        setExecution({ taskKind: null, phase: 'planning', detail: 'classifying task' })
        setStreamingText('')
        setStreamingReasoning('')
        setError(null)
        const optimisticSeq = Date.now()
        setEvents([{ seq: optimisticSeq, time: Date.now(), type: 'user/message', data: { content: finalSendText } } as unknown as SessionEventView])
        try {
          const h = await createSession(`Session ${sessions.length + 1}`, opts?.projectId ?? null)
          await refreshSessions()
          targetId = h.id
          const seq = ++loadSeq.current
          setSelectedId(h.id)
          selectedRef.current = h.id
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
        const optimisticSeq = Date.now()
        setEvents((prev) => [...prev, { seq: optimisticSeq, time: Date.now(), type: 'user/message', data: { content: finalSendText } } as unknown as SessionEventView])
      }
      setDraft('')
      // Fire-and-forget: do NOT await sendChatMessage. It is a long-lived
      // HTTP request that resolves when generation ends; SSE delta events
      // (assistant-delta, reasoning-delta, model:loading, tool:*, etc.)
      // are the reactive channel that updates streamingText / execution
      // state in real-time. Awaiting it here would block the event loop and
      // prevent React from re-rendering until the request completes, making
      // the stream invisible to the user.
      sendChatMessage(targetId, finalSendText, opts)
        .then(() => {
          setDraft('')
          if (selectedRef.current === targetId) {
            const seq = ++loadSeq.current
            void refreshEvents(targetId, seq)
          }
          void refreshSessions()
        })
        .finally(() => {
          setBusy(false)
          setPhase('idle')
        })
        .catch((e: unknown) => {
          if (selectedRef.current !== targetId) return
          setStreamingText('')
          setStreamingReasoning('')
          setError(e instanceof Error ? e.message : String(e))
          setExecution((prev) => (prev.phase === 'error' ? prev : { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
        })
      // SSE subscription drives all reactive UI updates (streamingText, streamingReasoning).
    },
    [selectedId, busy, sessions, refreshEvents, refreshSessions, handleCompact]
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
    // Fire-and-forget: SSE subscription handles reactive streaming state.
    regenerateChatMessage(selectedId, opts)
      .then(() => {
        if (selectedRef.current === selectedId) {
          const seq = ++loadSeq.current
          void refreshEvents(selectedId, seq)
        }
        void refreshSessions()
      })
      .finally(() => {
        setBusy(false)
        setPhase('idle')
      })
      .catch((e: unknown) => {
        if (selectedRef.current !== selectedId) return
        setStreamingText('')
        setStreamingReasoning('')
        setError(e instanceof Error ? e.message : String(e))
        setExecution((prev) => (prev.phase === 'error' ? prev : { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
      })
    return
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
      // Fire-and-forget: SSE subscription handles reactive streaming state.
      editAndResendChatMessage(selectedId, text, opts)
        .then(() => {
          if (selectedRef.current === selectedId) {
            const seq = ++loadSeq.current
            void refreshEvents(selectedId, seq)
          }
          void refreshSessions()
        })
        .finally(() => {
          setBusy(false)
          setPhase('idle')
        })
        .catch((e: unknown) => {
          if (selectedRef.current !== selectedId) return
          setStreamingText('')
          setStreamingReasoning('')
          setError(e instanceof Error ? e.message : String(e))
          setExecution((prev) => (prev.phase === 'error' ? prev : { taskKind: null, phase: 'error', error: e instanceof Error ? e.message : String(e) }))
        })
      return
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

  const approveTool = useCallback(
    async (toolCallId: string, approved: boolean, modifiedArgs?: any) => {
      if (!selectedId) return
      setExecution((prev) => ({ ...prev, toolCallId: undefined, args: undefined }))
      await import('../../lib/client/api').then((m) => m.sendChatApprove(selectedId, toolCallId, approved, modifiedArgs))
    },
    [selectedId]
  )

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
    handleArchive,
    handleSend,
    handleCompact,
    handleCancel,
    handleRegenerate,
    handleEditAndResend,
    switchSession,
    clearSelection,
    refreshModelStatus,
    refreshSessions,
    approveTool,
  }
}

/**
 * Project-scoped selection: opens the project's newest session so the chat
 * composer is live in that project's scope, or clears the selection so the
 * composer starts empty and its first send creates a session in the chosen
 * project dynamically. Used by the sidebar project rows.
 */
export function selectProjectSession(
  chat: {
    sessions: SessionHeaderViewRef[]
    switchSession: (id: string) => Promise<void>
    clearSelection: () => void
    refreshSessions: () => Promise<SessionHeaderViewRef[]>
    selectedId: string | null
  },
  projectId: string | null
): void {
  const scope = chat.sessions.filter((s) => (s.projectId ?? null) === projectId)
  const latest = [...scope].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
  if (latest) {
    void chat.switchSession(latest.id)
  } else {
    chat.clearSelection()
    void chat.refreshSessions()
  }
}

