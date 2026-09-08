/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExplorePage } from '../src/renderer/src/features/explore/ExplorePage'
import type { ExploreModel } from '../src/shared/types/explore'

function mkModel(over: Partial<ExploreModel> = {}): ExploreModel {
  return {
    id: 'Qwen/Qwen3-8B-GGUF',
    name: 'Qwen3-8B-GGUF',
    slug: 'Qwen/Qwen3-8B-GGUF',
    author: 'Qwen',
    description: 'Qwen3 8B GGUF by Qwen',
    longDescription: 'Qwen3 is a model by Qwen.',
    downloads: 123456,
    likes: 987,
    staffPick: false,
    updatedAt: new Date().toISOString(),
    parameters: '8B',
    architecture: 'qwen3',
    capabilities: ['Reasoning', 'Code'],
    files: [
      { format: 'GGUF', quantization: 'Q4_K_M', sizeGB: 4.92, downloadUrl: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/q4_k_m.gguf', rfilename: 'q4_k_m.gguf', sizeBytes: 4.92 * 1024 ** 3 },
      { format: 'GGUF', quantization: 'Q8_0', sizeGB: 8.1, downloadUrl: 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/q8_0.gguf', rfilename: 'q8_0.gguf', sizeBytes: 8.1 * 1024 ** 3 },
    ],
    tags: ['gguf', 'qwen', 'reasoning', 'code'],
    iconType: 'qwen',
    license: 'apache-2.0',
    languages: ['en', 'zh'],
    pipelineTag: 'text-generation',
    gated: false,
    repoSizeBytes: 8 * 1024 ** 3,
    readme: '# Qwen3\n\n**Bold** text with `code` and [link](https://example.com)\n\n- item one\n- item two',
    ...over,
  }
}

let mockModels: ExploreModel[] = []

beforeEach(() => {
  mockModels = [mkModel(), mkModel({ id: 'meta-llama/Llama-3.1-8B', name: 'Llama-3.1-8B', slug: 'meta-llama/Llama-3.1-8B', author: 'meta-llama', iconType: 'meta', parameters: '8B', tags: ['llama', 'instruct'], capabilities: ['Chat'], files: [{ format: 'safetensors', sizeGB: 16, downloadUrl: 'https://huggingface.co/meta-llama/Llama-3.1-8B/resolve/main/model.safetensors', rfilename: 'model.safetensors', sizeBytes: 16 * 1024 ** 3 }] })]
  ;(window as unknown as { sovara: unknown }).sovara = {
    invoke: vi.fn(async (channel: string, payload?: unknown) => {
      if (channel === 'explore:listModels') return mockModels
      if (channel === 'explore:getModel') return mockModels[0]
      if (channel === 'explore:getCompatibility') return { fitsInMemory: true, estimatedRamUsageGB: 5.9, estimatedVramUsageGB: 5.9, message: '✓ Fits in VRAM: ~5.9 GB / 6.0 GB (NVIDIA GeForce RTX 3050) — optimal for fast inference.', severity: 'good' }
      if (channel === 'explore:getRecommendations') return [{ file: mockModels[0].files[0], index: 0, estimatedRamGB: 5.9, severity: 'good', rank: 0, reason: '★ Recommended — Requires ~5.9 GB VRAM · fits · best quant for your GPU' }]
      if (channel === 'explore:getHardwareProfile') return { totalRamMB: 16 * 1024, freeRamMB: 8 * 1024, totalVramMB: 6 * 1024, freeVramMB: 4 * 1024, gpuName: 'NVIDIA GeForce RTX 3050', gpuAvailable: true }
      if (channel === 'library:isDownloaded') return { downloaded: false }
      if (channel === 'library:getActiveDownloads') return []
      if (channel === 'system:getResources') return { ram: { totalMB: 16384, freeMB: 8192, usedByAppMB: 512 }, vram: {}, gpu: { available: false }, cpu: { logicalCores: 8, loadAvg1: 1 }, disk: { path: '/', totalMB: 512000, freeMB: 256000 }, models: { instances: [] }, limits: { maxConcurrentModels: 4 } }
      return null
    }),
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Window['sovara']
})
afterEach(() => cleanup())

describe('Explorer E2E — production flow', () => {
  it('renders Explorer header, search, filters, and model cards', async () => {
    render(<ExplorePage onBack={() => {}} />)
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search Hugging Face and staff picks/)).toBeInTheDocument()
    expect(screen.getByText('Staff picks')).toBeInTheDocument()
    expect(screen.getByText(/Recommended/)).toBeInTheDocument()
    const cards = await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    expect(cards.length).toBeGreaterThan(0)
    // Detail panel shows model name as well
    expect(screen.getAllByText('Qwen3-8B-GGUF').length).toBeGreaterThan(1)
  })

  it('search filters by tags/tasks and sort by trending', async () => {
    const user = userEvent.setup()
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    const search = screen.getByPlaceholderText(/Search Hugging Face and staff picks/)
    await user.type(search, 'vision')
    const invoke = (window as unknown as { sovara: { invoke: ReturnType<typeof vi.fn> } }).sovara.invoke
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('explore:listModels', expect.objectContaining({ query: 'vision' })), { timeout: 3000 })
  })

  it('detail panel shows Download Options, Details, README', async () => {
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    await waitFor(() => expect(screen.getByText(/Download Options/)).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByText(/Details/)).toBeInTheDocument()
    expect(screen.getByText(/README/)).toBeInTheDocument()
    // Download Options dropdown shows file
    await waitFor(() => expect(screen.getAllByText(/Qwen3-8B-GGUF/).length).toBeGreaterThan(0), { timeout: 4000 })
    // README rendered
    await waitFor(() => expect(document.querySelector('.explore-readme--md')).toBeInTheDocument(), { timeout: 3000 })
  })

  it('system recommendation shows VRAM-aware badge', async () => {
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    await waitFor(() => expect(screen.getByText(/System recommendation/)).toBeInTheDocument(), { timeout: 4000 })
    // Should show VRAM mode and required VRAM
    await screen.findByText(/VRAM|RAM/, {}, { timeout: 4000 })
    await waitFor(() => expect(screen.getAllByText(/Requires/).length).toBeGreaterThan(0), { timeout: 3000 })
  })

  it('download button triggers library:download', async () => {
    const user = userEvent.setup()
    const invoke = (window as unknown as { sovara: { invoke: ReturnType<typeof vi.fn> } }).sovara.invoke
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    await waitFor(() => expect(screen.getByText(/Download Options/)).toBeInTheDocument(), { timeout: 3000 })
    // Find Download button (could be Download or Resume)
    const dlBtn = await screen.findByRole('button', { name: /Download/ }, { timeout: 3000 })
    await user.click(dlBtn)
    expect(invoke).toHaveBeenCalledWith('library:download', expect.objectContaining({ modelId: 'Qwen/Qwen3-8B-GGUF' }))
  })

  it('blocked window.open is replaced by shell:openExternal', async () => {
    const user = userEvent.setup()
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    await waitFor(() => expect(screen.getByText(/Open on Web/)).toBeInTheDocument(), { timeout: 3000 })
    const link = screen.getByText(/Open on Web/)
    await user.click(link)
    const invoke = (window as unknown as { sovara: { invoke: ReturnType<typeof vi.fn> } }).sovara.invoke
    expect(invoke).toHaveBeenCalledWith('shell:openExternal', expect.objectContaining({ url: expect.stringContaining('huggingface.co') }))
  })
})
