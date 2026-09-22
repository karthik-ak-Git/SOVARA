'use client'

import { useEffect, useState, type ReactElement } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  reasoning: string
  streaming?: boolean
  open: boolean
  onToggle: (next: boolean) => void
  elapsedSec?: number
  count?: number
}

/**
 * ReasoningBlock — Collapsible thinking accordion block.
 * Violet glass backdrop with live duration counter.
 */
export function ReasoningBlock({ reasoning, streaming = false, open, onToggle, elapsedSec, count = 1 }: Props): ReactElement {
  const [elapsed, setElapsed] = useState(elapsedSec ?? 0)
  useEffect(() => {
    if (!streaming) return
    const start = Date.now() - (elapsedSec ?? 0) * 1000
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - start)/1000)), 1000)
    return () => window.clearInterval(t)
  }, [streaming, elapsedSec])

  const seconds = streaming ? elapsed : (elapsedSec ?? elapsed)

  return (
    <div className="stitch-reasoning" data-testid="message-reasoning" style={{ border: '1px solid rgba(129, 140, 248, 0.25)', borderRadius: 10, background: 'rgba(30, 27, 75, 0.35)', margin: '8px 0', overflow: 'hidden' }}>
      <button
        type="button"
        className="stitch-reasoning-toggle"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-label={open ? 'Hide thought' : 'Show thought'}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: 'var(--text)', cursor: 'pointer' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={14} style={{ color: 'var(--accent-violet, #818cf8)' }} aria-hidden />
          <span className="stitch-reasoning-label" style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)' }}>
            {streaming ? 'Thinking process…' : `Thought process (${count})`}
          </span>
          {seconds > 0 ? (
            <span style={{ fontSize: 11, color: 'var(--accent-violet, #818cf8)', background: 'rgba(129, 140, 248, 0.15)', padding: '2px 6px', borderRadius: 4 }}>
              {seconds}s
            </span>
          ) : null}
        </span>
        <span className="stitch-reasoning-chevron" aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)' }}>
          <span style={{ fontSize: 11 }}>{open ? 'Hide' : 'Show'}</span>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open ? (
        <div style={{ padding: '6px 12px 10px', borderTop: '1px solid rgba(129, 140, 248, 0.15)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-violet, #818cf8)' }} />
            Internal Reasoning Trace
          </div>
          <div className={`stitch-reasoning-content${streaming ? ' stitch-reasoning-content--streaming' : ''}`} style={{ borderLeft: '2px solid rgba(129, 140, 248, 0.3)', marginLeft: 3, paddingLeft: 12, color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {reasoning}
            {streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

