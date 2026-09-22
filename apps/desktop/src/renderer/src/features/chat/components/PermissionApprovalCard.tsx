'use client'

import { useState, useEffect, useRef, type ReactElement } from 'react'
import { Terminal, CornerDownLeft } from 'lucide-react'

export interface PermissionApprovalCardProps {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  onApprove: (optionIndex: number, feedback?: string) => void
  onSkip: () => void
}

export function PermissionApprovalCard({
  toolCallId: _toolCallId,
  toolName,
  args,
  onApprove,
  onSkip,
}: PermissionApprovalCardProps): ReactElement {
  const [selectedOption, setSelectedOption] = useState<number>(1)
  const [feedbackText, setFeedbackText] = useState<string>('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Derive exact command or formatted string from arguments
  const commandStr = (() => {
    if (typeof args['CommandLine'] === 'string' && args['CommandLine']) return args['CommandLine'] as string
    if (typeof args['command'] === 'string' && args['command']) return args['command'] as string
    if (typeof args['cmd'] === 'string' && args['cmd']) return args['cmd'] as string
    if (typeof args['script'] === 'string' && args['script']) return args['script'] as string
    if (typeof args['path'] === 'string' && args['path']) return `${toolName} ${args['path']}`
    return `${toolName} ${JSON.stringify(args)}`
  })()

  // Format a human-readable title action description
  const actionTitle = (() => {
    const cmd = commandStr.toLowerCase()
    if (cmd.includes('git commit') || cmd.includes('git push')) return 'Allow commit and push changes?'
    if (cmd.includes('git add')) return 'Allow git staging changes?'
    if (cmd.includes('npm install') || cmd.includes('pnpm add') || cmd.includes('yarn add')) return 'Allow installing dependencies?'
    if (cmd.includes('python') || cmd.includes('node')) return 'Allow running script?'
    return `Allow ${toolName.replace(/_/g, ' ')}?`
  })()

  // Display truncated snippet of command in option labels
  const truncatedCmd = commandStr.length > 80 ? `${commandStr.slice(0, 77)}...` : commandStr

  const options = [
    { index: 1, label: 'Yes, allow this time' },
    { index: 2, label: `Yes, and always allow '${truncatedCmd}' in this conversation` },
    { index: 3, label: `Yes, and always allow '${truncatedCmd}' in this project` },
    { index: 4, label: `Yes, and always allow '${truncatedCmd}'` },
    { index: 5, label: 'No (tell the agent what to do instead)' },
  ]

  const handleSubmit = (overrideIdx?: number): void => {
    const idx = overrideIdx ?? selectedOption
    if (idx === 5) {
      onApprove(5, feedbackText)
    } else {
      onApprove(idx)
    }
  }

  // Keyboard navigation: 1-5 to select option, Enter to submit, Escape to skip
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // If user is actively typing in the feedback textarea, allow normal typing unless Ctrl+Enter
      const isTextareaFocused = document.activeElement === textareaRef.current
      if (isTextareaFocused) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          handleSubmit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          onSkip()
        }
        return
      }

      if (e.key >= '1' && e.key <= '5') {
        e.preventDefault()
        const idx = parseInt(e.key, 10)
        setSelectedOption(idx)
        if (idx === 5) {
          setTimeout(() => textareaRef.current?.focus(), 50)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedOption, feedbackText, onSkip])

  return (
    <div
      className="sv-permission-card w-full max-w-2xl my-3 p-4 rounded-xl border font-sans shadow-sm transition-all border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
      role="region"
      aria-label="Permission request"
      style={{ maxWidth: '640px', margin: '12px auto', background: '#fff', border: '1px solid #e4e4e7', borderRadius: '12px', padding: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div className="flex items-center justify-center w-6 h-6 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200" style={{ width: '24px', height: '24px', borderRadius: '6px', background: '#f4f4f5', border: '1px solid #d4d4d8', display: 'grid', placeItems: 'center' }}>
          <Terminal size={14} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 m-0 leading-snug" style={{ fontSize: '14px', fontWeight: 600, color: '#18181b', margin: 0 }}>
          {actionTitle}
        </h3>
      </div>

      {/* Monospace Code snippet box */}
      <div className="p-2.5 mb-3 rounded-lg border font-mono text-xs leading-relaxed overflow-x-hidden break-all whitespace-pre-wrap border-zinc-200 dark:border-zinc-800 bg-zinc-100/90 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100" style={{ padding: '10px', background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: '8px', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {commandStr}
      </div>

      {/* 5 Selectable Options — click selects, double-click submits */}
      <div className="flex flex-col gap-1 mb-3.5" role="radiogroup" aria-label="Permission options" style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '14px' }}>
        {options.map((opt) => {
          const isSelected = selectedOption === opt.index
          return (
            <div
              key={opt.index}
              role="radio"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => {
                setSelectedOption(opt.index)
                if (opt.index === 5) {
                  setTimeout(() => textareaRef.current?.focus(), 50)
                }
              }}
              onDoubleClick={() => {
                setSelectedOption(opt.index)
                setTimeout(() => handleSubmit(opt.index), 30)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleSubmit(opt.index)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '9px 10px',
                borderRadius: '8px',
                cursor: 'pointer',
                userSelect: 'none',
                border: isSelected ? '1px solid #d4d4d8' : '1px solid transparent',
                background: isSelected ? '#e4e4e7' : 'transparent',
                color: isSelected ? '#18181b' : '#3f3f46',
                fontWeight: isSelected ? 500 : 400,
                transition: 'all 120ms ease',
              }}
            >
              <div
                style={{
                  width: '20px',
                  height: '20px',
                  minWidth: '20px',
                  borderRadius: '4px',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '11px',
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, monospace',
                  background: isSelected ? '#d4d4d8' : '#f4f4f5',
                  color: isSelected ? '#18181b' : '#71717a',
                  marginTop: '1px',
                }}
              >
                {opt.index}
              </div>
              <div style={{ fontSize: '12px', lineHeight: '1.4', flex: 1, paddingTop: '2px' }}>
                {opt.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Input area if option 5 (No) selected */}
      {selectedOption === 5 ? (
        <div className="mb-3">
          <textarea
            ref={textareaRef}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Tell the agent what to do instead..."
            rows={2}
            className="w-full p-2 text-xs rounded-md border outline-none resize-y border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      ) : null}

      {/* Action Footer */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-medium px-2 py-1.5 cursor-pointer bg-transparent border-none text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
        >
          Skip
        </button>

        <button
          type="button"
          onClick={() => handleSubmit()}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-md border-none cursor-pointer bg-[#0078D4] hover:bg-[#006cc1] text-white shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          Submit <CornerDownLeft size={13} />
        </button>
      </div>
    </div>
  )
}
