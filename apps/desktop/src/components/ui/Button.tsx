'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'default' | 'primary' | 'ghost'
type Size = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

export function Button({ variant = 'default', size = 'md', className = '', children, ...rest }: Props): React.JSX.Element {
  const v = variant === 'primary' ? 'btn primary' : variant === 'ghost' ? 'btn ghost' : 'btn'
  const s = size === 'sm' ? 'btn-sm' : ''
  return (
    <button className={`${v} ${s} ${className}`.trim()} {...rest}>
      {children}
    </button>
  )
}
