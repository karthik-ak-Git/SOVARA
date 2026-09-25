import { afterEach, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { SystemResourceStub } from '../src/main/backend/ports/SystemResourceStub'
import { ModelRuntimeStub } from '../src/main/backend/ports/ModelRuntimeStub'
import { LlmStubAdapter } from '../src/main/backend/ports/LlmStubAdapter'
import { ToolStubAdapter } from '../src/main/backend/ports/ToolStubAdapter'
import { SqlitePersistenceAdapter } from '../src/main/backend/ports/SqlitePersistenceAdapter'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-test-'))
}

describe('Commit 1 — stub ports satisfy contracts', () => {
  it('SystemResourceStub.getSnapshot returns required shape', async () => {
    const s = new SystemResourceStub()
    const snap = await s.getSnapshot()
    expect(snap.cpu.logicalCores).toBeGreaterThan(0)
    expect(snap.ram.totalMB).toBeGreaterThan(0)
    expect(snap.gpu).toBeDefined()
    expect(snap.limits.maxConcurrentModels).toBe(1)
  })

  it('ModelRuntimeStub supports honest lifecycle (loading→ready)', async () => {
    const { clearAllInstances } = await import('../src/main/backend/ports/ModelRuntimeStub')
    clearAllInstances()
    const m = new ModelRuntimeStub()
    expect(await m.listLocalModels()).toEqual([])
    expect(await m.probeRuntime('ollama')).toEqual({ available: false })
    const inst = await m.load('any' as never, { runtimeId: 'local' })
    expect(inst.status).toBe('loading')
    expect(inst.modelId).toBe('any')
    const health = await m.health(inst.id)
    expect(health.ok).toBe(true)
    const list = await m.listInstances()
    expect(list.some((i) => i.id === inst.id)).toBe(true)
    await m.unload(inst.id)
    expect((await m.listInstances()).some((i) => i.id === inst.id)).toBe(false)
    clearAllInstances()
  })

  it('LlmStub streams a stub chunk', async () => {
    const llm = new LlmStubAdapter()
    const chunks = []
    for await (const c of llm.stream('hello')) chunks.push(c)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].type).toBe('text-delta')
  })

  it('ToolStub lists web_search + web_fetch (live web tools), plus local tools', () => {
    const defs = new ToolStubAdapter().list()
    const names = defs.map((d) => d.name)
    expect(names).toContain('web_search')
    expect(names).toContain('web_fetch')
    const webTools = defs.filter((d) => d.toolset === 'web')
    expect(webTools.map((d) => d.name)).toEqual(['web_search', 'web_fetch'])
  })

  it('ToolStub refuses web tools while disabled and validates queries', async () => {
    const tools = new ToolStubAdapter()
    expect(JSON.parse(await tools.dispatch('web_search', { queries: ['x'] })).error).toMatch(/disabled/)
    expect(JSON.parse(await tools.dispatch('nope', {})).error).toMatch(/unavailable/)
  })

  it('rejects empty run_code through the infrastructure handler too', async () => {
    const { ToolRegistry } = await import('../src/main/backend/tools/ToolRegistry')
    const { PTCToolHandler, createRunCodeToolHandler } = await import('../src/main/backend/tools/PTCToolHandler')
    const registry = new ToolRegistry()
    const ptc = new PTCToolHandler(registry)
    registry.register({
      id: 'run_code',
      name: 'run_code',
      description: 'Execute JavaScript',
      inputSchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
      concurrency: 'exclusive',
      timeout: 1000,
      tags: ['code'],
    }, createRunCodeToolHandler(ptc))
    const result = await registry.execute('run_code', {})
    expect(result).toMatchObject({ success: false, errorCode: 'INVALID_ARGUMENTS' })
  })

  it('fails closed for missing file content and distinguishes explicit empty writes', async () => {
    const dir = mkTmp()
    const tools = new ToolStubAdapter(
      { enabled: false, search: async () => { throw new Error('disabled') }, crawl: async () => [] },
      () => [],
      () => dir,
    )
    const missing = JSON.parse(await tools.dispatch('fs_write', { path: 'missing.py' }))
    expect(missing).toMatchObject({ error: expect.stringContaining('content'), code: 'INVALID_ARGUMENTS' })
    expect(fs.existsSync(path.join(dir, 'missing.py'))).toBe(false)

    const empty = JSON.parse(await tools.dispatch('fs_write', { path: 'empty.py', content: '' }))
    expect(empty).toMatchObject({ ok: true, verified: true, empty: true, bytes: 0 })
    expect(fs.readFileSync(path.join(dir, 'empty.py'), 'utf8')).toBe('')

    const patch = JSON.parse(await tools.dispatch('fs_patch', { path: 'empty.py', search: 'x' }))
    expect(patch).toMatchObject({ error: expect.stringContaining('replace'), code: 'INVALID_ARGUMENTS' })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('executes the local filesystem, todo, shell, and dev-server tool seams', async () => {
    const dir = mkTmp()
    const todoEvents: Array<{ type: string; data: unknown }> = []
    const tools = new ToolStubAdapter(
      { enabled: false, search: async () => { throw new Error('disabled') }, crawl: async () => [] },
      () => [],
      () => dir,
      (type, data) => todoEvents.push({ type, data }),
    )
    expect(JSON.parse(await tools.dispatch('fs_write', { path: 'notes.txt', content: 'alpha\n' })).ok).toBe(true)
    expect(JSON.parse(await tools.dispatch('fs_list', { path: '.' })).entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'notes.txt' })]))
    expect(JSON.parse(await tools.dispatch('fs_read', { path: 'notes.txt' })).content).toContain('alpha')
    expect(JSON.parse(await tools.dispatch('fs_search', { path: '.', query: 'alpha' })).results).toEqual(expect.arrayContaining([expect.objectContaining({ file: 'notes.txt' })]))
    expect(JSON.parse(await tools.dispatch('fs_patch', { path: 'notes.txt', search: 'alpha', replace: 'beta' })).ok).toBe(true)
    expect(JSON.parse(await tools.dispatch('todo_write', { todos: [{ content: 'verify tools', status: 'in_progress' }] })).counts.inProgress).toBe(1)
    for (const shellTool of ['shell_exec', 'bash', 'cmd', 'powershell', 'terminal_exec', 'run_command', 'exec_shell_command']) {
      const shell = JSON.parse(await tools.dispatch(shellTool, { command: 'node -e "console.log(\'shell-ok\')"' }))
      expect(shell.stdout).toContain('shell-ok')
    }
    expect(JSON.parse(await tools.dispatch('list_dev_servers', {}))).toHaveProperty('activeServers')
    expect(JSON.parse(await tools.dispatch('stop_dev_server', { port: 65535 }))).toMatchObject({ port: 65535 })
    expect(todoEvents.some((e) => e.type === 'todo/write')).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('executes skill and memory tools against real workspace data', async () => {
    const dir = mkTmp()
    const skillDir = path.join(dir, 'skills', 'matrix-skill')
    fs.mkdirSync(skillDir, { recursive: true })
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: matrix-skill\ndescription: A real workspace skill for tool verification\n---\nUse this skill when testing the tool matrix.\n')
    const tools = new ToolStubAdapter(
      { enabled: false, search: async () => { throw new Error('disabled') }, crawl: async () => [] },
      () => [],
      () => dir,
    )
    const search = JSON.parse(await tools.dispatch('search_skills', { query: 'matrix' }))
    expect(search.matches).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'matrix-skill' })]))
    const read = JSON.parse(await tools.dispatch('read_skill', { skill_name: 'matrix-skill' }))
    expect(read.content).toContain('tool matrix')

    const stored = JSON.parse(await tools.dispatch('memory', {
      action: 'store',
      title: 'Matrix Fact',
      type: 'entity',
      body: 'The matrix tool test passed.',
      tags: ['test'],
    }))
    expect(stored.ok).toBe(true)
    const listed = JSON.parse(await tools.dispatch('memory', { action: 'list' }))
    expect(listed.entries.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(['entities']))
    const recalled = JSON.parse(await tools.dispatch('memory', { action: 'recall', query: 'matrix' }))
    expect(recalled.results.length).toBeGreaterThan(0)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('dispatches an HTTP MCP tool against a real loopback JSON-RPC server', async () => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += String(chunk) })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { received: body, content: 'mcp-ok' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('MCP test server did not bind')
    try {
      const tools = new ToolStubAdapter(
        { enabled: false, search: async () => { throw new Error('disabled') }, crawl: async () => [] },
        () => [{ id: 'mcp-test', name: 'Matrix MCP', provider: 'Test', transport: 'http', endpoint: `http://127.0.0.1:${address.port}/mcp`, enabled: true, createdAt: 1, status: 'connected' }],
        () => mkTmp(),
      )
      const result = JSON.parse(await tools.dispatch('mcp_matrix_mcp', { input: 'ping' }))
      expect(result).toMatchObject({ mcp: 'Matrix MCP', status: 200 })
      expect(result.result).toContain('mcp-ok')
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('run_code exposes tools and reports nested tool calls when infrastructure is not ready', async () => {
    const dir = mkTmp()
    const tools = new ToolStubAdapter(
      { enabled: false, search: async () => { throw new Error('disabled') }, crawl: async () => [] },
      () => [],
      () => dir,
    )
    const emptyRun = JSON.parse(await tools.dispatch('run_code', {}))
    expect(emptyRun).toMatchObject({ error: expect.stringContaining('code') })
    const result = JSON.parse(await tools.dispatch('run_code', {
      code: 'return await tools.fs_write({ path: "nested.txt", content: "written by run_code" })',
    }))
    expect(result.status).toBe('ok')
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'fs_write', arguments: { path: 'nested.txt' } })
    expect(fs.readFileSync(path.join(dir, 'nested.txt'), 'utf8')).toBe('written by run_code')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('Persistence stub creates and lists sessions in order', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const a = await p.create('a')
    const b = await p.create('b')
    const list = await p.list()
    expect(list[0].id).toBe(b.id)
    expect(await p.get(a.id)).not.toBeNull()
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
