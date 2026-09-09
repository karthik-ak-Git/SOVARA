import { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Cpu, Activity, Zap, Trash2, RefreshCw, AlertTriangle } from 'lucide-react'
import { listInstances, unloadInstance, getInstanceMetrics, onInstanceEvents, type ModelInstance, type InstanceMetrics, type InstanceEvent } from '../../lib/ipc'
import { Button } from '../../components/ui/Button'
import { Badge, StatusPill } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'

interface Props {
  onBack: () => void
}

const POLL_INTERVAL_MS = 1500

function formatUptime(startedAt?: number): string {
  if (!startedAt) return '—'
  const ms = Date.now() - startedAt
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ${sec % 60}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function formatBytes(mb?: number): string {
  if (mb === undefined || mb === null) return '—'
  if (mb < 1024) return `${mb} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function statusLabel(status: ModelInstance['status']): string {
  switch (status) {
    case 'loading': return 'Loading…'
    case 'loaded': return 'Loaded'
    case 'idle': return 'Idle'
    case 'generating': return 'Generating'
    case 'unloading': return 'Unloading…'
    case 'unloaded': return 'Unloaded'
    case 'error': return 'Error'
    case 'failed': return 'Failed'
    case 'crashed': return 'Crashed'
    default: return status
  }
}

function statusVariant(status: ModelInstance['status']): 'success' | 'warn' | 'neutral' | 'info' {
  switch (status) {
    case 'loaded':
    case 'idle': return 'success'
    case 'generating': return 'info'
    case 'loading':
    case 'unloading': return 'info'
    case 'error':
    case 'failed':
    case 'crashed': return 'warn'
    default: return 'neutral'
  }
}

function MetricBar({ label, value, max, unit }: { label: string; value?: number; max: number; unit?: string }) {
  const pct = value !== undefined ? Math.min(100, Math.round((value / max) * 100)) : undefined
  return (
    <div className="instance-metric">
      <div className="instance-metric-header">
        <span className="instance-metric-label">{label}</span>
        <span className="instance-metric-value">{value !== undefined ? `${value}${unit ?? ''}` : '—'}</span>
      </div>
      <div className="instance-metric-bar">
        <div
          className={`instance-metric-fill ${pct === undefined ? 'instance-metric-fill--unknown' : pct > 85 ? 'instance-metric-fill--high' : ''}`}
          style={pct !== undefined ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  )
}

function InstanceCard({ instance, onUnload }: { instance: ModelInstance; onUnload: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false)
  const m = instance.metrics

  return (
    <div className={`instance-card ${instance.status === 'error' || instance.status === 'failed' || instance.status === 'crashed' ? 'instance-card--error' : ''}`}>
      <div className="instance-card-header">
        <div className="instance-card-identity">
          <Cpu size={14} className="instance-card-icon" />
          <span className="instance-card-model">{instance.modelId}</span>
          <Badge variant={statusVariant(instance.status)}>{statusLabel(instance.status)}</Badge>
        </div>
        <div className="instance-card-actions">
          <StatusPill title="Uptime">
            <Activity size={11} />
            <span>{formatUptime(instance.startedAt)}</span>
          </StatusPill>
          {instance.status !== 'unloading' && instance.status !== 'unloaded' ? (
            confirming ? (
              <div className="instance-confirm">
                <span className="instance-confirm-text">Unload model? Files stay on disk.</span>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={() => { setConfirming(false); onUnload(instance.id) }}>
                  <Trash2 size={12} /> Unload
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                <Trash2 size={12} /> Unload
              </Button>
            )
          ) : null}
        </div>
      </div>

      <div className="instance-card-meta">
        <span className="instance-meta-item">Runtime: {instance.runtimeId}</span>
        <span className="instance-meta-item">Context: {instance.ctxLen.toLocaleString()} tokens</span>
        {instance.port ? <span className="instance-meta-item">Port: {instance.port}</span> : null}
      </div>

      <div className="instance-metrics-grid">
        <MetricBar label="GPU" value={m?.gpuUtilization} max={100} unit="%" />
        <MetricBar label="VRAM" value={m?.vramUsedMB} max={m?.vramUsedMB !== undefined ? Math.max(m.vramUsedMB * 1.2, 1024) : 1024} unit=" MB" />
        <MetricBar label="CPU" value={m?.cpuUsage} max={100} unit="%" />
        <MetricBar label="RAM" value={m?.ramUsedMB} max={m?.ramUsedMB !== undefined ? Math.max(m.ramUsedMB * 1.5, 2048) : 2048} unit=" MB" />
      </div>

      {m?.tokensPerSec !== undefined ? (
        <div className="instance-card-throughput">
          <Zap size={12} />
          <span>{m.tokensPerSec.toFixed(1)} tok/s</span>
        </div>
      ) : null}
    </div>
  )
}

export function LoadedInstancesSection({ onBack }: Props): React.JSX.Element {
  const [instances, setInstances] = useState<ModelInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mountedRef = useRef(true)

  const fetchInstances = useCallback(async () => {
    try {
      const list = await listInstances()
      if (!mountedRef.current) return
      setInstances(list)
      setError(null)
    } catch (e) {
      if (!mountedRef.current) return
      setError(e instanceof Error ? e.message : 'Failed to load instances')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  const refreshMetrics = useCallback(async () => {
    for (const inst of instances) {
      if (inst.status === 'unloading' || inst.status === 'unloaded') continue
      try {
        const health = await getInstanceMetrics(inst.id)
        if (!mountedRef.current) return
        setInstances((prev) =>
          prev.map((p) =>
            p.id === inst.id
              ? { ...p, metrics: { ...p.metrics, vramUsedMB: health.vramUsedMB, lastUpdatedAt: Date.now() } }
              : p
          )
        )
      } catch {
        // metric fetch failure is non-fatal
      }
    }
  }, [instances])

  const handleUnload = useCallback(async (instanceId: string) => {
    try {
      setInstances((prev) => prev.map((p) => p.id === instanceId ? { ...p, status: 'unloading' as const } : p))
      await unloadInstance(instanceId)
      // Remove after brief delay so user sees the unloading state
      setTimeout(() => {
        if (!mountedRef.current) return
        setInstances((prev) => prev.filter((p) => p.id !== instanceId))
      }, 600)
    } catch (e) {
      // Restore status on failure
      setInstances((prev) => prev.map((p) => p.id === instanceId ? { ...p, status: 'loaded' as const } : p))
      setError(e instanceof Error ? e.message : 'Unload failed')
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void fetchInstances()

    pollRef.current = setInterval(() => {
      void fetchInstances()
      void refreshMetrics()
    }, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchInstances, refreshMetrics])

  // Listen for push events from the backend
  useEffect(() => {
    const unsub = onInstanceEvents((event: InstanceEvent) => {
      if (!mountedRef.current) return
      if (event.type === 'removed') {
        setInstances((prev) => prev.filter((p) => p.id !== event.instanceId))
      } else if (event.instance) {
        setInstances((prev) => {
          const idx = prev.findIndex((p) => p.id === event.instanceId)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = event.instance!
            return next
          }
          return [...prev, event.instance!]
        })
      }
    })
    return unsub
  }, [])

  const running = instances.filter((i) => i.status !== 'unloaded')
  const totalVram = instances.reduce((sum, i) => sum + (i.metrics?.vramUsedMB ?? 0), 0)

  return (
    <div className="settings-content">
      <div className="settings-content-header">
        <button type="button" className="settings-back" onClick={onBack} aria-label="Back to settings">
          <ArrowLeft size={14} aria-hidden />
          <span>Back</span>
        </button>
        <h2 className="settings-section-title">Loaded Instances</h2>
      </div>

      {error ? (
        <div className="instance-error-banner">
          <AlertTriangle size={14} />
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      ) : null}

      {!loading && running.length > 0 ? (
        <div className="instance-summary">
          <span className="instance-summary-item">
            <Cpu size={13} />
            {running.length} running
          </span>
          {totalVram > 0 ? (
            <span className="instance-summary-item">
              <Zap size={13} />
              {formatBytes(totalVram)} VRAM used
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="settings-group">
        {loading ? (
          <div className="settings-card settings-card--empty">
            <StatusPill>Loading instances…</StatusPill>
          </div>
        ) : instances.length === 0 ? (
          <EmptyState
            icon={<Cpu size={28} />}
            title="No loaded instances"
            description="Load a model from the Library or Explorer to see it here. Running instances show real-time resource usage."
          />
        ) : (
          <div className="instance-list">
            {instances.map((inst) => (
              <InstanceCard key={inst.id} instance={inst} onUnload={handleUnload} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
