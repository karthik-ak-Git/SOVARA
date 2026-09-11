import { existsSync, lstatSync, readFileSync, readdirSync, statSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { getSovaraDataDir, ensureDir } from '../storage/paths'

export type DetectedModelLocationKind = 'lmstudio' | 'ollama'

export interface DetectedModelLocation {
  kind: DetectedModelLocationKind
  name: string
  path: string
  exists: boolean
  modelCount: number
}

export interface ModelLocationsOptions {
  homeDir: string
  platform: NodeJS.Platform
  env?: NodeJS.ProcessEnv
}

const MAX_WEIGHT_FILES = 500

export function detectModelLocations(opts: ModelLocationsOptions): DetectedModelLocation[] {
  const t0 = Date.now()
  const env = opts.env ?? ({} as NodeJS.ProcessEnv)
  const candidates = buildCandidates(opts.homeDir, opts.platform, env)
  const seen = new Set<string>()
  const locations: DetectedModelLocation[] = []
  const logs: Array<{ path: string; kind: string; exists: boolean; modelCount: number; ms: number }> = []
  for (const candidate of candidates) {
    const key = opts.platform === 'linux' ? candidate.path : candidate.path.toLowerCase()
    if (seen.has(key)) {
      logDetection({ level: 'debug', event: 'dedupe', kind: candidate.kind, path: candidate.path, platform: opts.platform })
      continue
    }
    seen.add(key)
    const s0 = Date.now()
    const exists = isDirectory(candidate.path)
    const modelCount = exists ? countWeights(candidate.path, candidate.kind) : 0
    const ms = Date.now() - s0
    locations.push({ kind: candidate.kind, name: candidate.name, path: candidate.path, exists, modelCount })
    logs.push({ path: candidate.path, kind: candidate.kind, exists, modelCount, ms })
    logDetection({ level: exists ? 'info' : 'debug', event: 'probe', kind: candidate.kind, path: candidate.path, exists, modelCount, ms, platform: opts.platform })
  }
  logDetection({
    level: 'info',
    event: 'detect-done',
    platform: opts.platform,
    homeDir: opts.homeDir,
    candidates: candidates.length,
    unique: locations.length,
    found: locations.filter((l) => l.exists).length,
    totalMs: Date.now() - t0,
    results: logs,
  })
  return locations
}

function logDetection(entry: Record<string, unknown>): void {
  try { console.info('[detection]', JSON.stringify({ iso: new Date().toISOString(), ...entry })) } catch { /* ignore */ }
  try {
    let dir: string
    try { dir = join(getSovaraDataDir(undefined), 'logs') } catch { dir = join(require('node:os').tmpdir(), 'sovara-logs') }
    ensureDir(dir)
    const file = join(dir, 'detection.log')
    try {
      const st = statSync(file)
      if (st.size > 1_000_000) {
        const { renameSync } = require('node:fs') as typeof import('node:fs')
        try { renameSync(file, file + '.1') } catch { /* */ }
      }
    } catch { /* no file */ }
    appendFileSync(file, JSON.stringify({ time: Date.now(), iso: new Date().toISOString(), ...entry }) + '\n', 'utf8')
  } catch { /* never break detection */ }
}

function buildCandidates(
  homeDir: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): Array<{ kind: DetectedModelLocationKind; name: string; path: string }> {
  const candidates: Array<{ kind: DetectedModelLocationKind; name: string; path: string }> = []
  for (const dir of lmStudioDirs(homeDir, platform, env)) {
    candidates.push({ kind: 'lmstudio', name: 'LM Studio', path: dir })
  }
  for (const dir of ollamaDirs(homeDir, platform, env)) {
    candidates.push({ kind: 'ollama', name: 'Ollama', path: dir })
  }
  return candidates
}

function lmStudioDirs(homeDir: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = []
  const override = readLmStudioConfiguredDir(homeDir, platform, env)
  if (override) dirs.push(expandHome(override, homeDir))
  // Primary defaults (all platforms)
  dirs.push(join(homeDir, '.lmstudio', 'models'))
  // Platform-specific dynamic candidates
  if (platform === 'win32') {
    for (const d of winLmStudioCandidates(homeDir, env)) dirs.push(d)
  }
  const legacy = join(homeDir, '.cache', 'lm-studio', 'models')
  // Only include legacy if it exists to avoid noise, but keep home default always
  // Check dynamically — isDirectory is cheap
  if (isDirectory(legacy) && !dirs.includes(legacy)) dirs.push(legacy)
  return dirs
}

function ollamaDirs(homeDir: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = []
  const ollamaEnv = (env.OLLAMA_MODELS ?? '').trim()
  if (ollamaEnv) {
    dirs.push(resolve(ollamaEnv))
    return dirs
  }
  dirs.push(join(homeDir, '.ollama', 'models'))
  if (platform === 'win32') {
    for (const d of winOllamaCandidates(homeDir, env)) if (!dirs.includes(d)) dirs.push(d)
  }
  return dirs
}

function winLmStudioCandidates(homeDir: string, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = []
  const localAppData = (env.LOCALAPPDATA ?? '').trim()
  const programData = (env.ProgramData ?? env.PROGRAMDATA ?? '').trim()
  // LM Studio can be on any drive if user changed USERPROFILE; scan logical drives dynamically
  for (const drive of listWinDrives(env)) {
    const p = join(drive, 'Users', baseName(homeDir), '.lmstudio', 'models')
    if (!out.includes(p)) out.push(p)
    // C:\.cache style legacy on each drive
    const legacy = join(drive, '.cache', 'lm-studio', 'models')
    if (isDirectory(legacy) && !out.includes(legacy)) out.push(legacy)
  }
  if (localAppData) {
    const p = join(localAppData, 'LM Studio', 'models')
    if (!out.includes(p)) out.push(p)
  }
  if (programData) {
    const p = join(programData, 'LM Studio', 'models')
    if (!out.includes(p)) out.push(p)
  }
  // Also probe default C: explicitly even if drive list failed
  const cDefault = 'C:\\Users\\' + baseName(homeDir) + '\\.lmstudio\\models'
  if (!out.includes(cDefault)) out.push(cDefault)
  return out
}

function winOllamaCandidates(homeDir: string, env: NodeJS.ProcessEnv): string[] {
  const out: string[] = []
  const localAppData = (env.LOCALAPPDATA ?? '').trim()
  if (localAppData) out.push(join(localAppData, 'Ollama', 'models'))
  for (const drive of listWinDrives(env)) {
    const p = join(drive, 'Users', baseName(homeDir), '.ollama', 'models')
    if (!out.includes(p)) out.push(p)
  }
  return out
}

function listWinDrives(env: NodeJS.ProcessEnv): string[] {
  const drives = new Set<string>()
  const sysDrive = (env.SystemDrive ?? env.SYSTEMDRIVE ?? 'C:').trim()
  if (/^[A-Za-z]:$/.test(sysDrive)) drives.add(sysDrive.toUpperCase())
  try {
    const raw = execSync('wmic logicaldisk get name', { timeout: 1500, encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','ignore'] } as any)
    for (const m of raw.matchAll(/([A-Za-z]:)/g)) drives.add(m[1].toUpperCase())
  } catch { /* ignore */ }
  if (drives.size === 0) drives.add('C:')
  return [...drives].map((d) => `${d}\\`)
}

function baseName(p: string): string {
  const parts = p.replace(/\/$/, '').split(/[/\\]/)
  return parts[parts.length - 1] ?? ''
}

function readLmStudioConfiguredDir(
  homeDir: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): string | undefined {
  let file: string
  if (platform === 'win32') {
    const appData = (env.APPDATA ?? '').trim()
    file = appData
      ? join(appData, 'LM Studio', 'settings.json')
      : join(homeDir, 'AppData', 'Roaming', 'LM Studio', 'settings.json')
  } else if (platform === 'darwin') {
    file = join(homeDir, 'Library', 'Application Support', 'LM Studio', 'settings.json')
  } else {
    file = join(homeDir, '.config', 'LM Studio', 'settings.json')
  }
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return undefined
  }
  const configured = pickLmStudioDirectory(data)
  return configured?.trim() || undefined
}

function pickLmStudioDirectory(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const node = data as Record<string, unknown>
  const candidates: string[] = []
  if (typeof node.downloadsFolder === 'string') {
    candidates.push(node.downloadsFolder)
  } else if (Array.isArray(node.downloadsFolder)) {
    for (const entry of node.downloadsFolder) {
      if (typeof entry === 'string') candidates.push(entry)
    }
  }
  const paths = node.paths
  if (paths && typeof paths === 'object') {
    const models = (paths as Record<string, unknown>).models
    if (typeof models === 'string') candidates.push(models)
  }
  if (typeof node.modelsDirectory === 'string') candidates.push(node.modelsDirectory)
  return candidates.find((candidate) => candidate.trim().length > 0)
}

function expandHome(filePath: string, homeDir: string): string {
  if (filePath === '~') return homeDir
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) return join(homeDir, filePath.slice(2))
  if (filePath.startsWith('~')) return join(homeDir, filePath.slice(1))
  return filePath
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory()
  } catch {
    return false
  }
}

function countWeights(root: string, kind: DetectedModelLocationKind): number {
  if (kind === 'ollama') return countInstalledModels(root)
  const budget = { remaining: MAX_WEIGHT_FILES }
  walk(root, (name) => name.toLowerCase().endsWith('.gguf'), budget)
  return MAX_WEIGHT_FILES - budget.remaining
}

function countInstalledModels(root: string): number {
  const manifests = join(root, 'manifests')
  if (!isDirectory(manifests)) return 0
  const budget = { remaining: MAX_WEIGHT_FILES }
  walk(manifests, () => true, budget)
  return MAX_WEIGHT_FILES - budget.remaining
}

function walk(dir: string, accept: (name: string) => boolean, budget: { remaining: number }): void {
  if (budget.remaining <= 0) return
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (budget.remaining <= 0) return
    const full = join(dir, name)
    let stat
    try {
      stat = lstatSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) {
      walk(full, accept, budget)
    } else if (stat.isFile() && accept(name)) {
      budget.remaining -= 1
    }
  }
}