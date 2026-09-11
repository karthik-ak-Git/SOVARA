import type { ReactElement } from 'react'
import type { ModelLoadingState } from '../useChatSession'
import { Cpu } from 'lucide-react'

interface ModelLoadingIndicatorProps {
  progress: ModelLoadingState
}

const STAGE_LABELS: Record<string, string> = {
  mmap: 'Memory-mapping model',
  'gpu-offload': 'Offloading to GPU',
  context: 'Building KV cache',
  prompt: 'Processing prompt',
  streaming: 'Generating',
}

export function ModelLoadingIndicator({ progress }: ModelLoadingIndicatorProps): ReactElement {
  const { progress: pct, stage, detail } = progress
  const label = STAGE_LABELS[stage] ?? stage

  return (
    <div className="model-loading-bar" role="status" aria-live="polite" aria-label={`Loading model: ${label} ${pct}%`}>
      <div className="model-loading-bar__header">
        <Cpu size={14} className="model-loading-bar__icon" aria-hidden />
        <span className="model-loading-bar__label">{label}</span>
        <span className="model-loading-bar__pct">{pct}%</span>
      </div>
      <div className="model-loading-bar__track">
        <div className="model-loading-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="model-loading-bar__detail muted small">{detail}</div>
    </div>
  )
}
