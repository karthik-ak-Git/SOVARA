import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fakeUpdater } = vi.hoisted(() => ({
  fakeUpdater: {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: false,
    allowPrerelease: false,
    channel: null as string | null,
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.1.4', isPackaged: false },
}))

vi.mock('electron-updater', () => ({ default: { autoUpdater: fakeUpdater } }))

import {
  checkForUpdatesWithManager,
  configureUpdater,
  downloadUpdateNow,
  installDownloadedUpdate,
  resolveUpdaterFeed,
  setUpdaterForTests,
  syncUpdateManager,
} from '../src/main/services/updateManager'

describe('automatic update configuration', () => {
  beforeEach(() => {
    fakeUpdater.autoDownload = true
    fakeUpdater.autoInstallOnAppQuit = true
    fakeUpdater.allowDowngrade = false
    fakeUpdater.allowPrerelease = false
    fakeUpdater.channel = null
    fakeUpdater.setFeedURL.mockReset()
    fakeUpdater.checkForUpdates.mockReset()
    fakeUpdater.downloadUpdate.mockReset()
    fakeUpdater.quitAndInstall.mockReset()
    fakeUpdater.on.mockReset()
    setUpdaterForTests(fakeUpdater as never)
  })

  it('uses the GitHub provider for the default feed', () => {
    expect(resolveUpdaterFeed('', 'stable')).toEqual({
      provider: 'github',
      owner: 'karthik-ak-Git',
      repo: 'SOVARA',
    })
  })

  it('uses latest.yml for a custom update mirror and beta metadata', () => {
    expect(resolveUpdaterFeed('https://updates.example.test/latest.yml', 'beta')).toEqual({
      provider: 'generic',
      url: 'https://updates.example.test/latest-beta.yml',
    })
  })

  it('connects settings to the updater policy', () => {
    configureUpdater(fakeUpdater as never, {
      autoUpdates: true,
      updateFeedUrl: '',
      updateChannel: 'beta',
    })
    expect(fakeUpdater.autoDownload).toBe(true)
    expect(fakeUpdater.autoInstallOnAppQuit).toBe(false)
    expect(fakeUpdater.allowPrerelease).toBe(true)
    expect(fakeUpdater.channel).toBe('beta')
  })

  it('returns an available result from electron-updater', async () => {
    fakeUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.0' } })
    const result = await checkForUpdatesWithManager({
      autoUpdates: true,
      updateFeedUrl: '',
      updateChannel: 'stable',
    })
    expect(result.status).toBe('available')
    expect(result.latest).toBe('1.2.0')
  })
})

describe('manual update download + install', () => {
  const SETTINGS = { autoUpdates: false, updateFeedUrl: '', updateChannel: 'stable' }

  /**
   * Reset the updater, register the manager's listeners by initializing it,
   * and return the captured listener map so tests can drive updater events.
   */
  function boot(): Map<string, (arg?: unknown) => void> {
    const listeners = new Map<string, (arg?: unknown) => void>()
    fakeUpdater.on.mockImplementation((event: string, cb: (arg?: unknown) => void) => {
      listeners.set(event, cb)
    })
    setUpdaterForTests(fakeUpdater as never)
    syncUpdateManager(SETTINGS)
    return listeners
  }

  beforeEach(() => {
    fakeUpdater.autoDownload = false
    fakeUpdater.autoInstallOnAppQuit = false
    fakeUpdater.allowDowngrade = false
    fakeUpdater.allowPrerelease = false
    fakeUpdater.channel = null
    fakeUpdater.setFeedURL.mockReset()
    fakeUpdater.checkForUpdates.mockReset()
    fakeUpdater.downloadUpdate.mockReset()
    fakeUpdater.quitAndInstall.mockReset()
    fakeUpdater.on.mockReset()
    fakeUpdater.downloadUpdate.mockResolvedValue([])
  })

  it('downloads an available update even when automatic updates are off', async () => {
    // Regression: autoDownload is bound to the "Automatic Updates" toggle, so a
    // detected update used to sit at "available" with no way to fetch it.
    const listeners = boot()
    fakeUpdater.checkForUpdates.mockResolvedValue({ updateInfo: { version: '1.2.0' } })

    const result = await checkForUpdatesWithManager(SETTINGS)
    expect(result.status).toBe('available')
    expect(fakeUpdater.autoDownload).toBe(false)
    expect(fakeUpdater.downloadUpdate).not.toHaveBeenCalled()

    downloadUpdateNow(SETTINGS)
    expect(fakeUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('marks the update as downloading before the transfer starts', () => {
    const listeners = boot()
    listeners.get('update-available')?.({ version: '1.2.0' })
    downloadUpdateNow(SETTINGS)
    // The manager emits `downloading` itself, so the install path must still
    // refuse until the updater reports the payload landed.
    expect(() => installDownloadedUpdate()).toThrow(/no downloaded update/i)
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('refuses a second download while one is already running', () => {
    const listeners = boot()
    listeners.get('update-available')?.({ version: '1.2.0' })
    // Force the manager into "downloading" via the updater's progress event.
    listeners.get('download-progress')?.({ percent: 20 })
    expect(() => downloadUpdateNow(SETTINGS)).toThrow(/already in progress/i)
    expect(fakeUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('installs only after the update reports downloaded', () => {
    const listeners = boot()
    // Nothing downloaded yet → install must refuse rather than claim success.
    expect(() => installDownloadedUpdate()).toThrow(/no downloaded update/i)
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled()

    listeners.get('update-downloaded')?.({ version: '1.2.0' })
    installDownloadedUpdate()
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('drops the downloaded marker when the download errors', () => {
    const listeners = boot()
    listeners.get('update-downloaded')?.({ version: '1.2.0' })
    listeners.get('error')?.({ message: 'network down' })
    // The stale version must not offer an install for a package that failed.
    expect(() => installDownloadedUpdate()).toThrow(/no downloaded update/i)
  })
})
