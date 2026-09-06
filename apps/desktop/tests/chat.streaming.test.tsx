/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageList } from '../src/renderer/src/features/chat/MessageList'
import { MessageBubble } from '../src/renderer/src/features/chat/MessageBubble'
import { ChatView } from '../src/renderer/src/features/chat/ChatView'
import { deriveMessages } from '../src/renderer/src/features/chat/conversation'
import type { ChatStreamEvent } from '../src/shared/types/chat'

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
  let listeners: Array<(ev: ChatStreamEvent) => void>
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listeners = []
    invoke = vi.fn(async (ch: string) => {
      if (ch === 'sessions:list') return [{ id: 's1', title: 'S1', createdAt: 1, updatedAt: 1 }]
      if (ch === 'sessions:getEvents') return [{ seq: 0, time: 1, type: 'user/message', data: { content: 'q' } }]
      if (ch === 'models:getActiveModel') {
        return { selection: { runtimeId: 'rt-1', modelId: 'rt-1:m' }, available: true, displayName: 'm' }
      }
      if (ch === 'chat:send') {
        // Simulate main pushing deltas, then resolving on completion.
        for (const t of ['He', 'llo']) {
          for (const l of listeners) l({ sessionId: 's1', kind: 'assistant-delta', text: t })
        }
        for (const l of listeners) l({ sessionId: 's1', kind: 'assistant-done', seq: 1 })
        return { ok: true, userSeq: 0, assistantSeq: 1 }
      }
      return null
    })
    ;(window as unknown as { sovara: unknown }).sovara = {
      invoke,
      on: vi.fn((_ch: string, cb: (ev: ChatStreamEvent) => void) => {
        listeners.push(cb)
        return () => {}
      }),
    } as unknown as Window['sovara']
  })

  it('accumulates deltas transiently and reloads on done', async () => {
    const { useChatSession } = await import('../src/renderer/src/features/chat/useChatSession')
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
    expect(invoke).toHaveBeenCalledWith('chat:send', { sessionId: 's1', content: 'hello' })
  })

  it('routes cancel to chat:cancel for the selected session', async () => {
    const { useChatSession } = await import('../src/renderer/src/features/chat/useChatSession')
    const { renderHook } = await import('@testing-library/react')
    const { result } = renderHook(() => useChatSession())
    await waitFor(() => expect(result.current.selectedId).toBe('s1'))
    // Force busy via a hanging send.
    invoke.mockImplementation(async (ch: string) => {
      if (ch === 'chat:send') {
        await new Promise(() => {})
        return { ok: true, userSeq: 0, assistantSeq: 1 }
      }
      if (ch === 'sessions:getEvents') return []
      if (ch === 'models:getActiveModel') return { selection: null, available: false }
      return null
    })
    void act(() => {
      void result.current.handleSend('hanging')
    })
    await waitFor(() => expect(result.current.busy).toBe(true))
    await act(async () => {
      await result.current.handleCancel()
    })
    expect(invoke).toHaveBeenCalledWith('chat:cancel', { sessionId: 's1' })
  })
})
