import { BrowserWindow, shell, app } from 'electron'
import { join } from 'node:path'
import { ensureWebServer } from './nextServer'

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

  // ── CSP (sovereign default: no external connects except loopback + Hugging Face Hub for Explore/downloads) ──
  // script-src keeps 'unsafe-inline': Next.js ships inline bootstrap/flight
  // data with its loopback-served pages. All page content still comes only
  // from our own loopback server (see navigation allowlist below).
  const HF_CONNECT = "https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://*.hf.co https://huggingface.s3.amazonaws.com https://cdn.simpleicons.org"
  const HF_IMG = "https://huggingface.co https://*.huggingface.co https://cdn-avatars.huggingface.co https://*.hf.co https://cdn.simpleicons.org data: https:"
  const isDev = process.env['NODE_ENV'] === 'development' || Boolean(process.env['SOVARA_WEB_URL'])
  const devCsp =
    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' ${HF_IMG}; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* ${HF_CONNECT}`
  const prodCsp =
    `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' ${HF_IMG}; font-src 'self' data:; connect-src 'self' http://127.0.0.1:* http://localhost:* ${HF_CONNECT}`
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

  // Shell loads the internal Next.js server (UI + /api) on loopback.
  // The legacy Vite renderer bundle is gone — see src/main/nextServer.ts.
  try {
    const webUrl = await ensureWebServer()
    console.log(`[shell] loading web UI: ${webUrl}`)
    await win.loadURL(webUrl)
  } catch (e) {
    console.error('[shell] web server unavailable:', e instanceof Error ? e.message : String(e))
    await win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          '<body style="background:#0b0d12;color:#e8eaf0;font-family:sans-serif;padding:48px">' +
            '<h1>Sovara could not start its interface server</h1>' +
            '<p>Run <code>scripts/stage-web-runtime.ps1</code> then rebuild, or start <code>pnpm dev:web</code> alongside the app.</p></body>'
        )
    )
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
    // Allowlist: Hugging Face + GitHub only — everything else denied
    try {
      const u = new URL(url)
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
      if (u.protocol === 'https:' && isAllowedHost) {
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
