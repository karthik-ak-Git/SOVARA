import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectModelLocations } from '../src/main/services/modelLocations'

describe('detectModelLocations', () => {
  it('returns LM Studio then Ollama defaults under the home dir', () => {
    const locs = detectModelLocations({ homeDir: '/home/u', platform: 'linux', env: {} })
    expect(locs.map((l) => l.kind)).toEqual(['lmstudio', 'ollama'])
    expect(locs[0]?.path).toBe(path.join('/home/u', '.lmstudio', 'models'))
    expect(locs[1]?.path).toBe(path.join('/home/u', '.ollama', 'models'))
  })

  it('prefers the OLLAMA_MODELS env override for the Ollama path', () => {
    const locs = detectModelLocations({ homeDir: '/home/u', platform: 'linux', env: { OLLAMA_MODELS: '/data/ollama' } })
    expect(locs[1]?.path).toBe(path.resolve('/data/ollama'))
  })

  it('resolves a relative OLLAMA_MODELS against the cwd', () => {
    const locs = detectModelLocations({ homeDir: '/home/u', platform: 'darwin', env: { OLLAMA_MODELS: 'ollama' } })
    expect(locs[1]?.path).toBe(path.resolve('ollama'))
  })

  it.runIf(process.platform === 'win32')('dedupes by case-insensitive path on win32', () => {
    const locs = detectModelLocations({ homeDir: 'C:\\Users\\u', platform: 'win32', env: { OLLAMA_MODELS: 'c:\\users\\u\\.lmstudio\\models' } })
    expect(locs).toHaveLength(1)
    expect(locs[0]?.kind).toBe('lmstudio')
  })

  it.runIf(process.platform === 'linux')('dedupes by exact-case path on linux', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-linux-'))
    try {
      const home = path.join(root, 'home')
      const lmstudio = path.join(home, '.lmstudio', 'models')
      fs.mkdirSync(lmstudio, { recursive: true })
      const locs = detectModelLocations({ homeDir: home, platform: 'linux', env: { OLLAMA_MODELS: lmstudio } })
      expect(locs).toHaveLength(1)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('marks missing folders with exists=false and modelCount=0', () => {
    const locs = detectModelLocations({ homeDir: '/home/definitely-missing', platform: 'linux', env: {} })
    expect(locs.every((l) => l.exists === false)).toBe(true)
    expect(locs.every((l) => l.modelCount === 0)).toBe(true)
  })

  it('counts .gguf weights under an LM Studio models folder (recursive)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-test-'))
    fs.mkdirSync(path.join(root, 'publisher', 'repo'), { recursive: true })
    fs.writeFileSync(path.join(root, 'publisher', 'repo', 'model-GGUF.bin'), 'x')
    fs.writeFileSync(path.join(root, 'publisher', 'repo', 'model.GGUF'), 'x')
    fs.writeFileSync(path.join(root, 'publisher', 'repo', 'tokenizer.json'), 'x')
    try {
      const home = path.join(root, 'home')
      fs.mkdirSync(path.join(home, '.lmstudio', 'models'), { recursive: true })
      fs.writeFileSync(path.join(home, '.lmstudio', 'models', 'a.gguf'), 'x')
      fs.mkdirSync(path.join(home, '.lmstudio', 'models', 'sub'))
      fs.writeFileSync(path.join(home, '.lmstudio', 'models', 'sub', 'b.GGUF'), 'x')
      const locs = detectModelLocations({ homeDir: home, platform: 'linux', env: {} })
      expect(locs[0]?.exists).toBe(true)
      expect(locs[0]?.modelCount).toBe(2)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('counts Ollama manifests (installed model tags) and ignores blob files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-manifest-test-'))
    const modelsDir = path.join(root, '.ollama', 'models')
    fs.mkdirSync(path.join(modelsDir, 'blobs'), { recursive: true })
    fs.mkdirSync(path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library'), { recursive: true })
    fs.writeFileSync(path.join(modelsDir, 'blobs', 'sha256-aaa'), 'x')
    fs.writeFileSync(path.join(modelsDir, 'blobs', 'sha256-bbb'), 'x')
    fs.writeFileSync(path.join(modelsDir, 'blobs', 'sha256-ccc'), 'x')
    fs.writeFileSync(path.join(modelsDir, 'blobs', 'sha256-ddd'), 'x')
    fs.mkdirSync(path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library', 'llama3', 'latest'), { recursive: true })
    fs.mkdirSync(path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library', 'qwen3', '8b'), { recursive: true })
    fs.writeFileSync(path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library', 'llama3', 'latest', 'index.json'), 'x')
    fs.writeFileSync(path.join(modelsDir, 'manifests', 'registry.ollama.ai', 'library', 'qwen3', '8b', 'index.json'), 'x')
    try {
      const locs = detectModelLocations({ homeDir: root, platform: 'linux', env: {} })
      const ollama = locs.find((l) => l.kind === 'ollama')
      expect(ollama?.exists).toBe(true)
      expect(ollama?.modelCount).toBe(2)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns zero for an Ollama folder with blobs but no manifests', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-nomanifest-test-'))
    const modelsDir = path.join(root, '.ollama', 'models')
    fs.mkdirSync(path.join(modelsDir, 'blobs'), { recursive: true })
    fs.writeFileSync(path.join(modelsDir, 'blobs', 'sha256-aaa'), 'x')
    fs.writeFileSync(path.join(modelsDir, 'blobs', 'sha256-bbb'), 'x')
    try {
      const locs = detectModelLocations({ homeDir: root, platform: 'linux', env: {} })
      const ollama = locs.find((l) => l.kind === 'ollama')
      expect(ollama?.exists).toBe(true)
      expect(ollama?.modelCount).toBe(0)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('detects the legacy LM Studio cache models folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-cache-test-'))
    try {
      const home = path.join(root, 'home')
      const cache = path.join(home, '.cache', 'lm-studio', 'models')
      fs.mkdirSync(cache, { recursive: true })
      fs.writeFileSync(path.join(cache, 'legacy.gguf'), 'x')
      const locs = detectModelLocations({ homeDir: home, platform: 'linux', env: {} })
      const cacheLoc = locs.find((l) => l.path === cache)
      expect(cacheLoc).toBeDefined()
      expect(cacheLoc?.kind).toBe('lmstudio')
      expect(cacheLoc?.path).toBe(cache)
      expect(cacheLoc?.exists).toBe(true)
      expect(cacheLoc?.modelCount).toBe(1)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('prefers a models folder configured in LM Studio settings (downloadsFolder)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-settings-test-'))
    try {
      const home = path.join(root, 'home')
      const settingsDir = path.join(home, '.config', 'LM Studio')
      const modelsRoot = path.join(root, 'external', 'models')
      fs.mkdirSync(settingsDir, { recursive: true })
      fs.mkdirSync(modelsRoot, { recursive: true })
      fs.writeFileSync(path.join(modelsRoot, 'big.gguf'), 'x')
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({ downloadsFolder: modelsRoot }))
      const locs = detectModelLocations({ homeDir: home, platform: 'linux', env: {} })
      expect(locs[0]?.kind).toBe('lmstudio')
      expect(locs[0]?.path).toBe(modelsRoot)
      expect(locs[0]?.exists).toBe(true)
      expect(locs[0]?.modelCount).toBe(1)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to older LM Studio settings keys (paths.models, modelsDirectory)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-legacykey-test-'))
    try {
      const home = path.join(root, 'home')
      const settingsDir = path.join(home, '.config', 'LM Studio')
      fs.mkdirSync(settingsDir, { recursive: true })
      const pathsModels = path.join(root, 'via-paths')
      fs.mkdirSync(pathsModels, { recursive: true })
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({ paths: { models: pathsModels } }))
      const viaPaths = detectModelLocations({ homeDir: home, platform: 'linux', env: {} })
      expect(viaPaths[0]?.path).toBe(pathsModels)

      const viaModelsDirectory = path.join(root, 'via-directory')
      fs.mkdirSync(viaModelsDirectory, { recursive: true })
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({ modelsDirectory: viaModelsDirectory }))
      const viaDirectory = detectModelLocations({ homeDir: home, platform: 'linux', env: {} })
      expect(viaDirectory[0]?.path).toBe(viaModelsDirectory)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('expands ~ in a configured LM Studio models folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-tilde-test-'))
    try {
      const home = path.join(root, 'home')
      const settingsDir = path.join(home, '.config', 'LM Studio')
      const expanded = path.join(home, 'my', 'models')
      fs.mkdirSync(settingsDir, { recursive: true })
      fs.mkdirSync(expanded, { recursive: true })
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({ downloadsFolder: '~/my/models' }))
      const locs = detectModelLocations({ homeDir: home, platform: 'linux', env: {} })
      expect(locs[0]?.path).toBe(expanded)
      expect(locs[0]?.exists).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('lists a configured models folder even when it is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-missing-override-'))
    try {
      const home = path.join(root, 'home')
      const settingsDir = path.join(home, '.config', 'LM Studio')
      const missing = path.join(root, 'gone', 'models')
      fs.mkdirSync(settingsDir, { recursive: true })
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({ downloadsFolder: missing }))
      const locs = detectModelLocations({ homeDir: home, platform: 'linux', env: {} })
      expect(locs[0]?.path).toBe(missing)
      expect(locs[0]?.exists).toBe(false)
      expect(locs[0]?.modelCount).toBe(0)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === 'win32')('reads LM Studio settings from %APPDATA% on win32', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-appdata-test-'))
    try {
      const appData = path.join(root, 'AppData', 'Roaming')
      const settingsDir = path.join(appData, 'LM Studio')
      const modelsRoot = path.join(root, 'external', 'models')
      fs.mkdirSync(settingsDir, { recursive: true })
      fs.mkdirSync(modelsRoot, { recursive: true })
      fs.writeFileSync(path.join(modelsRoot, 'win.gguf'), 'x')
      fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({ downloadsFolder: modelsRoot }))
      const locs = detectModelLocations({ homeDir: path.join(root, 'Users', 'u'), platform: 'win32', env: { APPDATA: appData } })
      expect(locs[0]?.kind).toBe('lmstudio')
      expect(locs[0]?.path).toBe(modelsRoot)
      expect(locs[0]?.exists).toBe(true)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns zero for an empty LM Studio folder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmstudio-empty-test-'))
    try {
      const home = path.join(root, 'home')
      fs.mkdirSync(path.join(home, '.lmstudio', 'models'), { recursive: true })
      const locs = detectModelLocations({ homeDir: home, platform: 'darwin', env: {} })
      expect(locs[0]?.exists).toBe(true)
      expect(locs[0]?.modelCount).toBe(0)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns zero for an Ollama folder without a manifests subfolder', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-empty-test-'))
    try {
      const home = path.join(root, 'home')
      fs.mkdirSync(path.join(home, '.ollama', 'models'), { recursive: true })
      const locs = detectModelLocations({ homeDir: home, platform: 'linux', env: {} })
      expect(locs[1]?.exists).toBe(true)
      expect(locs[1]?.modelCount).toBe(0)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})