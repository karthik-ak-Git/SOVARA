import { useState, useRef, type ReactElement } from 'react'
import { ChevronDown, Plus, Folder } from 'lucide-react'
import { Popover } from './Popover'

interface ProjectSelectorProps {
  projects?: Array<{ id: string; name: string }>
  selectedProjectId?: string | null
  onSelectProject?: (id: string | null) => void
  onNewProject?: () => void
  currentProjectName?: string | null
}

export function ProjectSelector({
  projects = [],
  selectedProjectId = null,
  onSelectProject,
  onNewProject,
  currentProjectName,
}: ProjectSelectorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const activeName =
    currentProjectName ??
    (selectedProjectId
      ? projects.find((p) => p.id === selectedProjectId)?.name ?? 'SOVARA'
      : 'No Project')

  return (
    <div
      className="project-selector-wrap"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
        Select Project <span style={{ fontSize: 10, opacity: 0.8 }}>Ctrl+;</span>
      </div>
      <button
        ref={triggerRef}
        type="button"
        className="project-pill-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Project: ${activeName}. Click to change project.`}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 12px',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
          color: '#334155',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <span>{activeName}</span>
        <ChevronDown size={14} style={{ color: '#64748b' }} aria-hidden />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label="Project selector"
      >
        <div
          className="project-popover"
          role="listbox"
          aria-label="Projects"
          style={{ width: 180, padding: '4px 0' }}
        >
          <button
            type="button"
            role="option"
            aria-selected={!selectedProjectId}
            className={`project-popover-item ${!selectedProjectId ? 'active' : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: !selectedProjectId ? '#f1f5f9' : 'transparent',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              color: '#0f172a',
            }}
            onClick={() => {
              onSelectProject?.(null)
              setOpen(false)
              triggerRef.current?.focus()
            }}
          >
            <Folder size={14} style={{ color: '#64748b' }} />
            <span>No Project</span>
          </button>

          {projects.map((p) => {
            const isSel = selectedProjectId === p.id
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={isSel}
                className={`project-popover-item ${isSel ? 'active' : ''}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 12px',
                  border: 'none',
                  background: isSel ? '#f1f5f9' : 'transparent',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  color: '#0f172a',
                }}
                onClick={() => {
                  onSelectProject?.(p.id)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <Folder size={14} style={{ color: '#64748b' }} />
                <span>{p.name}</span>
              </button>
            )
          })}

          <div style={{ height: 1, background: '#e2e8f0', margin: '4px 0' }} />
          {onNewProject ? (
            <button
              type="button"
              className="project-popover-new"
              aria-label="Create new project"
              onClick={() => {
                setOpen(false)
                onNewProject()
                triggerRef.current?.focus()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '6px 12px',
                border: 'none',
                background: 'transparent',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                color: '#0284c7',
              }}
            >
              <Plus size={14} />
              <span>New Project</span>
            </button>
          ) : null}
        </div>
      </Popover>
    </div>
  )
}
