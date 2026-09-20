'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, X, Cpu, Zap, Activity } from 'lucide-react'
import { getSystemResources, listInstances, type SystemResourcesView } from '@/lib/client/api'
import type { ModelInstance } from '@shared/types/ports'
import type { AgentExecutionState } from './useChatSession'
import type { SessionEventView } from '@/lib/client/api'

interface ContextPanelProps {
  sessionTitle?: string
  projectName?: string | null
  modelName?: string
  modelStatus?: string
  branch?: string
  onClose?: () => void
  execution?: AgentExecutionState | null
  streamingText?: string
  streamingReasoning?: string
  events?: SessionEventView[]
  /** Optional externally-polled resources (App passes workbench.resources). When absent panel polls itself. */
  resources?: SystemResourcesView | null
}

function InfoRow({ label, value, good, mono }: { label: string; value: string; good?: boolean; mono?: boolean }): React.JSX.Element {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong className={good ? 'good' : ''} style={mono ? { fontFamily: 'DM Mono, monospace', fontSize: 10 } : undefined}>{value}</strong>
    </div>
  )
}

function Bar({ pct, color }: { pct: number; color?: string }): React.JSX.Element {
  const p = Math.max(0, Math.min(100, pct))
  const c = color ?? (p > 90 ? '#d94f2b' : p > 70 ? '#bd653e' : '#5c9b71')
  return (
    <div style={{ height: 4, borderRadius: 999, background: '#ebe7e1', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ width: `${p}%`, height: '100%', background: c, transition: 'width 600ms ease' }} />
    </div>
  )
}

function ContextSection({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="context-section">
      <div className="section-label" style={{ paddingLeft: 0, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

export function ContextPanel({
  sessionTitle = 'Untitled',
  projectName,
  modelName = 'No Model',
  modelStatus = 'Offline',
  branch = 'main',
  onClose,
  execution,
  streamingText = '',
  streamingReasoning = '',
  events = [],
  resources: propResources,
}: ContextPanelProps): React.JSX.Element {
  const [live, setLive] = useState<SystemResourcesView | null>(propResources ?? null)
  const [instances, setInstances] = useState<ModelInstance[]>([])
  const isStreaming = execution ? ['streaming', 'thinking', 'loading', 'tool', 'artifact'].includes(execution.phase) : false

  // Adopt external prop when App provides it
  useEffect(() => { if (propResources) setLive(propResources) }, [propResources])

  // Self-poll when no external prop, plus always refresh instances (1s while generating, 4s idle)
  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const [res, inst] = await Promise.all([
          propResources ? Promise.resolve(null as SystemResourcesView | null) : getSystemResources().catch(() => null),
          listInstances().catch(() => [] as ModelInstance[]),
        ])
        if (cancelled) return
        if (res) setLive(res)
        setInstances(inst as ModelInstance[])
      } catch { /* telemetry is best-effort */ }
    }
    void tick()
    const ms = isStreaming ? 1000 : 4000
    const id = setInterval(tick, ms)
    return () => { cancelled = true; clearInterval(id) }
  }, [propResources, isStreaming])

  // Derive system-level numbers (prefer live, fallback to instances)
  const gpu = live?.gpu
  const vramTotal = live?.vram.totalMB ?? (live as unknown as { vram?: { totalMB: number } })?.vram?.totalMB
  const vramFree = live?.vram.freeMB
  const vramUsedByModels = live?.vram.usedByModelsMB ?? live?.models.totalVramUsedMB
  // Fallback when nvidia-smi free unreadable: estimate from instances sum
  const vramUsed = vramUsedByModels ?? (instances.reduce((s, i) => s + (i.metrics?.vramUsedMB ?? i.observedVramMB ?? i.estimatedVramMB ?? 0), 0) || undefined)
  const vramPct = vramTotal && vramUsed !== undefined ? Math.round((vramUsed / vramTotal) * 100) : undefined
  const gpuUtil = (gpu as unknown as { utilization?: number })?.utilization ?? instances[0]?.metrics?.gpuUtilization
  const activeInst = instances.find((i) => i.state === 'BUSY_DECODE' || i.status === 'generating') ?? instances.find((i) => i.state === 'ACTIVE' || i.status === 'loaded') ?? instances[0]
  const ctxLen = activeInst?.ctxLen ?? activeInst?.configuration?.ctxLen ?? 4096

  // Token accounting — chars/4 estimate aligns with backend estimateTokens
  const eventChars = useMemo(() => events.reduce((n, e) => {
    const c = (e.data as { content?: string })?.content ?? ''
    return n + (typeof c === 'string' ? c.length : 0)
  }, 0), [events])
  const streamingChars = streamingText.length + streamingReasoning.length
  const totalChars = eventChars + streamingChars
  const usedTokens = Math.ceil(totalChars / 4)
  const streamingTokens = Math.ceil(streamingChars / 4) || (streamingText ? Math.ceil(streamingText.length / 4) : 0)
  const ctxPct = Math.min(100, Math.round((usedTokens / ctxLen) * 100))
  const tokPerSecLive = activeInst?.metrics?.tokensPerSec
  // Local tok/s estimate when backend hasn't reported yet (first ~2s)
  const startRef = useRef<number | null>(null)
  const [localTps, setLocalTps] = useState<number | null>(null)
  useEffect(() => {
    if (isStreaming) {
      if (startRef.current === null) startRef.current = Date.now()
      const id = setInterval(() => {
        if (startRef.current === null || streamingTokens === 0) return
        const secs = Math.max(0.6, (Date.now() - startRef.current) / 1000)
        setLocalTps(Math.round((streamingTokens / secs) * 10) / 10)
      }, 700)
      return () => clearInterval(id)
    }
    startRef.current = null
    setLocalTps(null)
  }, [isStreaming, streamingTokens])
  const tps = (tokPerSecLive && tokPerSecLive > 0 ? tokPerSecLive : localTps) ?? undefined

  const ramTotal = live?.ram.totalMB
  const ramFree = live?.ram.freeMB
  const ramUsed = ramTotal !== undefined && ramFree !== undefined ? ramTotal - ramFree : undefined
  const ramPct = ramTotal && ramUsed !== undefined ? Math.round((ramUsed / ramTotal) * 100) : undefined

  const statusLabel = (() => {
    if (!execution || execution.phase === 'idle') return modelStatus
    if (execution.phase === 'loading') return 'Loading…'
    if (execution.phase === 'thinking') return 'Thinking…'
    if (execution.phase === 'streaming') return tps ? `Generating · ${tps} tok/s` : 'Generating…'
    if (execution.phase === 'tool') return `Tool: ${execution.toolName ?? 'running'}`
    if (execution.phase === 'artifact') return 'Writing artifact…'
    return execution.phase
  })()
  const isReady = modelStatus === 'Ready' && (!execution || execution.phase === 'idle' || execution.phase === 'done')

  // Dynamic file detection from session events (attached files + tool results)
  const sessionFiles = useMemo(() => {
    const map = new Map<string, { name: string; kind: string }>()
    for (const e of events) {
      if (e.type === 'attachment/added') {
        const files = (e.data as { files?: Array<{ name: string; kind?: string }> })?.files
        if (Array.isArray(files)) {
          for (const f of files) {
            if (f?.name) map.set(f.name, { name: f.name, kind: f.kind ?? 'attachment' })
          }
        }
      } else if (e.type === 'tool/result') {
        const raw = typeof e.data === 'string' ? e.data : (e.data as { content?: string })?.content ?? ''
        // Ensure we only match files that were modified, written, patched, or created (e.g. fs_write ok: true)
        // avoid matching `"path":"..."` inside `fs_list` outputs!
        const matches = raw.matchAll(/(?:written to\s+|created\s+|"ok"\s*:\s*true\s*,\s*"path"\s*:\s*["'])([^"'\r\n,}]+\.[a-z0-9]+)/gi)
        for (const m of matches) {
          if (m[1]) {
            const fname = m[1].split(/[/\\]/).pop() ?? m[1]
            if (fname.length > 2 && !map.has(fname)) {
              map.set(fname, { name: fname, kind: 'workspace' })
            }
          }
        }
      }
    }
    return Array.from(map.values())
  }, [events])

  const subagents = useMemo(() => {
    return events.filter(e => {
      if (e.type !== 'tool/call') return false
      const toolName = (e.data as any)?.name || (e.data as any)?.toolName || (e.data as any)?.toolCall?.name
      return toolName === 'invoke_subagent' || toolName === 'define_subagent'
    })
  }, [events])

  const artifacts = useMemo(() => {
    return events.filter(e => e.type === 'artifact/created')
  }, [events])

  const bgTasks = useMemo(() => {
    return events.filter(e => {
      if (e.type !== 'tool/call') return false
      const toolName = (e.data as any)?.name || (e.data as any)?.toolName || (e.data as any)?.toolCall?.name
      const argsStr = JSON.stringify((e.data as any)?.args || {})
      return (toolName === 'run_command' || toolName === 'exec_shell_command') && (argsStr.includes('"IsDaemon":true') || argsStr.includes('"isDaemon":true'))
    })
  }, [events])

  const terminals = useMemo(() => {
    return events.filter(e => {
      if (e.type !== 'tool/call') return false
      const toolName = (e.data as any)?.name || (e.data as any)?.toolName || (e.data as any)?.toolCall?.name
      const argsStr = JSON.stringify((e.data as any)?.args || {})
      return (toolName === 'run_command' || toolName === 'exec_shell_command') && !argsStr.includes('"IsDaemon":true') && !argsStr.includes('"isDaemon":true')
    })
  }, [events])

  return (
    <aside className="context-panel" aria-label="Session context">
      <div className="context-heading">
        <span>Session context</span>
        <button type="button" className="topbar-icon-btn" onClick={onClose} aria-label="Close context panel" style={{ width: 26, height: 26 } as React.CSSProperties}>
          <X size={15} aria-hidden />
        </button>
      </div>

      <ContextSection title="SESSION">
        <InfoRow label="Name" value={sessionTitle} />
        <InfoRow label="Updated" value="Just now" />
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9a9288' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Activity size={10} /> Context</span>
            <span style={{ fontFamily: 'DM Mono, monospace' }}>{usedTokens.toLocaleString()} / {ctxLen.toLocaleString()} tok · {ctxPct}%</span>
          </div>
          <Bar pct={ctxPct} />
          <div style={{ fontSize: 10, color: '#b0a89e', marginTop: 4, fontFamily: 'DM Mono, monospace' }}>
            {isStreaming ? `${streamingTokens} tok streaming${tps ? ` · ${tps} tok/s` : ''}` : `${events.length} events · ~${usedTokens} tok`}
          </div>
        </div>
      </ContextSection>

      {/* Harness-style whole-list todos — last todo/write wins, shown in Session context, referred every turn */}
      {(() => {
        const lastWrite = [...events].reverse().find(e => e.type === 'todo/write')
        const todos = (lastWrite?.data as { todos?: Array<{ content: string; status: string }> })?.todos
        if (!todos || todos.length === 0) return null
        return (
          <ContextSection title={`TODO · ${todos.filter(t=>t.status==='completed').length}/${todos.length}`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {todos.map((t, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11, lineHeight: 1.4, padding: '6px 8px', borderRadius: 7, background: t.status==='completed' ? '#f0f7f0' : t.status==='in_progress' ? '#fff4e6' : '#fff', border: `1px solid ${t.status==='completed' ? '#d6e8d6' : t.status==='in_progress' ? '#f0d9a8' : '#e7e3dc'}` }}>
                  <span style={{ flexShrink: 0, marginTop: 1 }}>{t.status==='completed' ? '✓' : t.status==='in_progress' ? '●' : '○'}</span>
                  <span style={{ color: t.status==='completed' ? '#6b705c' : '#2c2825', textDecoration: t.status==='completed' ? 'line-through' : 'none' }}>{t.content}</span>
                  <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 9, fontFamily: 'DM Mono, monospace', color: t.status==='in_progress' ? '#b7792b' : '#9a9288' }}>{t.status}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 9, color: '#b0a89e', marginTop: 6, fontFamily: 'DM Mono, monospace' }}>todo_write last-write-wins · {todos.filter(t=>t.status==='in_progress').length} in progress</div>
          </ContextSection>
        )
      })()}

      <ContextSection title="WORKSPACE">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <details style={{ background: '#fff', borderRadius: 6, border: '1px solid #e7e3dc' }}>
            <summary style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 8px', cursor: 'pointer', listStyle: 'none' }}>
              <span>Files Changed</span>
              <span style={{ fontSize: 10, color: '#9a9288', fontFamily: 'DM Mono, monospace' }}>{sessionFiles.filter(f => f.kind === 'workspace').length}</span>
            </summary>
            {sessionFiles.filter(f => f.kind === 'workspace').length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px 8px 8px' }}>
                {sessionFiles.filter(f => f.kind === 'workspace').map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '4px', background: '#faf9f8', borderRadius: 4 }}>
                    <FileText size={11} style={{ color: '#7e766d', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#2c2825', flex: 1 }} title={f.name}>{f.name}</span>
                  </div>
                ))}
              </div>
            )}
          </details>

          <details style={{ background: '#fff', borderRadius: 6, border: '1px solid #e7e3dc' }}>
            <summary style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 8px', cursor: 'pointer', listStyle: 'none' }}>
              <span>Subagents</span>
              <span style={{ fontSize: 10, color: '#9a9288', fontFamily: 'DM Mono, monospace' }}>{subagents.length}</span>
            </summary>
            {subagents.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px 8px 8px' }}>
                {subagents.map((s, i) => {
                  const data: any = s.data || {}
                  const name = data.name || data.role || data.type || 'Subagent'
                  return <div key={i} style={{ fontSize: 10, padding: '4px', background: '#faf9f8', borderRadius: 4, color: '#2c2825' }}>{name}</div>
                })}
              </div>
            )}
          </details>

          <details style={{ background: '#fff', borderRadius: 6, border: '1px solid #e7e3dc' }}>
            <summary style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 8px', cursor: 'pointer', listStyle: 'none' }}>
              <span>Artifacts</span>
              <span style={{ fontSize: 10, color: '#9a9288', fontFamily: 'DM Mono, monospace' }}>{artifacts.length}</span>
            </summary>
            {artifacts.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px 8px 8px' }}>
                {artifacts.map((a, i) => {
                  const data: any = a.data || {}
                  const name = data.name || data.path?.split(/[/\\]/).pop() || 'Artifact'
                  return <div key={i} style={{ fontSize: 10, padding: '4px', background: '#faf9f8', borderRadius: 4, color: '#2c2825' }}>{name}</div>
                })}
              </div>
            )}
          </details>

          <details style={{ background: '#fff', borderRadius: 6, border: '1px solid #e7e3dc' }}>
            <summary style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 8px', cursor: 'pointer', listStyle: 'none' }}>
              <span>Uploads</span>
              <span style={{ fontSize: 10, color: '#9a9288', fontFamily: 'DM Mono, monospace' }}>{sessionFiles.filter(f => f.kind === 'attachment').length}</span>
            </summary>
            {sessionFiles.filter(f => f.kind === 'attachment').length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '0 8px 8px 8px' }}>
                {sessionFiles.filter(f => f.kind === 'attachment').map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '4px', background: '#faf9f8', borderRadius: 4 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#2c2825', flex: 1 }} title={f.name}>{f.name}</span>
                  </div>
                ))}
              </div>
            )}
          </details>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: '#fff', border: '1px solid #e7e3dc' }}>
            <span>Background Tasks</span>
            <span style={{ fontSize: 10, color: '#9a9288', fontFamily: 'DM Mono, monospace' }}>{bgTasks.length}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '4px 8px', borderRadius: 6, background: '#fff', border: '1px solid #e7e3dc' }}>
            <span>Terminals</span>
            <span style={{ fontSize: 10, color: '#9a9288', fontFamily: 'DM Mono, monospace' }}>{terminals.length}</span>
          </div>
        </div>
      </ContextSection>

      <ContextSection title="MODEL">
        <InfoRow label="Model" value={modelName} mono />
        <InfoRow label="Status" value={statusLabel} good={isReady} />
        {activeInst ? (
          <div style={{ marginTop: 8, padding: '8px 8px', borderRadius: 7, background: '#fff', border: '1px solid #e7e3dc' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#7e766d' }}>
              <span>{activeInst.modelId}</span>
              <span style={{ fontFamily: 'DM Mono, monospace' }}>{activeInst.state ?? activeInst.status}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10, color: '#9a9288', flexWrap: 'wrap' }}>
              {activeInst.ctxLen ? <span>ctx {activeInst.ctxLen}</span> : null}
              {typeof activeInst.offloadedLayers === 'number' ? <span>{activeInst.partialOffload ? `${activeInst.offloadedLayers} layers (partial)` : `${activeInst.offloadedLayers} layers`}</span> : null}
              {activeInst.loadTimeMs ? <span>{(activeInst.loadTimeMs / 1000).toFixed(1)}s load</span> : null}
              {activeInst.ttftMs ? <span>TTFT {activeInst.ttftMs}ms</span> : null}
            </div>
            {activeInst.metrics?.vramUsedMB !== undefined || activeInst.estimatedVramMB !== undefined ? (
              <div style={{ fontSize: 10, color: '#9a9288', marginTop: 4, fontFamily: 'DM Mono, monospace' }}>
                VRAM {Math.round((activeInst.metrics?.vramUsedMB ?? activeInst.estimatedVramMB ?? 0))} MB
                {activeInst.vramEstimated || activeInst.metrics?.vramEstimated ? ' (est.)' : ' (obs.)'}
                {tps ? ` · ${tps} tok/s` : ''}
              </div>
            ) : null}
          </div>
        ) : null}
      </ContextSection>

      <ContextSection title="RUNTIME">
        {/* GPU */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', fontSize: 11 }}>
          <span style={{ color: '#b0a89e', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Cpu size={11} /> GPU</span>
          <strong style={{ fontSize: 11, color: '#4b4640', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={gpu?.name ?? undefined}>
            {gpu?.available && gpu?.name ? gpu.name : gpu?.available ? 'GPU detected' : 'CPU mode'}
          </strong>
        </div>
        {gpu?.available && gpuUtil !== undefined ? (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9a9288' }}>
              <span>GPU load</span>
              <span style={{ fontFamily: 'DM Mono, monospace' }}>{Math.round(gpuUtil)}%</span>
            </div>
            <Bar pct={gpuUtil} />
          </div>
        ) : gpu?.available ? (
          <div style={{ fontSize: 10, color: '#b0a89e', marginBottom: 10, fontFamily: 'DM Mono, monospace' }}>GPU load — n/a</div>
        ) : null}

        {/* VRAM */}
        {vramTotal !== undefined ? (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9a9288' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Zap size={10} /> VRAM</span>
              <span style={{ fontFamily: 'DM Mono, monospace' }}>
                {vramUsed !== undefined ? `${Math.round(vramUsed).toLocaleString()} / ${Math.round(vramTotal).toLocaleString()} MB` : `${Math.round(vramTotal).toLocaleString()} MB total`}
                {vramPct !== undefined ? ` · ${vramPct}%` : ''}
              </span>
            </div>
            {vramPct !== undefined ? <Bar pct={vramPct} /> : null}
            {vramFree !== undefined ? (
              <div style={{ fontSize: 10, color: '#b0a89e', marginTop: 3, fontFamily: 'DM Mono, monospace' }}>{Math.round(vramFree).toLocaleString()} MB free · {gpu?.available ? 'GPU' : 'system'}</div>
            ) : null}
          </div>
        ) : (
          <InfoRow label="VRAM" value={instances.length > 0 && vramUsed !== undefined ? `${Math.round(vramUsed)} MB (est.)` : '—'} mono />
        )}

        {/* RAM */}
        {ramTotal !== undefined ? (
          <div style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#9a9288' }}>
              <span>RAM</span>
              <span style={{ fontFamily: 'DM Mono, monospace' }}>{ramUsed !== undefined ? `${Math.round(ramUsed).toLocaleString()} / ${Math.round(ramTotal).toLocaleString()} MB` : `${Math.round(ramTotal).toLocaleString()} MB`} {ramPct !== undefined ? `· ${ramPct}%` : ''}</span>
            </div>
            {ramPct !== undefined ? <Bar pct={ramPct} color={ramPct > 88 ? '#d94f2b' : '#8aa0a8'} /> : null}
          </div>
        ) : null}
        {live?.cpu ? (
          <div style={{ fontSize: 10, color: '#b0a89e', fontFamily: 'DM Mono, monospace' }}>{live.cpu.logicalCores} cores · load {live.cpu.loadAvg1.toFixed(2)}</div>
        ) : null}
        {!gpu?.available && !vramTotal ? (
          <div style={{ fontSize: 10, color: '#9a9288', marginTop: 8, lineHeight: 1.5 }}>
            No dedicated GPU — VRAM shows estimates only. GPU load appears only when <code style={{ fontFamily: 'DM Mono, monospace' }}>nvidia-smi</code> is available.
          </div>
        ) : null}
      </ContextSection>
    </aside>
  )
}
