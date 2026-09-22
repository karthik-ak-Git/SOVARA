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
        if (idx === 5) setTimeout(() => textareaRef.current?.focus(), 50)
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
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center justify-center w-6 h-6 rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">
          <Terminal size={14} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 m-0 leading-snug">
          {actionTitle}
        </h3>
      </div>

      {/* Monospace Code snippet box — contained, scrollable, not interfering with option selection */}
      <div className="p-2.5 mb-3 rounded-lg border font-mono text-xs leading-relaxed overflow-x-auto overflow-y-auto max-h-28 whitespace-pre-wrap break-all border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 select-text">
        {commandStr}
      </div>

      {/* 5 Selectable Options — single click selects, double-click selects + submits */}
      <div className="flex flex-col gap-1 mb-3.5" role="radiogroup" aria-label="Permission options">
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
                  setSelectedOption(opt.index)
                  if (opt.index === 5) setTimeout(() => textareaRef.current?.focus(), 50)
                  else handleSubmit(opt.index)
                }
              }}
              className={`flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-all select-none border ${
                isSelected
                  ? 'bg-blue-50 dark:bg-sky-950/40 border-blue-300 dark:border-sky-700 text-zinc-900 dark:text-zinc-100 font-medium shadow-sm ring-1 ring-blue-200 dark:ring-sky-800'
                  : 'bg-transparent border-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 hover:border-zinc-200 dark:hover:border-zinc-700'
              }`}
            >
              <div
                className={`flex items-center justify-center w-5 h-5 min-w-[20px] rounded-full text-xs font-bold font-mono mt-0.5 border ${
                  isSelected
                    ? 'bg-[#0078D4] border-[#0078D4] text-white shadow-sm'
                    : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {isSelected ? '✓' : opt.index}
              </div>
              <div className="text-xs leading-relaxed pt-0.5 flex-1">
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

      {/* Action Footer — clear affordance: click or press Enter */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 mt-1">
        <span className="mr-auto text-[11px] text-zinc-400 dark:text-zinc-500 hidden sm:inline select-none">Click to select • Double-click or Enter to submit</span>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-medium px-3 py-2 cursor-pointer bg-transparent border border-zinc-200 dark:border-zinc-700 rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-600"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => handleSubmit()}
          className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold rounded-md border-none cursor-pointer bg-[#0078D4] hover:bg-[#0063b1] active:bg-[#005a9e] text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
        >
          Submit <CornerDownLeft size={14} />
        </button>
      </div>
    </div>
  )
}
