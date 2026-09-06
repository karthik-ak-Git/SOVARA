import type { ReactNode } from 'react'

type Variant = 'neutral' | 'success' | 'warn' | 'info'

interface Props {
  variant?: Variant
  children: ReactNode
  title?: string
}

export function Badge({ variant = 'neutral', children, title }: Props): React.JSX.Element {
  return (
    <span className={`badge badge--${variant}`} title={title}>
      {children}
    </span>
  )
}

export function StatusPill({ children, title }: { children: ReactNode; title?: string }): React.JSX.Element {
  return (
    <span className="pill" title={title} role="status" aria-live="polite">
      {children}
    </span>
  )
}
