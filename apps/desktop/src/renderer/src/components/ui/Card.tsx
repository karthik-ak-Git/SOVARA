import type { ReactNode, CSSProperties } from 'react'

interface Props {
  children: ReactNode
  className?: string
  as?: 'div' | 'section'
  style?: CSSProperties
}

export function Card({ children, className = '', as: Tag = 'div', style }: Props): React.JSX.Element {
  return <Tag className={`card ${className}`.trim()} style={style}>{children}</Tag>
}

export function Panel({ children, className = '', style }: Props): React.JSX.Element {
  return <div className={`panel ${className}`.trim()} style={style}>{children}</div>
}

