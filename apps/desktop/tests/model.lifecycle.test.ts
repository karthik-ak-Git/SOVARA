import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { LlamaCppServerAdapter } from '../src/main/backend/ports/LlamaCppServerAdapter'
import { classifyLoadFailure, planMemory } from '../src/main/services/llamaRuntime'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-lifecycle-'))
}

function writeGguf(lib: string, name: string, bytes = 4096): string {
  const p = path.join(lib, name)
  fs.writeFileSync(p, Buffer.alloc(bytes))
  return p
}

function makeFakeProc(pid: number, hooks?: { killed?: { count: number } }) {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>()
  const proc = {
    pid,
    exitCode: null as number | null,
    signalCode: null as string | null,
    stdout: null,
    stderr: null,
    once(event: string, fn: (...a: unknown[]) => void) {
      const arr = handlers.get(event) ?? []
      arr.push(fn)
      handlers.set(event, arr)
      return proc
    },
    on() { return proc },
    kill(_sig?: string) {
      if (hooks?.killed) hooks.killed.count++
      if (proc.exitCode === null) {
        proc.exitCode = 0
        for (const fn of handlers.get('exit') ?? []) {
          try { fn(0, null) } catch { /* ignore */ }
        }
      }
      return true
    },
    __die(code: number | null) {
      proc.exitCode = code
      for (const fn of handlers.get('exit') ?? []) {
        try { fn(code, null) } catch { /* ignore */ }
      }
    },
  }
  return proc as unknown as ChildProcess & { __die: (c: number | null) => void }
}

interface SpawnLog { count: number; procs: Array<ChildProcess & { __die: (c: number | null) => void }> }

function makeDeps(over?: {
  waitReady?: (port: number, t: number) => Promise<void>
  vramSeq?: Array<{ totalMB?: number; freeMB?: number; name?: string } | null>
  killed?: { count: number }
}) {
  const spawnLog: SpawnLog = { count: 0, procs: [] }
  let port = 41000
  let vramCalls = 0
  const seq = over?.vramSeq
  return {
    spawnLog,
    deps: {
      exePathOverride: 'C:\\fake\\llama-server.exe' as string | null,
      spawn: ((_o: unknown) => {
        spawnLog.count++
        const proc = makeFakeProc(9000 + spawnLog.count, { killed: over?.killed })
        spawnLog.procs.push(proc)
        return proc as unknown as ChildProcess
      }) as never,
      waitReady: (over?.waitReady ?? (async () => {})) as never,
      queryVram: (async () => {
        if (seq) {
          const v = seq[Math.min(vramCalls, seq.length - 1)]
          vramCalls++
          return v
        }
        return { totalMB: 6144, freeMB: 6000, name: 'Test GPU' }
      }) as never,
      findPort: (async () => port++) as never,
    },
  }
}

function makeAdapter(lib: string, baseDir: string, d: ReturnType<typeof makeDeps>['deps']) {
  return new LlamaCppServerAdapter(baseDir, null, lib, d)
}

/** Minimal valid GGUF: header + shape metadata, zero padded to `bytes`. */
function writeMiniGguf(
  lib: string,
  name: string,
  shape: { arch?: string; blocks: number; embd?: number; heads?: number; kvHeads?: number },
  bytes = 4096
): string {
  const arch = shape.arch ?? 'testarch'
  const u32 = (v: number): Buffer => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b }
  const u64 = (v: number): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b }
  const str = (s: string): Buffer => Buffer.concat([u64(Buffer.byteLength(s)), Buffer.from(s, 'utf8')])
  const kvStr = (k: string, v: string): Buffer => Buffer.concat([str(k), u32(8), str(v)])
  const kvU32 = (k: string, v: number): Buffer => Buffer.concat([str(k), u32(4), u32(v)])
  const entries = [
    kvStr('general.architecture', arch),
    kvU32(`${arch}.block_count`, shape.blocks),
    kvU32(`${arch}.embedding_length`, shape.embd ?? 4096),
    kvU32(`${arch}.attention.head_count`, shape.heads ?? 32),
    kvU32(`${arch}.attention.head_count_kv`, shape.kvHeads ?? 8),
  ]
  const head = Buffer.concat([Buffer.from('GGUF', 'binary'), u32(3), u64(0), u64(entries.length), ...entries])
  const p = path.join(lib, name)
  fs.writeFileSync(p, Buffer.concat([head, Buffer.alloc(Math.max(0, bytes - head.length))]))
  return p
}

describe('lifecycle — loading', () => {
  let dir = ''
  let lib = ''
  beforeEach(() => {
    dir = mkTmp()
    lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
  })

  it('model loads successfully with verified readiness + registered instance', async () => {
    writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf')
    const { deps } = makeDeps()
    const a = makeAdapter(lib, dir, deps)
    const inst = await a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(inst.state).toBe('ACTIVE')
    expect(inst.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/)
    expect(inst.pid).toBeGreaterThan(0)
    expect(inst.configuration?.ctxLen).toBe(4096)
    expect(inst.loadTimeMs).toBeGreaterThanOrEqual(0)
    const h = await a.health(inst.id)
    expect(h.ok).toBe(true)
    expect(a.baseUrl(inst.id)).toBe(inst.endpoint)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('readiness is required: timeout kills the runner and leaves no stuck LOADING', async () => {
    writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf')
    const killed = { count: 0 }
    const { deps, spawnLog } = makeDeps({
      waitReady: async () => { throw new Error('local model did not become ready within 240s') },
      killed,
    })
    const a = makeAdapter(lib, dir, deps)
    await expect(a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })).rejects.toThrow(/readiness-timeout|did not become ready/)
    expect(spawnLog.count).toBe(1)
    expect(killed.count).toBeGreaterThan(0)
    expect(await a.listInstances()).toEqual([])
    // A second load retries cleanly (no permanently stuck LOADING).
    const { deps: d2 } = makeDeps()
    const a2 = makeAdapter(lib, dir, d2)
    const inst = await a2.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(inst.state).toBe('ACTIVE')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('invalid model fails cleanly with model-not-found', async () => {
    const { deps } = makeDeps()
    const a = makeAdapter(lib, dir, deps)
    await expect(a.load('ghost-70B-Q4_K_M' as never, { runtimeId: 'local' })).rejects.toThrow(/model-not-found/)
    expect(await a.listInstances()).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('missing runner fails cleanly without spawning', async () => {
    writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf')
    const { deps, spawnLog } = makeDeps()
    const a = makeAdapter(lib, dir, { ...deps, exePathOverride: null })
    await expect(a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })).rejects.toThrow(/not installed|Install local runtime/)
    expect(spawnLog.count).toBe(0)
    expect(await a.listInstances()).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('lifecycle — concurrency', () => {
  it('10 simultaneous requests create ONE runner and share ONE instance', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf')
    let resolveReady!: () => void
    const readyGate = new Promise<void>((r) => { resolveReady = r })
    const { deps, spawnLog } = makeDeps({ waitReady: () => readyGate })
    const a = makeAdapter(lib, dir, deps)
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i === 0
          ? (async () => { await new Promise((r) => setTimeout(r, 20)); resolveReady(); return a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' }) })()
          : a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
      )
    )
    expect(spawnLog.count).toBe(1)
    const ids = new Set(results.map((r) => String(r.id)))
    const endpoints = new Set(results.map((r) => r.endpoint))
    expect(ids.size).toBe(1)
    expect(endpoints.size).toBe(1)
    expect(await a.listInstances()).toHaveLength(1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('ensureHealthy reuses the verified instance without respawning', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf')
    const { deps, spawnLog } = makeDeps()
    const a = makeAdapter(lib, dir, deps)
    const first = await a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    const second = await a.ensureHealthy!('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(spawnLog.count).toBe(1)
    expect(String(second.id)).toBe(String(first.id))
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('lifecycle — routing', () => {
  it('unhealthy instance is never used: crash forces reload on next request', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf')
    const { deps, spawnLog } = makeDeps()
    const a = makeAdapter(lib, dir, deps)
    const first = await a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    // Simulate an unexpected runner crash.
    spawnLog.procs[0]!.__die(1)
    await new Promise((r) => setTimeout(r, 10))
    const h = await a.health(first.id)
    expect(h.ok).toBe(false)
    expect(() => a.baseUrl(first.id)).toThrow(/failed|process-exited|not serving/)
    const second = await a.ensureHealthy!('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(spawnLog.count).toBe(2)
    expect((await a.health(second.id)).ok).toBe(true)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('lifecycle — memory', () => {
  it('estimate is not treated as exact usage: observed allocation recorded separately', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    const gguf = writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf', 400 * 1024 * 1024)
    const size = fs.statSync(gguf).size
    const { deps } = makeDeps({
      vramSeq: [
        { totalMB: 6144, freeMB: 6000 },
        { totalMB: 6144, freeMB: 6000 },
        { totalMB: 6144, freeMB: 5200 },
      ],
    })
    const a = makeAdapter(lib, dir, deps)
    const inst = await a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(inst.estimatedVramMB).toBeGreaterThan(0)
    expect(inst.observedVramMB).toBe(800) // 6000 − 5200
    expect(inst.observedVramMB).not.toBe(inst.estimatedVramMB)
    expect(inst.vramEstimated).toBe(false)
    expect(inst.metrics?.vramEstimated).toBe(false)
    void size
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('KV cache accounts for parallel slots', () => {
    const one = planMemory(1024 * 1024 * 1024, 4096, 'model-7B-Q4_K_M.gguf', { nParallel: 1 })
    const four = planMemory(1024 * 1024 * 1024, 4096, 'model-7B-Q4_K_M.gguf', { nParallel: 4 })
    expect(four.kvCacheMB).toBe(one.kvCacheMB * 4)
    expect(four.estimatedMB).toBeGreaterThan(one.estimatedMB)
  })

  it('OOM handling differs from generic CUDA/backend failure', () => {
    expect(classifyLoadFailure('CUDA error: out of memory').kind).toBe('oom')
    expect(classifyLoadFailure('CUDA error: out of memory').recoverable).toBe(false)
    expect(classifyLoadFailure('CUDA driver failed to initialize').kind).toBe('backend-failure')
    expect(classifyLoadFailure('connection refused').kind).toBe('unknown')
    expect(classifyLoadFailure('EADDRINUSE port in use').recoverable).toBe(true)
  })
})

describe('lifecycle — unload', () => {
  it('unload stops the runner, clears the registry, keeps the file, reload works', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    const gguf = writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf')
    const killed = { count: 0 }
    const { deps, spawnLog } = makeDeps({ killed })
    const a = makeAdapter(lib, dir, deps)
    const inst = await a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(inst.state).toBe('ACTIVE')
    await a.unload(inst.id)
    expect(killed.count).toBeGreaterThan(0)
    expect(await a.listInstances()).toEqual([])
    expect(fs.existsSync(gguf)).toBe(true) // unload ≠ delete
    const again = await a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(again.state).toBe('ACTIVE')
    expect(spawnLog.count).toBe(2)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('LRU eviction never evicts a generating instance', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeGguf(lib, 'a-0.5B-Q4_K_M.gguf')
    writeGguf(lib, 'b-0.5B-Q4_K_M.gguf')
    const { deps } = makeDeps()
    const a = makeAdapter(lib, dir, deps)
    const first = await a.load('a-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    a.noteRequestStart!(first.id) // generating — ineligible for eviction
    await expect(a.load('b-0.5B-Q4_K_M' as never, { runtimeId: 'local' })).rejects.toThrow(/eligible for eviction|resource-pressure/)
    a.noteRequestEnd!(first.id)
    const second = await a.load('b-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(second.state).toBe('ACTIVE')
    // The evicted first model is OFFLINE now.
    expect(await a.health(first.id)).toMatchObject({ ok: false })
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('lifecycle — refusal quality', () => {
  it('oversized model refusal is ASCII-only, single-prefixed, and names fitting alternatives', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeGguf(lib, 'huge-27B-Q4_K_M.gguf', 100 * 1024) // size irrelevant: mocked VRAM forces refusal
    writeGguf(lib, 'tiny-0.6B-Q4_K_M.gguf', 1024)
    const { deps } = makeDeps({
      vramSeq: [{ totalMB: 1500, freeMB: 1400, name: 'Tiny GPU' }],
    })
    const a = makeAdapter(lib, dir, deps)
    let err: Error | null = null
    try {
      await a.load('huge-27B-Q4_K_M' as never, { runtimeId: 'local' })
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(Error)
    const message = (err as unknown as Error).message
    expect(message).toMatch(/^resource-pressure: (?!resource-pressure)/)
    expect(message).not.toMatch(/[^\x00-\x7F]/)
    expect(message).toMatch(/tiny-0\.6B-Q4_K_M\.gguf/)
    expect(await a.listInstances()).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('mmproj projector shards are never named as fitting alternatives', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeGguf(lib, 'huge-27B-Q4_K_M.gguf', 100 * 1024) // refused via mocked VRAM
    writeGguf(lib, 'mmproj-huge-27B-BF16.gguf', 1024) // small: would pass the size gate
    writeGguf(lib, 'tiny-0.6B-Q4_K_M.gguf', 1024)
    const { deps } = makeDeps({
      vramSeq: [{ totalMB: 1500, freeMB: 1400, name: 'Tiny GPU' }],
    })
    const a = makeAdapter(lib, dir, deps)
    let err: Error | null = null
    try {
      await a.load('huge-27B-Q4_K_M' as never, { runtimeId: 'local' })
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(Error)
    const message = (err as unknown as Error).message
    expect(message).not.toMatch(/mmproj/i)
    expect(message).toMatch(/tiny-0\.6B-Q4_K_M\.gguf/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('direct mmproj load is refused as invalid-model, never spawned', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeGguf(lib, 'mmproj-huge-27B-BF16.gguf', 1024)
    const { deps, spawnLog } = makeDeps()
    const a = makeAdapter(lib, dir, deps)
    await expect(a.load('mmproj-huge-27B-BF16' as never, { runtimeId: 'local' })).rejects.toThrow(/^invalid-model: .*vision projector/)
    expect(spawnLog.count).toBe(0)
    expect(await a.listInstances()).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('lifecycle — GPU placement modes', () => {
  // 100MB file, 40 layers (2.5MB/layer), GQA KV 40MB @ctx1024, full = 411MB.
  function setupFitLib(): { dir: string; lib: string } {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeMiniGguf(lib, 'gqa-40-Q4_K_M.gguf', { blocks: 40, embd: 4096, heads: 32, kvHeads: 2 }, 100 * 1024 * 1024)
    return { dir, lib }
  }

  function captureNgl(deps: ReturnType<typeof makeDeps>['deps']): { seen: number[] } {
    const seen: number[] = []
    const inner = deps.spawn
    deps.spawn = ((o: { nGpuLayers?: number }) => {
      seen.push(o?.nGpuLayers ?? -1)
      return (inner as (x: unknown) => ChildProcess)(o)
    }) as never
    return { seen }
  }

  it('fit mode partially offloads an otherwise-too-big model, recorded honestly', async () => {
    const { dir, lib } = setupFitLib()
    const { deps, spawnLog } = makeDeps({ vramSeq: [{ totalMB: 400, freeMB: 390, name: 'Small GPU' }] })
    const { seen } = captureNgl(deps)
    const a = makeAdapter(lib, dir, deps)
    const inst = await a.load('gqa-40-Q4_K_M' as never, { runtimeId: 'local', gpu: 'fit', ctxLen: 1024 })
    expect(inst.state).toBe('ACTIVE')
    expect(spawnLog.count).toBe(1)
    expect(seen[0]).toBeGreaterThanOrEqual(8)
    expect(seen[0]).toBeLessThan(40)
    expect(inst.partialOffload).toBe(true)
    expect(inst.offloadedLayers).toBe(seen[0])
    expect(inst.configuration?.nGpuLayers).toBe(seen[0])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('fit mode refuses honestly when even minimum offload cannot fit', async () => {
    const { dir, lib } = setupFitLib()
    const { deps, spawnLog } = makeDeps({ vramSeq: [{ totalMB: 300, freeMB: 290, name: 'Tiny GPU' }] })
    const a = makeAdapter(lib, dir, deps)
    await expect(a.load('gqa-40-Q4_K_M' as never, { runtimeId: 'local', gpu: 'fit' })).rejects.toThrow(/resource-pressure: .*minimum partial offload/)
    expect(spawnLog.count).toBe(0)
    expect(await a.listInstances()).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('cpu mode skips the VRAM gate and spawns with zero GPU layers', async () => {
    const { dir, lib } = setupFitLib()
    const { deps, spawnLog } = makeDeps({ vramSeq: [{ totalMB: 300, freeMB: 290, name: 'Tiny GPU' }] })
    const { seen } = captureNgl(deps)
    const a = makeAdapter(lib, dir, deps)
    const inst = await a.load('gqa-40-Q4_K_M' as never, { runtimeId: 'local', gpu: 'cpu' })
    expect(inst.state).toBe('ACTIVE')
    expect(spawnLog.count).toBe(1)
    expect(seen[0]).toBe(0)
    expect(inst.hardwareDevice).toBe('cpu')
    expect(inst.partialOffload).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('explicit layer count is estimate-gated and recorded', async () => {
    const { dir, lib } = setupFitLib()
    const { deps, spawnLog } = makeDeps({ vramSeq: [{ totalMB: 400, freeMB: 390, name: 'Small GPU' }] })
    const { seen } = captureNgl(deps)
    const a = makeAdapter(lib, dir, deps)
    const inst = await a.load('gqa-40-Q4_K_M' as never, { runtimeId: 'local', gpu: 10, ctxLen: 1024 })
    expect(inst.state).toBe('ACTIVE')
    expect(seen[0]).toBe(10)
    expect(inst.partialOffload).toBe(true)
    expect(inst.offloadedLayers).toBe(10)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('auto refusal names Fit mode when a partial offload would fit', async () => {
    const { dir, lib } = setupFitLib()
    const { deps } = makeDeps({ vramSeq: [{ totalMB: 400, freeMB: 390, name: 'Small GPU' }] })
    const a = makeAdapter(lib, dir, deps)
    let err: Error | null = null
    try {
      await a.load('gqa-40-Q4_K_M' as never, { runtimeId: 'local', ctxLen: 1024 })
    } catch (e) {
      err = e as Error
    }
    expect(err).toBeInstanceOf(Error)
    // Full needs 411MB > 400MB; fit (~39/40 layers) is offered explicitly.
    expect((err as unknown as Error).message).toMatch(/Fit mode could offload \d+\/40 layers/)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('lifecycle — failure', () => {
  it('runner crash cleans the registry (no stale ACTIVE)', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    writeGguf(lib, 'tiny-0.5B-Q4_K_M.gguf')
    const { deps, spawnLog } = makeDeps()
    const a = makeAdapter(lib, dir, deps)
    const inst = await a.load('tiny-0.5B-Q4_K_M' as never, { runtimeId: 'local' })
    expect(inst.state).toBe('ACTIVE')
    spawnLog.procs[0]!.__die(137)
    await new Promise((r) => setTimeout(r, 10))
    const list = await a.listInstances()
    // No ACTIVE entry remains routable.
    expect(list.filter((i) => i.state === 'ACTIVE' || i.status === 'loaded')).toEqual([])
    expect(() => a.baseUrl(inst.id)).toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
