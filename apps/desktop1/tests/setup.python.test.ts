import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  VENV_DIR_NAME,
  browserSetupBin,
  getPythonStatus,
  requirementsHash,
  systemPythonCandidates,
  venvDir,
  venvPython,
} from '../src/main/services/pythonEnv'

describe('pythonEnv provisioner helpers', () => {
  it('starts idle with no interpreter', () => {
    expect(getPythonStatus()).toMatchObject({ phase: 'idle', pythonExe: null, source: null })
  })

  it('offers a platform-appropriate python candidate', () => {
    const candidates = systemPythonCandidates()
    expect(candidates.length).toBeGreaterThan(0)
    if (process.platform === 'win32') {
      expect(candidates).toContain('python')
    } else {
      expect(candidates).toContain('python3')
    }
  })

  it('resolves venv paths under a given userData dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-pyenv-'))
    try {
      expect(venvDir(dir)).toBe(path.join(dir, VENV_DIR_NAME))
      const exe = venvPython(venvDir(dir))
      if (process.platform === 'win32') {
        expect(exe.endsWith(path.join('Scripts', 'python.exe'))).toBe(true)
        expect(browserSetupBin(venvDir(dir)).endsWith('crawl4ai-setup.exe')).toBe(true)
      } else {
        expect(exe.endsWith(path.join('bin', 'python'))).toBe(true)
        expect(browserSetupBin(venvDir(dir)).endsWith(path.join('bin', 'crawl4ai-setup'))).toBe(true)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('hashes requirements.txt to a short stable hex', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-pyreq-'))
    try {
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'flask==3.1.1\n')
      const h1 = requirementsHash(dir)
      const h2 = requirementsHash(dir)
      expect(h1).toBe(h2)
      expect(h1).toMatch(/^[0-9a-f]{16}$/)
      // missing file hashes as empty (stable, distinct from content)
      expect(requirementsHash(path.join(dir, 'nope'))).toMatch(/^[0-9a-f]{16}$/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
