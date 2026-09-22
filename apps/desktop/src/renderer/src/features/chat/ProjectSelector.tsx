import { useState, useRef, type ReactElement } from 'react'
import {
  ChevronDown,
  Folder,
  FolderPlus,
  FolderGit2,
  FolderMinus,
  Settings,
  Check,
} from 'lucide-react'
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

  const defaultProjects = projects.length > 0
    ? projects
    : [
        { id: 'sovara-main', name: 'SOVARA' },
        { id: 'sovara-landingpage', name: 'sovara-landingpage' },
      ]

  const activeProject = selectedProjectId
    ? defaultProjects.find((p) => p.id === selectedProjectId)
    : null

  const activeName = activeProject
    ? activeProject.name
    : selectedProjectId && selectedProjectId !== '__global__'
    ? selectedProjectId
    : currentProjectName || 'SOVARA Workspace'

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
          gap: 8,
          padding: '6px 14px',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
          color: '#0f172a',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        }}
      >
        <Folder size={15} style={{ color: '#0f172a' }} aria-hidden />
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
          style={{ width: 220, padding: '6px 0', background: '#ffffff', borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
        >
          {/* Projects List */}
          {defaultProjects.map((p) => {
            const isSel = selectedProjectId === p.id || (selectedProjectId === null && activeName === p.name)
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
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '7px 12px',
                  border: 'none',
                  background: isSel ? '#f1f5f9' : 'transparent',
                  fontSize: 13,
                  fontWeight: isSel ? 600 : 400,
                  cursor: 'pointer',
                  color: '#0f172a',
                  borderRadius: 6,
                }}
                onClick={() => {
                  onSelectProject?.(p.id)
                  setOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Folder size={15} style={{ color: '#334155' }} />
                  <span>{p.name}</span>
                </div>
                {isSel ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Settings size={13} style={{ color: '#64748b' }} />
                    <Check size={14} style={{ color: '#0f172a' }} />
                  </div>
                ) : null}
              </button>
            )
          })}

          <div style={{ height: 1, background: '#f1f5f9', margin: '6px 0' }} />

          {/* New Project & Quick Start */}
          <button
            type="button"
            className="project-popover-item"
            onClick={() => {
              setOpen(false)
              onNewProject?.()
              triggerRef.current?.focus()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '7px 12px',
              border: 'none',
              background: 'transparent',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              color: '#334155',
            }}
          >
            <FolderPlus size={15} style={{ color: '#64748b' }} />
            <span>New Project</span>
          </button>

          <button
            type="button"
            className="project-popover-item"
            onClick={() => {
              setOpen(false)
              onNewProject?.()
              triggerRef.current?.focus()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '7px 12px',
              border: 'none',
              background: 'transparent',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              color: '#334155',
            }}
          >
            <FolderGit2 size={15} style={{ color: '#64748b' }} />
            <span>Quick Start</span>
          </button>

          <div style={{ height: 1, background: '#f1f5f9', margin: '6px 0' }} />

          {/* No Project Item */}
          <button
            type="button"
            role="option"
            aria-selected={selectedProjectId === null}
            className={`project-popover-item ${selectedProjectId === null ? 'active' : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '7px 12px',
              border: 'none',
              background: selectedProjectId === null ? '#f1f5f9' : 'transparent',
              fontSize: 13,
              fontWeight: selectedProjectId === null ? 600 : 400,
              cursor: 'pointer',
              color: '#334155',
            }}
            onClick={() => {
              onSelectProject?.(null)
              setOpen(false)
              triggerRef.current?.focus()
            }}
          >
            <FolderMinus size={15} style={{ color: '#64748b' }} />
            <span>No Project</span>
          </button>
        </div>
      </Popover>
    </div>
  )
}
