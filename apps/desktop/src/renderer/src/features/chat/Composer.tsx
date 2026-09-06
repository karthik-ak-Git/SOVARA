import { useEffect, useRef, type KeyboardEvent, type ReactElement } from 'react'
import { Button } from '@renderer/components/ui/Button'

const MAX_LENGTH = 32_000
const MAX_HEIGHT_PX = 160

export function Composer({
  value,
  onChange,
  onSend,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  onSend: (content: string) => void
  onNewline?: () => void
  disabled?: boolean
}): ReactElement {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const canSend = value.trim().length > 0 && !disabled

  // Auto-grow up to a bounded height, then scroll internally.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }, [value])

  // Return focus here once a send completes (disabled true -> false).
  const wasDisabled = useRef(disabled)
  useEffect(() => {
    if (wasDisabled.current && !disabled) areaRef.current?.focus()
    wasDisabled.current = disabled
  }, [disabled])

  const submit = (): void => {
    const content = value.trim()
    if (content.length === 0 || disabled) return
    onSend(content)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return
    if (e.shiftKey) {
      // Shift+Enter: insert a newline at the caret (default is prevented
      // below, so do it manually to stay deterministic across browsers).
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      const next = `${value.slice(0, start)}\n${value.slice(end)}`
      onChange(next.slice(0, MAX_LENGTH))
      requestAnimationFrame(() => {
        el.selectionStart = start + 1
        el.selectionEnd = start + 1
      })
      return
    }
    e.preventDefault()
    submit()
  }

  return (
    <div className="composer" aria-label="Message composer">
      <textarea
        ref={areaRef}
        className="input composer-input"
        placeholder={disabled ? 'Waiting for the mock assistant…' : 'Type a message — Enter to send, Shift+Enter for newline'}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_LENGTH))}
        onKeyDown={handleKeyDown}
        maxLength={MAX_LENGTH}
        disabled={disabled}
        aria-label="Message input"
        rows={1}
      />
      <Button
        variant="primary"
        onClick={submit}
        disabled={!canSend}
        aria-label="Send message"
      >
        Send
      </Button>
    </div>
  )
}