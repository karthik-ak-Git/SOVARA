// @sovara/capability-fs — workspace FS seam, like harness fs/tool-fs + fs-local
// All paths are resolved against the Sovara workspace (Global or Project), never the repo root.

import fs from 'node:fs'
import path from 'node:path'

export const name = 'capability-fs'

export function resolveWorkspacePath(workspaceRoot: string, requested: string): string {
  const clean = (requested || '.').replace(/\\/g, '/').trim() || '.'
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
  if (!fs.existsSync(root)) return JSON.stringify({ error: `workspace not found: ${root}` })

  if (toolName === 'fs_list') {
    const rel = typeof args['path'] === 'string' ? args['path'] as string : '.'
    const abs = resolveWorkspacePath(root, rel)
    if (!fs.existsSync(abs)) return JSON.stringify({ error: `path not found: ${rel}`, workspace: root })
    const stat = fs.statSync(abs)
    if (stat.isFile()) return JSON.stringify({ path: rel, type: 'file', size: stat.size, workspace: root })
    const entries = fs.readdirSync(abs, { withFileTypes: true }).slice(0, 200).map(d => {
      const full = path.join(abs, d.name)
      let size = 0
      try { size = d.isFile() ? fs.statSync(full).size : 0 } catch { size = 0 }
      return { name: d.name, isDirectory: d.isDirectory(), isFile: d.isFile(), size, path: path.relative(root, full).replace(/\\/g, '/') }
    })
    return JSON.stringify({ workspace: root, path: rel, entries, count: entries.length }, null, 2)
  }

  if (toolName === 'fs_read') {
    const rel = args['path'] as string
    if (!rel || typeof rel !== 'string') return JSON.stringify({ error: 'fs_read requires { path: string }' })
    const abs = resolveWorkspacePath(root, rel)
    if (!fs.existsSync(abs)) return JSON.stringify({ error: `file not found: ${rel}` })
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) return JSON.stringify({ error: `is a directory, use fs_list: ${rel}` })
    if (stat.size > 2 * 1024 * 1024) return JSON.stringify({ error: `file too large (${stat.size} bytes), use a smaller file or fs_list` })
    try {
      const text = fs.readFileSync(abs, 'utf8').slice(0, 8000)
      return JSON.stringify({ workspace: root, path: rel, size: stat.size, content: text })
    } catch (e) {
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
      return JSON.stringify({ error: `path escapes workspace: ${e instanceof Error ? e.message : String(e)}` })
    }
    try {
      // Create parent directories if they don't exist
      const dir = path.dirname(abs)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(abs, content, 'utf8')
      const written = fs.statSync(abs).size
      return JSON.stringify({ ok: true, path: rel, bytes: written, workspace: root })
    } catch (e) {
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
      return JSON.stringify({ error: `path escapes workspace: ${e instanceof Error ? e.message : String(e)}` })
    }
    if (!fs.existsSync(abs)) return JSON.stringify({ error: `file not found: ${rel}` })
    const stat = fs.statSync(abs)
    if (stat.isDirectory()) return JSON.stringify({ error: `is a directory: ${rel}` })
    if (stat.size > 2 * 1024 * 1024) return JSON.stringify({ error: `file too large to patch (${stat.size} bytes)` })
    try {
      const original = fs.readFileSync(abs, 'utf8')
      const idx = original.indexOf(search)
      if (idx === -1) {
        return JSON.stringify({
          error: `search string not found in ${rel}`,
          hint: 'Use fs_read to check the exact content first, then copy the exact characters to search for.',
        })
      }
      const patched = original.slice(0, idx) + replace + original.slice(idx + search.length)
      fs.writeFileSync(abs, patched, 'utf8')
      return JSON.stringify({ ok: true, path: rel, patchedAt: idx, removedChars: search.length, insertedChars: replace.length })
    } catch (e) {
      return JSON.stringify({ error: `patch failed: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return JSON.stringify({ error: `unknown fs tool: ${toolName}` })
}
