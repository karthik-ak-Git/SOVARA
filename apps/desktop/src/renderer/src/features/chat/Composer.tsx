import type { ReactNode, ReactElement, KeyboardEvent } from 'react'
import { Button } from '@renderer/components/ui/Button'

type OnSend = (content: string) => void
type OnNewline = () => void

export function Composer({
  value,
  onChange,
  onSend,
  onNewline,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  onSend: OnSend
  onNewline: OnNewline
  disabled?: boolean
}): ReactElement {
  return (
    <div className="composer" aria-label="Message input">
      <textarea
        className="input"
        placeholder="Type a message"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) {
              onNewline()
            } else {
              onSend(value.trim())
            }
          }
        }}
        maxLength={32000}
        disabled={disabled}
        aria-label="Message input"
        rows={1}
      />
      <Button
        variant="primary"
        onClick={() => onSend(value.trim())}
        disabled={disabled || !value.trim()}
        aria-label="Send message"
      >
        Send
      </Button>
    </div>
  )
}