import { useState, type ReactElement } from 'react'
import { Database, Plug, RefreshCw, Trash2 } from 'lucide-react'
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
  const { runtimes, models, active, resources, probes, busy, error, dismissError, handleAdd, handleRemove, handleProbe, handleSelect, handleSelectFit, lastSelect, handleEnsureRuntime, handleDiagnose, handleUnblock, diag, localRuntime, runtimeProgress } =
    useModelWorkbench()
  const [name, setName] = useState('')
  const [endpoint, setEndpoint] = useState('http://127.0.0.1:1234/v1')
  const blocked = /spawn unknown|blocked|not installed|could not start/i.test(error ?? '')

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
                Unavailable - probe its runtime
              </span>
            ) : (
              <span className="badge badge--success">Selected</span>
            )}
          </div>
        ) : (
          <p className="muted small" role="status">
            No model selected. Add a local runtime below, test the connection, then select a model.
          </p>
        )}
      </Card>

      {/* Sovara owned runtime — our own llama.cpp sidecar, no third party */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <Database size={16} aria-hidden />
            <span>Sovara Local Runtime</span>
          </div>
          <div className="panel-hint muted small">llama.cpp sidecar · CUDA · owned by Sovara · %LOCALAPPDATA%\Sovara (no @)</div>
        </div>
        {localRuntime === null ? (
          <p className="muted small" role="status">Checking local runtime…</p>
        ) : localRuntime.available ? (
          <div className="active-model" role="status" data-testid="local-runtime-ready">
            <span className="badge badge--success">Installed</span>
            <span className="muted small">
              {localRuntime.version ?? 'llama-server'} · {localRuntime.path ?? ''} · loads GGUFs from your Library straight into GPU VRAM.
            </span>
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <Button variant="ghost" onClick={() => void handleDiagnose()} disabled={busy !== null} aria-label="Diagnose local runtime">Diagnose</Button>
              <Button variant="ghost" onClick={() => void handleUnblock()} disabled={busy !== null} aria-label="Unblock and retry">Unblock &amp; Retry</Button>
            </div>
            {diag ? (
              <p className="muted small" role="status" style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                exe={diag.exePath ?? '—'} · {diag.sizeMB ?? '?'}MB · MOTW={diag.hasMotw ? 'YES (blocked)' : 'no'} · version={diag.version ?? '—'} · dlls=[{diag.dlls.join(',')}] · {diag.recommendation}
              </p>
            ) : null}
          </div>
        ) : (
          <div role="status" aria-label="Local runtime not installed">
            <p className="muted small">
              Not installed or blocked. One-time download (~240MB pinned CUDA build) to %LOCALAPPDATA%\Sovara — afterwards Sovara runs fully offline. If Windows blocks it (spawn UNKNOWN / MOTW), use Unblock &amp; Retry or switch to LM Studio below.
            </p>
            {runtimeProgress ? (
              <p className="muted small" role="status" aria-label="Runtime install progress">
                {runtimeProgress.phase}… {runtimeProgress.totalBytes ? `${Math.round((runtimeProgress.receivedBytes / runtimeProgress.totalBytes) * 100)}%` : `${Math.round(runtimeProgress.receivedBytes / 1048576)}MB`}
              </p>
            ) : (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  onClick={() => void handleEnsureRuntime()}
                  disabled={busy !== null}
                  aria-label="Install Sovara local runtime"
                >
                  Install local runtime
                </Button>
                <Button variant="ghost" onClick={() => void handleDiagnose()} disabled={busy !== null} aria-label="Diagnose local runtime">Diagnose</Button>
                <Button variant="ghost" onClick={() => void handleUnblock()} disabled={busy !== null} aria-label="Unblock and retry">Unblock &amp; Retry</Button>
              </div>
            )}
            {diag ? (
              <p className="muted small" role="status" style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                dir={diag.runtimeDir} · legacy={diag.legacyDir ?? '—'} · MOTW={diag.hasMotw ? 'YES' : 'no'} · {diag.recommendation}
              </p>
            ) : null}
          </div>
        )}
      </Card>

      {blocked ? (
        <Card>
          <div className="panel-head">
            <div className="panel-title"><span>Fallback — use LM Studio / Ollama instead</span></div>
            <div className="panel-hint muted small">No reinstall needed · your GGUFs already there</div>
          </div>
          <p className="muted small">Owned sidecar is blocked by Windows. Start LM Studio → Server tab → Start Server (:1234), or start Ollama (:11434), then Test + Select below. Chat auto-falls-back when the sidecar fails.</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => void handleProbe('lmstudio')} disabled={busy !== null} aria-label="Test LM Studio">Test LM Studio (:1234)</Button>
            <Button variant="ghost" onClick={() => void handleProbe('ollama')} disabled={busy !== null} aria-label="Test Ollama">Test Ollama (:11434)</Button>
            <Button variant="ghost" onClick={() => void handleUnblock()} disabled={busy !== null} aria-label="Unblock owned runtime">Unblock owned &amp; Retry</Button>
          </div>
        </Card>
      ) : null}

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

      {/* Connected runtimes */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <Plug size={16} aria-hidden />
            <span>Connected runtimes</span>
          </div>
          <div className="panel-hint muted small">{runtimes.length} configured | loopback only</div>
        </div>

        <form
          className="runtime-add"
          aria-label="Add local runtime"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && endpoint.trim()) void handleAdd(name.trim(), endpoint.trim())
          }}
        >
          <label className="field" htmlFor="rt-name">
            <span className="field-label">Display name</span>
            <input
              id="rt-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              placeholder="LM Studio (local)"
              maxLength={80}
              aria-label="Runtime display name"
            />
          </label>
          <label className="field" htmlFor="rt-endpoint">
            <span className="field-label">Endpoint</span>
            <input
              id="rt-endpoint"
              className="input"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value.slice(0, 256))}
              placeholder="http://127.0.0.1:1234/v1"
              maxLength={256}
              inputMode="url"
              aria-label="Runtime endpoint URL"
            />
          </label>
          <Button variant="primary" type="submit" disabled={busy !== null || !name.trim() || !endpoint.trim()} aria-label="Add runtime">
            Add
          </Button>
        </form>

        {runtimes.length === 0 ? (
          <EmptyState
            title="No local runtimes yet"
            description="Add LM Studio, Ollama, vLLM, or any OpenAI-compatible server on localhost. Only loopback addresses are accepted."
          />
        ) : (
          <ul className="runtime-list" aria-label="Configured runtimes">
            {runtimes.map((rt) => {
              const probe = probes[rt.id]
              const status = probe ? (probe.reachable ? 'connected' : 'disconnected') : 'not-probed'
              return (
                <li key={rt.id} className="runtime-row" data-testid={`runtime-${rt.id}`}>
                  <div className="runtime-info">
                    <strong>{rt.displayName}</strong>
                    <span className="muted small runtime-endpoint">{rt.endpoint}</span>
                  </div>
                  <span
                    className={`badge ${status === 'connected' ? 'badge--success' : status === 'disconnected' ? 'badge--warn' : 'badge--info'}`}
                    data-testid={`runtime-status-${rt.id}`}
                    role="status"
                  >
                    {status === 'connected'
                      ? `Connected | ${probe!.models.length} models | ${probe!.latencyMs}ms`
                      : status === 'disconnected'
                        ? `Disconnected | ${probe!.error ?? 'unreachable'}`
                        : 'Not probed yet'}
                  </span>
                  <div className="runtime-actions">
                    <Button
                      onClick={() => void handleProbe(rt.id)}
                      disabled={busy !== null}
                      aria-label={`Test connection to ${rt.displayName}`}
                    >
                      <RefreshCw size={12} aria-hidden /> Test
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => void handleRemove(rt.id)}
                      disabled={busy !== null}
                      aria-label={`Remove ${rt.displayName}`}
                    >
                      <Trash2 size={12} aria-hidden /> Remove
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Available models */}
      <Card>
        <div className="panel-head">
          <div className="panel-title">
            <Database size={16} aria-hidden />
            <span>Available models</span>
          </div>
          <div className="panel-hint muted small">{models.length} discovered | from last probe</div>
        </div>
        {models.length === 0 ? (
          <EmptyState
            title="No models discovered"
            description="Test a runtime connection above to discover its local models. Snapshots persist - Refresh re-probes."
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
                      {runtimes.find((r) => r.id === m.runtimeId)?.displayName ?? m.runtimeId} | ctx {formatCtx(m.contextLength)}
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
