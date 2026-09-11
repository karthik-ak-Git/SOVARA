/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelsPage } from '../src/renderer/src/features/models/ModelsPage'

const baseBridge = {
  'models:listRuntimes': [],
  'models:listModels': [],
  'models:getActiveModel': { selection: null, available: false },
  'system:getResources': {
    cpu: { logicalCores: 8, loadAvg1: 0.5 },
    ram: { totalMB: 16000, freeMB: 8000, usedByAppMB: 200 },
    gpu: { available: false },
    vram: {},
    disk: { path: 'unknown', totalMB: 0, freeMB: 0 },
    models: { instances: [] },
    limits: { maxConcurrentModels: 1 },
  },
}

function mockBridge(overrides: Record<string, unknown> = {}) {
  const responses: Record<string, unknown> = { ...baseBridge, ...overrides }
  const invoke = vi.fn(async (ch: string, ...args: unknown[]) => {
    if (ch === 'models:selectModel') {
      const payload = args[0] as { runtimeId: string; modelId: string }
      return { selection: payload, available: true, displayName: payload.modelId, runtimeDisplayName: payload.runtimeId }
    }
    return responses[ch] ?? { selection: null, available: false }
  })
  ;(window as unknown as { sovara: unknown }).sovara = {
    invoke,
    on: vi.fn().mockReturnValue(() => {}),
  } as unknown as Window['sovara']
  return invoke
}

beforeEach(() => {
  mockBridge()
})
afterEach(() => cleanup())

describe('Commit 6 — Models page', () => {
  it('shows empty guidance, add form, and UNKNOWN resource honesty', async () => {
    render(<ModelsPage />)
    expect(await screen.findByText('No model selected. Add a local runtime below, test the connection, then select a model.')).toBeInTheDocument()
    expect(screen.getByText('No local runtimes yet')).toBeInTheDocument()
    expect(screen.getByText('No models discovered')).toBeInTheDocument()
    expect(await screen.findByTestId('resource-strip')).toHaveTextContent('UNKNOWN')
    expect(screen.getByRole('button', { name: 'Add runtime' })).toBeInTheDocument()
  })

  it('lists runtimes and models with select actions', async () => {
    mockBridge({
      'models:listRuntimes': [{ id: 'rt-1', displayName: 'LM Studio', type: 'openai-compatible', endpoint: 'http://127.0.0.1:1234/v1', enabled: true, timeoutMs: 8000 }],
      'models:listModels': [
        { modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', source: 'openai-compatible', capabilities: [], contextLength: 16384, available: true },
      ],
    })
    const invoke = (window as unknown as { sovara: { invoke: ReturnType<typeof vi.fn> } }).sovara.invoke
    render(<ModelsPage />)
    expect(await screen.findByText('LM Studio')).toBeInTheDocument()
    expect(screen.getByText('phi-4')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Select phi-4' }))
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('models:selectModel', { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    })
  })

  it('marks the active model and blocks duplicate selection', async () => {
    mockBridge({
      'models:listRuntimes': [{ id: 'rt-1', displayName: 'LM Studio', type: 'openai-compatible', endpoint: 'http://127.0.0.1:1234/v1', enabled: true, timeoutMs: 8000 }],
      'models:listModels': [
        { modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', source: 'openai-compatible', capabilities: [], available: true },
      ],
      'models:getActiveModel': {
        selection: { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' },
        available: true,
        displayName: 'phi-4',
        runtimeDisplayName: 'LM Studio',
      },
    })
    render(<ModelsPage />)
    expect(await screen.findByTestId('active-model')).toHaveTextContent('phi-4')
    expect(screen.getByRole('button', { name: 'Active model phi-4' })).toBeDisabled()
  })

  it('surfaces an unavailable selection instead of re-picking', async () => {
    mockBridge({
      'models:getActiveModel': {
        selection: { runtimeId: 'rt-9', modelId: 'rt-9:ghost' },
        available: false,
      },
    })
    render(<ModelsPage />)
    expect(await screen.findByTestId('active-model-unavailable')).toHaveTextContent('Unavailable')
  })

  it('add form validates locally and calls addRuntime', async () => {
    const invoke = mockBridge()
    render(<ModelsPage />)
    await screen.findByText('No local runtimes yet')
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Runtime display name' }), 'Ollama')
    await user.clear(screen.getByRole('textbox', { name: 'Runtime endpoint URL' }))
    await user.type(screen.getByRole('textbox', { name: 'Runtime endpoint URL' }), 'http://127.0.0.1:11434/v1')
    await user.click(screen.getByRole('button', { name: 'Add runtime' }))
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('models:addRuntime', {
        displayName: 'Ollama',
        endpoint: 'http://127.0.0.1:11434/v1',
      })
    })
  })
})
