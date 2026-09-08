import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { HardwareProfileFull, ModelProfile, ValidationResult, ValidationStoreEntry } from '@shared/types/validation'
import { hardwareFingerprint } from './hardwareProfile'
import { modelFingerprint } from './modelValidationRunner'

function storePath(baseDir?: string): string {
  const dir = baseDir ?? app.getPath('userData')
  return path.join(dir, 'validation-cache.json')
}

function loadAll(baseDir?: string): ValidationStoreEntry[] {
  try {
    const p = storePath(baseDir)
    if (!fs.existsSync(p)) return []
    const raw = fs.readFileSync(p, 'utf8')
    const arr = JSON.parse(raw) as ValidationStoreEntry[]
    return Array.isArray(arr) ? arr : []
  } catch { return [] }
}

function saveAll(entries: ValidationStoreEntry[], baseDir?: string): void {
  try {
    const p = storePath(baseDir)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(entries.slice(0, 200), null, 2), 'utf8')
  } catch { /* best-effort */ }
}

export function fingerprint(hw: HardwareProfileFull, profile: ModelProfile, runtimeVersion?: string): string {
  const hwFp = hardwareFingerprint(hw)
  const mFp = modelFingerprint(profile)
  return [hwFp, mFp, runtimeVersion ?? 'stub-0.1'].join('||')
}

export class ValidationStore {
  constructor(private baseDir?: string) {}

  getCached(hw: HardwareProfileFull, profile: ModelProfile, runtimeVersion?: string): ValidationStoreEntry | null {
    const fp = fingerprint(hw, profile, runtimeVersion)
    const all = loadAll(this.baseDir)
    const hit = all.find((e) => e.fingerprint === fp)
    return hit ?? null
  }

  put(result: ValidationResult, hw: HardwareProfileFull, profile: ModelProfile, runtimeVersion?: string): ValidationStoreEntry {
    const fp = fingerprint(hw, profile, runtimeVersion)
    const entry: ValidationStoreEntry = { ...result, fingerprint: fp, storedAt: Date.now() }
    const all = loadAll(this.baseDir)
    const idx = all.findIndex((e) => e.fingerprint === fp)
    if (idx >= 0) all.splice(idx, 1)
    all.unshift(entry)
    saveAll(all, this.baseDir)
    return entry
  }

  list(): ValidationStoreEntry[] { return loadAll(this.baseDir) }

  /** Cache invalidation check per docs 25: returns true if cached entry is still valid for current env */
  isStillValid(cached: ValidationStoreEntry, hw: HardwareProfileFull, profile: ModelProfile, runtimeVersion?: string): boolean {
    const cur = fingerprint(hw, profile, runtimeVersion)
    return cached.fingerprint === cur
  }

  clear(): void { saveAll([], this.baseDir) }
}
