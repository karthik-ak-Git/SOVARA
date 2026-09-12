import { useState, useMemo, type ReactElement } from 'react'
import { PersonStanding, Sparkles, Copy, Check } from 'lucide-react'
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
  streaming?: boolean
  cancelled?: boolean
  reasoning?: string
  reasoningStreaming?: boolean
  modelBadge?: string
  thoughtLabel?: string
  onCopy?: (content: string) => void
  onRegenerate?: () => void
  onEditAndResend?: (newContent: string) => void
  canRegenerate?: boolean
  busy?: boolean
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

function formatTime(ts?: number): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * MessageBubble — full Stitch replica row.
 * User: avatar + name/time + white rounded-2xl bubble.
 * Assistant: terracotta avatar + Sovora header + ReasoningBlock + Newsreader prose + ArtifactCards.
 * All handlers/testids preserved; purely presentational rewrite.
 */
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
  modelBadge,
  thoughtLabel,
  onCopy,
  onRegenerate,
  onEditAndResend,
  canRegenerate = false,
  busy = false,
  onOpenArtifact,
}: MessageBubbleProps): ReactElement {
  const isUser = role === 'user'
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(content)
  const [showReasoning, setShowReasoning] = useState(true)
  const [copied, setCopied] = useState(false)

  const parsedParts = useMemo(() => {
    if (isUser || !content) return [{ type: 'text' as const, text: content }]
    return parseMessageContent(content)
  }, [content, isUser])

  if (loading) {
    return (
      <div key={id} data-testid="assistant-typing" data-role="assistant" className="stitch-turn" aria-live="polite" aria-label="Assistant is typing">
        <div className="stitch-avatar stitch-avatar--assistant" aria-hidden>
          <Sparkles size={18} />
        </div>
        <div className="stitch-thinking-dots" aria-hidden>
          <span /> <span /> <span />
        </div>
      </div>
    )
  }

  if (thinking) {
    return (
      <div key={id} data-testid="assistant-thinking" data-role="assistant" className="stitch-turn" aria-live="polite" aria-label="Assistant is thinking">
        <div className="stitch-avatar stitch-avatar--assistant" aria-hidden>
          <Sparkles size={18} />
        </div>
        <div className="stitch-thinking-dots" aria-hidden>
          <span /> <span /> <span />
        </div>
      </div>
    )
  }

  if (isEditing && isUser && onEditAndResend) {
    return (
      <article key={id} data-testid="message-user-editing" data-role={role} className="stitch-turn" aria-label="Edit your message">
        <div className="stitch-avatar stitch-avatar--user" aria-hidden>
          <PersonStanding size={18} />
        </div>
        <div className="stitch-turn-body">
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
        </div>
      </article>
    )
  }

  const hasReasoning = typeof reasoning === 'string' && reasoning.length > 0
  const timeLabel = formatTime(timestamp)

  if (isUser) {
    return (
      <article
        key={id}
        data-testid={streaming ? 'message-streaming' : 'message-user'}
        data-role="user"
        className="stitch-turn"
        aria-label="Your message"
      >
        <div className="stitch-avatar stitch-avatar--user" aria-hidden>
          <PersonStanding size={18} />
        </div>
        <div className="stitch-turn-body">
          <div className="stitch-turn-meta">
            <span className="stitch-turn-name">You</span>
            {timeLabel ? <span className="stitch-turn-time">{timeLabel}</span> : null}
          </div>
          <div className="stitch-user-bubble">
            {parsedParts.map((part, index) =>
              part.type === 'text' ? (
                <p key={`${id}-text-${index}`} className="bubble-text">
                  {part.text}
                </p>
              ) : null,
            )}
          </div>
          <span className="bubble-meta muted small" />
          {!streaming ? (
            <MessageActions
              role={role}
              content={content}
              onCopy={(c) => {
                onCopy?.(c)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              onRegenerate={onRegenerate}
              onEdit={onEditAndResend ? () => setIsEditing(true) : undefined}
              canRegenerate={canRegenerate}
              busy={busy}
            />
          ) : null}
          {copied ? <span className="stitch-copied-hint"><Check size={12} /> Copied</span> : null}
        </div>
      </article>
    )
  }

  return (
    <article
      key={id}
      data-testid={streaming ? 'message-streaming' : 'message-assistant'}
      data-role="assistant"
      className="stitch-turn"
      aria-label={streaming ? 'Assistant response in progress' : cancelled ? 'Cancelled generation' : 'Assistant response'}
      aria-live={streaming ? 'polite' : undefined}
    >
      <div className="stitch-avatar stitch-avatar--assistant" aria-hidden>
        <Sparkles size={18} />
      </div>
      <div className="stitch-turn-body stitch-assistant-body">
        <div className="stitch-turn-meta stitch-assistant-meta">
          <span className="stitch-turn-name">Sovora</span>
          {modelBadge ? <span className="stitch-model-badge">{modelBadge}</span> : null}
          {thoughtLabel ? <span className="stitch-turn-time">{thoughtLabel}</span> : null}
        </div>

        {hasReasoning ? (
          <ReasoningBlock
            reasoning={reasoning ?? ''}
            streaming={reasoningStreaming}
            open={showReasoning}
            onToggle={setShowReasoning}
          />
        ) : null}

        {parsedParts.map((part, index) => {
          if (part.type === 'code') {
            return (
              <ArtifactCard
                key={`${id}-code-${index}`}
                title={part.title}
                language={part.language}
                code={part.code}
                onOpenSplit={onOpenArtifact ? () => onOpenArtifact({ title: part.title, language: part.language, code: part.code }) : undefined}
              />
            )
          }
          return part.text.trim() ? (
            <div key={`${id}-text-${index}`} className="stitch-prose">
              <p className="bubble-text">
                {part.text}
                {streaming && index === parsedParts.length - 1 ? <span className="stream-caret" aria-hidden="true" /> : null}
              </p>
            </div>
          ) : null
        })}

        {cancelled ? <span className="bubble-meta muted small">Stopped — no reply was generated.</span> : null}
        {timeLabel ? (
          <span className="bubble-meta muted small">
            <time dateTime={timestamp ? new Date(timestamp).toISOString() : undefined}>{timeLabel}</time>
          </span>
        ) : null}

        {!streaming && !thinking && !loading ? (
          <MessageActions
            role={role}
            content={hasReasoning && reasoning ? `${reasoning}\n\n${content}` : content}
            onCopy={onCopy}
            onRegenerate={onRegenerate}
            onEdit={undefined}
            canRegenerate={canRegenerate}
            busy={busy}
          />
        ) : null}
        {copied ? <span className="stitch-copied-hint"><Copy size={12} /> Copied</span> : null}
      </div>
    </article>
  )
}
