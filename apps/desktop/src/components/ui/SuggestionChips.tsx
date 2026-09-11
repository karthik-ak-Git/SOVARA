'use client'

import type { ReactElement } from 'react'

interface Props {
  label?: string
  suggestions: string[]
  onSelect?: (suggestion: string) => void
}

/**
 * SuggestionChips — Stitch "Explore further:" follow-up chips.
 * Presentational; caller decides what selecting a chip does
 * (default: no wiring, chips are disabled unless onSelect provided).
 */
export function SuggestionChips({ label = 'Explore further:', suggestions, onSelect }: Props): ReactElement | null {
  if (suggestions.length === 0) return null
  return (
    <div className="stitch-suggestion-row">
      <span className="stitch-suggestion-label">{label}</span>
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          className="stitch-suggestion-chip"
          onClick={() => onSelect?.(s)}
          disabled={!onSelect}
        >
          {`"${s}"`}
        </button>
      ))}
    </div>
  )
}
