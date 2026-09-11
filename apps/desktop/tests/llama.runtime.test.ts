import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  LLAMA_BUILD,
  LLAMA_DOWNLOAD_URL,
  buildServerArgs,
  estimateVramMB,
  findFreePort,
  getLlamaRuntimeDir,
  getLlamaServerPath,
  kvCacheMBFromInfo,
  parseNvidiaSmiCsv,
  parseParamsB,
  planMemory,
  planPartialFit,
  readGgufModelInfo,
} from '../src/main/services/llamaRuntime'
import { LlamaCppServerAdapter } from '../src/main/backend/ports/LlamaCppServerAdapter'
import { SystemResourceStub } from '../src/main/backend/ports/SystemResourceStub'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-llama-'))
}

/** Minimal valid GGUF: header + shape metadata, zero padded to `bytes`. */
function writeMiniGguf(
  dir: string,
  name: string,
  shape: { arch?: string; blocks: number; embd?: number; heads?: number; kvHeads?: number; keyLen?: number },
  bytes = 4096
): string {
  const arch = shape.arch ?? 'testarch'
  const parts: Buffer[] = []
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
    ...(shape.keyLen ? [kvU32(`${arch}.attention.key_length`, shape.keyLen)] : []),
  ]
  const head = Buffer.concat([Buffer.from('GGUF', 'binary'), u32(3), u64(0), u64(entries.length), ...entries])
  const p = path.join(dir, name)
  const body = Buffer.alloc(Math.max(0, bytes - head.length))
  fs.writeFileSync(p, Buffer.concat([head, body]))
  return p
}

describe('llamaRuntime — pure helpers', () => {
  it('pins a non-floating CUDA build URL', () => {
    expect(LLAMA_BUILD).toMatch(/^b\d+$/)
    expect(LLAMA_DOWNLOAD_URL).toContain(`releases/download/${LLAMA_BUILD}/llama-${LLAMA_BUILD}-bin-win-cuda-12.4-x64.zip`)
    expect(LLAMA_DOWNLOAD_URL.startsWith('https://github.com/')).toBe(true)
  })

  it('parses nvidia-smi csv (headerless, header, missing free)', () => {
    expect(parseNvidiaSmiCsv('6144, 6001, NVIDIA GeForce RTX 3050 6GB Laptop GPU')).toEqual({
      totalMB: 6144, freeMB: 6001, name: 'NVIDIA GeForce RTX 3050 6GB Laptop GPU',
    })
    expect(parseNvidiaSmiCsv('name, memory.total [MiB], memory.free [MiB]\n8192, 7000, Some GPU')?.totalMB).toBe(8192)
    // nvidia-smi prints total,free,name in --query order; garbage yields null, never a fabricated number
    expect(parseNvidiaSmiCsv('')).toBeNull()
    expect(parseNvidiaSmiCsv('not a gpu line')).toBeNull()
  })

  it('parses param counts for KV math, null when unknown', () => {
    expect(parseParamsB('Qwen3-0.6B-Q4_K_M.gguf')).toBe(0.6)
    expect(parseParamsB('Bonsai-27B-Q1_0.gguf')).toBe(27)
    expect(parseParamsB('model.gguf')).toBeNull()
  })

  it('estimates VRAM honestly: weights×1.15 + KV, scales with size', () => {
    const tiny = estimateVramMB(400 * 1024 * 1024, 4096, 'Qwen3-0.6B-Q4_K_M.gguf')
    const big = estimateVramMB(5 * 1024 * 1024 * 1024, 4096, 'Qwen3-14B-Q4_K_M.gguf')
    expect(tiny).toBeGreaterThan(400)
    expect(tiny).toBeLessThan(1500)
    expect(big).toBeGreaterThan(tiny)
    expect(big).toBeGreaterThan(5000)
  })

  it('builds sidecar args pinned to loopback + full GPU offload', () => {
    const args = buildServerArgs({ modelPath: 'C:\\m\\q.gguf', port: 18777, ctxLen: 4096, alias: 'q' })
    expect(args).toContain('127.0.0.1')
    expect(args).toContain('18777')
    expect(args).toContain('999') // -ngl all layers → VRAM, not CPU
    expect(args).not.toContain('0.0.0.0')
  })

  it('finds a bindable loopback port', async () => {
    const port = await findFreePort()
    expect(port).toBeGreaterThan(0)
  })

  it('reports missing binary as null (never throws)', () => {
    expect(getLlamaServerPath(mkTmp())).toBeNull()
  })

  it('scopes the runtime dir under the data dir + pinned build', () => {
    const dir = mkTmp()
    expect(getLlamaRuntimeDir(dir)).toBe(path.join(dir, 'runtime', 'llama.cpp', LLAMA_BUILD))
  })
})

describe('llamaRuntime — GGUF header probing', () => {
  it('reads transformer shape from a GGUF header', () => {
    const dir = mkTmp()
    const p = writeMiniGguf(dir, 'glm-like.gguf', { arch: 'glm4', blocks: 40, embd: 4096, heads: 32, kvHeads: 2 })
    expect(readGgufModelInfo(p)).toEqual({ arch: 'glm4', blockCount: 40, embeddingLength: 4096, headCount: 32, kvHeadCount: 2 })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns null (never throws) for missing, non-GGUF, and truncated files', () => {
    const dir = mkTmp()
    expect(readGgufModelInfo(path.join(dir, 'ghost.gguf'))).toBeNull()
    const txt = path.join(dir, 'notes.gguf')
    fs.writeFileSync(txt, 'definitely not a gguf file ............')
    expect(readGgufModelInfo(txt)).toBeNull()
    const tiny = path.join(dir, 'tiny.gguf')
    fs.writeFileSync(tiny, Buffer.alloc(8))
    expect(readGgufModelInfo(tiny)).toBeNull()
    const noext = path.join(dir, 'model.bin')
    fs.writeFileSync(noext, Buffer.alloc(64))
    expect(readGgufModelInfo(noext)).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('sizes GQA KV caches exactly (2 KV heads << legacy dense heuristic)', () => {
    // GLM-4.6V-like: 2 (k+v) × 40 layers × 2 kv heads × 128 dim × fp16
    const kv = kvCacheMBFromInfo({ arch: 'glm4', blockCount: 40, embeddingLength: 4096, headCount: 32, kvHeadCount: 2 }, 4096, 1)
    expect(kv).toBe(160) // 40960 B/token × 4096
    const dense = kvCacheMBFromInfo({ arch: 'llama', blockCount: 32, embeddingLength: 4096, headCount: 32, kvHeadCount: 32 }, 4096, 1)
    expect(dense).not.toBeNull()
    expect(dense as number).toBeGreaterThan(kv as number)
  })

  it('planMemory prefers header math, falls back to legacy for unknown files', () => {
    const dir = mkTmp()
    const gqa = writeMiniGguf(dir, 'gqa-40.gguf', { blocks: 40, embd: 4096, heads: 32, kvHeads: 2 })
    const size = 6 * 1024 * 1024 * 1024
    const exact = planMemory(size, 4096, gqa, { nParallel: 1 })
    expect(exact.archAware).toBe(true)
    expect(exact.kvCacheMB).toBe(160)
    const legacy = planMemory(size, 4096, 'unknown-40B-Q4_K_M.gguf', { nParallel: 1 })
    expect(legacy.archAware).toBe(false)
    expect(legacy.kvCacheMB).toBeGreaterThan(exact.kvCacheMB)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('planPartialFit sizes layers-to-fit, refuses impossible fits', () => {
    const dir = mkTmp()
    // 100MB file, 40 layers → 2.5MB/layer; KV 40MB at ctx 1024; full = 411MB
    const gqa = writeMiniGguf(dir, 'gqa-40.gguf', { blocks: 40, embd: 4096, heads: 32, kvHeads: 2 }, 100 * 1024 * 1024)
    const fit = planPartialFit({ modelPath: gqa, fileSizeBytes: 100 * 1024 * 1024, ctxLen: 1024, totalMB: 400 })
    expect(fit).not.toBeNull()
    expect(fit!.totalLayers).toBe(40)
    expect(fit!.fitLayers).toBeGreaterThanOrEqual(8) // ≥20% minimum useful offload
    expect(fit!.fitLayers).toBeLessThan(40)
    expect(fit!.estimatedMB).toBeLessThanOrEqual(400)
    // Hopelessly small GPU → null (honest refusal, not ngl 0 masquerading as GPU)
    expect(planPartialFit({ modelPath: gqa, fileSizeBytes: 100 * 1024 * 1024, ctxLen: 1024, totalMB: 300 })).toBeNull()
    // Unreadable header → null
    const zeros = path.join(dir, 'zeros.gguf')
    fs.writeFileSync(zeros, Buffer.alloc(1024))
    expect(planPartialFit({ modelPath: zeros, fileSizeBytes: 100 * 1024 * 1024, ctxLen: 1024, totalMB: 4000 })).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('LlamaCppServerAdapter — port contract without spawning', () => {
  it('lists library GGUFs as sovara-source local models', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(path.join(lib, 'Qwen__Qwen3-0.6B'), { recursive: true })
    fs.writeFileSync(path.join(lib, 'Qwen__Qwen3-0.6B', 'Qwen3-0.6B-Q4_K_M.gguf'), Buffer.alloc(1024))
    fs.writeFileSync(path.join(lib, 'notes.txt'), 'not a model')
    const adapter = new LlamaCppServerAdapter(dir, null, lib)
    const models = await adapter.listLocalModels()
    expect(models).toHaveLength(1)
    expect(models[0].source).toBe('sovara')
    expect(models[0].format).toBe('gguf')
    expect(models[0].displayName).toBe('Qwen3-0.6B-Q4_K_M.gguf')
    expect(models[0].params).toBe('0.6B')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('resolves model ids (basename, no-ext, repository/file) to absolute GGUF', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(path.join(lib, 'Qwen__Qwen3-0.6B'), { recursive: true })
    const gguf = path.join(lib, 'Qwen__Qwen3-0.6B', 'Qwen3-0.6B-Q4_K_M.gguf')
    fs.writeFileSync(gguf, Buffer.alloc(16))
    const adapter = new LlamaCppServerAdapter(dir, null, lib)
    expect(adapter.resolveModelPath('Qwen3-0.6B-Q4_K_M.gguf')).toBe(gguf)
    expect(adapter.resolveModelPath('Qwen3-0.6B-Q4_K_M')).toBe(gguf)
    expect(adapter.resolveModelPath(gguf)).toBe(gguf)
    expect(() => adapter.resolveModelPath('ghost-70B-Q4_K_M')).toThrow(/model-not-found/)
    expect(() => adapter.resolveModelPath('')).toThrow(/model-not-found/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses load honestly when the binary is not installed (no fake instance)', async () => {
    const dir = mkTmp()
    const lib = path.join(dir, 'models')
    fs.mkdirSync(lib, { recursive: true })
    fs.writeFileSync(path.join(lib, 'tiny-Q4_K_M.gguf'), Buffer.alloc(16))
    const adapter = new LlamaCppServerAdapter(dir, null, lib)
    await expect(adapter.load('tiny-Q4_K_M' as never, { runtimeId: 'local' })).rejects.toThrow(/not installed|runtime/)
    expect(await adapter.listInstances()).toEqual([])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('probeRuntime reports unavailable without binary, health unknown instances', async () => {
    const adapter = new LlamaCppServerAdapter(mkTmp(), null, mkTmp())
    expect(await adapter.probeRuntime('local')).toEqual({ available: false })
    expect(await adapter.health('inst_nope' as never)).toMatchObject({ ok: false })
    await expect(adapter.unload('inst_nope' as never)).rejects.toThrow(/unknown instance/)
  })
})

describe('SystemResourceStub — real readings, switch-aware pressure', () => {
  it('snapshot keeps the required shape with honest GPU fields', async () => {
    const snap = await new SystemResourceStub().getSnapshot()
    expect(snap.cpu.logicalCores).toBeGreaterThan(0)
    expect(snap.ram.totalMB).toBeGreaterThan(0)
    expect(snap.gpu).toBeDefined()
    expect(snap.limits.maxConcurrentModels).toBe(1)
    // Unknown VRAM stays undefined — never a fabricated 8192
    if (snap.vram.totalMB === undefined) expect(snap.vram.freeMB).toBeUndefined()
  })

  it('switching models warns (non-blocking) instead of refusing', async () => {
    const stub = new SystemResourceStub(async () => [
      { id: 'inst_a' as never, modelId: 'a' as never, runtimeId: 'local', status: 'loaded', ctxLen: 4096, metrics: { vramUsedMB: 800 } },
    ])
    const verdict = await stub.checkBeforeLoad({ id: 'b' as never, displayName: 'b', source: 'sovara', format: 'gguf' })
    expect(verdict.blocking).not.toBe(true)
  })

  it('same resident model is ok', async () => {
    const stub = new SystemResourceStub(async () => [
      { id: 'inst_a' as never, modelId: 'a' as never, runtimeId: 'local', status: 'loaded', ctxLen: 4096 },
    ])
    const verdict = await stub.checkBeforeLoad({ id: 'a' as never, displayName: 'a', source: 'sovara', format: 'gguf' })
    expect(verdict).toMatchObject({ level: 'ok' })
  })
})
