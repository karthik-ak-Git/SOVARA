import type { ReactElement } from 'react'
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
export function ReasoningBlock({ reasoning, streaming = false, open, onToggle }: Props): ReactElement {
  return (
    <div className="stitch-reasoning" data-testid="message-reasoning">
      <button
        type="button"
        className="stitch-reasoning-toggle"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-label={open ? 'Hide reasoning' : 'Show reasoning'}
      >
        <Brain size={14} aria-hidden />
        <span className="stitch-reasoning-label">{streaming ? 'Thinking…' : 'Reasoning Process'}</span>
        <span className="stitch-reasoning-chevron" aria-hidden>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {open ? (
        <div className={`stitch-reasoning-content${streaming ? ' stitch-reasoning-content--streaming' : ''}`}>
          {reasoning}
          {streaming ? <span className="stream-caret" aria-hidden="true" /> : null}
        </div>
      ) : null}
    </div>
  )
}
