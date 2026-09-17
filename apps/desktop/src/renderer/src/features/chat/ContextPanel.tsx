'use client'

import { useEffect, useState } from 'react'
import { FileText, X, Check } from 'lucide-react'
import type { AgentExecutionState } from './useChatSession'

interface ContextPanelProps {
  sessionTitle?: string
  projectName?: string | null
  modelName?: string
  modelStatus?: string
  branch?: string
  onClose?: () => void
  execution?: AgentExecutionState
  streamingReasoning?: string
  busy?: boolean
}

function InfoRow({ label, value, good }: { label: string; value: string; good?: boolean }): React.JSX.Element {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong className={good ? 'good' : ''}>{value}</strong>
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

const STAGES = ['Reading','Planning','Prompting','Routing','Loading','Thinking','Generating','Tool','File'] as const

export function ContextPanel({
  sessionTitle = 'Untitled',
  projectName,
  modelName = 'No Model',
  modelStatus = 'Offline',
  branch = 'main',
  onClose,
  execution,
  streamingReasoning = '',
  busy = false,
}: ContextPanelProps): React.JSX.Element {
  const phase = execution?.phase ?? 'idle'
  const showProgress = phase !== 'idle'
  const isBusy = busy && phase !== 'done' && phase !== 'error'
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!isBusy) return
    const start = Date.now() - elapsed*1000
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - start)/1000)), 1000)
    return () => window.clearInterval(t)
  }, [isBusy, phase])
  const activeIdx = (() => {
    const order = ['reading','planning','prompting','selecting','loading','thinking','streaming','tool','artifact']
    if (phase === 'ready') return 5
    const i = order.indexOf(phase)
    return i
  })()
  const thinkingLabel = (() => {
    if (phase === 'planning') return 'Prioritizing...'
    if (phase === 'thinking') return 'Thinking...'
    if (phase === 'loading') return 'Loading model...'
    if (phase === 'streaming') return 'Generating...'
    if (phase === 'tool') return 'Running tool...'
    if (phase === 'artifact') return 'Saving file...'
    if (phase === 'reading') return 'Reading...'
    if (phase === 'selecting') return 'Routing...'
    if (phase === 'prompting') return 'Adjusting course...'
    return null
  })()

  return (
    <aside className="context-panel" aria-label="Session context">
      <div className="context-heading">
        <span>Session context</span>
        <button type="button" className="topbar-icon-btn" onClick={onClose} aria-label="Close context panel" style={{ width: 26, height: 26 } as React.CSSProperties}>
          <X size={15} aria-hidden />
        </button>
      </div>

      {showProgress ? (
        <>
          {isBusy ? (
            <>
              <div className="context-processing">
                <span>Processing {elapsed}s</span>
                <span style={{ flex: 1 }} />
                <span className="sovara-stage-dot" style={{ background: '#C65D3B', animation: 'pulse 1s infinite' } as React.CSSProperties} />
              </div>
              <div style={{ height: 1, background: '#f0ede7', margin: '6px 0 10px' }} />
              {thinkingLabel ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, background: '#e8f6ff', color: '#3b82f6', font: '500 11px/1 Manrope', width: 'fit-content', marginBottom: 10 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 6, background: '#60a5fa', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 9 }}>◧</span>
                  {thinkingLabel}
                </div>
              ) : null}
            </>
          ) : null}
          <div className="context-progress">
            <div className="context-progress-title">
              <span>Progress</span>
              <span style={{ color: '#8A8279', fontWeight: 400 }}>{activeIdx >=0 ? `${activeIdx+1}/${STAGES.length}` : ''} ▾</span>
            </div>
            {STAGES.map((label, i) => {
              const done = activeIdx > i
              const active = activeIdx === i
              return (
                <div key={label} className={`context-todo ${done ? 'done' : ''} ${active ? 'active' : ''}`}>
                  <span className="context-todo-num">{done ? <Check size={10} /> : i+1}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label === 'Reading' ? 'Chat reactive SSE: stream tokens i...' : label === 'Generating' ? 'Reasoning display: surface thinkin...' : label === 'Tool' ? 'Skills & Agents: fix broken deploy...' : label === 'File' ? 'Typecheck + tests: verify all chang...' : label}</span>
                </div>
              )
            })}
          </div>
          {streamingReasoning ? (
            <div style={{ marginBottom: 12 }}>
              <details open style={{ border: '1px solid #E8E4DE', borderRadius: 8, padding: '8px 10px', background: '#fff' }}>
                <summary style={{ font: '600 11px/1 Manrope', color: '#8A8279', cursor: 'pointer' }}>Thought 1 time(s) ▾</summary>
                <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: '1px solid #f0ede7' }}>
                  <div style={{ font: '600 11px/1 Manrope', color: '#8A8279', marginBottom: 6 }}>◎ Thinking process</div>
                  <div className="context-thinking">{streamingReasoning.slice(0, 600)}</div>
                </div>
              </details>
            </div>
          ) : null}
        </>
      ) : null}

      <ContextSection title="SESSION">
        <InfoRow label="Name" value={sessionTitle} />
        <InfoRow label="Updated" value="Just now" />
      </ContextSection>
      <ContextSection title="WORKSPACE">
        <InfoRow label="Project" value={projectName ?? '—'} />
        <InfoRow label="Branch" value={branch} />
      </ContextSection>
      <ContextSection title="MODEL">
        <InfoRow label="Model" value={modelName} />
        <InfoRow label="Status" value={modelStatus} good={modelStatus === 'Ready'} />
      </ContextSection>
      <ContextSection title="FILES">
        <div className="context-empty">
          <FileText size={15} aria-hidden />
          No files attached
        </div>
      </ContextSection>
      <ContextSection title="RUNTIME">
        <InfoRow label="GPU" value="Detecting..." />
        <InfoRow label="VRAM" value="—" />
      </ContextSection>
    </aside>
  )
}
