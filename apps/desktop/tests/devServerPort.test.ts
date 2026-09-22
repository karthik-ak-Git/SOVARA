import { describe, it, expect } from 'vitest'
import { extractServerInfo, isServerCommand } from '../src/main/capabilities/shell/index'
import { extractLocalhostUrl, isLocalhostArtifact, bundleLocalhostPreview, isVisualArtifact } from '../src/renderer/src/utils/previewBundler'

describe('Dev Server Port & URL Detection', () => {
  it('detects standard Vite output with localhost port', () => {
    const viteOutput = `
  VITE v5.2.0  ready in 280 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
`
    const info = extractServerInfo(viteOutput)
    expect(info.port).toBe(5173)
    expect(info.url).toBe('http://localhost:5173')
    expect(info.allUrls).toContain('http://localhost:5173')
  })

  it('detects Next.js / React dev server on port 3000', () => {
    const nextOutput = `
   ▲ Next.js 14.1.0
   - Local:        http://localhost:3000
   - Experiments (turbo): true
`
    const info = extractServerInfo(nextOutput)
    expect(info.port).toBe(3000)
    expect(info.url).toBe('http://localhost:3000')
  })

  it('detects 127.0.0.1 loopback addresses and normalizes 0.0.0.0', () => {
    const pyOutput = `Serving HTTP on 0.0.0.0 port 8080 (http://0.0.0.0:8080/) ...`
    const info = extractServerInfo(pyOutput)
    expect(info.port).toBe(8080)
    expect(info.url).toBe('http://localhost:8080')
  })

  it('identifies server commands reliably', () => {
    expect(isServerCommand('npm run dev')).toBe(true)
    expect(isServerCommand('npm start')).toBe(true)
    expect(isServerCommand('pnpm dev')).toBe(true)
    expect(isServerCommand('yarn dev')).toBe(true)
    expect(isServerCommand('npx vite --port 3000')).toBe(true)
    expect(isServerCommand('python -m http.server 8000')).toBe(true)
    expect(isServerCommand('git status')).toBe(false)
    expect(isServerCommand('dir')).toBe(false)
    expect(isServerCommand('npm install')).toBe(false)
  })

  it('detects localhost URLs in previewBundler', () => {
    expect(extractLocalhostUrl('http://localhost:5173')).toBe('http://localhost:5173')
    expect(extractLocalhostUrl('App running at http://localhost:3000/dashboard')).toBe('http://localhost:3000/dashboard')
    expect(isLocalhostArtifact('http://localhost:5173')).toBe(true)
    expect(isLocalhostArtifact('http://127.0.0.1:8080')).toBe(true)
    expect(isVisualArtifact('http://localhost:5173')).toBe(true)
    expect(isVisualArtifact('http://localhost:3000', 'url')).toBe(true)
  })

  it('bundles live localhost server preview iframe with controls', () => {
    const html = bundleLocalhostPreview('http://localhost:5173')
    expect(html).toContain('http://localhost:5173')
    expect(html).toContain('<iframe id="previewFrame" src="http://localhost:5173"')
    expect(html).toContain('refreshFrame()')
    expect(html).toContain('openExternal()')
    expect(html).toContain('Live App')
  })
})
