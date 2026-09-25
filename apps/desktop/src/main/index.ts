// Silence Node 22 ExperimentalWarning for node:sqlite (used in db.ts)
process.on('warning', (w: Error & { name?: string }) => {
  if (w?.name === 'ExperimentalWarning' && String(w.message).includes('SQLite')) return
})
import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { registerIpcHandlers } from './ipc/handlers'
import { disposeBackend } from './backendComposition'

app.setName('Sovara')

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
    await disposeBackend()
  } finally {
    app.exit(0)
  }
})

// Security: deny webview
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault())
})
