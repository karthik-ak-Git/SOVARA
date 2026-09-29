import type { ReactElement } from 'react'

interface Props {
  used: number
  max?: number
  completionTokens?: number
}

/**
 * TokenMeter — Stitch context meter chip (e.g. "12.4k / 200k").
 * Displays prompt tokens and tracks actual completion tokens when available.
 */
export function TokenMeter({ used, max = 8192, completionTokens }: Props): ReactElement | null {
  if (used <= 0 && (!completionTokens || completionTokens <= 0)) return null
  const total = used + (completionTokens ?? 0)
  const title = completionTokens !== undefined && completionTokens > 0
    ? `Prompt: ~${used} tok | Completion: ${completionTokens} tok | Total: ~${total} tok`
    : `Prompt: ~${used} tokens`
  return (
    <div className="stitch-token-meter" title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--bg-soft, #f1f5f9)', color: 'var(--text-subtle, #64748b)' }}>
      <span className="stitch-dot" aria-hidden style={{ color: completionTokens ? '#10b981' : '#c65d3b' }}>
        ●
      </span>
      <span>
        {total.toLocaleString()} / {max.toLocaleString()}
        {completionTokens !== undefined && completionTokens > 0 ? (
          <span style={{ marginLeft: 3, color: '#10b981', fontWeight: 600 }}>
            (+{completionTokens.toLocaleString()})
          </span>
        ) : null}
      </span>
    </div>
  )
}
