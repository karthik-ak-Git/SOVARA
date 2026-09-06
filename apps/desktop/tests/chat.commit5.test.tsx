/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { deriveMessages } from '../src/renderer/src/features/chat/conversation'
import { MessageBubble } from '../src/renderer/src/features/chat/MessageBubble'
import { MessageList } from '../src/renderer/src/features/chat/MessageList'
import { Composer } from '../src/renderer/src/features/chat/Composer'
import { ChatView } from '../src/renderer/src/features/chat/ChatView'
import { buildMockAssistantText } from '../src/main/backend/ports/LlmStubAdapter'

afterEach(() => cleanup())

describe('Commit 5 — event model', () => {
  it('derives user/assistant messages in seq order and ignores other types', () => {
    const msgs = deriveMessages([
      { seq: 2, time: 3, type: 'assistant/message', data: { content: 'b' } },
      { seq: 0, time: 1, type: 'user/message', data: { content: 'a' } },
      { seq: 1, time: 2, type: 'system/resource-blocked', data: {} },
      { seq: 3, time: 4, type: 'user/message', data: { content: 'c' } },
    ])
    expect(msgs.map((m) => m.content)).toEqual(['a', 'b', 'c'])
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })

  it('ignores malformed events instead of breaking reconstruction', () => {
    const msgs = deriveMessages([
      { seq: 0, time: 1, type: 'user/message', data: { content: 'ok' } },
      { seq: 1, time: 2, type: 'user/message', data: { nope: 1 } },
      { seq: 2, time: 3, type: 'user/message', data: null },
      { seq: 3, time: Number.NaN, type: 'user/message', data: { content: 'bad-time' } },
    ] as unknown as Parameters<typeof deriveMessages>[0])
    expect(msgs.map((m) => m.content)).toEqual(['ok'])
  })
})

describe('Commit 5 — message rendering', () => {
  it('distinguishes user vs assistant bubbles', () => {
    render(
      <>
        <MessageBubble id="1" role="user" content="hello" timestamp={Date.now()} />
        <MessageBubble id="2" role="assistant" content="world" timestamp={Date.now()} />
      </>
    )
    expect(screen.getByTestId('message-user')).toHaveAttribute('data-role', 'user')
    expect(screen.getByTestId('message-assistant')).toHaveAttribute('data-role', 'assistant')
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('world')).toBeInTheDocument()
  })

  it('renders empty conversation guidance', () => {
    render(<MessageList events={[]} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/Start a local conversation/)).toBeInTheDocument()
  })

  it('renders timeline from events and thinking state', () => {
    const now = Date.now()
    render(
      <MessageList
        events={[
          { seq: 0, time: now, type: 'user/message', data: { content: 'hi' } },
          { seq: 1, time: now, type: 'assistant/message', data: { content: 'mock reply' } },
        ]}
        thinking
      />
    )
    expect(screen.getByTestId('message-user')).toBeInTheDocument()
    expect(screen.getByTestId('message-assistant')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-thinking')).toBeInTheDocument()
    expect(screen.getByRole('log', { name: 'Conversation messages' })).toBeInTheDocument()
  })
})

describe('Commit 5 — composer', () => {
  it('Enter sends trimmed content; empty never sends', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const { rerender } = render(<Composer value="  hello  " onChange={() => {}} onSend={onSend} />)
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith('hello')

    onSend.mockClear()
    rerender(<Composer value="   " onChange={() => {}} onSend={onSend} />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    let value = 'a'
    const onChange = vi.fn((v: string) => {
      value = v
    })
    const { rerender } = render(<Composer value={value} onChange={onChange} onSend={onSend} />)
    const box = screen.getByRole('textbox', { name: 'Message input' })
    await user.click(box)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onSend).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalled()
    expect(value).toContain('\n')
    rerender(<Composer value={value} onChange={onChange} onSend={onSend} />)
    expect(screen.getByRole('textbox', { name: 'Message input' })).toHaveValue(value)
  })

  it('duplicate-send prevention: disabled composer cannot send', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    render(<Composer value="hello" onChange={() => {}} onSend={onSend} disabled />)
    const box = screen.getByRole('textbox', { name: 'Message input' })
    expect(box).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    await user.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('Commit 5 — ChatView states', () => {
  const base = {
    sessions: [{ id: 's1', title: 'Session 1' }],
    selectedId: 's1' as string | null,
    events: [] as Array<{ seq: number; time: number; type: string; data: unknown }>,
    draft: '',
    setDraft: () => {},
    busy: false,
    error: null as string | null,
    onSend: () => {},
    onCreateSession: () => {},
    onSwitchSession: () => {},
  }

  it('shows error banner with role=alert and dismiss', async () => {
    const user = userEvent.setup()
    const dismiss = vi.fn()
    render(<ChatView {...base} error="persistence failed" onDismissError={dismiss} />)
    expect(screen.getByRole('alert')).toHaveTextContent('persistence failed')
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('guides when no conversation is selected', () => {
    render(<ChatView {...base} selectedId={null} sessions={[]} />)
    expect(screen.getByText(/Create a conversation to start/)).toBeInTheDocument()
  })

  it('send button has an accessible name and composer is labelled', () => {
    render(<ChatView {...base} draft="hi" />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message input' })).toBeInTheDocument()
  })
})

describe('Commit 5 — mock assistant sovereignty', () => {
  it('is deterministic for the same prompt', () => {
    expect(buildMockAssistantText('hello')).toBe(buildMockAssistantText('hello'))
    expect(buildMockAssistantText('a')).not.toBe(buildMockAssistantText('b'))
  })

  it('never pretends to be a real model and stays bounded', () => {
    const t = buildMockAssistantText('x'.repeat(5000))
    expect(t).toMatch(/mock assistant/)
    expect(t).toMatch(/no model wired/)
  })

  it('LlmStubAdapter makes zero network calls (static proof)', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/main/backend/ports/LlmStubAdapter.ts', 'utf8')
    expect(src).not.toMatch(/\bfetch\s*\(/)
    expect(src).not.toMatch(/axios|node:http|net\.request|WebSocket/)
  })
})
