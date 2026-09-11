import { useState, useMemo, type ReactElement } from 'react'
import { MessageActions } from './components/MessageActions'
import { ArtifactCard } from '../../components/ui/ArtifactCard'
import { ReasoningBlock } from '../../components/ui/ReasoningBlock'

export interface ArtifactInfo {
  title: string
  language: string
  code: string
}

interface MessageBubbleProps {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
  loading?: boolean
  thinking?: boolean
  /** Live in-progress reply (transient, not yet persisted). */
  streaming?: boolean
  /** Stopped generation marker (durable `assistant/cancelled` event). */
  cancelled?: boolean
  /** Reasoning content (when reasoning enabled) */
  reasoning?: string
  /** Whether reasoning is currently streaming */
  reasoningStreaming?: boolean
  /** Action handlers — provided by MessageList/ChatView */
  onCopy?: (content: string) => void
  onRegenerate?: () => void
  onEditAndResend?: (newContent: string) => void
  /** Whether regenerate is allowed (only latest assistant) */
  canRegenerate?: boolean
  /** Disable actions while streaming/sending */
  busy?: boolean
  /** Triggered when user opens a code block into the artifact panel */
  onOpenArtifact?: (artifact: ArtifactInfo) => void
}

interface CodeBlockItem {
  type: 'code'
  language: string
  code: string
  title: string
}

interface TextItem {
  type: 'text'
  text: string
}

type ParsedPart = CodeBlockItem | TextItem

function parseMessageContent(raw: string): ParsedPart[] {
  if (!raw.includes('```')) {
    return [{ type: 'text', text: raw }]
  }

  const parts: ParsedPart[] = []
  const fenceRegex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = fenceRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: raw.slice(lastIndex, match.index) })
    }
    const lang = match[1]?.trim() || 'code'
    const code = match[2]?.trimEnd() ?? ''
    const title = lang.toLowerCase().includes('tsx')
      ? 'Component.tsx'
      : lang.toLowerCase().includes('ts')
        ? 'script.ts'
        : lang.toLowerCase().includes('py')
          ? 'script.py'
          : lang.toLowerCase().includes('html')
            ? 'index.html'
            : lang.toLowerCase().includes('json')
              ? 'data.json'
              : `${lang}-output`
    parts.push({ type: 'code', language: lang, code, title })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < raw.length) {
    parts.push({ type: 'text', text: raw.slice(lastIndex) })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: raw }]
}

function InlineArtifactCard({
  item,
  onOpenSplit,
}: {
  item: CodeBlockItem
  onOpenSplit?: () => void
}): ReactElement {
  // Thin alias over the global Stitch ArtifactCard — same props, no new logic.
  return <ArtifactCard title={item.title} language={item.language} code={item.code} onOpenSplit={onOpenSplit} />
}

export function MessageBubble({
  id,
  role,
  content,
  timestamp,
  loading = false,
  thinking = false,
  streaming = false,
  cancelled = false,
  reasoning,
  reasoningStreaming = false,
  onCopy,
  onRegenerate,
  onEditAndResend,
  canRegenerate = false,
  busy = false,
  onOpenArtifact,
}: MessageBubbleProps): ReactElement {
  const isUser = role === 'user'
  const bubbles = isUser ? 'user-bubble' : 'assistant-bubble'
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(content)
  const [showReasoning, setShowReasoning] = useState(true)

  const parsedParts = useMemo(() => {
    if (isUser || !content) return [{ type: 'text' as const, text: content }]
    return parseMessageContent(content)
  }, [content, isUser])

  if (loading) {
    return (
      <div
        key={id}
        data-testid="assistant-typing"
        data-role="assistant"
        className={`bubble ${bubbles} bubble--loading`}
        aria-live="polite"
        aria-label="Assistant is typing"
      >
        <div className="pill" aria-hidden>{'◆'}</div>
        <div className="empty empty--loading" aria-hidden />
      </div>
    )
  }

  if (thinking) {
    return (
      <div
        key={id}
        data-testid="assistant-thinking"
        data-role="assistant"
        className={`bubble ${bubbles} bubble--thinking`}
        aria-live="polite"
        aria-label="Assistant is thinking"
      >
        <div className="pill" aria-hidden>{'◆'}</div>
        <svg
          className="thinking-svg"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth={2}>
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 12 12"
              to="360 12 12"
              dur="1.5s"
              repeatCount="indefinite"
            />
          </circle>
        </svg>
      </div>
    )
  }

  // Edit mode for user messages
  if (isEditing && isUser && onEditAndResend) {
    return (
      <article
        key={id}
        data-testid="message-user-editing"
        data-role={role}
        className={`bubble ${bubbles} bubble--editing`}
        aria-label="Edit your message"
      >
        <textarea
          className="bubble-edit-input"
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value.slice(0, 32_000))}
          rows={3}
          autoFocus
          aria-label="Edit message"
          data-testid="edit-input"
        />
        <div className="bubble-edit-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const next = editDraft.trim()
              if (!next) return
              onEditAndResend(next)
              setIsEditing(false)
            }}
            disabled={!editDraft.trim() || busy}
            aria-label="Send edited message"
          >
            Send
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setEditDraft(content)
              setIsEditing(false)
            }}
            aria-label="Cancel edit"
          >
            Cancel
          </button>
        </div>
      </article>
    )
  }

  const hasReasoning = typeof reasoning === 'string' && reasoning.length > 0

  return (
    <article
      key={id}
      data-testid={streaming ? 'message-streaming' : isUser ? 'message-user' : 'message-assistant'}
      data-role={role}
      className={`bubble ${bubbles}${streaming ? ' bubble--streaming' : ''}${cancelled ? ' bubble--cancelled' : ''}${hasReasoning ? ' bubble--with-reasoning' : ''}`}
      aria-label={streaming ? 'Assistant response in progress' : cancelled ? 'Cancelled generation' : isUser ? 'Your message' : 'Assistant response'}
      aria-live={streaming ? 'polite' : undefined}
    >
      {hasReasoning ? (
        <ReasoningBlock
          reasoning={reasoning ?? ''}
          streaming={reasoningStreaming}
          open={showReasoning}
          onToggle={setShowReasoning}
        />
      ) : null}

      {/* Render message body with artifact detection for code blocks */}
      {parsedParts.map((part, index) => {
        if (part.type === 'code') {
          return (
            <InlineArtifactCard
              key={`${id}-code-${index}`}
              item={part}
              onOpenSplit={onOpenArtifact ? () => onOpenArtifact({ title: part.title, language: part.language, code: part.code }) : undefined}
            />
          )
        }
        return (
          <p key={`${id}-text-${index}`} className="bubble-text">
            {part.text}
            {streaming && index === parsedParts.length - 1 ? <span className="stream-caret" aria-hidden="true" /> : null}
          </p>
        )
      })}

      {cancelled ? <span className="bubble-meta muted small">Stopped — no reply was generated.</span> : null}
      <span className="bubble-meta muted small">
        {typeof timestamp === 'number' && Number.isFinite(timestamp) ? (
          <time dateTime={new Date(timestamp).toISOString()}>
            {new Date(timestamp).toLocaleTimeString()}
          </time>
        ) : (
          ''
        )}
      </span>

      {!streaming && !thinking && !loading ? (
        <MessageActions
          role={role}
          content={hasReasoning && reasoning ? `${reasoning}\n\n${content}` : content}
          onCopy={onCopy}
          onRegenerate={onRegenerate}
          onEdit={isUser && onEditAndResend ? () => setIsEditing(true) : undefined}
          canRegenerate={canRegenerate}
          busy={busy}
        />
      ) : null}
    </article>
  )
}