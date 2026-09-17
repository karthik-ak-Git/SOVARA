'use client'

import { useEffect, useState, type ReactElement } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  reasoning: string
  streaming?: boolean
  open: boolean
  onToggle: (next: boolean) => void
}

/**
 * ReasoningBlock — Stitch collapsible thinking block.
 * Controlled by caller; renders reasoning text verbatim, no parsing.
 */
export function ReasoningBlock({ reasoning, streaming = false, open, onToggle }: Props & { elapsedSec?: number; count?: number }): ReactElement {
  const count = (arguments[0] as unknown as { count?: number }).count ?? 1
  const propElapsed = (arguments[0] as unknown as { elapsedSec?: number }).elapsedSec
  const [elapsed, setElapsed] = useState(propElapsed ?? 0)
  useEffect(() => {
    if (!streaming) return
    const start = Date.now() - (propElapsed ?? 0) * 1000
    const t = window.setInterval(() => setElapsed(Math.floor((Date.now() - start)/1000)), 1000)
    return () => window.clearInterval(t)
  }, [streaming, propElapsed])
  return (
    <div className="stitch-reasoning" data-testid="message-reasoning">
      <button
        type="button"
        className="stitch-reasoning-toggle"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-label={open ? 'Hide thought' : 'Show thought'}
        style={{ justifyContent: 'space-between' } as React.CSSProperties}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Brain size={14} aria-hidden />
          <span className="stitch-reasoning-label">Thought {count} time(s)</span>
          {streaming ? <span style={{ font: '400 11px/1 Manrope', color: '#C65D3B' }}>{elapsed}s</span> : propElapsed !== undefined ? <span style={{ font: '400 11px/1 Manrope', color: '#8A8279' }}>{propElapsed}s</span> : null}
          {streaming ? <span style={{ font: '400 11px/1 Manrope', color: '#C65D3B' }}>Thinking…</span> : null}
        </span>
        <span className="stitch-reasoning-chevron" aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ font: '400 12px/1 Manrope', color: '#8A8279' }}>{open ? '∨' : '>'}</span>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open ? (
        <div style={{ padding: '6px 12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: '500 11px/1 Manrope', color: '#8A8279', marginBottom: 6 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', border: '1px solid #E8E4DE', display: 'grid', placeItems: 'center', fontSize: 8 }}>○</span>
            Thinking process
          </div>
          <div className={`stitch-reasoning-content${streaming ? ' stitch-reasoning-content--streaming' : ''}`} style={{ borderLeft: '1px solid #f0ede7', marginLeft: 6, borderRadius: 0, background: 'transparent', padding: '4px 0 4px 14px' }}>
            {reasoning}
            {streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
