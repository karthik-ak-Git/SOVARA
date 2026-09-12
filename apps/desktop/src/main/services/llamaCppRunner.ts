/**
 * Real llama.cpp lifecycle for Local Library models via node-llama-cpp v3.
 * Bundled in .exe (extraResources) like Ollama — model stays in userData/models.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getHardwareProfile } from './hardwareProfile'
import { registerLoadedInstance } from '../backend/ports/ModelRuntimeStub'

export interface LlamaLoadResult {
  ggufPath: string
  fileSizeMB: number
  targetVramMB: number
  gpuLayers: number
  totalLayers: number
  backend: 'CUDA' | 'Vulkan' | 'Metal' | 'CPU'
  contextLength: number
  _session?: unknown
  _model?: unknown
  _llama?: unknown
}

function tryGgufPathForModelId(modelId: string, libraryDir: string): string | null {
  const candidates: string[] = []
  const bare = modelId.split('/').pop() ?? modelId
  const withExt = bare.toLowerCase().endsWith('.gguf') ? bare : `${bare}.gguf`
  try {
    for (const dir of fs.readdirSync(libraryDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      const sub = path.join(libraryDir, dir.name)
      for (const f of fs.readdirSync(sub)) {
        if (f.toLowerCase() === withExt.toLowerCase() || f.toLowerCase() === bare.toLowerCase()) candidates.push(path.join(sub, f))
        if (f.replace(/\.gguf$/i, '').toLowerCase() === bare.replace(/\.gguf$/i, '').toLowerCase()) candidates.push(path.join(sub, f))
      }
    }
  } catch {}
  const rootCandidate = path.join(libraryDir, withExt)
  if (fs.existsSync(rootCandidate)) candidates.push(rootCandidate)
  if (candidates.length === 0) {
    const walk = (dir: string): string | null => {
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name)
          if (e.isDirectory()) { const r = walk(p); if (r) return r }
          else if (p.toLowerCase().endsWith('.gguf') && path.basename(p, '.gguf').toLowerCase() === bare.replace(/\.gguf$/i, '').toLowerCase()) return p
        }
      } catch {}
      return null
    }
    const hit = walk(libraryDir)
    if (hit) candidates.push(hit)
  }
  for (const c of candidates) if (fs.existsSync(c)) return c
  return null
}

function log(level: 'info' | 'debug', event: string, extra: Record<string, unknown>): void {
  try { console.info(`[llama.cpp:${event}]`, extra) } catch {}
  try {
    const logDir = path.join(os.tmpdir(), 'sovara-logs')
    fs.mkdirSync(logDir, { recursive: true })
    const line = JSON.stringify({ time: Date.now(), iso: new Date().toISOString(), level, event, runtime: 'llama.cpp', ...extra }) + '\n'
    fs.appendFileSync(path.join(logDir, 'runtime.log'), line, 'utf8')
  } catch {}
}

export type LoadProgress = { progress: number; stage: string; detail: string }

export function verifyGguf(ggufPath: string): { valid: boolean; reason?: string } {
  try {
    const fd = fs.openSync(ggufPath, 'r')
    const buf = Buffer.alloc(4)
    const n = fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    if (n < 4) return { valid: false, reason: 'file too small' }
    const magic = buf.toString('utf8')
    if (magic === 'GGUF') return { valid: true }
    if (magic === '\x00\x00\x00\x00') return { valid: false, reason: 'invalid GGUF magic' }
    return { valid: false, reason: `invalid GGUF magic: ${JSON.stringify(magic)}` }
  } catch (e) { return { valid: false, reason: e instanceof Error ? e.message : String(e) } }
}

export async function ensureLlamaModelLoaded(
  modelId: string,
  libraryDir: string,
  contextLength = 4096,
  onProgress?: (p: LoadProgress) => void,
): Promise<LlamaLoadResult | null> {
  const ggufPath = tryGgufPathForModelId(modelId, libraryDir)
  if (!ggufPath || !fs.existsSync(ggufPath)) return null
  let st: fs.Stats
  try { st = fs.statSync(ggufPath) } catch { return null }
  const fileSizeMB = Math.round(st.size / (1024 * 1024))
  const ggufCheck = verifyGguf(ggufPath)
  if (!ggufCheck.valid && st.size > 1024) {
    log('info', 'load-verify-failed', { modelId, ggufPath, reason: ggufCheck.reason })
    throw new Error(`GGUF verification failed: ${ggufCheck.reason ?? 'invalid file'}`)
  }
  const hw = getHardwareProfile()
  const emit = (progress: number, stage: string, detail: string): void => {
    try { onProgress?.({ progress, stage, detail }) } catch {}
  }
  log('info', 'load-step1-getllama', { modelId, gpuAvailable: hw.gpuAvailable })
  emit(5, 'init', 'Resolving llama.cpp native binding...')
  const { getLlama } = await import('node-llama-cpp')
  const llama: any = await (getLlama as any)({ gpu: hw.gpuAvailable ? 'cuda' : false })
  emit(20, 'init', `Native binding ready (gpu: ${llama.gpu})`)
  log('info', 'load-step1-done', { gpu: String(llama.gpu) })
  log('info', 'load-step2-loadmodel', { modelId, ggufPath, fileSizeMB })
  emit(25, 'mmap', `Loading ${path.basename(ggufPath)} (${fileSizeMB}MB)`)
  const model = await llama.loadModel({ modelPath: ggufPath })
  emit(60, 'weights', `GGUF loaded — ${fileSizeMB}MB mapped`)
  log('info', 'load-step2-done', { modelSize: model.size })
  log('info', 'load-step3-context', { modelId, contextLength })
  emit(65, 'context', `Creating context (ctx ${contextLength})`)
  const context = await model.createContext({ contextSize: contextLength })
  emit(90, 'context', `KV cache ready`)
  log('info', 'load-step3-done', { contextLength })
  const sequence = context.getSequence()
  let backend: LlamaLoadResult['backend'] = 'CPU'
  if (process.platform === 'darwin') backend = llama.gpu ? 'Metal' : 'CPU'
  else if (llama.gpu) {
    const name = (hw.gpuName ?? '').toLowerCase()
    backend = name.includes('nvidia') ? 'CUDA' : 'Vulkan'
  }
  const gpuLayers = llama.gpu ? 999 : 0
  const totalLayers = 999
  const targetVramMB = llama.gpu ? Math.round(fileSizeMB * 1.12) : 0
  try { registerLoadedInstance(modelId, 'local', contextLength, st.size) } catch {}
  emit(95, 'ready', `Model ready on ${backend}`)
  log('info', 'load-complete', { modelId, backend, contextLength, fileSizeMB })
  return { ggufPath, fileSizeMB, targetVramMB, gpuLayers, totalLayers, backend, contextLength, _session: sequence, _model: model, _llama: llama }
}

export async function* streamLocalLlama(
  userContent: string,
  load: LlamaLoadResult,
  signal?: AbortSignal,
  onProgress?: (p: LoadProgress) => void,
): AsyncIterable<string> {
  const { LlamaCompletion } = await import('node-llama-cpp')
  const sequence = load._session as any
  if (!sequence) throw new Error('Model not loaded — call ensureLlamaModelLoaded first')
  const emit = (progress: number, stage: string, detail: string): void => {
    try { onProgress?.({ progress, stage, detail }) } catch {}
  }
  log('info', 'infer-start', { modelId: path.basename(load.ggufPath), promptLen: userContent.length, backend: load.backend })
  emit(88, 'prompt', `Tokenizing prompt (${userContent.length} chars)`)
  const completion = new (LlamaCompletion as any)({ contextSequence: sequence })
  const queue: string[] = []
  let resolve: (() => void) | null = null
  let done = false
  let error: Error | null = null
  const push = (chunk: string) => { queue.push(chunk); resolve?.(); resolve = null }
  const signalDone = () => { done = true; resolve?.(); resolve = null }
  const controller = new AbortController()
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true })
  const genPromise = (async () => {
    try { await completion.generateCompletion(userContent, { maxTokens: 2048, signal: controller.signal, onTextChunk: push }) }
    catch (err: any) { if (err?.name === 'AbortError' || signal?.aborted) log('info', 'infer-cancelled', { modelId: path.basename(load.ggufPath) }); else error = err }
    finally { signalDone() }
  })()
  let tokenCount = 0
  while (true) {
    while (queue.length > 0) { const chunk = queue.shift()!; tokenCount++; emit(Math.min(99, 92 + Math.round(tokenCount * 0.1)), 'streaming', `Generated ${tokenCount} chunks`); yield chunk }
    if (done) break
    await new Promise<void>((r) => { resolve = r })
  }
  if (error) throw error
  log('info', 'infer-done', { modelId: path.basename(load.ggufPath), chunks: tokenCount })
  emit(100, 'done', `Done — ${tokenCount} chunks generated`)
}
