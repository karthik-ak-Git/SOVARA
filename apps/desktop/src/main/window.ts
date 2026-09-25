import { BrowserWindow, shell, app } from 'electron'
import { join } from 'node:path'

export async function createMainWindow(): Promise<BrowserWindow> {
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

  // ── CSP (sovereign default: file:// + loopback + Hugging Face Hub for Explore/downloads) ──
  // script-src 'unsafe-inline' kept for Vite HMR/style injection in dev; all
  // content originates from file:// (prod) or localhost Vite server (dev).
  const HF_CONNECT = "https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://*.hf.co https://huggingface.s3.amazonaws.com https://cdn.simpleicons.org"
  const HF_IMG = "https://huggingface.co https://*.huggingface.co https://cdn-avatars.huggingface.co https://*.hf.co https://cdn.simpleicons.org data: https:"
  const activeCsp =
    `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; img-src 'self' ${HF_IMG}; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* ${HF_CONNECT}; frame-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net blob: data:;`

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const isLoopback = details.url.startsWith('http://localhost:') || details.url.startsWith('http://127.0.0.1:') || details.url.startsWith('ws://localhost:') || details.url.startsWith('ws://127.0.0.1:')
    const isSubFrame = details.resourceType === 'subFrame'
    const headers = { ...details.responseHeaders }

    if (isLoopback || isSubFrame) {
      delete headers['X-Frame-Options']
      delete headers['x-frame-options']
      callback({ responseHeaders: headers })
      return
    }

    callback({
      responseHeaders: {
        ...headers,
        'Content-Security-Policy': [activeCsp],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY']
      }
    })
  })

  // Vite renderer — ELECTRON_RENDERER_URL injected by electron-vite in dev
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    console.log(`[shell] loading renderer: ${rendererUrl}`)
    await win.loadURL(rendererUrl)
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // ── Permission handler — deny all renderer permissions ──
  win.webContents.session.setPermissionCheckHandler((_wc, _permission, _requestingOrigin, _details) => false)
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

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
    // Allowlist: Hugging Face + GitHub + Local dev servers — everything else denied
      try {
        if (url.startsWith('blob:')) {
          return { action: 'allow' }
        }
        
        const u = new URL(url)
        const isLoopback = (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
        const allowedHosts = new Set<string>([
          'huggingface.co',
          'www.huggingface.co',
          'cdn-lfs.huggingface.co',
          'huggingface.s3.amazonaws.com',
          'github.com',
          'www.github.com',
          'raw.githubusercontent.com',
        ])
        const isAllowedHost =
          allowedHosts.has(u.hostname) ||
          u.hostname.endsWith('.huggingface.co') ||
          u.hostname.endsWith('.hf.co')
        if ((u.protocol === 'https:' && isAllowedHost) || isLoopback) {
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
