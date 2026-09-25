/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsModal } from '../src/renderer/src/components/modals/SettingsModal'

/**
 * The reported bug was "the app only detects updates, it has no update button".
 * Detection was never the problem — the UI only rendered a button in the
 * `downloaded` state, so a detected update was a dead end. These tests drive the
 * real component and assert each phase offers the correct action.
 */

afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).sovara
})

type Handlers = Record<string, (arg?: unknown) => unknown | Promise<unknown>>

function mockBridge(handlers: Handlers) {
  const calls: Array<{ channel: string; args: unknown[] }> = []
  const listeners = new Map<string, (ev: unknown) => void>()
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    calls.push({ channel, args })
    const h = handlers[channel]
    if (!h) throw new Error(`unmocked IPC: ${channel}`)
    return h(args[0])
  })
  const on = vi.fn((channel: string, cb: (ev: unknown) => void) => {
    listeners.set(channel, cb)
    return () => listeners.delete(channel)
  })
  ;(window as unknown as Record<string, unknown>).sovara = { invoke, on }
  return {
    calls,
    emit: (channel: string, ev: unknown): void => { listeners.get(channel)?.(ev) },
    channelCalls: (channel: string) => calls.filter((c) => c.channel === channel),
  }
}

const SETTINGS = {
  version: '1.1.4',
  autoUpdates: false,
  updateFeedUrl: '',
  updateChannel: 'stable',
}

function baseHandlers(extra: Handlers = {}): Handlers {
  return {
    'settings:get': () => SETTINGS,
    'app:getVersion': () => ({ version: '1.1.4' }),
    'sessions:list': () => [],
    'sessions:listArchived': () => [],
    'models:listRuntimes': () => [],
    'models:getActiveModel': () => ({ selection: null, available: false }),
    'exec:getMode': () => ({ mode: 'ask' }),
    'usage:getTotal': () => ({ total: 0 }),
    ...extra,
  }
}

function renderModal() {
  return render(
    <SettingsModal
      open
      onClose={() => {}}
      onSelectSession={() => {}}
    /> as never,
  )
}

async function openGeneralTab() {
  // `activeTab` defaults to 'general', which is the surface that owns the update
  // rows, so no navigation click is needed — waiting for the section to appear
  // is enough to know the modal finished mounting.
  await waitFor(() => expect(screen.getByText('Check for Updates')).toBeInTheDocument())
}

describe('Settings — update button lifecycle', () => {
  it('offers no download action before an update is detected', async () => {
    mockBridge(baseHandlers())
    renderModal()
    await openGeneralTab()
    await waitFor(() => expect(screen.getByText('Check Now')).toBeInTheDocument())
    // No phantom "Update Available" row before anything is known.
    expect(screen.queryByText('Download Update')).toBeNull()
    expect(screen.queryByText('Restart & Install')).toBeNull()
  })

  it('surfaces a Download Update button as soon as an update is available', async () => {
    const bridge = mockBridge(baseHandlers({
      'updates:checkNow': () => ({
        status: 'available', current: '1.1.4', latest: '1.2.0', message: 'Update available: 1.2.0.',
      }),
    }))
    renderModal()
    await openGeneralTab()

    await userEvent.click(await screen.findByText('Check Now'))

    const download = await screen.findByText('Download Update', undefined, { timeout: 5000 })
    expect(download).toBeInTheDocument()
    // Detection alone must not have triggered a download.
    expect(bridge.channelCalls('updates:download')).toHaveLength(0)
  })

  it('invokes updates:download when the user clicks Download Update', async () => {
    const bridge = mockBridge(baseHandlers({
      'updates:checkNow': () => ({
        status: 'available', current: '1.1.4', latest: '1.2.0', message: 'Update available: 1.2.0.',
      }),
      'updates:download': () => ({ ok: true }),
    }))
    renderModal()
    await openGeneralTab()
    await userEvent.click(await screen.findByText('Check Now'))
    await userEvent.click(await screen.findByText('Download Update'))

    await waitFor(() => expect(bridge.channelCalls('updates:download')).toHaveLength(1))
  })

  it('shows progress and disables the button while downloading', async () => {
    const bridge = mockBridge(baseHandlers({
      'updates:checkNow': () => ({
        status: 'available', current: '1.1.4', latest: '1.2.0', message: 'Update available: 1.2.0.',
      }),
      'updates:download': () => ({ ok: true }),
    }))
    renderModal()
    await openGeneralTab()
    await userEvent.click(await screen.findByText('Check Now'))

    // Progress arrives over the event channel, not the invoke result.
    bridge.emit('updates:event', {
      status: 'downloading', current: '1.1.4', latest: '1.2.0', percent: 42,
      message: 'Downloading update… 42%',
    })

    await waitFor(() => expect(screen.getByText(/Downloading 42%/)).toBeInTheDocument())
    // A second download must not be possible mid-transfer.
    const disabled = screen.getByText(/Downloading 42%/).closest('button') as HTMLButtonElement
    expect(disabled).toBeDisabled()
  })

  it('offers Restart & Install once the update is downloaded, and installs on click', async () => {
    const bridge = mockBridge(baseHandlers({
      'updates:checkNow': () => ({
        status: 'available', current: '1.1.4', latest: '1.2.0', message: 'Update available: 1.2.0.',
      }),
      'updates:download': () => ({ ok: true }),
      'updates:install': () => ({ ok: true }),
    }))
    renderModal()
    await openGeneralTab()
    await userEvent.click(await screen.findByText('Check Now'))

    bridge.emit('updates:event', {
      status: 'downloaded', current: '1.1.4', latest: '1.2.0', percent: 100,
      message: 'Sovara 1.2.0 is ready. Restart to install it.',
    })

    const install = await screen.findByText('Restart & Install', undefined, { timeout: 5000 })
    expect(screen.queryByText('Download Update')).toBeNull()

    await userEvent.click(install)
    await waitFor(() => expect(bridge.channelCalls('updates:install')).toHaveLength(1))
  })

  it('shows a Retry action when the update check fails', async () => {
    mockBridge(baseHandlers({
      'updates:checkNow': () => ({
        status: 'error', current: '1.1.4', latest: null, message: 'Update failed: no network',
      }),
    }))
    renderModal()
    await openGeneralTab()
    await userEvent.click(await screen.findByText('Check Now'))

    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument())
  })

  it('surfaces an install failure inline instead of throwing an unhandled rejection', async () => {
    const bridge = mockBridge(baseHandlers({
      'updates:checkNow': () => ({
        status: 'available', current: '1.1.4', latest: '1.2.0', message: 'Update available: 1.2.0.',
      }),
      'updates:download': () => ({ ok: true }),
      'updates:install': () => { throw new Error('No downloaded update is ready to install.') },
    }))
    renderModal()
    await openGeneralTab()
    await userEvent.click(await screen.findByText('Check Now'))

    bridge.emit('updates:event', {
      status: 'downloaded', current: '1.1.4', latest: '1.2.0', percent: 100,
      message: 'Sovara 1.2.0 is ready. Restart to install it.',
    })

    const install = await screen.findByText('Restart & Install', undefined, { timeout: 5000 })
    await userEvent.click(install)

    // The failure must become visible text, not a silent crash.
    await waitFor(() =>
      expect(screen.getByText(/No downloaded update is ready to install\./)).toBeInTheDocument(),
    )
  })
})
