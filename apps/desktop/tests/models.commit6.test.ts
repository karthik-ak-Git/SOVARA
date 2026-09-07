import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { getLoopbackJson, isLoopbackUrl, LoopbackViolationError } from '../src/main/network/HttpClient'
import { CustomOpenAICompatibleAdapter } from '../src/main/backend/ports/CustomOpenAICompatibleAdapter'
import { RuntimeConfigStore } from '../src/main/config/RuntimeConfigStore'
import { ModelWorkbench, normalizeEndpoint } from '../src/main/backend/ModelWorkbench'
import { SystemResourceStub } from '../src/main/backend/ports/SystemResourceStub'
import {
  zModelsAddRuntime,
  zModelsListModels,
  zModelsRuntimeRef,
  zModelsSelect,
} from '../src/shared/ipc/schemas'
import { IPC_CHANNELS } from '../src/shared/ipc/channels'
import type { SystemResourceManagerPort } from '../src/shared/types/ports'

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-c6-'))
}

function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv = http.createServer(handler)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ port, close: () => new Promise((r) => srv.close(() => r())) })
    })
  })
}

const okResources: SystemResourceManagerPort = {
  getSnapshot: async () => {
    throw new Error('unused')
  },
  checkBeforeLoad: async () => ({ level: 'ok' }),
  getLimits: async () => ({ maxConcurrentModels: 1 }),
  setLimits: async () => {},
}

describe('Commit 6 — loopback sovereignty', () => {
  it('accepts loopback spellings', async () => {
    expect(await isLoopbackUrl('http://127.0.0.1:1234/v1')).toBe(true)
    expect(await isLoopbackUrl('http://localhost:1234/v1')).toBe(true)
    expect(await isLoopbackUrl('http://[::1]:1234/v1')).toBe(true)
    expect(await isLoopbackUrl('http://127.0.0.2:11434/')).toBe(true)
  })

  it('rejects remote, public IPs, https, credentials, garbage', async () => {
    expect(await isLoopbackUrl('https://example.com')).toBe(false)
    expect(await isLoopbackUrl('https://api.openai.com/v1/models')).toBe(false)
    expect(await isLoopbackUrl('http://example.com/v1/models')).toBe(false)
    expect(await isLoopbackUrl('http://8.8.8.8/v1')).toBe(false)
    expect(await isLoopbackUrl('http://93.184.216.34/')).toBe(false)
    expect(await isLoopbackUrl('https://127.0.0.1:1234/v1')).toBe(false)
    expect(await isLoopbackUrl('http://user:pass@127.0.0.1:1234/v1')).toBe(false)
    expect(await isLoopbackUrl('not-a-url')).toBe(false)
    expect(await isLoopbackUrl('ftp://127.0.0.1/x')).toBe(false)
  })

  it('GETs a local /models endpoint', async () => {
    const { port, close } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'm1' }] }))
    })
    const r = await getLoopbackJson(`http://127.0.0.1:${port}/v1/models`, { timeoutMs: 3000 })
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ data: [{ id: 'm1' }] })
    await close()
  })

  it('times out instead of hanging', async () => {
    const { port, close } = await startServer(() => {
      // never respond
    })
    await expect(getLoopbackJson(`http://127.0.0.1:${port}/v1/models`, { timeoutMs: 300 })).rejects.toThrow()
    await close()
  })

  it('rejects malformed (non-JSON) payloads', async () => {
    const { port, close } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>nope</html>')
    })
    await expect(getLoopbackJson(`http://127.0.0.1:${port}/v1/models`, { timeoutMs: 3000 })).rejects.toThrow(/invalid-response/)
    await close()
  })

  it('blocks redirects away from localhost', async () => {
    const { port, close } = await startServer((_req, res) => {
      res.writeHead(302, { location: 'http://example.com/v1/models' })
      res.end()
    })
    await expect(getLoopbackJson(`http://127.0.0.1:${port}/v1/models`, { timeoutMs: 3000 })).rejects.toThrow(LoopbackViolationError)
    await close()
  })

  it('refuses connection with a classified error, not a raw stack', async () => {
    await expect(getLoopbackJson('http://127.0.0.1:9/v1/models', { timeoutMs: 1500 })).rejects.toThrow()
  })
})

describe('Commit 6 — adapter normalization', () => {
  const rt = { id: 'rt-1', displayName: 'Local', type: 'openai-compatible' as const, endpoint: 'http://127.0.0.1:1234/v1', enabled: true, timeoutMs: 3000 }

  it('normalizes the standard data[] shape', async () => {
    const adapter = new CustomOpenAICompatibleAdapter(async () => ({
      status: 200,
      json: { object: 'list', data: [{ id: 'llama-3', owned_by: 'local', context_window: 8192 }] },
      latencyMs: 5,
    }))
    const { result } = await adapter.probe(rt)
    expect(result.reachable).toBe(true)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]).toMatchObject({ modelId: 'rt-1:llama-3', displayName: 'llama-3', runtimeId: 'rt-1', available: true, contextLength: 8192 })
  })

  it('tolerates enriched models maps and skips id-less rows', async () => {
    const adapter = new CustomOpenAICompatibleAdapter(async () => ({
      status: 200,
      json: { models: { 'qwen-3': { display_name: 'Qwen 3', context_length: 32768 }, broken: { nope: 1 } } },
      latencyMs: 5,
    }))
    const { result } = await adapter.probe(rt)
    expect(result.models.map((m) => m.modelId).sort()).toEqual(['rt-1:broken', 'rt-1:qwen-3'])
    expect(result.models.find((m) => m.modelId === 'rt-1:qwen-3')?.contextLength).toBe(32768)
  })

  it('classifies http errors and unreachable runtimes without raw exceptions', async () => {
    const http500 = new CustomOpenAICompatibleAdapter(async () => ({ status: 500, json: {}, latencyMs: 5 }))
    const r500 = await http500.probe(rt)
    expect(r500.result.reachable).toBe(false)
    expect(r500.result.error).toMatch(/^http-error/)

    const refused = new CustomOpenAICompatibleAdapter(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:1234')
    })
    const rRef = await refused.probe(rt)
    expect(rRef.result.reachable).toBe(false)
    expect(rRef.result.error).toMatch(/^connection-refused/)
    expect(rRef.result.error).not.toMatch(/at |Error: connect/)
  })
})

describe('Commit 6 — workbench registry + selection + restart', () => {
  function makeWorkbench(
    dir: string,
    opts?: { resources?: SystemResourceManagerPort; http?: (url: string, o?: { timeoutMs?: number; maxBytes?: number }) => Promise<{ status: number; json: unknown; latencyMs: number }> }
  ): ModelWorkbench {
    return new ModelWorkbench(new RuntimeConfigStore(dir), opts?.resources ?? okResources, dir, opts?.http)
  }

  function cleanupWorkbench(dir: string, ...wbs: ModelWorkbench[]): void {
    for (const wb of wbs) {
      try {
        wb.dispose()
      } catch {
        // ignore
      }
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }

  it('adds loopback runtimes, rejects remote ones', async () => {
    const dir = mkTmp()
    const wb = makeWorkbench(dir)
    const rt = await wb.addRuntime({ displayName: 'LM Studio', endpoint: 'http://127.0.0.1:1234' })
    expect(rt.endpoint).toBe('http://127.0.0.1:1234/v1')
    await expect(wb.addRuntime({ displayName: 'Cloud', endpoint: 'https://api.openai.com/v1' })).rejects.toThrow(/loopback|http/)
    await expect(wb.addRuntime({ displayName: 'Pub', endpoint: 'http://8.8.8.8/v1' })).rejects.toThrow(/loopback/)
    expect(wb.listRuntimes()).toHaveLength(1)
    cleanupWorkbench(dir, wb)
  })

  it('probe persists a snapshot; select + restart restores it', async () => {
    const dir = mkTmp()
    const fakeHttp = async () => ({ status: 200, json: { data: [{ id: 'phi-4', context_window: 16384 }] }, latencyMs: 3 })
    const wb1 = makeWorkbench(dir, { http: fakeHttp })
    const rt = await wb1.addRuntime({ displayName: 'Local', endpoint: 'http://localhost:1234/v1' })
    const probe = await wb1.probeRuntime(rt.id)
    expect(probe.reachable).toBe(true)
    const state = await wb1.selectModel(rt.id, `${rt.id}:phi-4`)
    expect(state.available).toBe(true)
    expect(state.displayName).toBe('phi-4')

    // Simulate restart: brand-new service objects on the same dir.
    const wb2 = makeWorkbench(dir, { http: fakeHttp })
    const restored = wb2.getActiveModel()
    expect(restored).toMatchObject({ available: true, displayName: 'phi-4' })
    expect(wb2.listModels()).toHaveLength(1)
    cleanupWorkbench(dir, wb1, wb2)
  })

  it('removed runtime keeps selection cleared, never re-picked', async () => {
    const dir = mkTmp()
    const fakeHttp = async () => ({ status: 200, json: { data: [{ id: 'a' }] }, latencyMs: 1 })
    const wb = makeWorkbench(dir, { http: fakeHttp })
    const rt = await wb.addRuntime({ displayName: 'R', endpoint: 'http://127.0.0.1:1234/v1' })
    await wb.probeRuntime(rt.id)
    await wb.selectModel(rt.id, `${rt.id}:a`)
    expect(wb.removeRuntime(rt.id)).toBe(true)
    expect(wb.getActiveModel()).toEqual({ selection: null, available: false })
    cleanupWorkbench(dir, wb)
  })

  it('duplicate remote ids across runtimes stay distinct', async () => {
    const dir = mkTmp()
    const fakeHttp = async () => ({ status: 200, json: { data: [{ id: 'same' }] }, latencyMs: 1 })
    const wb = makeWorkbench(dir, { http: fakeHttp })
    const a = await wb.addRuntime({ displayName: 'A', endpoint: 'http://127.0.0.1:1234/v1' })
    const b = await wb.addRuntime({ displayName: 'B', endpoint: 'http://127.0.0.1:11434/v1' })
    await wb.probeRuntime(a.id)
    await wb.probeRuntime(b.id)
    const ids = wb.listModels().map((m) => m.modelId).sort()
    expect(ids).toEqual([`${a.id}:same`, `${b.id}:same`].sort())
    cleanupWorkbench(dir, wb)
  })

  it('select validates: unknown runtime, unprobed model, disabled runtime', async () => {
    const dir = mkTmp()
    const wb = makeWorkbench(dir)
    await expect(wb.selectModel('nope', 'x')).rejects.toThrow(/unknown runtime/)
    const rt = await wb.addRuntime({ displayName: 'R', endpoint: 'http://127.0.0.1:1234/v1' })
    await expect(wb.selectModel(rt.id, `${rt.id}:ghost`)).rejects.toThrow(/probe/)
    await expect(wb.probeRuntime('nope')).rejects.toThrow(/unknown runtime/)
    expect(() => wb.listModels('nope')).toThrow(/unknown runtime/)
    cleanupWorkbench(dir, wb)
  })

  it('resource boundary is consulted on select and can refuse', async () => {
    const dir = mkTmp()
    const fakeHttp = async () => ({ status: 200, json: { data: [{ id: 'big' }] }, latencyMs: 1 })
    const blocking: SystemResourceManagerPort = {
      ...okResources,
      checkBeforeLoad: async () => ({ level: 'critical' as const, reason: 'vram unknown', blocking: true }),
    }
    const wb = makeWorkbench(dir, { resources: blocking, http: fakeHttp })
    const rt = await wb.addRuntime({ displayName: 'R', endpoint: 'http://127.0.0.1:1234/v1' })
    await wb.probeRuntime(rt.id)
    await expect(wb.selectModel(rt.id, `${rt.id}:big`)).rejects.toThrow(/resource-pressure/)
    cleanupWorkbench(dir, wb)
  })

  it('endpoint normalization appends /v1 and rejects non-http', () => {
    expect(normalizeEndpoint('http://127.0.0.1:1234')).toBe('http://127.0.0.1:1234/v1')
    expect(normalizeEndpoint('http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/v1')
    expect(() => normalizeEndpoint('https://127.0.0.1:1234/v1')).toThrow(/plain http/)
    expect(() => normalizeEndpoint('not a url')).toThrow(/not a URL/)
  })
})

describe('Commit 6 — resource stub honesty', () => {
  it('reports VRAM as unknown, never fabricated', async () => {
    const snap = await new SystemResourceStub().getSnapshot()
    expect(snap.vram.totalMB).toBeUndefined()
    expect(snap.vram.freeMB).toBeUndefined()
    expect(snap.vram.usedByModelsMB).toBeUndefined()
    expect(snap.gpu.available).toBe(false)
  })

  it('request log never carries bodies or secrets', async () => {
    const { safeTarget } = await import('../src/main/logging/runtimeLog')
    expect(safeTarget('http://127.0.0.1:1234/v1/models?key=secret')).toBe('http://127.0.0.1:1234/v1/models')
  })
})

describe('Commit 6 — IPC contracts', () => {
  it('add/select/ref schemas accept valid, reject malformed', () => {
    expect(zModelsAddRuntime.safeParse({ displayName: 'R', endpoint: 'http://127.0.0.1:1234/v1' }).success).toBe(true)
    expect(zModelsAddRuntime.safeParse({ displayName: '', endpoint: 'http://127.0.0.1:1234/v1' }).success).toBe(false)
    expect(zModelsAddRuntime.safeParse({ displayName: 'R', endpoint: 'x', extra: 1 }).success).toBe(false)
    expect(zModelsAddRuntime.safeParse({ displayName: 'R', endpoint: 'http://127.0.0.1:1234/v1', timeoutMs: 5 }).success).toBe(false)
    expect(zModelsSelect.safeParse({ runtimeId: 'rt-1', modelId: 'rt-1:m' }).success).toBe(true)
    expect(zModelsSelect.safeParse({ runtimeId: '../evil', modelId: 'm' }).success).toBe(false)
    expect(zModelsRuntimeRef.safeParse({ runtimeId: 'rt-1' }).success).toBe(true)
    expect(zModelsRuntimeRef.safeParse({ runtimeId: '' }).success).toBe(false)
    expect(zModelsListModels.safeParse({}).success).toBe(true)
    expect(zModelsListModels.safeParse({ runtimeId: 'rt-1', extra: 1 }).success).toBe(false)
  })

  it('new channels are whitelisted, no generic proxy exists', () => {
    const invoke = Object.entries(IPC_CHANNELS)
      .filter(([, v]) => v.type === 'invoke')
      .map(([k]) => k)
    for (const ch of ['models:listRuntimes', 'models:addRuntime', 'models:removeRuntime', 'models:testConnection', 'models:listModels', 'models:selectModel', 'models:getActiveModel']) {
      expect(invoke).toContain(ch)
    }
    expect(invoke).not.toContain('net:fetch')
    expect(invoke).not.toContain('http:request')
    expect(invoke).not.toContain('models:execute')
  })
})

describe('Commit 6 — sovereignty proofs', () => {
  it('HttpClient is the only shipped file that may call fetch', () => {
    const scan = (dir: string): string[] => {
      const out: string[] = []
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          if (['node_modules', 'dist', 'out'].includes(ent.name)) continue
          out.push(...scan(p))
        } else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p)
      }
      return out
    }
    for (const f of scan('src')) {
      const txt = fs.readFileSync(f, 'utf8')
      if (/\bfetch\s*\(/.test(txt)) {
        // Exceptions: HttpClient (loopback inference) and voiceTranscriber (local faster-whisper server)
        const rel = f.replace(/\\/g, '/')
        expect(rel, `bare fetch outside HttpClient: ${f}`).toMatch(/(main\/network\/HttpClient\.ts|main\/services\/voiceTranscriber\.ts)$/)
      }
    }
  })

  it('renderer workbench files have no network/filesystem access', () => {
    const files = [
      'src/renderer/src/features/models/ModelsPage.tsx',
      'src/renderer/src/features/models/useModelWorkbench.ts',
      'src/renderer/src/lib/ipc.ts',
    ]
    for (const f of files) {
      const txt = fs.readFileSync(f, 'utf8')
      expect(txt, `fetch in ${f}`).not.toMatch(/\bfetch\s*\(/)
      expect(txt, `node api in ${f}`).not.toMatch(/from 'node:|from "node:|require\(['"]node:/)
      expect(txt, `electron in ${f}`).not.toMatch(/from 'electron'|require\(['"]electron['"]\)/)
      expect(txt, `axios in ${f}`).not.toMatch(/axios/)
    }
  })

  it('no cloud endpoints or telemetry machinery in shipped code', () => {
    const hits: string[] = []
    const scan = (dir: string): void => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          if (['node_modules', 'dist', 'out'].includes(ent.name)) continue
          scan(p)
        } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
          if (p.endsWith('.test.ts') || p.endsWith('.test.tsx')) continue
          const txt = fs.readFileSync(p, 'utf8')
          // Cloud control planes must never appear (the "No telemetry" UI
          // label and "no telemetry" comments are explicitly allowed).
          for (const needle of ['api.openai.com', 'huggingface.co']) {
            if (txt.includes(needle)) hits.push(`${p}: ${needle}`)
          }
          // Telemetry *machinery* (sending/tracking), not the UI label.
          for (const re of [/sendTelemetry\s*\(/, /trackEvent\s*\(/, /analytics\.(track|identify|page)\s*\(/, /posthog/i, /segment\.(io|com)/i]) {
            if (re.test(txt)) hits.push(`${p}: ${String(re)}`)
          }
        }
      }
    }
    scan('src')
    expect(hits).toEqual([])
  })
})
