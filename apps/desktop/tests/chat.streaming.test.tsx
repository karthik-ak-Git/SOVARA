/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act, renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageList } from '../src/renderer/src/features/chat/MessageList'
import { MessageBubble } from '../src/renderer/src/features/chat/MessageBubble'
import { ChatView } from '../src/renderer/src/features/chat/ChatView'
import { deriveMessages } from '../src/renderer/src/features/chat/conversation'
import { useChatSession } from '../src/renderer/src/features/chat/useChatSession'

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).sovara
})

describe('Commit 7 — streaming timeline', () => {
  it('renders transient streaming text with a caret, hiding the thinking state', () => {
    render(
      <MessageList
        events={[{ seq: 0, time: 1, type: 'user/message', data: { content: 'hi' } }]}
        thinking
        streamingText="Hel"
      />
    )
    const streaming = screen.getByTestId('message-streaming')
    expect(streaming).toHaveTextContent('Hel')
    expect(streaming.querySelector('.sv-stream-caret')).not.toBeNull()
    expect(screen.queryByTestId('assistant-thinking')).toBeNull()
  })

  it('renders cancelled markers honestly, not as replies', () => {
    render(<MessageBubble id="9" role="assistant" content="Generation cancelled." timestamp={7} cancelled />)
    expect(screen.getByText('Generation cancelled.')).toBeInTheDocument()
    expect(screen.getByText('Stopped — no reply was generated.')).toBeInTheDocument()
  })

  it('derives cancelled events into the timeline, ignoring unknown types', () => {
    const msgs = deriveMessages([
      { seq: 0, time: 1, type: 'user/message', data: { content: 'q' } },
      { seq: 1, time: 2, type: 'assistant/cancelled', data: { reason: 'cancelled' } },
      { seq: 2, time: 3, type: 'assistant/stream-delta', data: { text: 'x' } },
    ])
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ role: 'assistant', cancelled: true })
  })
})

describe('Commit 7 — ChatView states', () => {
  const base = {
    sessions: [{ id: 's1', title: 'Session 1' }],
    selectedId: 's1' as string | null,
    events: [{ seq: 0, time: 1, type: 'user/message', data: { content: 'hi' } }] as Array<{ seq: number; time: number; type: string; data: unknown }>,
    draft: '',
    setDraft: () => {},
    busy: false,
    phase: 'idle' as const,
    streamingText: '',
    error: null as string | null,
    model: { selection: null, available: false },
    onSend: () => {},
    onCancel: () => {},
    onCreateSession: () => {},
    onSwitchSession: () => {},
  }

  it('shows Stop while streaming and calls onCancel', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<ChatView {...base} busy phase="streaming" streamingText="partial" onCancel={onCancel} />)
    expect(screen.getByTestId('message-streaming')).toHaveTextContent('partial')
    await user.click(screen.getByRole('button', { name: 'Stop generating' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows LOCAL MODEL presence vs NO LOCAL MODEL states', () => {
    const { rerender } = render(
      <ChatView
        {...base}
        model={{
          selection: { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' },
          available: true,
          displayName: 'phi-4',
          runtimeDisplayName: 'LM Studio',
        }}
      />
    )
    expect(screen.getByRole('status', { name: /Local model phi-4/ })).toHaveTextContent('LOCAL MODEL')
    rerender(<ChatView {...base} />)
    expect(screen.getByRole('status', { name: 'No local model selected' })).toHaveTextContent('NO LOCAL MODEL')
  })

  it('surfaces classified errors without raw stacks', () => {
    render(<ChatView {...base} error="connection-refused: is the local server still running?" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('connection-refused')
    expect(alert.textContent).not.toMatch(/at |node:internal|TypeError/)
  })
})

describe('Commit 7 — delta subscription flow', () => {
  const sessionList = [{ id: 's1', title: 'S1', createdAt: 1, updatedAt: 1 }]
  const userFixture = [{ seq: 0, time: 1, type: 'user/message', data: { content: 'q' } }]

  // Desktop transport is the Electron preload bridge (window.sovara), not
  // fetch + EventSource: `invoke` for request/response, `on('events:session')`
  // for server pushes (assistant-delta / assistant-done / ...).
  function mockBridge(handlers: Record<string, (arg?: unknown) => unknown | Promise<unknown>>) {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    let sessionCb: ((ev: unknown) => void) | null = null
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      calls.push({ channel, args })
      const h = handlers[channel]
      if (!h) throw new Error(`unmocked IPC: ${channel}`)
      return h(args[0])
    })
    const on = vi.fn((channel: string, cb: (...a: unknown[]) => void) => {
      if (channel === 'events:session') sessionCb = cb as (ev: unknown) => void
      return () => {
        if (channel === 'events:session') sessionCb = null
      }
    })
    ;(window as unknown as Record<string, unknown>).sovara = { invoke, on }
    return {
      calls,
      emitSessionEvent: (ev: unknown): void => {
        sessionCb?.(ev)
      },
      sentBody: (channel: string): unknown => calls.find((c) => c.channel === channel)?.args[0],
    }
  }

  function baseHandlers(extra: Record<string, (arg?: unknown) => unknown | Promise<unknown>> = {}) {
    return {
      'sessions:list': () => sessionList,
      'sessions:getEvents': () => userFixture,
      'models:getActiveModel': () => ({ selection: null, available: false }),
      ...extra,
    }
  }

  it('accumulates deltas transiently and reloads on done', async () => {
    let resolveSend!: (v: unknown) => void
    const bridge = mockBridge(
      baseHandlers({
        // Deferred send: deltas stream over events:session while chat:send is
        // in flight, exactly as the backend behaves (deltas via push,
        // durable event persisted on done).
        'chat:send': () => new Promise((resolve) => { resolveSend = resolve as (v: unknown) => void }),
      })
    )
    const { result } = renderHook(() => useChatSession())
    await waitFor(() => expect(result.current.selectedId).toBe('s1'))
    act(() => {
      void result.current.handleSend('hello')
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    // Server pushes stream in while the request is in flight.
    await act(async () => {
      bridge.emitSessionEvent({ sessionId: 's1', kind: 'assistant-delta', text: 'He' })
      bridge.emitSessionEvent({ sessionId: 's1', kind: 'assistant-delta', text: 'llo' })
    })
    expect(result.current.streamingText).toBe('Hello')
    await act(async () => {
      bridge.emitSessionEvent({ sessionId: 's1', kind: 'assistant-done', seq: 1 })
      resolveSend({ ok: true, userSeq: 0, assistantSeq: 1 })
    })
    // Done push triggers a durable reload of the same user event fixture.
    await waitFor(() => expect(result.current.events).toHaveLength(1))
    expect(result.current.streamingText).toBe('')
    expect(result.current.phase).toBe('idle')
    await waitFor(() => expect(result.current.busy).toBe(false))
    expect(bridge.sentBody('chat:send')).toMatchObject({ sessionId: 's1', content: 'hello' })
  })

  it('routes cancel to chat:cancel for the selected session', async () => {
    const bridge = mockBridge(
      baseHandlers({
        // Hanging send: chat:send never resolves, mirroring a generation in flight.
        'chat:send': () => new Promise(() => {}),
        'chat:cancel': () => ({ cancelled: true }),
      })
    )
    const { result } = renderHook(() => useChatSession())
    await waitFor(() => expect(result.current.selectedId).toBe('s1'))
    // Force busy via a hanging send.
    act(() => {
      void result.current.handleSend('hanging')
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => {
      await result.current.handleCancel()
    })
    expect(bridge.sentBody('chat:cancel')).toEqual({ sessionId: 's1' })
  })

  it('never renders another session events after switching mid-send', async () => {
    let resolveSend!: (v: unknown) => void
    mockBridge({
      'sessions:list': () => [
        { id: 's1', title: 'S1', createdAt: 1, updatedAt: 1 },
        { id: 's2', title: 'S2', createdAt: 2, updatedAt: 2 },
      ],
      'sessions:getEvents': (sessionId) =>
        sessionId === 's1'
          ? [{ seq: 0, time: 1, type: 'user/message', data: { content: 's1 question' } }]
          : [{ seq: 0, time: 1, type: 'user/message', data: { content: 's2 question' } }],
      'models:getActiveModel': () => ({ selection: null, available: false }),
      'chat:send': () =>
        new Promise((resolve) => {
          resolveSend = resolve as (v: unknown) => void
        }),
    })
    const { result } = renderHook(() => useChatSession())
    await waitFor(() => expect(result.current.selectedId).toBe('s1'))
    // Start a send on s1, then switch to s2 before it resolves.
    act(() => {
      void result.current.handleSend('s1 hello')
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => {
      await result.current.switchSession('s2')
    })
    expect(result.current.events).toHaveLength(1)
    expect((result.current.events[0]?.data as { content: string }).content).toBe('s2 question')
    await act(async () => {
      resolveSend({ ok: true, userSeq: 0, assistantSeq: 1 })
    })
    await waitFor(() => expect(result.current.busy).toBe(false))
    // s1's post-send refresh must not overwrite the s2 view.
    expect(result.current.selectedId).toBe('s2')
    expect(result.current.events).toHaveLength(1)
    expect((result.current.events[0]?.data as { content: string }).content).toBe('s2 question')
  })
})
