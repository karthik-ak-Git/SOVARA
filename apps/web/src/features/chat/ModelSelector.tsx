'use client'

import { useState, useRef, useCallback, type KeyboardEvent, type ReactElement } from 'react'
import { Search, Check, ChevronDown, Wrench, Brain } from 'lucide-react'
import { Popover } from './Popover'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'

interface ModelSelectorProps {
  active: ActiveModelState
  models: DiscoveredModel[]
  runtimes: ModelRuntimeEntry[]
  onSelect: (runtimeId: string, modelId: string) => void
  reasoningEnabled?: boolean
  onReasoningToggle?: (enabled: boolean) => void
  onOpenSettings?: () => void
}

export function ModelSelector({ active, models, runtimes, onSelect, reasoningEnabled = false, onReasoningToggle, onOpenSettings }: ModelSelectorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

  const selectedModel = active.selection
    ? models.find(
        (m) =>
          m.modelId === active.selection!.modelId && m.runtimeId === active.selection!.runtimeId
      )
    : null

  const runtimeName = selectedModel
    ? runtimes.find((r) => r.id === selectedModel.runtimeId)?.displayName ?? selectedModel.runtimeId
    : null

  const modelLabel = selectedModel
    ? `${selectedModel.displayName} ${runtimeName ? `on ${runtimeName}` : ''}`
    : 'No model'

  const statusLabel = active.available ? 'Ready' : 'Unavailable'

  const filtered = models.filter((m) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.modelId.toLowerCase().includes(q) ||
      (runtimes.find((r) => r.id === m.runtimeId)?.displayName ?? '').toLowerCase().includes(q)
    )
  })

  const handleSelect = useCallback(
    (m: DiscoveredModel) => {
      onSelect(m.runtimeId, m.modelId)
      setOpen(false)
      setFilter('')
      triggerRef.current?.focus()
    },
    [onSelect]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        setFilter('')
        triggerRef.current?.focus()
      }
    },
    []
  )

  const statusVariant = active.available ? 'success' : 'warn'

  return (
    <div className="model-selector" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="model-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model selector: ${modelLabel}, ${statusLabel}. Click to change model.`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="model-pill-icon" aria-hidden>
          <ChevronDown size={14} />
        </span>
        <span className="model-pill-label">{modelLabel}</span>
        <span className={`model-pill-status badge badge--${statusVariant}`}>{statusLabel}</span>
      </button>

      <Popover
        open={open}
        onClose={() => { setOpen(false); setFilter('') }}
        anchorRef={triggerRef}
        label="Model selector"
      >
        <div className="model-popover" role="listbox" aria-label="Available models">
          <div className="model-popover-head">
            <span className="model-popover-title">Model</span>
            <div className="model-popover-search">
              <Search size={14} aria-hidden />
              <input
                type="search"
                className="input model-popover-filter"
                placeholder="Filter models…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter models"
                ref={(el) => { if (el) setTimeout(() => el.focus(), 0) }}
              />
            </div>
          </div>

          <ul className="model-popover-list">
            {filtered.length === 0 ? (
              <li className="model-popover-empty" role="option" aria-disabled>
                No models match &quot;{filter}&quot;
              </li>
            ) : (
              filtered.map((m) => {
                const isActive =
                  active.selection?.modelId === m.modelId && active.selection?.runtimeId === m.runtimeId
                const rt = runtimes.find((r) => r.id === m.runtimeId)
                return (
                  <li
                    key={m.modelId}
                    role="option"
                    aria-selected={isActive}
                    className={`model-popover-item ${isActive ? 'model-popover-item--active' : ''}`}
                    data-testid={`model-${m.modelId}`}
                    onClick={() => handleSelect(m)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleSelect(m)
                      }
                    }}
                    tabIndex={0}
                    data-active={isActive || undefined}
                  >
                    <span className="model-popover-item-name">{m.displayName}</span>
                    <span className="model-popover-item-meta muted small">
                      {rt?.displayName ?? m.runtimeId}
                      {m.available ? (
                        <Check size={12} aria-label="Available" className="model-popover-check" />
                      ) : (
                        <span className="muted small">— unavailable</span>
                      )}
                    </span>
                    {isActive ? <Check size={14} className="model-popover-check-active" aria-label="Active" /> : null}
                  </li>
                )
              })
            )}
          </ul>

          <div className="model-popover-divider" />

          <div className="model-popover-reasoning">
            <button
              type="button"
              className="reasoning-toggle"
              onClick={(e) => { e.stopPropagation(); onReasoningToggle?.(!reasoningEnabled) }}
              aria-pressed={reasoningEnabled}
              aria-label={`Reasoning mode: ${reasoningEnabled ? 'on' : 'off'}`}
            >
              <Brain size={14} aria-hidden />
              <span className="reasoning-toggle-label">Reasoning</span>
              <span className={`reasoning-toggle-track ${reasoningEnabled ? 'on' : ''}`}>
                <span className="reasoning-toggle-thumb" />
              </span>
            </button>
          </div>

          <div className="model-popover-divider" />
          <button
            type="button"
            className="model-popover-settings"
            aria-label="Runtime / Model Settings"
            onClick={() => {
              setOpen(false)
              setFilter('')
              triggerRef.current?.focus()
              onOpenSettings?.()
            }}
          >
            <Wrench size={14} aria-hidden />
            Runtime / Model Settings
          </button>
        </div>
      </Popover>
    </div>
  )
}
