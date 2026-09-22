import { useState, useRef, useCallback, type KeyboardEvent, type ReactElement } from 'react'
import { Search, Check, ChevronDown, Brain } from 'lucide-react'
import { Popover } from './Popover'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'

function formatCtx(n?: number): string {
  if (n === undefined) return ''
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

function prettyName(raw: string): string {
  let s = raw.trim().replace(/\.gguf$/i, '')
  s = s.split('/').pop() ?? s
  return s.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim() || raw
}

interface ModelSelectorProps {
  active: ActiveModelState
  models: DiscoveredModel[]
  runtimes: ModelRuntimeEntry[]
  onSelect: (runtimeId: string, modelId: string) => void
  reasoningEnabled?: boolean
  onReasoningToggle?: (enabled: boolean) => void
  onOpenSettings?: () => void
}

export function ModelSelector({
  active,
  models,
  runtimes: _runtimes,
  onSelect,
  reasoningEnabled = false,
  onReasoningToggle,
  onOpenSettings: _onOpenSettings,
}: ModelSelectorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

  const isAuto = active.selection?.modelId === '__auto__' && active.selection?.runtimeId === 'auto'
  const selectedModel = !isAuto && active.selection
    ? models.find(
        (m) =>
          m.modelId === active.selection!.modelId && m.runtimeId === active.selection!.runtimeId
      )
    : null

  const ctxLabel = isAuto ? null : selectedModel?.contextLength ? formatCtx(selectedModel.contextLength) : null

  const modelLabel = isAuto
    ? 'Auto'
    : selectedModel
    ? ctxLabel
      ? `${prettyName(selectedModel.displayName)} · ${ctxLabel}`
      : prettyName(selectedModel.displayName)
    : 'No model'

  const statusLabel = isAuto ? 'Smart' : active.available ? 'Ready' : 'Ready'

  const filtered = models.filter((m) => {
    if (!filter) return true
    const q = filter.toLowerCase()
    return (
      m.displayName.toLowerCase().includes(q) ||
      m.modelId.toLowerCase().includes(q)
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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      setFilter('')
      triggerRef.current?.focus()
    }
  }, [])

  return (
    <div className="model-selector" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="model-pill"
        data-testid="model-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${modelLabel}, ${statusLabel}. Click to change model.`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="model-pill-label">{modelLabel}</span>
        <span className="model-pill-status badge badge--success">{statusLabel}</span>
        <span className="model-pill-icon" aria-hidden>
          <ChevronDown size={14} />
        </span>
      </button>

      <Popover
        open={open}
        onClose={() => {
          setOpen(false)
          setFilter('')
        }}
        anchorRef={triggerRef}
        label="Model selector"
      >
        <div className="model-popover" role="listbox" aria-label="Available models" style={{ width: 260, padding: '8px 0' }}>
          <div className="model-popover-head" style={{ padding: '0 12px 8px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="model-popover-title" style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>MODEL</span>
            <div className="model-popover-search" style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <Search size={13} style={{ color: '#94a3b8' }} aria-hidden />
              <input
                type="search"
                className="input model-popover-filter"
                placeholder="Filter models..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter models"
                ref={(el) => {
                  if (el) setTimeout(() => el.focus(), 0)
                }}
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 12, width: 110 }}
              />
            </div>
          </div>

          <ul className="model-popover-list" style={{ listStyle: 'none', margin: 0, padding: '4px 6px', maxHeight: 240, overflowY: 'auto' }}>
            <li
              role="option"
              aria-selected={isAuto}
              className={`model-popover-item ${isAuto ? 'model-popover-item--active' : ''}`}
              data-testid="model-auto"
              onClick={() => {
                onSelect('auto', '__auto__')
                setOpen(false)
                setFilter('')
                triggerRef.current?.focus()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect('auto', '__auto__')
                  setOpen(false)
                  setFilter('')
                  triggerRef.current?.focus()
                }
              }}
              tabIndex={0}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background: isAuto ? '#f1f5f9' : 'transparent',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>Auto</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>Smart routing · picks best per task</span>
              </div>
              {isAuto ? <Check size={14} style={{ color: '#0284c7' }} aria-label="Active" /> : null}
            </li>

            {filtered.length === 0 ? (
              <li className="model-popover-empty" role="option" aria-disabled style={{ padding: '12px 10px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                No models match &quot;{filter}&quot;
              </li>
            ) : (
              filtered.map((m) => {
                const isActive =
                  !isAuto && active.selection?.modelId === m.modelId
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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: isActive ? '#e0f2fe' : 'transparent',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: isActive ? 600 : 400, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.displayName}>
                      {prettyName(m.displayName)}
                    </span>
                    {isActive ? <Check size={14} style={{ color: '#0284c7', flexShrink: 0 }} aria-label="Active" /> : null}
                  </li>
                )
              })
            )}
          </ul>

          <div style={{ height: 1, background: '#e2e8f0', margin: '4px 0' }} />

          <div className="model-popover-reasoning" style={{ padding: '4px 10px' }}>
            <button
              type="button"
              className="reasoning-toggle"
              onClick={(e) => {
                e.stopPropagation()
                onReasoningToggle?.(!reasoningEnabled)
              }}
              aria-pressed={reasoningEnabled}
              aria-label={`Reasoning mode: ${reasoningEnabled ? 'on' : 'off'}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '6px 4px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                color: '#334155',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Brain size={14} style={{ color: '#0284c7' }} aria-hidden />
                <span style={{ fontWeight: 500 }}>Reasoning</span>
              </div>
              <span
                style={{
                  width: 28,
                  height: 16,
                  borderRadius: 999,
                  background: reasoningEnabled ? '#0284c7' : '#cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 2,
                  transition: 'background 150ms ease',
                }}
              >
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: '#ffffff',
                    transform: reasoningEnabled ? 'translateX(12px)' : 'translateX(0)',
                    transition: 'transform 150ms ease',
                  }}
                />
              </span>
            </button>
          </div>
        </div>
      </Popover>
    </div>
  )
}
