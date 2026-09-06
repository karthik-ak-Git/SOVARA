import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  as?: 'div' | 'section'
}

export function Card({ children, className = '', as: Tag = 'div' }: Props): React.JSX.Element {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>
}

export function Panel({ children, className = '' }: Props): React.JSX.Element {
  return <div className={`panel ${className}`.trim()}>{children}</div>
}
