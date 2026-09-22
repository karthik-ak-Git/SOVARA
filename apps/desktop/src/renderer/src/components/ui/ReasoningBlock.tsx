'use client'

import { useEffect, useState, type ReactElement } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface Props {
  reasoning: string
  streaming?: boolean
  open: boolean
  onToggle: (next: boolean) => void
  elapsedSec?: number
  count?: number
}

/**
 * ReasoningBlock — Collapsible thinking accordion block matching Antigravity 2.0 / SOVARA design:
 * "Worked for [duration]s >"
 */
export function ReasoningBlock({ reasoning, streaming = false, open, onToggle, elapsedSec = 14, count = 1 }: Props): ReactElement {
  const [elapsed, setElapsed] = useState(elapsedSec)
  useEffect(() => {
    if (!streaming) return
    const start = Date.now() - elapsedSec * 1000
    const t = window.setInterval(() => setElapsed(Math.max(1, Math.floor((Date.now() - start) / 1000))), 1000)
    return () => window.clearInterval(t)
  }, [streaming, elapsedSec])

  const seconds = streaming ? elapsed : (elapsedSec || 14)

  return (
    <div
      className="stitch-reasoning"
      data-testid="message-reasoning"
      style={{
        margin: '6px 0 10px',
        borderRadius: 8,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        className="stitch-reasoning-toggle"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-label={open ? 'Hide thought process' : 'Show thought process'}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '6px 10px',
          background: 'transparent',
          border: 'none',
          color: '#64748b',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span>
          {streaming ? `Thinking... (${seconds}s)` : `Worked for ${seconds}s`}
        </span>
        {open ? <ChevronDown size={14} style={{ color: '#94a3b8' }} /> : <ChevronRight size={14} style={{ color: '#94a3b8' }} />}
      </button>
      {open ? (
        <div style={{ padding: '8px 12px 10px', borderTop: '1px solid #e2e8f0', background: '#ffffff' }}>
          <div
            className={`stitch-reasoning-content${streaming ? ' stitch-reasoning-content--streaming' : ''}`}
            style={{
              color: '#334155',
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            }}
          >
            {reasoning}
            {streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
