'use client'

import { useState, type ReactElement } from 'react'
import { Copy, RefreshCw, Pencil, ThumbsUp, ThumbsDown, Check } from 'lucide-react'
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
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  const handleCopy = async (): Promise<void> => {
    try {
      await copyToClipboard(content)
    } catch {
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
      } catch {
        /* clipboard unavailable */
      }
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
    onCopy?.(content)
  }

  return (
    <div
      className="sv-message-actions"
      role="toolbar"
      aria-label={`${role} message actions`}
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}
    >
      <button
        type="button"
        className="sv-message-action"
        onClick={handleCopy}
        aria-label="Copy message"
        title="Copy"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 6px',
          borderRadius: 4,
          border: 'none',
          background: 'transparent',
          color: '#64748b',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        {copied ? <Check size={13} style={{ color: '#10b981' }} /> : <Copy size={13} aria-hidden />}
      </button>

      {role === 'assistant' ? (
        <>
          <button
            type="button"
            className="sv-message-action"
            onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
            aria-label="Thumbs up"
            title="Good response"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px 6px',
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: feedback === 'up' ? '#0284c7' : '#64748b',
              cursor: 'pointer',
            }}
          >
            <ThumbsUp size={13} aria-hidden />
          </button>
          <button
            type="button"
            className="sv-message-action"
            onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
            aria-label="Thumbs down"
            title="Poor response"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px 6px',
              borderRadius: 4,
              border: 'none',
              background: 'transparent',
              color: feedback === 'down' ? '#ef4444' : '#64748b',
              cursor: 'pointer',
            }}
          >
            <ThumbsDown size={13} aria-hidden />
          </button>
        </>
      ) : null}

      {role === 'user' && onEdit ? (
        <button
          type="button"
          className="sv-message-action"
          onClick={onEdit}
          aria-label="Edit and resend"
          title="Edit"
          disabled={busy}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '3px 6px',
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: '#64748b',
            cursor: 'pointer',
          }}
        >
          <Pencil size={13} aria-hidden />
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
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '3px 6px',
            borderRadius: 4,
            border: 'none',
            background: 'transparent',
            color: '#64748b',
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
