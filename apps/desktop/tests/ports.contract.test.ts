import { afterEach, describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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

  it('ModelRuntimeStub is unavailable-by-design', async () => {
    const m = new ModelRuntimeStub()
    expect(await m.listLocalModels()).toEqual([])
    expect(await m.probeRuntime('ollama')).toEqual({ available: false })
    await expect(m.load('any' as never, {})).rejects.toThrow(/unavailable/)
  })

  it('LlmStub streams a stub chunk', async () => {
    const llm = new LlmStubAdapter()
    const chunks = []
    for await (const c of llm.stream('hello')) chunks.push(c)
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].type).toBe('text-delta')
  })

  it('ToolStub lists empty', () => {
    expect(new ToolStubAdapter().list()).toEqual([])
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
