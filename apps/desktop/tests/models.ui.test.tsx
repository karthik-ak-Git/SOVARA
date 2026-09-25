/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModelsPage } from '../src/renderer/src/features/models/ModelsPage'

// Desktop-only: ModelsPage talks to main over the preload bridge
// (window.sovara.invoke), not over fetch('/api/...'). Mock the bridge per
// test with channel routes mirroring the IPC channels in api.ts.
interface InvokeCall {
  channel: string
  args: unknown[]
}

type Route = unknown | ((...args: unknown[]) => unknown | Promise<unknown>)

const hardwareSnapshot = {
  cpu: { logicalCores: 8, loadAvg1: 0.5 },
  ram: { totalMB: 16000, freeMB: 8000, usedByAppMB: 200 },
  gpu: { available: false },
  vram: {},
  disk: { path: 'unknown', totalMB: 0, freeMB: 0 },
  models: { instances: [] },
  limits: { maxConcurrentModels: 1 },
}

function installBridge(overrides: Record<string, Route> = {}): { calls: InvokeCall[] } {
  const calls: InvokeCall[] = []
  // In-memory runtime registry so add flows behave like the real workbench
  // (handleAdd re-reads the list after adding).
  let runtimes = [...((overrides['models:listRuntimes'] as unknown[] | undefined) ?? [])]
  const routes: Record<string, Route> = {
    'models:listRuntimes': () => runtimes,
    'models:listModels': [],
    'models:getActiveModel': { selection: null, available: false },
    'library:listModels': [],
    'system:getResources': hardwareSnapshot,
    'models:probeRuntime': { available: false },
    ...overrides,
  }
  // listRuntimes override replaces the backing store (add still appends).
  if (overrides['models:listRuntimes'] !== undefined && typeof overrides['models:listRuntimes'] !== 'function') {
    runtimes = [...(overrides['models:listRuntimes'] as unknown[])]
    routes['models:listRuntimes'] = () => runtimes
  }
  if (routes['models:addRuntime'] === undefined) {
    routes['models:addRuntime'] = (input: unknown) => {
      const payload = input as { displayName: string; endpoint: string }
      const entry = {
        id: `rt-${runtimes.length + 1}`,
        displayName: payload.displayName,
        endpoint: payload.endpoint,
        type: 'openai-compatible',
        enabled: true,
        timeoutMs: 8000,
      }
      runtimes = [...runtimes, entry]
      return entry
    }
  }
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    calls.push({ channel, args })
    const handler = routes[channel]
    if (handler === undefined) throw new Error(`unmocked IPC: ${channel}`)
    return (await (typeof handler === 'function'
      ? (handler as (...a: unknown[]) => unknown)(...args)
      : handler)) as unknown
  })
  ;(window as unknown as Record<string, unknown>).sovara = {
    invoke,
    on: () => () => {},
  }
  return { calls }
}

/** Assert an IPC invoke happened on channel with (partial) payload match. */
function expectInvoke(calls: InvokeCall[], channel: string, body?: Record<string, unknown>): void {
  const call = calls.find((c) => c.channel === channel)
  if (!call) throw new Error(`expected invoke ${channel} — not called`)
  if (body !== undefined) {
    const sent = (call.args[0] ?? {}) as Record<string, unknown>
    for (const [k, v] of Object.entries(body)) {
      if (JSON.stringify(sent[k]) !== JSON.stringify(v)) {
        throw new Error(
          `expected invoke ${channel} arg ${k}=${JSON.stringify(v)}, got ${JSON.stringify(sent[k])}`
        )
      }
    }
  }
}

beforeEach(() => {
  installBridge()
})
afterEach(() => {
  cleanup()
  delete (window as unknown as Record<string, unknown>).sovara
})

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
    const { calls } = installBridge({
      'models:listRuntimes': [{ id: 'rt-1', displayName: 'LM Studio', type: 'openai-compatible', endpoint: 'http://127.0.0.1:1234/v1', enabled: true, timeoutMs: 8000 }],
      'models:listModels': [
        { modelId: 'rt-1:phi-4', displayName: 'phi-4', runtimeId: 'rt-1', source: 'openai-compatible', capabilities: [], contextLength: 16384, available: true },
      ],
      'models:selectModel': (body: unknown) => {
        const payload = body as { runtimeId: string; modelId: string }
        return { selection: payload, available: true, displayName: payload.modelId, runtimeDisplayName: payload.runtimeId }
      },
    })
    render(<ModelsPage />)
    expect(await screen.findByText('LM Studio')).toBeInTheDocument()
    expect(screen.getByText('phi-4')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Select phi-4' }))
    await waitFor(() => {
      expectInvoke(calls, 'models:selectModel', { runtimeId: 'rt-1', modelId: 'rt-1:phi-4' })
    })
  })

  it('marks the active model and blocks duplicate selection', async () => {
    installBridge({
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
    installBridge({
      'models:getActiveModel': {
        selection: { runtimeId: 'rt-9', modelId: 'rt-9:ghost' },
        available: false,
      },
    })
    render(<ModelsPage />)
    expect(await screen.findByTestId('active-model-unavailable')).toHaveTextContent('Unavailable')
  })

  it('add form validates locally and calls addRuntime', async () => {
    const { calls } = installBridge()
    render(<ModelsPage />)
    await screen.findByText('No local runtimes yet')
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox', { name: 'Runtime display name' }), 'Ollama')
    await user.clear(screen.getByRole('textbox', { name: 'Runtime endpoint URL' }))
    await user.type(screen.getByRole('textbox', { name: 'Runtime endpoint URL' }), 'http://127.0.0.1:11434/v1')
    await user.click(screen.getByRole('button', { name: 'Add runtime' }))
    await waitFor(() => {
      expectInvoke(calls, 'models:addRuntime', {
        displayName: 'Ollama',
        endpoint: 'http://127.0.0.1:11434/v1',
      })
    })
  })
})
