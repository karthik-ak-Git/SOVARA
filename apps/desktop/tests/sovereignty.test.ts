import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

function scan(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'out') continue
      out.push(...scan(p, exts))
    } else if (exts.some((e) => p.endsWith(e))) out.push(p)
  }
  return out
}

describe('Commit 1 sovereignty guards', () => {
  it('no Cordis import in shipped code', () => {
    const files = scan('src', ['.ts', '.tsx'])
    for (const f of files) {
      const txt = fs.readFileSync(f, 'utf8')
      expect(txt, `Cordis import found in ${f}`).not.toMatch(/@deepseek-ai\/cordis|dsh-agent-loop|dsh-session/)
    }
  })
  it('no Python spawn in shipped code', () => {
    const files = scan('src', ['.ts', '.tsx'])
    for (const f of files) {
      const txt = fs.readFileSync(f, 'utf8')
      // allow mentioning the word Python in comments, but not spawn('python' / 'run_agent')
      expect(txt, `Python spawn found in ${f}`).not.toMatch(/spawn\s*\(\s*['"]python/)
      expect(txt, `run_agent found in ${f}`).not.toMatch(/run_agent\.py/)
    }
  })
  it('no bare fetch outside the single HttpClient boundary (Commit 6)', () => {
    const files = scan('src', ['.ts', '.tsx'])
    for (const f of files) {
      const txt = fs.readFileSync(f, 'utf8')
      if (/\bfetch\s*\(/.test(txt)) {
        // Exceptions: HttpClient (loopback inference), hfCatalog + explorerCatalog (Hub API), modelDownloads (Hub file downloads), skillsScanner (skill import from URL)
        const rel = f.replace(/\\/g, '/')
        expect(rel, `bare fetch outside HttpClient: ${f}`).toMatch(/(main\/network\/HttpClient\.ts|main\/services\/hfCatalog\.ts|main\/services\/explorerCatalog\.ts|main\/services\/modelDownloads\.ts|main\/services\/skillsScanner\.ts)$/)
      }
    }
  })
  it('preload does not expose raw ipcRenderer', () => {
    const txt = fs.readFileSync('src/preload/preload.ts', 'utf8')
    expect(txt).not.toMatch(/exposeInMainWorld.*ipcRenderer/)
    // must use contextBridge with filtered alias — we check it whitelists
    expect(txt).toMatch(/ALLOWED_INVOKE/)
    expect(txt).toMatch(/contextBridge/)
  })
})
