import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
}

/**
 * IconButton — global 32px square-round touchpoint.
 * Stitch spec: muted graphite icon, terracotta on hover/active.
 * Presentational only; no new wiring.
 */
export function IconButton({ label, children, className = '', ...rest }: Props): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`stitch-icon-btn ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  )
}
