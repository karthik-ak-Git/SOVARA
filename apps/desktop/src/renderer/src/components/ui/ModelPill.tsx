import type { ReactElement } from 'react'
import { Sparkles, ChevronDown } from 'lucide-react'

interface Props {
  displayName: string
  available: boolean
  contextLabel?: string
  expanded?: boolean
  onToggle: () => void
}

/**
 * ModelPill — presentational Stitch model selector pill.
 * Data source stays local-only (discoveredModels/activeModel).
 * Dropdown logic lives in the caller (ChatView); this renders the trigger only.
 */
export function ModelPill({
  displayName,
  available,
  contextLabel = 'Local GPU',
  expanded = false,
  onToggle,
}: Props): ReactElement {
  return (
    <button
      type="button"
      className="stitch-model-pill"
      onClick={onToggle}
      aria-label={`Selected model: ${displayName}. Click to change model.`}
      aria-expanded={expanded}
    >
      <span className="stitch-model-pill-icon" aria-hidden>
        <Sparkles size={13} />
      </span>
      <span className="stitch-model-pill-name">{displayName}</span>
      {available ? (
        <span className="stitch-model-pill-tag">Ready</span>
      ) : (
        <span className="stitch-model-pill-tag stitch-model-pill-tag--offline">Offline</span>
      )}
      <span className="stitch-model-pill-divider" aria-hidden />
      <span className="stitch-model-pill-ctx">
        <span className="stitch-dot" aria-hidden>
          ●
        </span>
        <span>{contextLabel}</span>
      </span>
      <ChevronDown size={14} className="stitch-model-pill-chevron" aria-hidden />
    </button>
  )
}
