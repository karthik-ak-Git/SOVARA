import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SqlitePersistenceAdapter } from '../src/main/backend/ports/SqlitePersistenceAdapter'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-test-'))
}

describe('Session foundation — append-only, seq, ordering', () => {
  it('creates sessions with deterministic ordering by updatedAt', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const a = await p.create('a')
    const b = await p.create('b')
    const list = await p.list()
    expect(list[0].id).toBe(b.id)
    expect(list[1].id).toBe(a.id)
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('appendEvent assigns contiguous seq and preserves order', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const h = await p.create('s')
    const e0 = await p.appendEvent(h.id, 'user/message', { content: 'first' })
    const e1 = await p.appendEvent(h.id, 'user/message', { content: 'second' })
    const e2 = await p.appendEvent(h.id, 'user/message', { content: 'third' })
    expect(e0.seq).toBe(0)
    expect(e1.seq).toBe(1)
    expect(e2.seq).toBe(2)
    const all = await p.getEvents(h.id)
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2])
    expect(all[1].data).toEqual({ content: 'second' })
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('getEvents returns copy — mutating it does not corrupt log', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const h = await p.create('s')
    await p.appendEvent(h.id, 'user/message', { content: 'a' })
    const a = await p.getEvents(h.id)
    a.push({ seq: 99, time: 0, type: 'x', data: null })
    const b = await p.getEvents(h.id)
    expect(b.length).toBe(1)
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('isolates events per session', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const a = await p.create('a')
    const b = await p.create('b')
    await p.appendEvent(a.id, 'user/message', { content: 'only-a' })
    expect(await p.getEvents(a.id)).toHaveLength(1)
    expect(await p.getEvents(b.id)).toHaveLength(0)
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects non-lossless-JSON (BigInt, undefined, NaN, sparse)', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const h = await p.create('s')
    await expect(p.appendEvent(h.id, 'user/message', { v: BigInt(1) } as unknown as object)).rejects.toThrow(/lossless JSON/)
    await expect(p.appendEvent(h.id, 'user/message', { v: undefined } as unknown as object)).rejects.toThrow(/lossless JSON/)
    await expect(p.appendEvent(h.id, 'user/message', { v: Number.NaN } as unknown as object)).rejects.toThrow(/lossless JSON/)
    const sparse: unknown[] = []
    sparse[2] = 'x'
    await expect(p.appendEvent(h.id, 'user/message', sparse as unknown as object)).rejects.toThrow(/lossless JSON/)
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('rejects append to unknown session', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    await expect(p.appendEvent('nope' as never, 'user/message', { content: 'x' })).rejects.toThrow(/session not found/)
    await expect(p.getEvents('nope' as never)).rejects.toThrow(/session not found/)
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reconstruction: events derive in seq order', async () => {
    const dir = mkTmp()
    const p = new SqlitePersistenceAdapter(dir)
    const h = await p.create('s')
    for (let i = 0; i < 5; i++) await p.appendEvent(h.id, 'user/message', { content: `msg-${i}` })
    const evts = await p.getEvents(h.id)
    const contents = evts.map((e) => (e.data as { content: string }).content)
    expect(contents).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4'])
    await p.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
