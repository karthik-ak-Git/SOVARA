'use client'

import { useEffect, useState, useRef, type ReactElement } from 'react'
import { ChevronRight, ChevronDown, Sparkles } from 'lucide-react'
import { coalesceFragmentedProse } from '../../utils/proseFormatter'

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
 * "Thought for [duration]s" or "Thinking... ([seconds]s)" with dark/light theme support.
 */
export function ReasoningBlock({
  reasoning,
  streaming = false,
  open,
  onToggle,
  elapsedSec,
  count: _count,
}: Props): ReactElement {
  const [elapsed, setElapsed] = useState<number>(elapsedSec ?? 1)
  const startTimeRef = useRef<number>(Date.now())

  useEffect(() => {
    if (!streaming) return
    startTimeRef.current = Date.now() - (elapsedSec ? elapsedSec * 1000 : 0)
    const t = window.setInterval(() => {
      setElapsed(Math.max(1, Math.floor((Date.now() - startTimeRef.current) / 1000)))
    }, 1000)
    return () => window.clearInterval(t)
  }, [streaming, elapsedSec])

  // If elapsedSec is explicitly passed, use it. Otherwise use tracked elapsed if streaming, or estimate.
  const displaySec = streaming
    ? elapsed
    : (elapsedSec !== undefined ? elapsedSec : (elapsed > 1 ? elapsed : Math.max(2, Math.round(reasoning.length / 120))))

  const label = streaming
    ? `Thinking... (${displaySec}s)`
    : displaySec > 0
      ? `Thought for ${displaySec}s`
      : 'Thought process'

  return (
    <div
      className="stitch-reasoning rounded-lg overflow-hidden my-2 border transition-colors border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/70 dark:bg-zinc-900/50"
      data-testid="message-reasoning"
      style={{
        borderRadius: 8,
        border: '1px solid var(--stitch-border, rgba(228, 228, 231, 0.6))',
      }}
    >
      <button
        type="button"
        className="stitch-reasoning-toggle w-full flex items-center justify-between px-3 py-1.5 text-left transition-colors hover:bg-zinc-100/50 dark:hover:bg-zinc-800/40"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-label={open ? 'Hide thought process' : 'Show thought process'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '6px 12px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {streaming ? (
            <Sparkles size={13} className="text-amber-500 animate-pulse" style={{ color: 'var(--stitch-primary, #D97757)' }} />
          ) : (
            <Sparkles size={13} style={{ color: '#8A8279', opacity: 0.8 }} />
          )}
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: streaming ? 'var(--stitch-primary, #D97757)' : '#71717A',
            }}
          >
            {label}
          </span>
        </div>
        {open ? (
          <ChevronDown size={14} style={{ color: '#A1A1AA' }} />
        ) : (
          <ChevronRight size={14} style={{ color: '#A1A1AA' }} />
        )}
      </button>

      {open ? (
        <div
          className="border-t border-zinc-200 dark:border-zinc-800/80 p-3 bg-white dark:bg-zinc-950/60"
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--stitch-border, rgba(228, 228, 231, 0.6))',
          }}
        >
          <div
            className={`stitch-reasoning-content${streaming ? ' stitch-reasoning-content--streaming' : ''}`}
            style={{
              color: 'var(--stitch-text-muted, #52525B)',
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            }}
          >
            {coalesceFragmentedProse(reasoning)}
            {streaming ? (
              <span
                className="sv-stream-caret inline-block w-1.5 h-3.5 ml-1 align-middle animate-pulse"
                style={{ background: 'var(--stitch-primary, #D97757)' }}
                aria-hidden="true"
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
