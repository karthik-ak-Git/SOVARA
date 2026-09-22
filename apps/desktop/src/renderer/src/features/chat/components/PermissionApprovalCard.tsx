'use client'

import { useState, type ReactElement } from 'react'
import { Terminal, CornerDownLeft, Shield } from 'lucide-react'

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

  const handleSubmit = (): void => {
    if (selectedOption === 5) {
      onApprove(5, feedbackText)
    } else {
      onApprove(selectedOption)
    }
  }

  return (
    <div
      className="sv-permission-card border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-xl p-4 shadow-sm my-3 font-sans transition-all"
      style={{
        width: '100%',
        maxWidth: '680px',
        margin: '12px 0',
        borderRadius: '12px',
        border: '1px solid var(--stitch-border, #E8E4DE)',
        background: '#FFFFFF',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
      }}
      role="region"
      aria-label="Permission request"
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            border: '1px solid #D4D4D8',
            background: '#F4F4F5',
            color: '#27272A',
          }}
        >
          <Terminal size={14} />
        </div>
        <h3
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: '#18181B',
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          {actionTitle}
        </h3>
      </div>

      {/* Monospace Code snippet box */}
      <div
        style={{
          background: '#F4F4F5',
          border: '1px solid #E4E4E7',
          borderRadius: '8px',
          padding: '10px 12px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '13px',
          lineHeight: '1.45',
          color: '#18181B',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          overflowX: 'hidden',
          marginBottom: '14px',
        }}
      >
        {commandStr}
      </div>

      {/* 5 Selectable Options */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
        {options.map((opt) => {
          const isSelected = selectedOption === opt.index
          return (
            <div
              key={opt.index}
              onClick={() => setSelectedOption(opt.index)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: '8px',
                background: isSelected ? '#E4E4E7' : 'transparent',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
                userSelect: 'none',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  minWidth: '20px',
                  borderRadius: '4px',
                  background: isSelected ? '#D4D4D8' : '#E4E4E7',
                  color: isSelected ? '#18181B' : '#71717A',
                  fontSize: '12px',
                  fontWeight: 600,
                  marginTop: '1px',
                }}
              >
                {opt.index}
              </div>
              <div style={{ fontSize: '13px', color: isSelected ? '#18181B' : '#52525B', lineHeight: '1.4' }}>
                {opt.label}
              </div>
            </div>
          )
        })}
      </div>

      {/* Input area if option 5 (No) selected */}
      {selectedOption === 5 ? (
        <div style={{ marginBottom: '14px' }}>
          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Tell the agent what to do instead..."
            rows={2}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: '13px',
              borderRadius: '6px',
              border: '1px solid #D4D4D8',
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>
      ) : null}

      {/* Action Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '12px' }}>
        <button
          type="button"
          onClick={onSkip}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '13px',
            color: '#71717A',
            cursor: 'pointer',
            padding: '6px 8px',
            fontWeight: 500,
          }}
        >
          Skip
        </button>

        <button
          type="button"
          onClick={handleSubmit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: '#0078D4',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '6px',
            padding: '7px 16px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
            transition: 'background-color 0.15s ease',
          }}
        >
          Submit <CornerDownLeft size={14} />
        </button>
      </div>
    </div>
  )
}
