'use client'

import type { ReactElement } from 'react'
import { Brain } from 'lucide-react'

interface Props {
  enabled: boolean
  onToggle: (next: boolean) => void
}

/**
 * ThinkingPill — Stitch "Extended Thinking" segmented pill.
 * Toggles reasoningEnabled only; reasoning stream rendering is handled
 * by ReasoningBlock in MessageBubble.
 */
export function ThinkingPill({ enabled, onToggle }: Props): ReactElement {
  return (
    <button
      type="button"
      className={`stitch-thinking-pill${enabled ? ' active' : ''}`}
      onClick={() => onToggle(!enabled)}
      aria-pressed={enabled}
      aria-label={`Extended Thinking: ${enabled ? 'enabled' : 'disabled'}`}
      title="Toggle Extended Thinking (Chain-of-thought reasoning)"
    >
      <Brain size={13} aria-hidden />
      <span>Extended Thinking</span>
      <span className={`stitch-dot${enabled ? ' active' : ''}`} aria-hidden>
        ●
      </span>
    </button>
  )
}
