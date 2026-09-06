import { useState, useRef, useEffect, type ReactElement } from 'react'
import { FolderOpen, Shield, X } from 'lucide-react'

interface CreateProjectModalProps {
  open: boolean
  onClose: () => void
  onCreate: (name: string, rootPath: string) => void
}

export function CreateProjectModal({ open, onClose, onCreate }: CreateProjectModalProps): ReactElement | null {
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setRootPath('')
      setTimeout(() => nameRef.current?.focus(), 0)
    }
  }, [open])

  const handlePickFolder = async (): Promise<void> => {
    if (window.sovara) {
      try {
        const result = (await window.sovara.invoke('dialog:pickFolder')) as { canceled: boolean; filePath: string | null }
        if (result && !result.canceled && result.filePath) setRootPath(result.filePath)
      } catch {
        /* fallback: user can type manually */
      }
    }
  }

  const handleCreate = (): void => {
    const trimmed = name.trim()
    if (!trimmed || !rootPath.trim()) return
    onCreate(trimmed, rootPath.trim())
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleCreate()
    }
  }

  if (!open) return null

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown} role="dialog" aria-modal aria-label="Create new project">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Create new project</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="modal-body">
          <label className="modal-label" htmlFor="project-name">
            Project name
          </label>
          <input
            ref={nameRef}
            id="project-name"
            type="text"
            className="modal-input"
            placeholder="e.g. my-app"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={120}
          />

          <label className="modal-label" htmlFor="project-root">
            Working directory
          </label>
          <div className="modal-folder-row">
            <input
              id="project-root"
              type="text"
              className="modal-input modal-folder-input"
              placeholder="Select a folder…"
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button type="button" className="btn btn-sm" onClick={handlePickFolder} aria-label="Browse for folder">
              <FolderOpen size={14} aria-hidden />
            </button>
          </div>

          <div className="modal-permission-info">
            <Shield size={14} aria-hidden />
            <span>Run code and commands in any project folder</span>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!name.trim() || !rootPath.trim()}
            onClick={handleCreate}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
