import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc/handlers'
import { disposeBackend } from './backendComposition'
import { stopWebServer } from './nextServer'
import { initPythonEnv } from './services/pythonEnv'
import { initVoiceServer } from './services/voiceServer'
import { initCrawlServer } from './services/crawlServer'

// Single-instance lock — second launch focuses existing window
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

let mainWindow: BrowserWindow | null = null

function onSecondInstance(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}
app.on('second-instance', onSecondInstance)

app.whenReady().then(async () => {
  registerIpcHandlers()
  // Python env first (sidecars resolve their interpreter through it).
  initPythonEnv()
  initVoiceServer()
  initCrawlServer()
  // The window loads the internal Next.js server; createMainWindow waits
  // for it (spawning the staged runtime when needed).
  mainWindow = await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow().then((w) => {
        mainWindow = w
      })
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (event) => {
  // Allow async dispose before quit — prevent half-flushed state
  event.preventDefault()
  try {
    stopWebServer()
    await disposeBackend()
  } finally {
    app.exit(0)
  }
})

// Security: deny webview
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})
