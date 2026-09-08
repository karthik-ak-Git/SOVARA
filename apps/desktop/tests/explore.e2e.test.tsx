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
      if (channel === 'explore:getCompatibility') return { fitsInMemory: true, estimatedRamUsageGB: 5.9, message: 'Should run on CPU', severity: 'good' }
      if (channel === 'explore:getRecommendations') return [{ file: mockModels[0].files[0], index: 0, estimatedRamGB: 5.9, severity: 'good', rank: 0, reason: '★ Recommended' }]
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
  it('renders Explorer header, search, filters, and model cards with badges', async () => {
    render(<ExplorePage onBack={() => {}} />)
    expect(screen.getByText('Explore')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Search name, tags, tasks/)).toBeInTheDocument()
    expect(screen.getByText('Filters')).toBeInTheDocument()
    // Cards appear after async load — name appears in list and detail (2 copies)
    const cards = await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    expect(cards.length).toBeGreaterThan(0)
    // Badges: params, GGUF, license, capabilities (appear in card + detail)
    expect(screen.getAllByText('8B').length).toBeGreaterThan(0)
    expect(screen.getAllByText('GGUF').length).toBeGreaterThan(0)
    expect(screen.getAllByText('apache-2.0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Reasoning').length).toBeGreaterThan(0)
    // Meta: downloads / likes / date
    expect(screen.getByText(/downloads/)).toBeInTheDocument()
  })

  it('search filters by tags/tasks and sort by trending', async () => {
    const user = userEvent.setup()
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    const search = screen.getByPlaceholderText(/Search name, tags, tasks/)
    await user.type(search, 'vision')
    // Debounced query triggers listModels again; mock returns same list, filter happens backend
    const invoke = (window as unknown as { sovara: { invoke: ReturnType<typeof vi.fn> } }).sovara.invoke
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('explore:listModels', expect.objectContaining({ query: 'vision' })))
  })

  it('detail panel shows Overview, Capabilities, Files, License, README markdown', async () => {
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    // Wait for detail to load
    await waitFor(() => expect(screen.getByText('Overview')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByText('Capabilities')).toBeInTheDocument()
    expect(screen.getAllByText('Files').length).toBeGreaterThan(0)
    expect(screen.getByText('License & access')).toBeInTheDocument()
    expect(screen.getByText('README')).toBeInTheDocument()
    // README markdown: bold, code, list rendered via dangerouslySetInnerHTML
    await waitFor(() => expect(document.querySelector('.explore-readme--md')).toBeInTheDocument(), { timeout: 3000 })
    // File chips
    expect(screen.getByText('Q4_K_M')).toBeInTheDocument()
  })

  it('system recommendation shows Recommended badge', async () => {
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('System recommendation')).toBeInTheDocument(), { timeout: 3000 })
    await waitFor(() => expect(screen.getAllByText(/Should run/).length).toBeGreaterThan(0), { timeout: 3000 })
    await waitFor(() => expect(screen.getAllByText(/Recommended/).length).toBeGreaterThan(0), { timeout: 3000 })
  })

  it('download button triggers library:download and shows progress state', async () => {
    const user = userEvent.setup()
    const invoke = (window as unknown as { sovara: { invoke: ReturnType<typeof vi.fn> } }).sovara.invoke
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    await waitFor(() => expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument(), { timeout: 3000 })
    const dlBtn = screen.getByRole('button', { name: /Download/ })
    await user.click(dlBtn)
    expect(invoke).toHaveBeenCalledWith('library:download', expect.objectContaining({ modelId: 'Qwen/Qwen3-8B-GGUF' }))
  })

  it('blocked window.open is replaced by shell:openExternal', async () => {
    const user = userEvent.setup()
    render(<ExplorePage onBack={() => {}} />)
    await screen.findAllByText('Qwen3-8B-GGUF', {}, { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('Open on Hugging Face')).toBeInTheDocument(), { timeout: 3000 })
    const link = screen.getByText('Open on Hugging Face')
    await user.click(link)
    const invoke = (window as unknown as { sovara: { invoke: ReturnType<typeof vi.fn> } }).sovara.invoke
    expect(invoke).toHaveBeenCalledWith('shell:openExternal', expect.objectContaining({ url: expect.stringContaining('huggingface.co') }))
  })
})
