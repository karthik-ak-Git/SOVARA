import type { ReactNode, ReactElement } from 'react'

export function ThinkingIndicator(): ReactElement {
  return (
    <div
      className="bubble assistant-bubble bubble--thinking"
      aria-live="polite"
      aria-label="Assistant is thinking"
    >
      <div className="pill" aria-hidden>{'◆'}</div>
      <svg
        className="thinking-svg"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth={2}>
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="2s"
            repeatCount="indefinite"
          />
        </circle>
      </svg>
    </div>
  )
}