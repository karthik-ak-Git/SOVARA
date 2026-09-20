'use client'

import type { ReactElement } from 'react'
import { Copy, RefreshCw, Pencil } from 'lucide-react'
import { copyToClipboard } from '@/lib/client/api'

interface MessageActionsProps {
  role: 'user' | 'assistant'
  content: string
  onCopy?: (content: string) => void
  onRegenerate?: () => void
  onEdit?: () => void
  canRegenerate?: boolean
  busy?: boolean
}

export function MessageActions({
  role,
  content,
  onCopy,
  onRegenerate,
  onEdit,
  canRegenerate = false,
  busy = false,
}: MessageActionsProps): ReactElement | null {
  const handleCopy = async (): Promise<void> => {
    // Main-process clipboard (deterministic under contextIsolation); the api
    // helper falls back to navigator.clipboard in non-Electron dev.
    try {
      await copyToClipboard(content)
    } catch {
      // last-resort in-page fallback so the button never dead-ends
      try {
        const ta = document.createElement('textarea')
        ta.value = content
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch { /* clipboard unavailable */ }
    }
    onCopy?.(content)
  }

  // User actions: Copy + Edit
  // Assistant actions: Copy + Regenerate (only on latest)
  return (
    <div className="sv-message-actions" role="toolbar" aria-label={`${role} message actions`}>
      <button
        type="button"
        className="sv-message-action"
        onClick={handleCopy}
        aria-label="Copy message"
        title="Copy"
        disabled={false}
      >
        <Copy size={12} aria-hidden />
        <span className="sr-only">Copy</span>
      </button>
      {role === 'user' && onEdit ? (
        <button
          type="button"
          className="sv-message-action"
          onClick={onEdit}
          aria-label="Edit and resend"
          title="Edit"
          disabled={busy}
        >
          <Pencil size={12} aria-hidden />
          <span className="sr-only">Edit</span>
        </button>
      ) : null}
      {role === 'assistant' && canRegenerate && onRegenerate ? (
        <button
          type="button"
          className="sv-message-action"
          onClick={onRegenerate}
          aria-label="Regenerate response"
          title="Regenerate"
          disabled={busy}
        >
          <RefreshCw size={12} aria-hidden />
          <span className="sr-only">Regenerate</span>
        </button>
      ) : null}
    </div>
  )
}
