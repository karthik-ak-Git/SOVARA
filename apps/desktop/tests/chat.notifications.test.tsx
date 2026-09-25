/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import { useChatSession } from '../src/renderer/src/features/chat/useChatSession'

const seen: Array<{ title: string; body?: string }> = []

class MockNotification {
  static permission: NotificationPermission = 'granted'
  static requestPermission = vi.fn().mockResolvedValue('granted' as NotificationPermission)
  constructor(title: string, opts?: { body?: string }) {
    seen.push({ title, body: opts?.body })
  }
}

let notificationsEnabled = true

const SESSIONS = [
  { id: 's1', title: 'Session 1', createdAt: 1, updatedAt: 2 },
  { id: 's2', title: 'Session 2', createdAt: 3, updatedAt: 4 },
]

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
}

function Probe(): React.JSX.Element {
  const chat = useChatSession()
  return <div data-testid="sel">{chat.selectedId ?? 'none'}</div>
}

async function renderWithSession(selected: string): Promise<(ev: unknown) => void> {
  // Desktop transport: Electron preload bridge (window.sovara) — `invoke`
  // for request/response, `on('events:session')` for server pushes —
  // instead of the old web REST (/api/sessions, /api/settings) + SSE
  // (/api/chat/stream) transport.
  let sessionCb: ((ev: unknown) => void) | null = null
  ;(window as unknown as Record<string, unknown>).sovara = {
    invoke: async (channel: string, ...args: unknown[]) => {
      switch (channel) {
        case 'sessions:list':
          return SESSIONS
        case 'sessions:getEvents':
          return []
        case 'models:getActiveModel':
          return { selection: null, available: false }
        case 'settings:get':
          return { sessionNotifications: notificationsEnabled }
        default:
          throw new Error(`unmocked IPC: ${channel} ${JSON.stringify(args[0])}`)
      }
    },
    on: (channel: string, cb: (...a: unknown[]) => void) => {
      if (channel === 'events:session') sessionCb = cb as (ev: unknown) => void
      return () => {
        if (channel === 'events:session') sessionCb = null
      }
    },
  }
  render(<Probe />)
  await waitFor(() => {
    expect(document.querySelector('[data-testid="sel"]')?.textContent).toBe(selected)
  })
  return (ev: unknown): void => {
    sessionCb?.(ev)
  }
}

function installBridge(): void {
  seen.length = 0
  notificationsEnabled = true
  MockNotification.permission = 'granted'
  vi.stubGlobal('Notification', MockNotification)
  setHidden(true)
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).sovara
  setHidden(false)
})

describe('session completion notifications', () => {
  it('notifies when a background session finishes while hidden', async () => {
    installBridge()
    const emit = await renderWithSession('s1')
    await act(async () => {
      emit({ sessionId: 's2', kind: 'assistant-done' })
    })
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toMatchObject({ title: 'Sovara — reply ready', body: 'Session 2' })
  })

  it('stays silent when the viewed session finishes and the window is visible', async () => {
    installBridge()
    setHidden(false)
    const emit = await renderWithSession('s1')
    await act(async () => {
      emit({ sessionId: 's1', kind: 'assistant-done' })
    })
    // allow the async notify path to settle, then assert nothing fired
    await waitFor(() => expect(document.querySelector('[data-testid="sel"]')?.textContent).toBe('s1'))
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toHaveLength(0)
  })

  it('stays silent when the setting is off, even when hidden', async () => {
    installBridge()
    notificationsEnabled = false
    const emit = await renderWithSession('s1')
    await act(async () => {
      emit({ sessionId: 's2', kind: 'assistant-done' })
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toHaveLength(0)
  })

  it('notifies for the viewed session when the window is hidden', async () => {
    installBridge()
    const emit = await renderWithSession('s1')
    await act(async () => {
      emit({ sessionId: 's1', kind: 'assistant-done' })
    })
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]?.body).toBe('Session 1')
  })
})
