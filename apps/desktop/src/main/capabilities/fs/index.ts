// @sovara/capability-fs — workspace FS seam, like harness fs/tool-fs + fs-local
// All paths are resolved against the Sovara workspace (Global or Project), never the repo root.

import fs from 'node:fs'
import path from 'node:path'

export const name = 'capability-fs'

export function resolveWorkspacePath(workspaceRoot: string, requested: string): string {
  let clean = (requested || '.').replace(/\\/g, '/').trim() || '.'
  const normRoot = path.resolve(workspaceRoot).replace(/\\/g, '/').toLowerCase()
  const normClean = clean.toLowerCase()

  // If the model passed an absolute path that is inside the workspace root:
  if (normClean === normRoot || normClean === normRoot + '/') {
    clean = '.'
  } else if (normClean.startsWith(normRoot + '/')) {
    clean = clean.slice(normRoot.length + 1) || '.'
  } else if (/^[a-z]:\//i.test(clean)) {
    // If it's an absolute path to another drive/path that doesn't match workspaceRoot,
    // strip the drive root prefix to treat it as workspace-relative instead of throwing
    clean = clean.replace(/^[a-z]:\/*/i, '') || '.'
  }

  // Prevent escape: resolve then ensure it stays inside workspaceRoot
  const abs = path.resolve(workspaceRoot, clean)
  const rel = path.relative(path.resolve(workspaceRoot), abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path escapes workspace: ${requested}`)
  return abs
}

export function getFsToolDefinitions() {
  return [
    {
      name: 'fs_list',
      toolset: 'fs' as const,
      description: 'List files and folders in the workspace. Input: { path?: string } (relative to workspace root, default "."). Returns names, sizes, and whether directory. Use to answer "what files and folder it had".',
      parameters: {
        type: 'object' as const,
        properties: { path: { type: 'string' as const, description: 'Relative path inside workspace, e.g. "." or "src"' } },
        required: [] as const,
      },
    },
    {
      name: 'fs_read',
      toolset: 'fs' as const,
      description: 'Read a text file from the workspace. Input: { path: string } (relative). Returns first 8000 chars. For binary/docx/xlsx/pdf use fs_list to see it exists, then ask to generate.',
      parameters: {
        type: 'object' as const,
        properties: { path: { type: 'string' as const, description: 'Relative file path to read' } },
        required: ['path'] as const,
      },
    },
  ]
}

export async function dispatchFs(
  toolName: string,
  args: Record<string, unknown>,
  workspaceRoot: string
): Promise<string> {
  const root = path.resolve(workspaceRoot)
  console.log(`[SOVARA][FS] dispatch tool=${toolName} workspaceRoot=${root} args=${JSON.stringify(args)}`)
  if (!fs.existsSync(root)) {
    console.warn(`[SOVARA][FS] workspace root does not exist: ${root}`)
    return JSON.stringify({ error: `workspace not found: ${root}` })
  }

  if (toolName === 'fs_list') {
    const rel = typeof args['path'] === 'string' ? args['path'] as string : '.'
    let abs: string
    try {
      abs = resolveWorkspacePath(root, rel)
    } catch (e) {
      console.warn(`[SOVARA][FS] fs_list path resolution failed for "${rel}":`, e)
      return JSON.stringify({ error: `path escapes workspace: ${rel}` })
    }
    if (!fs.existsSync(abs)) {
      console.warn(`[SOVARA][FS] fs_list path not found: rel="${rel}" abs="${abs}"`)
      return JSON.stringify({ error: `path not found: ${rel}`, workspace: root })
    }
    const stat = fs.statSync(abs)
    if (stat.isFile()) return JSON.stringify({ path: rel, type: 'file', size: stat.size, workspace: root })
    const entries = fs.readdirSync(abs, { withFileTypes: true }).slice(0, 200).map(d => {
      const full = path.join(abs, d.name)
      let size = 0
      try { size = d.isFile() ? fs.statSync(full).size : 0 } catch { size = 0 }
      return { name: d.name, isDirectory: d.isDirectory(), isFile: d.isFile(), size, path: path.relative(root, full).replace(/\\/g, '/') }
    })
    console.log(`[SOVARA][FS] fs_list path="${rel}" found ${entries.length} entries`)
    return JSON.stringify({ workspace: root, path: rel, entries, count: entries.length }, null, 2)
  }

  if (toolName === 'fs_read') {
    const rel = args['path'] as string
    if (!rel || typeof rel !== 'string') {
      console.warn(`[SOVARA][FS] fs_read called without valid path:`, args)
      return JSON.stringify({ error: 'fs_read requires { path: string }' })
    }
    // Allow absolute external paths (e.g. C:/Users/.../Downloads/file.md) for reading only — workspace is for writes
    const isAbs = path.isAbsolute(rel) || /^[a-z]:[\\/]/i.test(rel)
    if (isAbs) {
      const extAbs = path.resolve(rel)
      if (fs.existsSync(extAbs)) {
        try {
          const stat = fs.statSync(extAbs)
          if (stat.isDirectory()) return JSON.stringify({ error: `is a directory, use fs_list: ${rel}` })
          if (stat.size > 2 * 1024 * 1024) return JSON.stringify({ error: `file too large (${stat.size} bytes)` })
          const text = fs.readFileSync(extAbs, 'utf8').slice(0, 8000)
          console.log(`[SOVARA][FS] fs_read external success: rel="${rel}" extAbs="${extAbs}" size=${stat.size}`)
          return JSON.stringify({ workspace: root, path: rel, external: true, size: stat.size, content: text })
        } catch (e) {
          console.error(`[SOVARA][FS] fs_read external error ${extAbs}:`, e)
          return JSON.stringify({ error: `read failed: ${e instanceof Error ? e.message : String(e)}` })
        }
      }
      // If absolute but not found, fall through to workspace resolution to give hint
    }
    let abs: string
    try {
      abs = resolveWorkspacePath(root, rel)
    } catch (e) {
      console.warn(`[SOVARA][FS] fs_read path resolution failed for "${rel}":`, e)
      return JSON.stringify({ error: `path escapes workspace: ${rel}` })
    }

    if (!fs.existsSync(abs)) {
      // Look up files in parent or root to provide immediate hints
      let available: string[] = []
      try {
        const parentDir = fs.existsSync(path.dirname(abs)) ? path.dirname(abs) : root
        available = fs.readdirSync(parentDir).slice(0, 15)
      } catch {}
      console.warn(`[SOVARA][FS] fs_read file not found: rel="${rel}" abs="${abs}" root="${root}" availableInDir=[${available.join(', ')}]`)
      return JSON.stringify({
        error: `file not found: ${rel}`,
        requestedPath: rel,
        resolvedPath: abs,
        workspace: root,
        hint: available.length > 0 ? `Files existing in directory: ${available.join(', ')}` : 'Directory is empty or does not exist.'
      })
    }
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) {
      console.warn(`[SOVARA][FS] fs_read target is directory: ${abs}`)
      return JSON.stringify({ error: `is a directory, use fs_list: ${rel}` })
    }
    if (stat.size > 2 * 1024 * 1024) {
      console.warn(`[SOVARA][FS] fs_read file too large: ${abs} (${stat.size} bytes)`)
      return JSON.stringify({ error: `file too large (${stat.size} bytes), use a smaller file or fs_list` })
    }
    try {
      const text = fs.readFileSync(abs, 'utf8').slice(0, 8000)
      console.log(`[SOVARA][FS] fs_read success: rel="${rel}" abs="${abs}" size=${stat.size} bytes readChars=${text.length}`)
      return JSON.stringify({ workspace: root, path: rel, size: stat.size, content: text })
    } catch (e) {
      console.error(`[SOVARA][FS] fs_read error reading ${abs}:`, e)
      return JSON.stringify({ error: `read failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  // ── fs_write: create or overwrite a file ───────────────────────────────
  // Creates all parent directories. Validates path stays inside workspace.
  // Gated: requires 'review' or 'allow' exec mode (not 'ask').
  if (toolName === 'fs_write') {
    const rel = typeof args['path'] === 'string' ? args['path'] as string : ''
    const content = typeof args['content'] === 'string' ? args['content'] as string : ''
    if (!rel) return JSON.stringify({ error: 'fs_write requires { path: string, content: string }' })
    let abs: string
    try { abs = resolveWorkspacePath(root, rel) } catch (e) {
      console.warn(`[SOVARA][FS] fs_write path escapes workspace: ${rel}`, e)
      return JSON.stringify({ error: `path escapes workspace: ${e instanceof Error ? e.message : String(e)}` })
    }
    try {
      // Create parent directories if they don't exist
      const dir = path.dirname(abs)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(abs, content, 'utf8')
      const written = fs.statSync(abs).size
      console.log(`[SOVARA][FS] fs_write success: rel="${rel}" abs="${abs}" bytes=${written}`)
      return JSON.stringify({ ok: true, path: rel, bytes: written, workspace: root })
    } catch (e) {
      console.error(`[SOVARA][FS] fs_write error on ${abs}:`, e)
      return JSON.stringify({ error: `write failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  // ── fs_patch: surgical search-and-replace edit ─────────────────────────
  // Replaces the FIRST exact occurrence of `search` with `replace`.
  // Fails clearly if `search` is not found — no silent no-ops.
  // Gated: requires 'review' or 'allow' exec mode (not 'ask').
  if (toolName === 'fs_patch') {
    const rel = typeof args['path'] === 'string' ? args['path'] as string : ''
    const search = typeof args['search'] === 'string' ? args['search'] as string : ''
    const replace = typeof args['replace'] === 'string' ? args['replace'] as string : ''
    if (!rel || !search) return JSON.stringify({ error: 'fs_patch requires { path: string, search: string, replace: string }' })
    let abs: string
    try { abs = resolveWorkspacePath(root, rel) } catch (e) {
      console.warn(`[SOVARA][FS] fs_patch path escapes workspace: ${rel}`, e)
      return JSON.stringify({ error: `path escapes workspace: ${e instanceof Error ? e.message : String(e)}` })
    }
    if (!fs.existsSync(abs)) {
      console.warn(`[SOVARA][FS] fs_patch file not found: rel="${rel}" abs="${abs}"`)
      return JSON.stringify({ error: `file not found: ${rel}` })
    }
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) return JSON.stringify({ error: `is a directory: ${rel}` })
    if (stat.size > 2 * 1024 * 1024) return JSON.stringify({ error: `file too large to patch (${stat.size} bytes)` })
    try {
      const original = fs.readFileSync(abs, 'utf8')
      const idx = original.indexOf(search)
      if (idx === -1) {
        console.warn(`[SOVARA][FS] fs_patch search string not found in ${abs}`)
        return JSON.stringify({
          error: `search string not found in ${rel}`,
          hint: 'Use fs_read to check the exact content first, then copy the exact characters to search for.',
        })
      }
      const patched = original.slice(0, idx) + replace + original.slice(idx + search.length)
      fs.writeFileSync(abs, patched, 'utf8')
      console.log(`[SOVARA][FS] fs_patch success: rel="${rel}" abs="${abs}" idx=${idx}`)
      return JSON.stringify({ ok: true, path: rel, patchedAt: idx, removedChars: search.length, insertedChars: replace.length })
    } catch (e) {
      console.error(`[SOVARA][FS] fs_patch error on ${abs}:`, e)
      return JSON.stringify({ error: `patch failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return JSON.stringify({ error: `unknown fs tool: ${toolName}` })
}
