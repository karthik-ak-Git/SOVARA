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
  app: { getVersion: () => '1.1.2', isPackaged: false },
}))

vi.mock('electron-updater', () => ({ default: { autoUpdater: fakeUpdater } }))

import {
  checkForUpdatesWithManager,
  configureUpdater,
  resolveUpdaterFeed,
  setUpdaterForTests,
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
