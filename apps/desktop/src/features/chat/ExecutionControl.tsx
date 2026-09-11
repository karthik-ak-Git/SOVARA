'use client'

import type { ReactElement } from 'react'
import { Shield } from 'lucide-react'
import { Badge } from '../../components/ui/Badge'

type ExecMode = 'disabled' | 'ask' | 'policy' | 'automatic'

interface ExecutionControlProps {
  mode: ExecMode | null
  available: boolean
}

const MODE_LABELS: Record<NonNullable<ExecMode>, string> = {
  disabled: 'Disabled',
  ask: 'Ask every time',
  policy: 'Policy controlled',
  automatic: 'Automatic',
}

const MODE_DESCS: Record<NonNullable<ExecMode>, string> = {
  disabled: 'No commands may execute.',
  ask: 'Review each proposed operation.',
  policy: 'Execute only approved operations.',
  automatic: 'Execute within configured policy.',
}

export function ExecutionControl({ mode, available }: ExecutionControlProps): ReactElement {
  if (!available) {
    return (
      <div className="exec-control exec-control--unavailable" role="status">
        <Shield size={14} aria-hidden className="exec-control-icon" />
        <span className="muted small">Coming soon</span>
      </div>
    )
  }

  return (
    <div className="exec-control" role="group" aria-label="Execution control">
      <button
        type="button"
        className="exec-control-btn"
        aria-haspopup="menu"
        aria-expanded={false}
        aria-label={`Execution: ${mode ? MODE_LABELS[mode] : 'Not configured'}`}
        disabled={!mode}
      >
        <Shield size={14} aria-hidden />
        <span className="muted small">{mode ? MODE_LABELS[mode] : 'Configure'}</span>
      </button>

      <div className="exec-control-menu" role="menu" aria-label="Execution modes">
        {(Object.entries(MODE_LABELS) as [ExecMode, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="menuitemradio"
            aria-checked={mode === key}
            className={`exec-mode-item ${mode === key ? 'exec-mode-item--active' : ''}`}
            tabIndex={0}
            onClick={() => {}}
            disabled
            title={MODE_DESCS[key]}
          >
            <span className="exec-mode-label">{label}</span>
            {mode === key ? <Badge variant="success">Active</Badge> : null}
            <span className="muted small exec-mode-desc">{MODE_DESCS[key]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
