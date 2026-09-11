/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelsPage } from '../../web/src/features/models/ModelsPage'
import { mockApi, expectFetch } from './helpers/http'

// Internal-API equivalents of the former IPC channels (see apps/web README).
const baseRoutes: Record<string, unknown> = {
  'GET /api/runtimes': [],
  'GET /api/models': [],
  'GET /api/models/active': { selection: null, available: false },
  'GET /api/hardware': {
    cpu: { logicalCores: 8, loadAvg1: 0.5 },
    ram: { totalMB: 16000, freeMB: 8000, usedByAppMB: 200 },
    gpu: { available: false },
    vram: {},
    disk: { path: 'unknown', totalMB: 0, freeMB: 0 },
    models: { instances: [] },
    limits: { maxConcurrentModels: 1 },
  },
  'GET /api/library': [],
  'POST /api/models/probe': { available: false },
  'POST /api/models/select': (body: unknown) => {
    const payload = body as { runtimeId: string; modelId: string }
    return { selection: payload, available: true, displayName: payload.modelId, runtimeDisplayName: payload.runtimeId }
  },
}

function mockBridge(overrides: Record<string, unknown> = {}) {
  return mockApi({ ...baseRoutes, ...overrides })
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
    const fetchMock = mockBridge({
      'GET /api/runtimes': [{ id: 'rt-1', displayName: 'LM Studio', type: 'openai-compatible', endpoint: 'http://127.0.0.1:1234/v1', enabled: true, timeoutMs: 8000 }],
      'GET /api/models': [
        { modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', source: 'openai-compatible', capabilities: [], contextLength: 16384, available: true },
      ],
    })
    render(<ModelsPage />)
    expect(await screen.findByText('LM Studio')).toBeInTheDocument()
    expect(screen.getByText('phi-4')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Select phi-4' }))
    await waitFor(() => {
      expectFetch(fetchMock, 'POST', '/api/models/select', { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    })
  })

  it('marks the active model and blocks duplicate selection', async () => {
    mockBridge({
      'GET /api/runtimes': [{ id: 'rt-1', displayName: 'LM Studio', type: 'openai-compatible', endpoint: 'http://127.0.0.1:1234/v1', enabled: true, timeoutMs: 8000 }],
      'GET /api/models': [
        { modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', source: 'openai-compatible', capabilities: [], available: true },
      ],
      'GET /api/models/active': {
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
      'GET /api/models/active': {
        selection: { runtimeId: 'rt-9', modelId: 'rt-9:ghost' },
        available: false,
      },
    })
    render(<ModelsPage />)
    expect(await screen.findByTestId('active-model-unavailable')).toHaveTextContent('Unavailable')
  })

  it('add form validates locally and calls addRuntime', async () => {
    const fetchMock = mockBridge()
    render(<ModelsPage />)
    await screen.findByText('No local runtimes yet')
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Runtime display name' }), 'Ollama')
    await user.clear(screen.getByRole('textbox', { name: 'Runtime endpoint URL' }))
    await user.type(screen.getByRole('textbox', { name: 'Runtime endpoint URL' }), 'http://127.0.0.1:11434/v1')
    await user.click(screen.getByRole('button', { name: 'Add runtime' }))
    await waitFor(() => {
      expectFetch(fetchMock, 'POST', '/api/runtimes', {
        displayName: 'Ollama',
        endpoint: 'http://127.0.0.1:11434/v1',
      })
    })
  })
})
