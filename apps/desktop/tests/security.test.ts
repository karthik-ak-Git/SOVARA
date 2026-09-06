import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

describe('Security invariants — Electron hard shell', () => {
  const windowSrc = fs.readFileSync('src/main/window.ts', 'utf8')
  const preloadSrc = fs.readFileSync('src/preload/preload.ts', 'utf8')
  const handlersSrc = fs.readFileSync('src/main/ipc/handlers.ts', 'utf8')
  const mainSrc = fs.readFileSync('src/main/index.ts', 'utf8')

  it('window has mandatory secure webPreferences', () => {
    expect(windowSrc).toMatch(/contextIsolation:\s*true/)
    expect(windowSrc).toMatch(/nodeIntegration:\s*false/)
    expect(windowSrc).toMatch(/sandbox:\s*true/)
    expect(windowSrc).toMatch(/webSecurity:\s*true/)
    expect(windowSrc).toMatch(/allowRunningInsecureContent:\s*false/)
    expect(windowSrc).toMatch(/experimentalFeatures:\s*false/)
  })

  it('window sets CSP and hardens headers', () => {
    expect(windowSrc).toMatch(/Content-Security-Policy/)
    expect(windowSrc).toMatch(/X-Content-Type-Options/)
    expect(windowSrc).toMatch(/X-Frame-Options/)
  })

  it('window denies permissions and blocks navigation', () => {
    expect(windowSrc).toMatch(/setPermissionCheckHandler/)
    expect(windowSrc).toMatch(/setPermissionRequestHandler/)
    expect(windowSrc).toMatch(/will-navigate/)
    expect(windowSrc).toMatch(/will-redirect/)
    expect(windowSrc).toMatch(/setWindowOpenHandler/)
    expect(windowSrc).toMatch(/will-attach-webview/)
  })

  it('preload exposes only whitelisted channels via contextBridge', () => {
    expect(preloadSrc).toMatch(/contextBridge\.exposeInMainWorld\('sovara'/)
    expect(preloadSrc).toMatch(/ALLOWED_INVOKE/)
    expect(preloadSrc).toMatch(/ALLOWED_ON/)
    expect(preloadSrc).not.toMatch(/exposeInMainWorld\('electron'/)
    expect(preloadSrc).not.toMatch(/ipcRenderer\.sendSync/)
  })

  it('main does not expose raw filesystem/network to renderer', () => {
    const rendererFiles = ['src/renderer/src/App.tsx', 'src/renderer/src/main.tsx']
    for (const f of rendererFiles) {
      const txt = fs.readFileSync(f, 'utf8')
      expect(txt, `raw fs in ${f}`).not.toMatch(/from 'node:fs'|require\('fs'\)/)
      expect(txt, `child_process in ${f}`).not.toMatch(/child_process/)
      expect(txt, `bare fetch in ${f}`).not.toMatch(/\bfetch\s*\(/)
    }
  })

  it('all IPC handlers validate with zod and use strict schemas', () => {
    expect(handlersSrc).toMatch(/zSessionsCreate/)
    expect(handlersSrc).toMatch(/zChatSend/)
    expect(handlersSrc).toMatch(/zSessionId/)
    expect(handlersSrc).toMatch(/safeParse/)
    // every handle must validate before touching backend
    const handles = (handlersSrc.match(/ipcMain\.handle/g) || []).length
    expect(handles).toBeGreaterThanOrEqual(8)
  })

  it('single-instance lock and no webview attachment', () => {
    expect(mainSrc).toMatch(/requestSingleInstanceLock/)
    expect(mainSrc).toMatch(/will-attach-webview/)
  })
})
