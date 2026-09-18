'use client'

import { type ReactElement } from 'react'
import { Database, Cpu } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { useModelWorkbench } from './useModelWorkbench'

function formatCtx(n?: number): string {
  if (n === undefined) return '-'
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function ModelsPage(): ReactElement {
  const { models, active, resources, busy, error, dismissError, handleSelect, handleSelectFit, lastSelect, handleEnsureRuntime, localRuntime, runtimeProgress } =
    useModelWorkbench()

  const vramUnknown = resources !== null && resources.vram.totalMB === undefined

  return (
    <div className="models-page" aria-label="Model workbench">
      {/* Active model - always visible */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <Database size={16} aria-hidden />
            <span>Active model</span>
          </div>
          <div className="panel-hint muted small">Local only · served from your GPU</div>
        </div>
        {active.selection ? (
          <div
            className="active-model"
            data-testid={active.available ? 'active-model' : 'active-model-unavailable'}
            role="status"
          >
            <strong>{active.displayName ?? active.selection.modelId}</strong>
            <span className="muted small">
              {' '}on {active.runtimeDisplayName ?? active.selection.runtimeId}
            </span>
            {!active.available ? (
              <span className="badge badge--warn" aria-label="Selected model unavailable">
                Unavailable — drop the GGUF into your Library and reselect
              </span>
            ) : (
              <span className="badge badge--success">Selected</span>
            )}
          </div>
        ) : (
          <p className="muted small" role="status">
            No model selected. Pick a model from the list below.
          </p>
        )}
      </Card>

      {/* Sovara owned runtime — our own llama.cpp sidecar. No LM Studio /
          Ollama / vLLM endpoints are accepted: Sovara is sovereign and
          loads GGUF weights through its own llama-server.exe binary. */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <Cpu size={16} aria-hidden />
            <span>Sovara Local Runtime</span>
          </div>
          <div className="panel-hint muted small">llama.cpp sidecar · CUDA · owned by Sovara</div>
        </div>
        {localRuntime === null ? (
          <p className="muted small" role="status">Checking local runtime…</p>
        ) : localRuntime.available ? (
          <div className="active-model" role="status" data-testid="local-runtime-ready">
            <span className="badge badge--success">Installed</span>
            <span className="muted small">
              {localRuntime.version ?? 'llama-server'} · loads GGUFs from your Library straight into GPU VRAM. Switching models unloads the previous one first.
            </span>
          </div>
        ) : (
          <div role="status" aria-label="Local runtime not installed">
            <p className="muted small">
              Not installed. One-time download (~240MB pinned CUDA build) — afterwards Sovara runs fully offline and loads your Library GGUFs into VRAM itself. The runtime is also auto-installed the first time you select a model.
            </p>
            {runtimeProgress ? (
              <p className="muted small" role="status" aria-label="Runtime install progress">
                {runtimeProgress.phase}… {runtimeProgress.totalBytes ? `${Math.round((runtimeProgress.receivedBytes / runtimeProgress.totalBytes) * 100)}%` : `${Math.round(runtimeProgress.receivedBytes / 1048576)}MB`}
              </p>
            ) : (
              <Button
                variant="primary"
                onClick={() => void handleEnsureRuntime()}
                disabled={busy !== null}
                aria-label="Install Sovara local runtime"
              >
                Install local runtime
              </Button>
            )}
          </div>
        )}
      </Card>

      {error ? (
        <div className="chat-error" role="alert" aria-label="Models error">
          <span>{error}</span>
          {/fit mode/i.test(error) && lastSelect ? (
            <button type="button" className="btn btn-sm" onClick={() => void handleSelectFit()} aria-label="Retry with Fit mode (partial GPU offload)">
              Retry with Fit mode
            </button>
          ) : null}
          <button type="button" className="btn btn-sm" onClick={dismissError} aria-label="Dismiss error">
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Available models */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <Database size={16} aria-hidden />
            <span>Available models</span>
          </div>
          <div className="panel-hint muted small">{models.length} discovered | from your Library</div>
        </div>
        {models.length === 0 ? (
          <EmptyState
            title="No models discovered"
            description="Drop a GGUF into your Sovara Library (or use Library → Import) and it will appear here automatically."
          />
        ) : (
          <ul className="model-list" aria-label="Discovered models">
            {models.map((m) => {
              const isActive = active.selection?.modelId === m.modelId && active.selection?.runtimeId === m.runtimeId
              return (
                <li key={m.modelId} className="model-row" data-testid={`model-${m.modelId}`}>
                  <div className="model-info">
                    <strong>{m.displayName}</strong>
                    <span className="muted small">
                      Sovara Local · llama.cpp | ctx {formatCtx(m.contextLength)}
                      {!m.available ? ' | unavailable' : ''}
                    </span>
                  </div>
                  <Button
                    variant={isActive ? 'ghost' : 'primary'}
                    onClick={() => void handleSelect(m.runtimeId, m.modelId)}
                    disabled={busy !== null || isActive || !m.available}
                    aria-label={isActive ? `Active model ${m.displayName}` : `Select ${m.displayName}`}
                  >
                    {isActive ? 'Active' : 'Select'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Resources - stub-honest */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <span>Resources</span>
          </div>
          <div className="panel-hint muted small">SystemResourceManagerPort</div>
        </div>
        {resources ? (
          <p className="muted small" data-testid="resource-strip" role="status">
            CPU {resources.cpu.logicalCores} cores | RAM {resources.ram.freeMB}/{resources.ram.totalMB} MB free
            {resources.gpu.name ? ` | GPU ${resources.gpu.name}` : ''}
            {' '}| VRAM{' '}
            {vramUnknown ? 'UNKNOWN — no NVIDIA driver reading (install the driver or load a model)' : `${resources.vram.freeMB}/${resources.vram.totalMB} MB free`}
            {resources.vram.usedByModelsMB !== undefined ? ` | models hold ${resources.vram.usedByModelsMB} MB` : ''}
          </p>
        ) : (
          <p className="muted small">Loading resource snapshot...</p>
        )}
      </Card>
    </div>
  )
}
