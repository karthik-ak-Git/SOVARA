import type { ReactElement } from 'react'

interface Props {
  used: number
  max?: number
}

/**
 * TokenMeter — Stitch context meter chip (e.g. "12.4k / 200k").
 * Caller computes `used`; no tokenizer wiring inside.
 */
export function TokenMeter({ used, max = 8192 }: Props): ReactElement | null {
  if (used <= 0) return null
  return (
    <div className="stitch-token-meter" title={`Prompt: ~${used} tokens`}>
      <span className="stitch-dot" aria-hidden>
        ●
      </span>
      <span>
        {used} / {max}
      </span>
    </div>
  )
}
