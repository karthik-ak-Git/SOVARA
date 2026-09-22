/**
 * Local Runtime Auto-Detector — Ollama & LM Studio real-time scanner.
 * Probes both directory manifests (.ollama/models, .lmstudio/models) and local HTTP sockets (:11434, :1234).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export interface DetectedRuntimeModel {
  name: string
  modelId: string
  runtime: 'ollama' | 'lmstudio'
  sizeBytes: number
  sizeGB: number
  parameterSize?: string
  quantization?: string
  digest?: string
  isVramActive?: boolean
  path?: string
}

export interface DetectedRuntimeSummary {
  ollama: {
    installed: boolean
    endpoint: string
    online: boolean
    models: DetectedRuntimeModel[]
    activeModels: string[]
    manifestCount: number
  }
  lmstudio: {
    installed: boolean
    endpoint: string
    online: boolean
    models: DetectedRuntimeModel[]
    manifestCount: number
  }
  totalLocalModels: number
  recommendedModelId?: string
}

const TIMEOUT_MS = 2500

async function httpGetJson<T>(url: string): Promise<T | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** Probe Ollama HTTP API endpoint (:11434/api/tags and :11434/api/ps) */
async function probeOllamaApi(endpoint = 'http://127.0.0.1:11434'): Promise<{ online: boolean; models: DetectedRuntimeModel[]; activeModels: string[] }> {
  const tagsData = await httpGetJson<{ models?: Array<{ name: string; size: number; digest: string; details?: { parameter_size?: string; quantization_level?: string } }> }>(`${endpoint}/api/tags`)
  if (!tagsData || !Array.isArray(tagsData.models)) {
    return { online: false, models: [], activeModels: [] }
  }

  const psData = await httpGetJson<{ models?: Array<{ name: string; model: string }> }>(`${endpoint}/api/ps`)
  const activeSet = new Set((psData?.models ?? []).map((m) => m.name || m.model))

  const models: DetectedRuntimeModel[] = tagsData.models.map((m) => ({
    name: m.name,
    modelId: `ollama:${m.name}`,
    runtime: 'ollama' as const,
    sizeBytes: m.size ?? 0,
    sizeGB: Math.round(((m.size ?? 0) / 1024 ** 3) * 100) / 100,
    parameterSize: m.details?.parameter_size,
    quantization: m.details?.quantization_level?.toUpperCase(),
    digest: m.digest,
    isVramActive: activeSet.has(m.name),
  }))

  return { online: true, models, activeModels: [...activeSet] }
}

/** Probe LM Studio OpenAI-compatible endpoint (:1234/v1/models) */
async function probeLmStudioApi(endpoint = 'http://127.0.0.1:1234'): Promise<{ online: boolean; models: DetectedRuntimeModel[] }> {
  const data = await httpGetJson<{ data?: Array<{ id: string }> }>(`${endpoint}/v1/models`)
  if (!data || !Array.isArray(data.data)) {
    return { online: false, models: [] }
  }

  const models: DetectedRuntimeModel[] = data.data.map((m) => {
    const base = path.basename(m.id)
    return {
      name: base,
      modelId: `lmstudio:${m.id}`,
      runtime: 'lmstudio' as const,
      sizeBytes: 0,
      sizeGB: 0,
      path: m.id,
    }
  })

  return { online: true, models }
}

/** Scan Ollama directory on disk (~/.ollama/models/manifests) */
function scanOllamaDirectory(): { installed: boolean; models: DetectedRuntimeModel[] } {
  try {
    const home = os.homedir()
    const manifestDir = path.join(home, '.ollama', 'models', 'manifests', 'registry.ollama.ai', 'library')
    if (!fs.existsSync(manifestDir)) return { installed: false, models: [] }

    const models: DetectedRuntimeModel[] = []
    const walk = (dir: string, modelNameAcc: string[]): void => {
      let entries: fs.Dirent[] = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.isDirectory()) {
          walk(path.join(dir, e.name), [...modelNameAcc, e.name])
        } else if (e.isFile()) {
          const fullPath = path.join(dir, e.name)
          const tag = e.name
          const modelName = modelNameAcc.length > 0 ? `${modelNameAcc.join('/')}:${tag}` : tag
          try {
            const raw = fs.readFileSync(fullPath, 'utf8')
            const json = JSON.parse(raw) as { layers?: Array<{ size?: number; mediaType?: string }> }
            let totalBytes = 0
            if (Array.isArray(json.layers)) {
              totalBytes = json.layers.reduce((sum, l) => sum + (l.size ?? 0), 0)
            }
            models.push({
              name: modelName,
              modelId: `ollama:${modelName}`,
              runtime: 'ollama',
              sizeBytes: totalBytes,
              sizeGB: Math.round((totalBytes / 1024 ** 3) * 100) / 100,
              path: fullPath,
            })
          } catch { /* skip corrupted manifest */ }
        }
      }
    }

    walk(manifestDir, [])
    return { installed: true, models }
  } catch {
    return { installed: false, models: [] }
  }
}

/** Scan LM Studio directory on disk (~/.lmstudio/models & %LOCALAPPDATA%/LM Studio/models) */
function scanLmStudioDirectory(): { installed: boolean; models: DetectedRuntimeModel[] } {
  try {
    const candidateDirs: string[] = []
    const home = os.homedir()
    const p1 = path.join(home, '.lmstudio', 'models')
    if (fs.existsSync(p1)) candidateDirs.push(p1)

    if (process.env.LOCALAPPDATA) {
      const p2 = path.join(process.env.LOCALAPPDATA, 'LM Studio', 'models')
      if (fs.existsSync(p2) && !candidateDirs.includes(p2)) candidateDirs.push(p2)
    }

    if (candidateDirs.length === 0) return { installed: false, models: [] }

    const models: DetectedRuntimeModel[] = []
    for (const root of candidateDirs) {
      const walk = (dir: string): void => {
        let entries: fs.Dirent[] = []
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full)
          else if (e.isFile() && e.name.toLowerCase().endsWith('.gguf')) {
            const b = e.name.toLowerCase()
            if (b.includes('mmproj') || b.includes('vocab') || b.includes('tokenizer')) continue
            let stat: fs.Stats | null = null
            try { stat = fs.statSync(full) } catch { continue }
            models.push({
              name: e.name,
              modelId: `lmstudio:${e.name}`,
              runtime: 'lmstudio',
              sizeBytes: stat.size,
              sizeGB: Math.round((stat.size / 1024 ** 3) * 100) / 100,
              path: full,
            })
          }
        }
      }
      walk(root)
    }

    return { installed: true, models }
  } catch {
    return { installed: false, models: [] }
  }
}

/**
 * Main auto-detection entrypoint: scans local directories and HTTP APIs.
 * Merges discovered models and dedupes entries.
 */
export async function detectLocalRuntimes(): Promise<DetectedRuntimeSummary> {
  const ollamaDisk = scanOllamaDirectory()
  const lmDisk = scanLmStudioDirectory()

  const ollamaApi = await probeOllamaApi()
  const lmApi = await probeLmStudioApi()

  // Merge Ollama models (API takes precedence as it has quant details)
  const ollamaModelMap = new Map<string, DetectedRuntimeModel>()
  for (const m of ollamaDisk.models) ollamaModelMap.set(m.name, m)
  for (const m of ollamaApi.models) ollamaModelMap.set(m.name, m)

  // Merge LM Studio models
  const lmModelMap = new Map<string, DetectedRuntimeModel>()
  for (const m of lmDisk.models) lmModelMap.set(m.name, m)
  for (const m of lmApi.models) lmModelMap.set(m.name, m)

  const ollamaModels = [...ollamaModelMap.values()]
  const lmModels = [...lmModelMap.values()]

  const totalLocalModels = ollamaModels.length + lmModels.length
  let recommendedModelId: string | undefined

  if (ollamaModels.length > 0) {
    const active = ollamaModels.find((m) => m.isVramActive)
    recommendedModelId = active?.modelId ?? ollamaModels[0]?.modelId
  } else if (lmModels.length > 0) {
    recommendedModelId = lmModels[0]?.modelId
  }

  return {
    ollama: {
      installed: ollamaDisk.installed || ollamaApi.online,
      endpoint: 'http://127.0.0.1:11434',
      online: ollamaApi.online,
      models: ollamaModels,
      activeModels: ollamaApi.activeModels,
      manifestCount: ollamaModels.length,
    },
    lmstudio: {
      installed: lmDisk.installed || lmApi.online,
      endpoint: 'http://127.0.0.1:1234',
      online: lmApi.online,
      models: lmModels,
      manifestCount: lmModels.length,
    },
    totalLocalModels,
    recommendedModelId,
  }
}
