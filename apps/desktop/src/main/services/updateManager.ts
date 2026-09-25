import { app } from 'electron'
import { autoUpdater, type AppUpdater, type UpdateInfo } from 'electron-updater'
import { compareVersions, DEFAULT_UPDATE_FEED_URL, type UpdateCheckResult } from './updateFeed'

export const UPDATE_REPO_OWNER = 'karthik-ak-Git'
export const UPDATE_REPO_NAME = 'SOVARA'
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdatePhase =
  | 'disabled'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'current'
  | 'error'

export interface UpdateEvent {
  status: UpdatePhase
  current: string
  latest: string | null
  message: string
  percent?: number
}

export interface UpdateSettings {
  autoUpdates: boolean
  updateFeedUrl: string
  updateChannel: string
}

type Updater = Pick<AppUpdater,
  'autoDownload' | 'autoInstallOnAppQuit' | 'allowDowngrade' | 'allowPrerelease' |
  'channel' | 'setFeedURL' | 'checkForUpdates' | 'downloadUpdate' | 'quitAndInstall' |
  'on'>

type Broadcast = (event: UpdateEvent) => void
type FeedConfiguration = Exclude<Parameters<Updater['setFeedURL']>[0], string>
type IntervalHandle = ReturnType<typeof setInterval>

let updater: Updater = autoUpdater
let initialized = false
let broadcast: Broadcast = () => {}
let interval: IntervalHandle | null = null
let installRequested = false
let lastEvent: UpdateEvent | null = null

function currentVersion(): string {
  return app.getVersion()
}

function emit(event: UpdateEvent): void {
  lastEvent = event
  broadcast(event)
}

function isDefaultGitHubFeed(value: string): boolean {
  const normalized = value.trim().replace(/\/+$/, '')
  return !normalized || normalized === DEFAULT_UPDATE_FEED_URL || normalized === `${DEFAULT_UPDATE_FEED_URL}/`
}

/**
 * Resolve the electron-updater feed. The default remains the GitHub Releases
 * provider. A custom URL is treated as a generic electron-builder `latest.yml`
 * endpoint; plain JSON/version APIs are useful for the read-only feed check
 * but cannot install a signed NSIS update.
 */
export function resolveUpdaterFeed(feedUrl: string, channel: string): FeedConfiguration {
  const raw = feedUrl.trim()
  if (isDefaultGitHubFeed(raw)) {
    return { provider: 'github', owner: UPDATE_REPO_OWNER, repo: UPDATE_REPO_NAME }
  }

  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol')
    const filename = channel === 'beta' ? 'latest-beta.yml' : 'latest.yml'
    if (!/\/latest(?:-beta)?\.ya?ml$/i.test(url.pathname)) {
      return { provider: 'github', owner: UPDATE_REPO_OWNER, repo: UPDATE_REPO_NAME }
    }
    const pathname = url.pathname.replace(/\/latest(?:-beta)?\.ya?ml$/i, `/${filename}`)
    return { provider: 'generic', url: `${url.origin}${pathname}${url.search}` }
  } catch {
    return { provider: 'github', owner: UPDATE_REPO_OWNER, repo: UPDATE_REPO_NAME }
  }
}

export function configureUpdater(target: Updater, settings: UpdateSettings): void {
  target.autoDownload = settings.autoUpdates
  // Downloading is automatic; installation stays an explicit user action.
  target.autoInstallOnAppQuit = false
  target.allowDowngrade = false
  target.allowPrerelease = settings.updateChannel === 'beta'
  target.channel = settings.updateChannel === 'beta' ? 'beta' : null
  target.setFeedURL(resolveUpdaterFeed(settings.updateFeedUrl, settings.updateChannel))
}

function updateMessage(info: UpdateInfo): string {
  return `Sovara ${info.version} is available.`
}

function installEvent(): UpdateEvent | null {
  return lastEvent?.status === 'downloaded' ? lastEvent : null
}

function ensureEventListeners(): void {
  if (initialized) return
  initialized = true

  updater.on('checking-for-update', () => {
    emit({ status: 'checking', current: currentVersion(), latest: lastEvent?.latest ?? null, message: 'Checking for Sovara updates…' })
  })
  updater.on('update-available', (info) => {
    emit({ status: 'available', current: currentVersion(), latest: info.version, message: updateMessage(info) })
  })
  updater.on('update-not-available', (info) => {
    emit({ status: 'current', current: currentVersion(), latest: info.version, message: `Sovara is up to date (${currentVersion()}).` })
  })
  updater.on('download-progress', (progress) => {
    emit({
      status: 'downloading',
      current: currentVersion(),
      latest: lastEvent?.latest ?? null,
      percent: Math.round(progress.percent),
      message: `Downloading update… ${Math.round(progress.percent)}%`,
    })
  })
  updater.on('update-downloaded', (info) => {
    emit({
      status: 'downloaded',
      current: currentVersion(),
      latest: info.version,
      percent: 100,
      message: `Sovara ${info.version} is ready. Restart to install it.`,
    })
  })
  updater.on('error', (error) => {
    emit({ status: 'error', current: currentVersion(), latest: lastEvent?.latest ?? null, message: `Update failed: ${error.message}` })
  })
}

export function initializeUpdateManager(nextBroadcast: Broadcast): void {
  broadcast = nextBroadcast
  ensureEventListeners()
}

export function syncUpdateManager(settings: UpdateSettings): void {
  initializeUpdateManager(broadcast)
  configureUpdater(updater, settings)
}

export async function checkForUpdatesWithManager(settings: UpdateSettings): Promise<UpdateCheckResult> {
  const current = currentVersion()
  if (!settings.autoUpdates && !settings.updateFeedUrl.trim()) {
    return { status: 'no-feed', current, latest: null, message: 'Automatic updates are disabled and no update feed is configured.' }
  }

  syncUpdateManager(settings)
  emit({ status: 'checking', current, latest: lastEvent?.latest ?? null, message: 'Checking for Sovara updates…' })
  try {
    const result = await updater.checkForUpdates()
    if (!result) {
      const message = 'The update provider is not configured for this build.'
      emit({ status: 'error', current, latest: null, message })
      return { status: 'error', current, latest: null, message }
    }
    const latest = result.updateInfo.version
    if (compareVersions(latest, current) > 0) {
      return { status: 'available', current, latest, message: `Update available: ${latest}.` }
    }
    return { status: 'current', current, latest, message: `You're up to date (${current}).` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ status: 'error', current, latest: lastEvent?.latest ?? null, message: `Could not check for updates: ${message}` })
    return { status: 'error', current, latest: lastEvent?.latest ?? null, message: `Could not check for updates: ${message}` }
  }
}

export function startAutomaticUpdates(getSettings: () => UpdateSettings, nextBroadcast: Broadcast): void {
  initializeUpdateManager(nextBroadcast)
  if (!app.isPackaged) return

  const run = (): void => {
    const settings = getSettings()
    syncUpdateManager(settings)
    if (!settings.autoUpdates) {
      emit({ status: 'disabled', current: currentVersion(), latest: null, message: 'Automatic updates are disabled.' })
      return
    }
    void checkForUpdatesWithManager(settings)
  }

  run()
  if (interval !== null) clearInterval(interval)
  interval = setInterval(run, UPDATE_CHECK_INTERVAL_MS)
  interval.unref?.()
}

export function installDownloadedUpdate(): void {
  const downloaded = installEvent()
  if (!downloaded) throw new Error('No downloaded update is ready to install.')
  installRequested = true
  updater.quitAndInstall(false, true)
}

export function isUpdateInstallInProgress(): boolean {
  return installRequested
}

export function getLastUpdateEvent(): UpdateEvent | null {
  return lastEvent
}

/** Test seam: avoids constructing Electron's singleton in unit tests. */
export function setUpdaterForTests(nextUpdater: Updater): void {
  updater = nextUpdater
  initialized = false
  lastEvent = null
  if (interval !== null) clearInterval(interval)
  interval = null
}
