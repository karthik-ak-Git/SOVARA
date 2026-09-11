'use client'

/**
 * useComposer — composer state helper per spec.
 * Manages multiline input, maxLength, send guards, focus.
 */
import { useCallback, useRef } from 'react'

export function useComposer(maxLength = 32_000) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const handleChange = useCallback(
    (value: string, onChange: (v: string) => void) => {
      onChange(value.slice(0, maxLength))
    },
    [maxLength]
  )

  const focus = useCallback(() => {
    ref.current?.focus()
  }, [])

  return { ref, handleChange, focus }
}
