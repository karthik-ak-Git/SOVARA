'use client'

import type { ReactElement } from 'react'
import type { ChatStatus } from '../types'

interface GenerationStatusProps {
  status: ChatStatus
  modelName?: string | null
}

/**
 * GenerationStatus — restrained indicator per spec §11/§21.
 * No giant spinners; calm, dense, professional.
 */
export function GenerationStatus({ status, modelName }: GenerationStatusProps): ReactElement | null {
  if (status === 'idle') return null
  const labels: Record<ChatStatus, string> = {
    idle: '',
    sending: 'Sending…',
    streaming: modelName ? `Generating with ${modelName}…` : 'Generating…',
    cancelling: 'Stopping…',
    error: 'Error',
  }
  return (
    <div className="generation-status" role="status" aria-live="polite" aria-label={labels[status]}>
      <span className="generation-status-dot" aria-hidden>●</span>
      <span className="muted small">{labels[status]}</span>
    </div>
  )
}
