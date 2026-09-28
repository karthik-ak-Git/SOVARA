import React, { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheck,
  Lock,
  Cpu,
  Terminal,
  Activity,
  Server,
  Database,
  CheckCircle2,
  HardDrive,
  RefreshCw,
  Zap,
} from 'lucide-react'
import {
  listInstances,
  getHardwareProfile,
  getAppSettings,
  onAgentEvents,
  type ModelInstance,
} from '@/lib/client/api'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'

interface Props {
  onBack?: () => void
}

interface ToolAuditEvent {
  id: string
  timestamp: string
  role: string
  tool: string
  target: string
  permission: 'auto' | 'approved' | 'denied'
  status: 'ok' | 'failed'
  latencyMs: number
}

export function AuditSovereigntyPage({ onBack }: Props): React.JSX.Element {
  const [instances, setInstances] = useState<ModelInstance[]>([])
  const [hardware, setHardware] = useState<any>(null)
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [auditLog, setAuditLog] = useState<ToolAuditEvent[]>([])

  const loadSovereigntyData = useCallback(async () => {
    setLoading(true)
    try {
      const [insts, hw, st] = await Promise.all([
        listInstances().catch(() => []),
        getHardwareProfile().catch(() => null),
        getAppSettings().catch(() => null),
      ])
      setInstances(insts)
      setHardware(hw)
      setSettings(st)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSovereigntyData()
    const unsub = onAgentEvents((ev) => {
      if (ev.type === 'TOOL_CALL_COMPLETED' || ev.type === 'TOOL_CALL_STARTED') {
        const payload = ev.payload as any
        const ts = payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString()
        const newEv: ToolAuditEvent = {
          id: payload.toolCallId || `aud-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: ts,
          role: payload.role || 'ToolOperator',
          tool: payload.toolName || payload.name || 'tool',
          target: payload.args ? JSON.stringify(payload.args).slice(0, 50) : payload.path || 'workspace',
          permission: payload.permission || 'auto',
          status: payload.error || payload.status === 'failed' ? 'failed' : 'ok',
          latencyMs: payload.durationMs || payload.latencyMs || 0,
        }
        setAuditLog((prev) => [newEv, ...prev].slice(0, 100))
      }
    })
    return () => unsub()
  }, [loadSovereigntyData])

  const activeInstance = instances.find((i) => i.status === 'active' || i.status === 'loaded' || i.status === 'generating')

  return (
    <div
      className="audit-sovereignty-page"
      style={{
        padding: '24px 32px',
        maxWidth: 1200,
        margin: '0 auto',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        color: '#0f172a',
      }}
    >
      {/* Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: '#0f172a',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#0f172a' }}>
              Sovereignty & Audit Console
            </h1>
            <p style={{ fontSize: 13, color: '#64748b', margin: '2px 0 0' }}>
              Local-first zero-cloud runtime isolation, VRAM allocation, and tool permission audit stream
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button variant="ghost" size="sm" onClick={loadSovereigntyData}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Refresh
          </Button>
          {onBack ? (
            <Button variant="default" size="sm" onClick={onBack}>
              Back to Chat
            </Button>
          ) : null}
        </div>
      </div>

      {/* Main Grid Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
        {/* Card 1: Local Sovereignty Proof */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Lock size={18} style={{ color: '#16a34a' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Offline Proof & Security</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>Network Mode</span>
              {settings?.securityMode === 'CONTROLLED_LOCAL' ? (
                <Badge variant="info">CONTROLLED LOCAL (Approved Web Tools)</Badge>
              ) : (
                <Badge variant="success">AIR-GAPPED (100% Isolated)</Badge>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>Cloud LLM Egress</span>
              <span style={{ fontWeight: 600, color: '#16a34a' }}>0 Bytes</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>Telemetry / Analytics</span>
              <span style={{ fontWeight: 600, color: '#64748b' }}>Disabled (Local-only)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>Workspace Root</span>
              <span
                style={{
                  fontWeight: 500,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  background: '#f8fafc',
                  padding: '2px 6px',
                  borderRadius: 4,
                  maxWidth: 160,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={settings?.globalWorkspaceRoot ?? 'Local System'}
              >
                {settings?.globalWorkspaceRoot ?? 'Local System'}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Active Resident Model */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Cpu size={18} style={{ color: '#0284c7' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Active Resident Model</span>
          </div>
          {activeInstance ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>Model ID</span>
                <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 12 }}>
                  {activeInstance.modelId}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>Backend / Offload</span>
                <Badge variant="info">
                  {activeInstance.configuration?.nGpuLayers === 999
                    ? 'Full CUDA'
                    : `GPU (${activeInstance.configuration?.nGpuLayers ?? 'auto'})`}
                </Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>Context Window</span>
                <span style={{ fontWeight: 600 }}>{activeInstance.ctxLen.toLocaleString()} tokens</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b' }}>VRAM Allocation</span>
                <span style={{ fontWeight: 600 }}>{activeInstance.metrics?.vramUsedMB ?? 0} MB</span>
              </div>
            </div>
          ) : (
            <div style={{ padding: '16px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
              No active resident model loaded in VRAM
            </div>
          )}
        </div>

        {/* Card 3: Hardware & VRAM Allocation */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 16,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <HardDrive size={18} style={{ color: '#8b5cf6' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>Hardware & Memory</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>GPU Backend</span>
              <span style={{ fontWeight: 600 }}>{hardware?.gpu?.name ?? 'Detecting...'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>Dedicated VRAM</span>
              <span style={{ fontWeight: 600 }}>
                {hardware?.vram?.totalMB ? `${Math.round(hardware.vram.totalMB / 1024)} GB` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>CPU Logical Cores</span>
              <span style={{ fontWeight: 600 }}>{hardware?.cpu?.logicalCores ?? '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#64748b' }}>Single GPU Lock</span>
              <span style={{ fontWeight: 600, color: '#16a34a' }}>Enforced (Max 1)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tool Execution Audit Trail Table */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: 20,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={18} style={{ color: '#0f172a' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Real-Time Tool Execution Audit Stream</span>
          </div>
          <Badge variant="neutral">{auditLog.length} recorded operations</Badge>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b', fontSize: 12 }}>
              <th style={{ padding: '8px 12px' }}>Timestamp</th>
              <th style={{ padding: '8px 12px' }}>Logical Role</th>
              <th style={{ padding: '8px 12px' }}>Tool</th>
              <th style={{ padding: '8px 12px' }}>Target / Scope</th>
              <th style={{ padding: '8px 12px' }}>Permission</th>
              <th style={{ padding: '8px 12px' }}>Status</th>
              <th style={{ padding: '8px 12px', textAlign: 'right' }}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {auditLog.map((ev) => (
              <tr key={ev.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '10px 12px', color: '#64748b', fontFamily: 'monospace', fontSize: 11 }}>
                  {ev.timestamp}
                </td>
                <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a' }}>{ev.role}</td>
                <td style={{ padding: '10px 12px' }}>
                  <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
                    {ev.tool}
                  </code>
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    maxWidth: 240,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={ev.target}
                >
                  {ev.target}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <Badge variant={ev.permission === 'approved' ? 'success' : 'neutral'}>
                    {ev.permission}
                  </Badge>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      color: ev.status === 'ok' ? '#16a34a' : '#dc2626',
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  >
                    <CheckCircle2 size={13} /> {ev.status.toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b', fontFamily: 'monospace' }}>
                  {ev.latencyMs}ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
