import { BrowserWindow, shell, app } from 'electron'
import { join } from 'node:path'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#ffffff',
    title: 'Sovara',
    autoHideMenuBar: true,
    webPreferences: {
      // Electron sandboxed preloads require CommonJS (.cjs)
      preload: join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    }
  })

  // Ready-to-show avoids white flash
  win.on('ready-to-show', () => win.show())

  // Diagnostic logging for renderer runtime health
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer console][lvl:${level}] ${message} (${sourceId}:${line})`)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer did-fail-load] ${errorCode}: ${errorDescription} at ${validatedURL}`)
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[renderer preload-error] at ${preloadPath}:`, error)
  })

  // ── CSP (sovereign default: no external connects except loopback allowlisted in CSP) ──
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  const devCsp =
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src-elem 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; wasm-unsafe-eval"
  const prodCsp =
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; script-src-elem 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' http://127.0.0.1:* http://localhost:* https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net; wasm-unsafe-eval"
  const activeCsp = isDev ? devCsp : prodCsp

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [activeCsp],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY']
      }
    })
  })

  // HMR dev server vs built file — electron-vite injects ELECTRON_RENDERER_URL in dev
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ── Permission handler — allow mic, deny everything else ──
  win.webContents.session.setPermissionCheckHandler((_wc, permission, _requestingOrigin, _details) => {
    if (permission === 'media') return true
    return false
  })
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') { callback(true); return }
    callback(false)
  })

  // ── Navigation hijack block ──
  const isAllowedNav = (url: string): boolean =>
    url.startsWith('file://') || url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:')
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNav(url)) {
      event.preventDefault()
      console.warn(`[security] blocked will-navigate to ${url}`)
    }
  })
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNav(url)) {
      event.preventDefault()
      console.warn(`[security] blocked will-redirect to ${url}`)
    }
  })

  // ── New window block ──
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Allowlist only — everything else denied, never blindly shell.openExternal
    try {
      const u = new URL(url)
      const allowedHosts = new Set<string>([])
      if (u.protocol === 'https:' && allowedHosts.has(u.hostname)) {
        void shell.openExternal(u.toString())
      } else if (url !== 'about:blank') {
        console.warn(`[security] blocked window.open to ${url}`)
      }
    } catch {
      console.warn(`[security] rejected invalid window.open url: ${url}`)
    }
    return { action: 'deny' }
  })

  // ── Block webview attachment ──
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  return win
}
