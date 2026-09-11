'use client'

import { useState, useRef, useCallback, type KeyboardEvent, type ReactElement } from 'react'
import { FolderOpen, ChevronDown, Plus } from 'lucide-react'
import { Popover } from './Popover'

interface ProjectSelectorProps {
  projectCount: number
  onNewProject: () => void
}

export function ProjectSelector({ projectCount, onNewProject }: ProjectSelectorProps): ReactElement {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const label = projectCount > 0 ? `Project (${projectCount})` : 'No project'

  return (
    <div className="project-selector">
      <button
        ref={triggerRef}
        type="button"
        className="project-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Project selector: ${label}. Click to select or create a project.`}
        onClick={() => setOpen((o) => !o)}
      >
        <FolderOpen size={14} aria-hidden />
        <span className="project-pill-label">{label}</span>
        <ChevronDown size={14} aria-hidden className="project-pill-chevron" />
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        label="Project selector"
      >
        <div className="project-popover" role="listbox" aria-label="Projects">
          <button
            type="button"
            role="option"
            aria-selected={projectCount === 0}
            className={`project-popover-item ${projectCount === 0 ? 'project-popover-item--active' : ''}`}
            tabIndex={0}
            onClick={() => { setOpen(false); triggerRef.current?.focus() }}
          >
            <FolderOpen size={14} aria-hidden />
            <span>No project</span>
          </button>

          {projectCount > 0
            ? Array.from({ length: projectCount }, (_, i) => (
                <button
                  key={`proj-${i}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="project-popover-item"
                  tabIndex={0}
                  onClick={() => { setOpen(false); triggerRef.current?.focus() }}
                >
                  <FolderOpen size={14} aria-hidden />
                  <span>Project {i + 1}</span>
                </button>
              ))
            : null}

          <div className="project-popover-divider" />
          <button
            type="button"
            className="project-popover-new"
            aria-label="Create new project"
            onClick={() => {
              setOpen(false)
              onNewProject()
              triggerRef.current?.focus()
            }}
          >
            <Plus size={14} aria-hidden />
            New Project
          </button>
        </div>
      </Popover>
    </div>
  )
}
