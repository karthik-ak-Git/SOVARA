'use client'

import { useState, useEffect, useRef, type ReactElement } from 'react'
import { Terminal, CornerDownLeft, Shield, Clock, FolderOpen, Globe, XCircle } from 'lucide-react'

export interface PermissionApprovalCardProps {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  onApprove: (optionIndex: number, feedback?: string) => void
  onSkip: () => void
}

type OptionDef = {
  index: number
  label: string
  sublabel: string
  icon: ReactElement
  scope: 'once' | 'conversation' | 'project' | 'global' | 'deny'
  color: string
  bg: string
  selectedBorder: string
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
  const [hovered, setHovered] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Derive exact command or formatted string from arguments
  // Derive exact command or formatted string from arguments
  const commandStr = (() => {
    if (typeof args['CommandLine'] === 'string' && args['CommandLine']) return args['CommandLine'] as string
    if (typeof args['command'] === 'string' && args['command']) return args['command'] as string
    if (typeof args['cmd'] === 'string' && args['cmd']) return args['cmd'] as string
    if (typeof args['script'] === 'string' && args['script']) return args['script'] as string
    if (typeof args['path'] === 'string' && args['path']) return args['path'] as string
    if (typeof args['file_path'] === 'string' && args['file_path']) return args['file_path'] as string
    return `${toolName} ${JSON.stringify(args)}`
  })()

  // Format a human-readable title action description
  const actionTitle = (() => {
    if (toolName === 'fs_read') return 'Allow reading external file?'
    if (toolName === 'fs_list') return 'Allow listing external directory?'
    if (toolName === 'fs_search') return 'Allow searching external path?'
    if (toolName === 'fs_write' || toolName === 'fs_patch') return 'Allow writing to file?'
    if (toolName === 'shell_exec' || toolName === 'run_command') return 'Allow running command?'
    const cmd = commandStr.toLowerCase()
    if (cmd.includes('git commit') || cmd.includes('git push')) return 'Allow commit & push?'
    if (cmd.includes('git add')) return 'Allow staging changes?'
    if (cmd.includes('npm install') || cmd.includes('pnpm add') || cmd.includes('yarn add')) return 'Allow installing dependencies?'
    if (cmd.includes('python') || cmd.includes('node')) return 'Allow running script?'
    return `Allow ${toolName.replace(/_/g, ' ')}?`
  })()

  const options: OptionDef[] = [
    {
      index: 1,
      label: 'Allow once',
      sublabel: 'Run this time only',
      icon: <Clock size={13} />,
      scope: 'once',
      color: 'var(--text, #374151)',
      bg: 'var(--panel, #f9fafb)',
      selectedBorder: 'var(--border-glow, #9ca3af)',
    },
    {
      index: 2,
      label: 'Allow for this conversation',
      sublabel: "Won't ask again in this chat",
      icon: <Shield size={13} />,
      scope: 'conversation',
      color: '#2563eb',
      bg: 'rgba(37, 99, 235, 0.08)',
      selectedBorder: '#3b82f6',
    },
    {
      index: 3,
      label: 'Allow for this project',
      sublabel: "Won't ask again in this project",
      icon: <FolderOpen size={13} />,
      scope: 'project',
      color: '#0284c7',
      bg: 'rgba(2, 132, 199, 0.08)',
      selectedBorder: '#38bdf8',
    },
    {
      index: 4,
      label: 'Always allow',
      sublabel: 'Never ask again for this command',
      icon: <Globe size={13} />,
      scope: 'global',
      color: '#059669',
      bg: 'rgba(5, 150, 105, 0.08)',
      selectedBorder: '#10b981',
    },
    {
      index: 5,
      label: 'Deny',
      sublabel: 'Tell the agent what to do instead',
      icon: <XCircle size={13} />,
      scope: 'deny',
      color: '#dc2626',
      bg: 'rgba(220, 38, 38, 0.08)',
      selectedBorder: '#ef4444',
    },
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
      role="region"
      aria-label="Permission request"
      style={{
        maxWidth: '560px',
        margin: '8px 0',
        background: 'var(--bg-elevated, var(--bg, #ffffff))',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: '12px',
        padding: '14px',
        boxShadow: 'var(--shadow-panel, 0 1px 6px rgba(0,0,0,0.07))',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <div
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '6px',
            background: 'var(--panel, #f3f4f6)',
            border: '1px solid var(--border, #e5e7eb)',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text, #374151)',
            flexShrink: 0,
          }}
        >
          <Terminal size={13} />
        </div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text, #111827)', lineHeight: 1.3 }}>{actionTitle}</div>
          <div style={{ fontSize: '11px', color: 'var(--muted, #6b7280)', lineHeight: 1.3 }}>
            {toolName.replace(/_/g, ' ')} · review permissions
          </div>
        </div>
      </div>

      {/* Command box */}
      <div
        style={{
          padding: '8px 10px',
          background: 'var(--bg-soft, #f8fafc)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: '6px',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: '11.5px',
          color: 'var(--text, #1e293b)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: '72px',
          overflowY: 'auto',
          marginBottom: '12px',
          lineHeight: 1.5,
        }}
      >
        {commandStr}
      </div>

      {/* Options */}
      <div role="radiogroup" aria-label="Permission options" style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '10px' }}>
        {options.map((opt) => {
          const isSelected = selectedOption === opt.index
          const isHovered = hovered === opt.index && !isSelected
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
              onMouseEnter={() => setHovered(opt.index)}
              onMouseLeave={() => setHovered(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleSubmit(opt.index)
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: '8px',
                cursor: 'pointer',
                userSelect: 'none',
                border: isSelected ? `1px solid ${opt.selectedBorder}` : '1px solid transparent',
                background: isSelected ? opt.bg : isHovered ? 'var(--panel, #f9fafb)' : 'transparent',
                transition: 'all 100ms ease',
              }}
            >
              {/* Keyboard shortcut badge */}
              <div
                style={{
                  width: '18px',
                  height: '18px',
                  minWidth: '18px',
                  borderRadius: '4px',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '10px',
                  fontWeight: 700,
                  fontFamily: 'ui-monospace, monospace',
                  background: isSelected ? opt.selectedBorder : 'var(--panel, #f3f4f6)',
                  color: isSelected ? '#ffffff' : 'var(--muted, #9ca3af)',
                }}
              >
                {opt.index}
              </div>

              {/* Icon */}
              <div style={{ color: isSelected ? opt.color : 'var(--muted, #9ca3af)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {opt.icon}
              </div>

              {/* Labels */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: isSelected ? 600 : 500, color: isSelected ? opt.color : 'var(--text, #374151)', lineHeight: 1.3 }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: '10.5px', color: isSelected ? opt.color : 'var(--muted, #9ca3af)', lineHeight: 1.3, opacity: isSelected ? 0.8 : 1 }}>
                  {opt.sublabel}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Feedback textarea — only for deny option */}
      {selectedOption === 5 ? (
        <div style={{ marginBottom: '10px' }}>
          <textarea
            ref={textareaRef}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Tell the agent what to do instead..."
            rows={2}
            style={{
              width: '100%',
              padding: '8px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid var(--danger, #fca5a5)',
              outline: 'none',
              resize: 'vertical',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              background: 'var(--bg-soft, #fff5f5)',
              color: 'var(--text, #111827)',
              boxSizing: 'border-box',
            }}
          />
        </div>
      ) : null}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '2px' }}>
        <div style={{ fontSize: '10px', color: 'var(--muted, #9ca3af)' }}>
          Press <kbd style={{ padding: '1px 4px', border: '1px solid var(--border, #e5e7eb)', borderRadius: '3px', fontFamily: 'monospace', background: 'var(--panel, #f9fafb)', color: 'var(--text, inherit)' }}>1</kbd>–<kbd style={{ padding: '1px 4px', border: '1px solid var(--border, #e5e7eb)', borderRadius: '3px', fontFamily: 'monospace', background: 'var(--panel, #f9fafb)', color: 'var(--text, inherit)' }}>5</kbd> then <kbd style={{ padding: '1px 4px', border: '1px solid var(--border, #e5e7eb)', borderRadius: '3px', fontFamily: 'monospace', background: 'var(--panel, #f9fafb)', color: 'var(--text, inherit)' }}>↵</kbd>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={onSkip}
            style={{
              fontSize: '11px',
              fontWeight: 500,
              padding: '5px 10px',
              cursor: 'pointer',
              background: 'transparent',
              border: 'none',
              color: 'var(--muted, #9ca3af)',
              borderRadius: '6px',
            }}
          >
            Skip
          </button>

          <button
            type="button"
            onClick={() => handleSubmit()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 14px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              background: selectedOption === 5 ? '#dc2626' : '#2563eb',
              color: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            }}
          >
            {selectedOption === 5 ? 'Deny' : 'Allow'} <CornerDownLeft size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
