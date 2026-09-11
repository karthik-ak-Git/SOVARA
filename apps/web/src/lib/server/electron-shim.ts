/**
 * Minimal server-only `electron` shim for the Next.js internal server.
 *
 * The reused backend (`apps/desktop/src/main/**`) imports `{ app }` from
 * 'electron' but only uses it for:
 *   - app.isReady() / app.getPath('userData') / app.getAppPath()
 *   - app.getVersion()
 * Every call site already falls back to `SOVARA_DATA_DIR` when the Electron
 * app is not ready, so this shim reports "not ready" and resolves the same
 * OS-appropriate data directory the Electron build uses. No Electron runtime
 * is required; the shim throws if it ever leaks into a browser bundle.
 */

import os from 'node:os'
import path from 'node:path'

if (typeof window !== 'undefined') {
  throw new Error('electron-shim is server-only and must never run in the browser')
}

function resolveUserData(): string {
  const env = process.env['SOVARA_DATA_DIR']
  if (env) return path.resolve(env)
  const platform = process.platform
  if (platform === 'win32') {
    const base = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(base, 'Sovara')
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Sovara')
  }
  const base = process.env['XDG_CONFIG_HOME'] ?? path.join(os.homedir(), '.config')
  return path.join(base, 'Sovara')
}

function resolveVersion(): string {
  return process.env['SOVARA_VERSION'] ?? '0.1.0'
}

export const app = {
  isReady(): boolean {
    // Deliberately false: every backend call site falls back to
    // SOVARA_DATA_DIR / the OS app-data path (see storage/paths.ts).
    return false
  },
  getVersion(): string {
    return resolveVersion()
  },
  getAppPath(): string {
    return process.cwd()
  },
  getPath(name: string): string {
    if (name === 'userData') return resolveUserData()
    if (name === 'temp') return os.tmpdir()
    if (name === 'home') return os.homedir()
    throw new Error(`electron-shim: unsupported app.getPath(${JSON.stringify(name)})`)
  },
}

export default { app }
