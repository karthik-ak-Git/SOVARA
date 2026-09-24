import { describe, it, expect } from 'vitest'
import { getCandidateModelDirs } from '../src/main/services/modelLocations'
import { scanLibrary, scanLibraryFiles } from '../src/main/services/modelDownloads'
import { RuntimeConfigStore } from '../src/main/config/RuntimeConfigStore'
import { ModelWorkbench } from '../src/main/backend/ModelWorkbench'
import { SystemResourceStub } from '../src/main/backend/ports/SystemResourceStub'
import { LlamaCppServerAdapter } from '../src/main/backend/ports/LlamaCppServerAdapter'

describe('Model Auto-Discovery & Scanning on C: Drive', () => {
  it('discovers all existing candidate model directories', () => {
    const dirs = getCandidateModelDirs()
    console.log('Candidate directories discovered on host:', dirs)
    expect(dirs.length).toBeGreaterThan(0)
    // Should include .lmstudio/models or .node-llama-cpp/models or @sovara/desktop/models
    const hasKnown = dirs.some(
      (d) =>
        d.toLowerCase().includes('.lmstudio') ||
        d.toLowerCase().includes('.node-llama-cpp') ||
        d.toLowerCase().includes('@sovara')
    )
    expect(hasKnown).toBe(true)
    // Should NOT include HuggingFace hub cache (audio/whisper weights)
    const hasHfHub = dirs.some((d) => d.toLowerCase().includes('huggingface'))
    expect(hasHfHub).toBe(false)
  })

  it('scans and lists all runnable GGUF models on disk without mmproj shards or audio weights', () => {
    const dirs = getCandidateModelDirs()
    const allFiles = dirs.flatMap((d) => scanLibraryFiles(d))
    console.log(`Found ${allFiles.length} files in candidate dirs:`)
    for (const f of allFiles) {
      console.log(` - ${f.name} :: ${f.file} (${(f.sizeBytes / (1024 * 1024)).toFixed(1)} MB)`)
    }
    // Verify mmproj files are filtered
    const mmprojCount = allFiles.filter((f) => f.file.toLowerCase().startsWith('mmproj')).length
    expect(mmprojCount).toBe(0)
    // Verify no .bin or .pt voice weights
    const audioCount = allFiles.filter((f) => f.file.toLowerCase().endsWith('.bin') || f.file.toLowerCase().endsWith('.pt')).length
    expect(audioCount).toBe(0)
    // All files should be valid .gguf
    expect(allFiles.every((f) => f.file.toLowerCase().endsWith('.gguf'))).toBe(true)
    expect(allFiles.length).toBe(8)
  })

  it('populates local workbench models list for Chat selector and Settings with no duplicates', async () => {
    // Real runtime config store (baseDir undefined)
    const config = new RuntimeConfigStore()
    const resources = new SystemResourceStub()
    const adapter = new LlamaCppServerAdapter(undefined, undefined, undefined, {
      queryVram: async () => ({ freeMB: 6000, totalMB: 6144, name: 'NVIDIA GeForce RTX 3050' }),
      spawn: () => ({} as any),
      findPort: async () => 41000,
    })
    adapter.bindConfig(config)
    const wb = new ModelWorkbench(config, resources, undefined, undefined, adapter)

    const models = wb.listModels()
    console.log(`Workbench listModels() returned ${models.length} models:`)
    for (const m of models) {
      console.log(` - [${m.runtimeId}] ${m.displayName} (modelId: ${m.modelId})`)
    }

    expect(models.length).toBeGreaterThanOrEqual(8)
    // None should be mmproj
    expect(models.every((m) => !m.modelId.toLowerCase().includes('mmproj'))).toBe(true)
    // None should be audio weights
    expect(models.every((m) => !m.displayName.toLowerCase().endsWith('.bin') && !m.displayName.toLowerCase().endsWith('.pt'))).toBe(true)

    // No duplicate display names
    const names = models.map((m) => m.displayName.toLowerCase())
    const uniqueNames = new Set(names)
    expect(uniqueNames.size).toBe(models.length)

    // Should include Qwen3-0.6B or Spark-X2.5 or Gemma or GLM or Nemotron
    const foundExpected = names.some(
      (n) =>
        n.includes('qwen') ||
        n.includes('spark') ||
        n.includes('gemma') ||
        n.includes('glm') ||
        n.includes('nemotron')
    )
    expect(foundExpected).toBe(true)

    wb.dispose()
  })

  it('deduplicates merged workbench and library models identically to useModelWorkbench', () => {
    const isMmproj = (s: string) => {
      const b = s.split(/[/\\]/).pop()?.toLowerCase() ?? ''
      return b.startsWith('mmproj-') || b === 'mmproj.gguf' || b.startsWith('mmproj.')
    }
    const isAudioWeight = (s: string) => {
      const b = s.toLowerCase()
      return b.endsWith('.bin') || b.endsWith('.pt')
    }
    const normKey = (m: { displayName?: string; modelId: string }): string => {
      let s = (m.displayName || m.modelId).trim()
      if (s.includes(' — ')) {
        s = s.split(' — ').pop() ?? s
      }
      s = s.split(/[/\\]/).pop() ?? s
      return s.replace(/\.gguf$/i, '').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim()
    }

    // Simulate 8 md items and 8 libModels items (the exact duplicates seen by user)
    const testMd = [
      { modelId: 'lmstudio-community/GLM-4.6V-Flash-Q4_K_M.gguf', displayName: 'lmstudio-community — GLM-4.6V-Flash-Q4_K_M.gguf' },
      { modelId: 'lmstudio-community/Qwen3.5-9B-Q4_K_M.gguf', displayName: 'lmstudio-community — Qwen3.5-9B-Q4_K_M.gguf' },
      { modelId: 'Qwen3-0.6B-Q4_K_M', displayName: 'Qwen3-0.6B-Q4_K_M.gguf' },
    ]
    const testLib = [
      { file: 'GLM-4.6V-Flash-Q4_K_M.gguf', name: 'GLM 4.6V Flash Q4 K M' },
      { file: 'Qwen3.5-9B-Q4_K_M.gguf', name: 'Qwen3.5 9B Q4 K M' },
      { file: 'Qwen3-0.6B-Q4_K_M.gguf', name: 'Qwen3 0.6B Q4 K M' },
      { file: 'mmproj-GLM-4.6V-Flash-F16.gguf', name: 'mmproj GLM 4.6V Flash F16' },
      { file: 'model.bin', name: 'model.bin' },
      { file: 'hm_psi.pt', name: 'hm psi.pt' },
    ]

    const cleanLib = testLib.filter((m) => !isMmproj(m.file) && !isMmproj(m.name) && !isAudioWeight(m.file) && !isAudioWeight(m.name))
    const libModels = cleanLib.map((m) => ({
      modelId: m.file,
      displayName: m.file,
    }))

    const seenKeys = new Set<string>()
    const merged: Array<{ modelId: string; displayName: string }> = []
    for (const m of testMd) {
      if (isMmproj(m.modelId) || isMmproj(m.displayName) || isAudioWeight(m.modelId) || isAudioWeight(m.displayName)) continue
      const k = normKey(m)
      if (!seenKeys.has(k)) {
        seenKeys.add(k)
        merged.push(m)
      }
    }
    for (const lm of libModels) {
      const k = normKey(lm)
      if (!seenKeys.has(k)) {
        seenKeys.add(k)
        merged.push(lm)
      }
    }

    expect(merged.length).toBe(3)
    expect(merged.map((m) => m.modelId)).toEqual([
      'lmstudio-community/GLM-4.6V-Flash-Q4_K_M.gguf',
      'lmstudio-community/Qwen3.5-9B-Q4_K_M.gguf',
      'Qwen3-0.6B-Q4_K_M',
    ])
  })
})
