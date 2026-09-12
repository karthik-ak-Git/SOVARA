'use client'

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
 * MessageBubble — SOVARA chat bubble (commit 257ec52 style).
 * User: right-aligned white bubble.
 * Assistant: left-aligned with terracotta avatar + Newsreader prose.
 * All handlers/testids preserved; visual layer uses sv-* CSS classes.
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
      <div key={id} data-testid="assistant-typing" data-role="assistant" className="sv-message sv-message--assistant" aria-live="polite" aria-label="Assistant is typing">
        <div className="sv-message-avatar sv-message-avatar--assistant" aria-hidden>
          <Sparkles size={16} />
        </div>
        <div className="sv-thinking-dots" aria-hidden>
          <span /> <span /> <span />
        </div>
      </div>
    )
  }

  if (thinking) {
    return (
      <div key={id} data-testid="assistant-thinking" data-role="assistant" className="sv-message sv-message--assistant" aria-live="polite" aria-label="Assistant is thinking">
        <div className="sv-message-avatar sv-message-avatar--assistant" aria-hidden>
          <Sparkles size={16} />
        </div>
        <div className="sv-thinking-dots" aria-hidden>
          <span /> <span /> <span />
        </div>
      </div>
    )
  }

  if (isEditing && isUser && onEditAndResend) {
    return (
      <article key={id} data-testid="message-user-editing" data-role={role} className="sv-message sv-message--user" aria-label="Edit your message">
        <div className="sv-message-bubble sv-message-user">
          <textarea
            className="sv-composer-input"
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value.slice(0, 32_000))}
            rows={3}
            autoFocus
            aria-label="Edit message"
            data-testid="edit-input"
            style={{ minHeight: 60, padding: 0 }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button
              type="button"
              className="sv-btn sv-btn-primary"
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
              className="sv-btn sv-btn-ghost"
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
        className="sv-message sv-message--user"
        aria-label="Your message"
      >
        <div className="sv-message-bubble sv-message-user">
          <div className="sv-message-meta">
            <span className="sv-message-name">You</span>
            {timeLabel ? <span className="sv-message-time">{timeLabel}</span> : null}
          </div>
          {parsedParts.map((part, index) =>
            part.type === 'text' ? (
              <p key={`${id}-text-${index}`} style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {part.text}
              </p>
            ) : null,
          )}
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
          {copied ? <span className="sv-copied-hint"><Check size={10} /> Copied</span> : null}
        </div>
      </article>
    )
  }

  return (
    <article
      key={id}
      data-testid={streaming ? 'message-streaming' : 'message-assistant'}
      data-role="assistant"
      className="sv-message sv-message--assistant"
      aria-label={streaming ? 'Assistant response in progress' : cancelled ? 'Cancelled generation' : 'Assistant response'}
      aria-live={streaming ? 'polite' : undefined}
    >
      <div className="sv-message-avatar sv-message-avatar--assistant" aria-hidden>
        <Sparkles size={16} />
      </div>
      <div className="sv-message-bubble sv-message-assistant">
        <div className="sv-message-meta">
          <span className="sv-message-name">Sovora</span>
          {modelBadge ? <span className="sv-message-model-badge">{modelBadge}</span> : null}
          {thoughtLabel ? <span className="sv-message-time">{thoughtLabel}</span> : null}
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
            <p key={`${id}-text-${index}`}>
              {part.text}
              {streaming && index === parsedParts.length - 1 ? <span className="sv-stream-caret" aria-hidden="true" /> : null}
            </p>
          ) : null
        })}

        {cancelled ? <span style={{ fontSize: 12, color: 'var(--stitch-muted, #8A8279)' }}>Stopped — no reply was generated.</span> : null}
        {timeLabel ? (
          <span style={{ fontSize: 11, color: 'var(--stitch-muted, #8A8279)' }}>
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
        {copied ? <span className="sv-copied-hint"><Copy size={10} /> Copied</span> : null}
      </div>
    </article>
  )
}
