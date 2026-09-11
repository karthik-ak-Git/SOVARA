import type { ReactElement } from 'react'
import { Copy, RefreshCw, Pencil } from 'lucide-react'

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
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content)
      } else {
        // Fallback
        const ta = document.createElement('textarea')
        ta.value = content
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      onCopy?.(content)
    } catch {
      // clipboard best-effort; still notify caller
      onCopy?.(content)
    }
  }

  // User actions: Copy + Edit
  // Assistant actions: Copy + Regenerate (only on latest)
  return (
    <div className="message-actions" role="toolbar" aria-label={`${role} message actions`}>
      <button
        type="button"
        className="message-action-btn"
        onClick={handleCopy}
        aria-label="Copy message"
        title="Copy"
        disabled={busy}
      >
        <Copy size={12} aria-hidden />
        <span className="sr-only">Copy</span>
      </button>
      {role === 'user' && onEdit ? (
        <button
          type="button"
          className="message-action-btn"
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
          className="message-action-btn"
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
