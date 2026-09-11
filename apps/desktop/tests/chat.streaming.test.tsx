/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageList } from '../../web/src/features/chat/MessageList'
import { MessageBubble } from '../../web/src/features/chat/MessageBubble'
import { ChatView } from '../../web/src/features/chat/ChatView'
import { deriveMessages } from '../../web/src/features/chat/conversation'
import type { ChatStreamEvent } from '../src/shared/types/chat'
import { mockApi, expectFetch } from './helpers/http'
import { streamFor } from './helpers/sse'

afterEach(() => cleanup())

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
    expect(streaming.querySelector('.stream-caret')).not.toBeNull()
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
  const baseRoutes: Record<string, unknown> = {
    'GET /api/sessions': sessionList,
    'GET /api/sessions/s1/events': [{ seq: 0, time: 1, type: 'user/message', data: { content: 'q' } }],
    'GET /api/models/active': {
      selection: { runtimeId: 'rt-1', modelId: 'rt-1:m' },
      available: true,
      displayName: 'm',
    },
  }

  beforeEach(() => {
    mockApi(baseRoutes)
  })

  it('accumulates deltas transiently and reloads on done', async () => {
    const fetchMock = mockApi({
      ...baseRoutes,
      'POST /api/chat': () => {
        // Deltas stream over SSE while POST is in flight, exactly as the
        // internal server behaves (deltas via stream, durable event on done).
        const stream = streamFor('/api/chat/stream')
        stream.emit({ sessionId: 's1', kind: 'assistant-delta', text: 'He' })
        stream.emit({ sessionId: 's1', kind: 'assistant-delta', text: 'llo' })
        stream.emit({ sessionId: 's1', kind: 'assistant-done', seq: 1 })
        return { ok: true, userSeq: 0, assistantSeq: 1 }
      },
    })
    const { useChatSession } = await import('../../web/src/features/chat/useChatSession')
    const { renderHook } = await import('@testing-library/react')
    const { result } = renderHook(() => useChatSession())
    await waitFor(() => expect(result.current.selectedId).toBe('s1'))
    await act(async () => {
      await result.current.handleSend('hello')
    })
    // Done push triggers a durable reload of the same user event fixture.
    await waitFor(() => expect(result.current.events).toHaveLength(1))
    expect(result.current.streamingText).toBe('')
    expect(result.current.phase).toBe('idle')
    expectFetch(fetchMock, 'POST', '/api/chat', { sessionId: 's1', content: 'hello' })
  })

  it('routes cancel to chat:cancel for the selected session', async () => {
    const fetchMock = mockApi({
      ...baseRoutes,
      // Hanging send: POST never resolves, mirroring a generation in flight.
      'POST /api/chat': () => new Promise(() => {}),
      'POST /api/chat/cancel': { cancelled: true },
    })
    const { useChatSession } = await import('../../web/src/features/chat/useChatSession')
    const { renderHook } = await import('@testing-library/react')
    const { result } = renderHook(() => useChatSession())
    await waitFor(() => expect(result.current.selectedId).toBe('s1'))
    // Force busy via a hanging send.
    void act(() => {
      void result.current.handleSend('hanging')
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => {
      await result.current.handleCancel()
    })
    expectFetch(fetchMock, 'POST', '/api/chat/cancel', { sessionId: 's1' })
  })

  it('never renders another session events after switching mid-send', async () => {
    let resolveSend!: (v: unknown) => void
    mockApi({
      'GET /api/sessions': [
        { id: 's1', title: 'S1', createdAt: 1, updatedAt: 1 },
        { id: 's2', title: 'S2', createdAt: 2, updatedAt: 2 },
      ],
      'GET /api/sessions/s1/events': [
        { seq: 0, time: 1, type: 'user/message', data: { content: 's1 question' } },
      ],
      'GET /api/sessions/s2/events': [
        { seq: 0, time: 1, type: 'user/message', data: { content: 's2 question' } },
      ],
      'GET /api/models/active': { selection: null, available: false },
      'POST /api/chat': () =>
        new Promise((resolve) => {
          resolveSend = resolve
        }),
    })
    const { useChatSession } = await import('../../web/src/features/chat/useChatSession')
    const { renderHook } = await import('@testing-library/react')
    const { result } = renderHook(() => useChatSession())
    await waitFor(() => expect(result.current.selectedId).toBe('s1'))
    // Start a send on s1, then switch to s2 before it resolves.
    let sendPromise!: Promise<void>
    await act(async () => {
      sendPromise = result.current.handleSend('s1 hello')
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => {
      await result.current.switchSession('s2')
    })
    expect(result.current.events).toHaveLength(1)
    expect((result.current.events[0]?.data as { content: string }).content).toBe('s2 question')
    await act(async () => {
      resolveSend({ ok: true, userSeq: 0, assistantSeq: 1 })
      await sendPromise
    })
    // s1's post-send refresh must not overwrite the s2 view.
    expect(result.current.selectedId).toBe('s2')
    expect(result.current.events).toHaveLength(1)
    expect((result.current.events[0]?.data as { content: string }).content).toBe('s2 question')
  })
})
