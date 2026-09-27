/**
 * Per-tool contract tests — REAL implementations, real filesystem, real shell.
 *
 * For every tool this asserts four things:
 *   1. PURPOSE    — the description matches what the code actually does
 *   2. CAN DO     — the happy path produces the documented effect
 *   3. RETURNS    — the exact response shape (not just "no throw")
 *   4. DOES NOT   — documented refusals/safety really refuse
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { dispatchFs, getFsToolDefinitions, resolveWorkspacePath } from '../src/main/capabilities/fs'
import { dispatchShell, getShellToolDefinitions, extractServerInfo, isServerCommand, getActiveDevServers, stopDevServer } from '../src/main/capabilities/shell'
import { getTodoToolDefinition, executeTodoWrite } from '../src/main/capabilities/todo'

let ws: string

beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-tools-'))
  fs.writeFileSync(path.join(ws, 'a.txt'), 'alpha\nbeta\ngamma\n', 'utf8')
  fs.writeFileSync(path.join(ws, 'b.js'), 'const NEEDLE = 1\nconsole.log(NEEDLE)\n', 'utf8')
  fs.mkdirSync(path.join(ws, 'src'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'src', 'deep.ts'), 'export const DEEP = "NEEDLE"\n', 'utf8')
  fs.mkdirSync(path.join(ws, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'node_modules', 'ignored.js'), 'NEEDLE\n', 'utf8')
})
afterEach(() => { fs.rmSync(ws, { recursive: true, force: true }) })

const j = (s: string) => JSON.parse(s) as Record<string, any>

// ══════════════════════════════════════════════════════════════════════
describe('TOOL fs_list — purpose: "list files and folders", returns names/sizes/isDirectory', () => {
  const def = getFsToolDefinitions().find((d) => d.name === 'fs_list')!
  it('declares its purpose and marks path optional', () => {
    expect(def.description).toMatch(/list files and folders/i)
    expect(def.parameters.required).toEqual([])
  })
  it('defaults to the workspace root when path is omitted', async () => {
    const r = j(await dispatchFs('fs_list', {}, ws))
    expect(r.error).toBeUndefined()
    expect(r.path).toBe('.')
    expect(r.workspace).toBe(ws)
    expect(typeof r.count).toBe('number')
  })
  it('returns name/isDirectory/size/path for every entry', async () => {
    const r = j(await dispatchFs('fs_list', { path: '.' }, ws))
    const a = r.entries.find((e: any) => e.name === 'a.txt')
    expect(a).toMatchObject({ isFile: true, isDirectory: false })
    expect(a.size).toBe('alpha\nbeta\ngamma\n'.length)
    expect(a.path).toBe('a.txt')
    const src = r.entries.find((e: any) => e.name === 'src')
    expect(src.isDirectory).toBe(true)
  })
  it('lists a subdirectory relative to the workspace', async () => {
    const r = j(await dispatchFs('fs_list', { path: 'src' }, ws))
    expect(r.entries.map((e: any) => e.name)).toContain('deep.ts')
  })
  it('returns a file descriptor (not a listing) when pointed at a file', async () => {
    const r = j(await dispatchFs('fs_list', { path: 'a.txt' }, ws))
    expect(r.type).toBe('file')
    expect(r.path).toBe('a.txt')
    expect(r.size).toBe('alpha\nbeta\ngamma\n'.length)
    expect(r.entries).toBeUndefined()
  })
  it('refuses a path that escapes the workspace', async () => {
    const r = j(await dispatchFs('fs_list', { path: '../..' }, ws))
    expect(r.error).toMatch(/escapes workspace/i)
  })
  it('reports a missing path instead of inventing a listing', async () => {
    const r = j(await dispatchFs('fs_list', { path: 'nope' }, ws))
    expect(r.error).toMatch(/path not found/i)
  })
  it('returns a clear error when the workspace itself is gone', async () => {
    const r = j(await dispatchFs('fs_list', {}, path.join(ws, 'ghost')))
    expect(r.error).toMatch(/workspace not found/i)
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('TOOL fs_read — purpose: "read a text file", returns content + line counts', () => {
  const def = getFsToolDefinitions().find((d) => d.name === 'fs_read')!
  it('declares path as REQUIRED (a read without a path is meaningless)', () => {
    expect(def.parameters.required).toEqual(['path'])
  })
  it('returns real file content', async () => {
    const r = j(await dispatchFs('fs_read', { path: 'a.txt' }, ws))
    expect(r.content).toBe('alpha\nbeta\ngamma\n')
    expect(r.size).toBe(17)
    expect(r.linesReturned).toBe(4)
  })
  it('honours start_line/end_line slicing', async () => {
    const r = j(await dispatchFs('fs_read', { path: 'a.txt', start_line: 2, end_line: 3 }, ws))
    expect(r.content).toBe('beta\ngamma')
    expect(r.totalLines).toBe(4)
  })
  it('caps oversized reads at 8000 chars (description says so)', async () => {
    fs.writeFileSync(path.join(ws, 'big.txt'), 'x'.repeat(20000), 'utf8')
    const r = j(await dispatchFs('fs_read', { path: 'big.txt' }, ws))
    expect(r.content.length).toBe(8000)
  })
  it('requires a path', async () => {
    const r = j(await dispatchFs('fs_read', {}, ws))
    expect(r.error).toMatch(/requires \{ path: string \}/)
  })
  it('redirects a directory read to fs_list', async () => {
    const r = j(await dispatchFs('fs_read', { path: 'src' }, ws))
    expect(r.error).toMatch(/is a directory, use fs_list/i)
  })
  it('returns a helpful hint listing the actual directory contents on miss', async () => {
    const r = j(await dispatchFs('fs_read', { path: 'typo.txt' }, ws))
    expect(r.error).toMatch(/file not found/i)
    expect(r.hint).toMatch(/a\.txt/)
    expect(r.requestedPath).toBe('typo.txt')
  })
  it('refuses to escape the workspace', async () => {
    const r = j(await dispatchFs('fs_read', { path: '../../../Windows/win.ini' }, ws))
    expect(r.error).toMatch(/escapes workspace/i)
  })
  it('does NOT silently rewrite a missing absolute path into the workspace', async () => {
    // Regression: drive-stripping once turned C:\...\nope.md into a bogus
    // workspace-relative path and reported "not found" in the wrong place.
    const r = j(await dispatchFs('fs_read', { path: 'C:\\definitely\\not\\here\\nope.md' }, ws))
    expect(r.error).toMatch(/path not found/i)
    expect(r.resolvedPath).toContain('definitely')
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('TOOL fs_search — purpose: "keyword/pattern search", returns file/line/text', () => {
  it('finds matches recursively with 1-based line numbers', async () => {
    const r = j(await dispatchFs('fs_search', { query: 'NEEDLE' }, ws))
    expect(r.results.length).toBeGreaterThanOrEqual(2)
    const files = r.results.map((x: any) => x.file)
    expect(files).toContain('b.js')
    expect(files).toContain('src/deep.ts')
    for (const hit of r.results) {
      expect(hit.line).toBeGreaterThan(0)
      expect(hit.text).toContain('NEEDLE')
    }
  })
  it('skips node_modules / .git / dist (not searched)', async () => {
    const r = j(await dispatchFs('fs_search', { query: 'NEEDLE' }, ws))
    expect(r.results.map((x: any) => x.file).join('|')).not.toMatch(/node_modules/)
  })
  it('scopes to a subdirectory when path is given', async () => {
    const r = j(await dispatchFs('fs_search', { query: 'NEEDLE', path: 'src' }, ws))
    expect(r.results.every((x: any) => x.file.startsWith('src'))).toBe(true)
  })
  it('requires a query', async () => {
    const r = j(await dispatchFs('fs_search', {}, ws))
    expect(r.error).toMatch(/requires \{ query: string \}/)
  })
  it('returns an empty result set (not an error) when nothing matches', async () => {
    const r = j(await dispatchFs('fs_search', { query: 'ZZZ_NOT_PRESENT' }, ws))
    expect(r.error).toBeUndefined()
    expect(r.results).toEqual([])
  })
  it('errors on a missing directory rather than searching nothing', async () => {
    const r = j(await dispatchFs('fs_search', { query: 'x', path: 'nope' }, ws))
    expect(r.error).toMatch(/directory not found/i)
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('TOOL fs_write — purpose: "create or overwrite", returns verified byte count', () => {
  it('creates the file AND its parent directories', async () => {
    const r = j(await dispatchFs('fs_write', { path: 'new/deep/x.ts', content: 'export const V = 1\n' }, ws))
    expect(r).toMatchObject({ ok: true, verified: true, path: 'new/deep/x.ts' })
    expect(fs.readFileSync(path.join(ws, 'new', 'deep', 'x.ts'), 'utf8')).toBe('export const V = 1\n')
  })
  it('reports the real byte count of what it wrote', async () => {
    const content = 'héllo wörld\n' // multi-byte
    const r = j(await dispatchFs('fs_write', { path: 'u.txt', content }, ws))
    expect(r.bytes).toBe(Buffer.byteLength(content, 'utf8'))
    expect(r.empty).toBe(false)
  })
  it('overwrites an existing file', async () => {
    await dispatchFs('fs_write', { path: 'a.txt', content: 'replaced' }, ws)
    expect(fs.readFileSync(path.join(ws, 'a.txt'), 'utf8')).toBe('replaced')
  })
  it('flags an empty write honestly (verified but not an artifact)', async () => {
    const r = j(await dispatchFs('fs_write', { path: 'empty.txt', content: '' }, ws))
    expect(r.ok).toBe(true)
    expect(r.verified).toBe(true)
    expect(r.empty).toBe(true)
    expect(r.bytes).toBe(0)
  })
  it('refuses to write outside the workspace', async () => {
    const r = j(await dispatchFs('fs_write', { path: '../escape.txt', content: 'x' }, ws))
    expect(r.error).toMatch(/escapes workspace/i)
    expect(fs.existsSync(path.join(path.dirname(ws), 'escape.txt'))).toBe(false)
  })
  it('rejects a call with no content (no accidental truncation)', async () => {
    const before = fs.readFileSync(path.join(ws, 'a.txt'), 'utf8')
    const r = j(await dispatchFs('fs_write', { path: 'a.txt' }, ws))
    expect(r.code).toBe('INVALID_ARGUMENTS')
    expect(fs.readFileSync(path.join(ws, 'a.txt'), 'utf8')).toBe(before)
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('TOOL fs_patch — purpose: "search-and-replace the FIRST exact occurrence"', () => {
  it('replaces the first exact occurrence and verifies the write', async () => {
    const r = j(await dispatchFs('fs_patch', { path: 'b.js', search: 'NEEDLE = 1', replace: 'NEEDLE = 2' }, ws))
    expect(r).toMatchObject({ ok: true, verified: true, path: 'b.js' })
    expect(r.patchedAt).toBeGreaterThanOrEqual(0)
    expect(fs.readFileSync(path.join(ws, 'b.js'), 'utf8')).toContain('NEEDLE = 2')
  })
  it('replaces only the FIRST match, not all of them', async () => {
    fs.writeFileSync(path.join(ws, 'dup.txt'), 'A A A', 'utf8')
    await dispatchFs('fs_patch', { path: 'dup.txt', search: 'A', replace: 'B' }, ws)
    expect(fs.readFileSync(path.join(ws, 'dup.txt'), 'utf8')).toBe('B A A')
  })
  it('reports removedChars/insertedChars so the model can reason about the delta', async () => {
    const r = j(await dispatchFs('fs_patch', { path: 'b.js', search: 'NEEDLE = 1', replace: 'NEEDLE = 22' }, ws))
    expect(r.removedChars).toBe('NEEDLE = 1'.length)
    expect(r.insertedChars).toBe('NEEDLE = 22'.length)
  })
  it('fails LOUDLY (no silent no-op) when the search text is absent', async () => {
    const before = fs.readFileSync(path.join(ws, 'a.txt'), 'utf8')
    const r = j(await dispatchFs('fs_patch', { path: 'a.txt', search: 'NOT_PRESENT', replace: 'X' }, ws))
    expect(r.error).toMatch(/search string not found/i)
    expect(r.hint).toMatch(/fs_read/i)
    expect(fs.readFileSync(path.join(ws, 'a.txt'), 'utf8')).toBe(before)
  })
  it('errors on a missing file', async () => {
    const r = j(await dispatchFs('fs_patch', { path: 'ghost.txt', search: 'a', replace: 'b' }, ws))
    expect(r.error).toMatch(/file not found/i)
  })
  it('refuses to patch a directory', async () => {
    const r = j(await dispatchFs('fs_patch', { path: 'src', search: 'a', replace: 'b' }, ws))
    expect(r.error).toMatch(/is a directory/i)
  })
  it('refuses to escape the workspace', async () => {
    const r = j(await dispatchFs('fs_patch', { path: '../x.txt', search: 'a', replace: 'b' }, ws))
    expect(r.error).toMatch(/escapes workspace/i)
  })
  it('validates all three required args', async () => {
    const r = j(await dispatchFs('fs_patch', { path: 'a.txt', search: 'alpha' }, ws))
    expect(r.code).toBe('INVALID_ARGUMENTS')
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('TOOL shell_exec — purpose: run a command, return stdout/stderr/exitCode', () => {
  const def = getShellToolDefinitions().find((d) => d.name === 'shell_exec')!
  const isWin = process.platform === 'win32'
  const okCmd = 'echo sovara-tool-ok'
  // Use the SAME shell the dispatcher uses so the exit code propagates verbatim.
  const failCmd = isWin ? 'exit 3' : 'exit 3'

  it('declares command as required and advertises URL/port detection', () => {
    expect(def.parameters.required).toEqual(['command'])
    expect(def.description).toMatch(/dev servers, active ports, and URLs/i)
  })
  it('returns stdout for a successful command', async () => {
    const r = j(await dispatchShell({ command: okCmd }, ws))
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('sovara-tool-ok')
  })
  it('returns a non-zero exitCode for a failing command', async () => {
    const r = j(await dispatchShell({ command: failCmd }, ws))
    expect(r.exitCode).toBe(3)
  })
  it('requires a command', async () => {
    const r = j(await dispatchShell({}, ws))
    expect(r.error).toMatch(/requires \{ command: string \}/)
  })
  it('refuses a bare python REPL instead of hanging until timeout', async () => {
    const r = j(await dispatchShell({ command: 'python' }, ws))
    expect(r.error).toMatch(/bare python repl/i)
    expect(r.hint).toMatch(/--version|script\.py/)
  })
  it('refuses a workdir outside the workspace', async () => {
    const r = j(await dispatchShell({ command: okCmd, workdir: '../..' }, ws))
    expect(r.error).toMatch(/escapes workspace/i)
  })
  it('reports a missing workdir honestly', async () => {
    const r = j(await dispatchShell({ command: okCmd, workdir: 'nope' }, ws))
    expect(r.error).toMatch(/workdir not found/i)
  })
  it('runs in the workspace (not the repo root)', async () => {
    // `cd` alone prints nothing in PowerShell — ask for the location explicitly.
    const r = j(await dispatchShell({ command: isWin ? '(Get-Location).Path' : 'pwd' }, ws))
    expect(String(r.stdout).toLowerCase()).toContain(path.basename(ws).toLowerCase())
  })
  it('honours a relative workdir inside the workspace', async () => {
    const r = j(await dispatchShell({ command: isWin ? '(Get-Location).Path' : 'pwd', workdir: 'src' }, ws))
    expect(String(r.stdout).toLowerCase()).toContain(path.join(path.basename(ws), 'src').toLowerCase())
  })
  it('truncates runaway output instead of exhausting memory', async () => {
    const r = j(await dispatchShell({ command: isWin ? '1..20000 | % { "sovara-line-$_" }' : 'seq 1 20000 | sed "s/^/sovara-line-/"' }, ws))
    expect(r.truncated).toBe(true)
    expect(String(r.stdout).length).toBeLessThanOrEqual(8000)
  })
  it('surfaces dev-server URL/port when the command prints one', async () => {
    const fake = 'VITE v6 ready in 300 ms\n  ➜  Local:   http://localhost:5173/\n'
    expect(extractServerInfo(fake).port).toBe(5173)
    expect(extractServerInfo(fake).url).toContain('5173')
  })
})

describe('TOOL list_dev_servers / stop_dev_server — purpose: manage background dev servers', () => {
  it('declares their purpose and required args', () => {
    const defs = getShellToolDefinitions()
    const list = defs.find((d) => d.name === 'list_dev_servers')!
    const stop = defs.find((d) => d.name === 'stop_dev_server')!
    expect(list.description).toMatch(/list actively running background dev servers/i)
    expect(stop.parameters.required).toEqual(['port'])
  })
  it('reports an empty list (never throws) when nothing runs', () => {
    expect(Array.isArray(getActiveDevServers())).toBe(true)
  })
  it('returns false when asked to stop a port it never started', () => {
    expect(stopDevServer(65500)).toBe(false)
  })
  it('recognises dev-server commands', () => {
    expect(isServerCommand('npm run dev')).toBe(true)
    expect(isServerCommand('pnpm dev')).toBe(true)
    expect(isServerCommand('npx vite')).toBe(true)
    expect(isServerCommand('ls -la')).toBe(false)
  })
  it('extracts a port from a bare "listening on 8080" line', () => {
    expect(extractServerInfo('listening on 8080').port).toBe(8080)
  })
  it('returns null port for unrelated output (no hallucinated port)', () => {
    expect(extractServerInfo('compiling... done').port).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('TOOL todo_write — purpose: replace the whole task list, return counts', () => {
  const def = getTodoToolDefinition(true)
  it('declares the whole-list REPLACE semantics (models get this wrong)', () => {
    expect(def.description).toMatch(/entire/i)
    expect(def.description).toMatch(/replaces the previous list/i)
    expect(def.description).toMatch(/no partial updates/i)
  })
  it('documents the three statuses', () => {
    expect(def.description).toMatch(/pending.*in_progress.*completed/is)
  })
  it('returns the normalised list plus per-status counts', () => {
    const events: unknown[] = []
    const r = executeTodoWrite(
      { todos: [{ content: 'one', status: 'completed' }, { content: 'two', status: 'in_progress' }, { content: 'three', status: 'pending' }] },
      { append: (t, d) => events.push([t, d]) },
    )
    expect(r.todos).toHaveLength(3)
    expect(r.counts).toEqual({ pending: 1, inProgress: 1, completed: 1 })
    expect(events).toHaveLength(1)
    expect((events[0] as any)[0]).toBe('todo/write')
  })
  it('REPLACES rather than appends (last write wins)', () => {
    const seen: any[] = []
    const ctx = { append: (_t: any, d: any) => seen.push(d.todos) }
    executeTodoWrite({ todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'pending' }] }, ctx)
    executeTodoWrite({ todos: [{ content: 'only', status: 'completed' }] }, ctx)
    expect(seen[0]).toHaveLength(2)
    expect(seen[1]).toHaveLength(1)
  })
  it('rejects an unknown status rather than silently coercing', () => {
    expect(() => executeTodoWrite({ todos: [{ content: 'x', status: 'done-ish' }] }, { append: () => {} }))
      .toThrow(/invalid status/i)
  })
  it('rejects empty content', () => {
    expect(() => executeTodoWrite({ todos: [{ content: '   ', status: 'pending' }] }, { append: () => {} }))
      .toThrow(/non-empty string/i)
  })
  it('rejects duplicate todos', () => {
    expect(() => executeTodoWrite({ todos: [{ content: 'x', status: 'pending' }, { content: 'x', status: 'pending' }] }, { append: () => {} }))
      .toThrow(/duplicate/i)
  })
  it('honours the single-in-progress rule when parallel is disabled', () => {
    const two = { todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }] }
    expect(() => executeTodoWrite(two, { append: () => {}, allowParallel: false })).toThrow(/at most one/i)
    // Allowed when parallel work is permitted.
    expect(() => executeTodoWrite(two, { append: () => {}, allowParallel: true })).not.toThrow()
  })
  it('accepts an empty list (clears the board)', () => {
    const r = executeTodoWrite({ todos: [] }, { append: () => {} })
    expect(r.todos).toEqual([])
    expect(r.counts).toEqual({ pending: 0, inProgress: 0, completed: 0 })
  })
})

// ══════════════════════════════════════════════════════════════════════
describe('TOOL resolveWorkspacePath — the safety seam every fs tool depends on', () => {
  it('resolves a relative path inside the workspace', () => {
    expect(resolveWorkspacePath(ws, 'a.txt')).toBe(path.join(ws, 'a.txt'))
  })
  it('strips a redundant absolute prefix that is already inside the workspace', () => {
    expect(resolveWorkspacePath(ws, path.join(ws, 'a.txt'))).toBe(path.join(ws, 'a.txt'))
  })
  it('THROWS on traversal (the single most important guarantee)', () => {
    expect(() => resolveWorkspacePath(ws, '../../etc/passwd')).toThrow(/escapes workspace/i)
    expect(() => resolveWorkspacePath(ws, 'src/../../..')).toThrow(/escapes workspace/i)
  })
})

describe('TOOL contract: every registered fs/shell/todo tool declares a description', () => {
  const all = [...getFsToolDefinitions(), ...getShellToolDefinitions(), getTodoToolDefinition(true)]
  it('has no unnamed tools (the prompt would render "- undefined")', () => {
    for (const d of all) {
      expect(d.name, 'tool has a name').toBeTruthy()
      expect(d.description, `${d.name} has a description`).toBeTruthy()
      expect(d.description.length, `${d.name} description is meaningful`).toBeGreaterThan(30)
      expect(d.parameters, `${d.name} has a parameter schema`).toBeTruthy()
    }
  })
})
