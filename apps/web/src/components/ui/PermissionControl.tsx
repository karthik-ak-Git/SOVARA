import { useState, useRef, useEffect, type ReactElement } from 'react'
import { Shield, ChevronDown, TriangleAlert } from 'lucide-react'

export type ExecMode = 'off' | 'ask' | 'review' | 'allow'

interface PermissionControlProps {
  mode: ExecMode
  onChange: (mode: ExecMode) => void
}

const MODES: Array<{ value: ExecMode; label: string; desc: string }> = [
  { value: 'off', label: 'Off', desc: 'No commands will be executed' },
  { value: 'ask', label: 'Ask every time', desc: 'Prompt before each command' },
  { value: 'review', label: 'Auto Review', desc: 'Auto-run safe commands, ask for risky ones' },
  { value: 'allow', label: 'Allow all', desc: 'Execute commands without prompting' },
]

export function PermissionControl({ mode, onChange }: PermissionControlProps): ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = MODES.find((m) => m.value === mode) ?? MODES[0]

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    setTimeout(() => document.addEventListener('mousedown', handle), 0)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <div className="perm-control" ref={ref}>
      <button
        type="button"
        className="perm-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Permission: ${current.label}. Click to change.`}
      >
        <Shield size={13} aria-hidden />
        <span className="perm-trigger-label">{current.label}</span>
        <ChevronDown size={12} aria-hidden />
      </button>

      {open ? (
        <div className="perm-dropdown" role="listbox" aria-label="Permission modes">
          {MODES.map((m) => (
            <div key={m.value}>
              <button
                type="button"
                role="option"
                aria-selected={m.value === mode}
                className={`perm-item ${m.value === mode ? 'perm-item--active' : ''}`}
                onClick={() => {
                  onChange(m.value)
                  setOpen(false)
                }}
              >
                <span className="perm-item-label">{m.label}</span>
                <span className="perm-item-desc">{m.desc}</span>
              </button>
              {m.value === 'allow' ? (
                <div className="perm-warn" role="note" aria-label="Full access warning">
                  <TriangleAlert size={12} aria-hidden />
                  <span>Full access — the AI can run any command on this machine without asking. Use only with trusted models.</span>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
