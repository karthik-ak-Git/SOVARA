'use client'

import type { ReactNode } from 'react'

interface Props {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({ title, description, action, icon }: Props): React.JSX.Element {
  return (
    <div className="empty" role="status">
      {icon ? <div className="empty-icon" aria-hidden>{icon}</div> : null}
      <div className="empty-title">{title}</div>
      {description ? <div className="empty-desc muted small">{description}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}
