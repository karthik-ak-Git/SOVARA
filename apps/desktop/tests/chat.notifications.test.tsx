/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { useChatSession } from '../../web/src/features/chat/useChatSession'
import { mockApi } from './helpers/http'
import { installEventSourceMock, streamFor } from './helpers/sse'

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

async function renderWithSession(selected: string): Promise<void> {
  // New transport: REST (/api/sessions, /api/settings) + SSE
  // (/api/chat/stream) instead of the Electron `window.sovara` bridge.
  mockApi({
    'GET /api/sessions': SESSIONS,
    'GET /api/sessions/s1/events': [],
    'GET /api/sessions/s2/events': [],
    'GET /api/models/active': { selection: null, available: false },
    'GET /api/settings': {
      theme: 'dark',
      sidebarBackground: 'dark',
      inlineDiffLayout: 'side-by-side',
      renameAfterFork: false,
      globalWorkspaceRoot: '',
      allowModelDownload: false,
      autoUpdates: true,
      sessionNotifications: notificationsEnabled,
      updateFeedUrl: '',
      updateChannel: 'stable',
      lastUpdateCheckAt: null,
      lastUpdateStatus: null,
      rootModel: '',
      visionModel: '',
      webSearch: false,
      explorationAgents: false,
      customAutoReview: false,
      customInstructions: '',
      version: '0.1.0',
    },
  })
  render(<Probe />)
  await waitFor(() => {
    expect(document.querySelector('[data-testid="sel"]')?.textContent).toBe(selected)
  })
}

beforeEach(() => {
  seen.length = 0
  notificationsEnabled = true
  // afterEach unstubs all globals (incl. the setup-file EventSource mock),
  // so reinstall the SSE mock for every test.
  installEventSourceMock()
  MockNotification.permission = 'granted'
  vi.stubGlobal('Notification', MockNotification)
  setHidden(true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setHidden(false)
})

describe('session completion notifications', () => {
  it('notifies when a background session finishes while hidden', async () => {
    await renderWithSession('s1')
    streamFor('/api/chat/stream').emit({ sessionId: 's2', kind: 'assistant-done' })
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toMatchObject({ title: 'Sovara — reply ready', body: 'Session 2' })
  })

  it('stays silent when the viewed session finishes and the window is visible', async () => {
    setHidden(false)
    await renderWithSession('s1')
    streamFor('/api/chat/stream').emit({ sessionId: 's1', kind: 'assistant-done' })
    // allow the async notify path to settle, then assert nothing fired
    await waitFor(() => expect(document.querySelector('[data-testid="sel"]')?.textContent).toBe('s1'))
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toHaveLength(0)
  })

  it('stays silent when the setting is off, even when hidden', async () => {
    notificationsEnabled = false
    await renderWithSession('s1')
    streamFor('/api/chat/stream').emit({ sessionId: 's2', kind: 'assistant-done' })
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toHaveLength(0)
  })

  it('notifies for the viewed session when the window is hidden', async () => {
    await renderWithSession('s1')
    streamFor('/api/chat/stream').emit({ sessionId: 's1', kind: 'assistant-done' })
    await waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]?.body).toBe('Session 1')
  })
})
