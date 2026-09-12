import { useEffect, useRef, type ReactElement } from 'react'

interface PopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
  children: React.ReactNode
  label: string
}

export function Popover({ open, onClose, anchorRef, children, label }: PopoverProps): ReactElement | null {
  const containerRef = useRef<HTMLDivElement>(null)
  const firstFocusRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => firstFocusRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const container = containerRef.current
      const anchor = anchorRef.current
      if (container && !container.contains(e.target as Node) && anchor && !anchor.contains(e.target as Node)) {
        onClose()
      }
    }
    setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose, anchorRef])

  if (!open) return null

  return (
    <div
      ref={containerRef}
      className="popover"
      role="dialog"
      aria-label={label}
      aria-modal="false"
    >
      {children}
    </div>
  )
}
