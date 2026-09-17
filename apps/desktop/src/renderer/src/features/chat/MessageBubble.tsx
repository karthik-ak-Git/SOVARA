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

function parseMessageContent(raw: string, streaming = false): ParsedPart[] {
  // Force English lang for HTML artifact preview
  const normalizeCode = (code: string): string => code.replace(/<html\s+lang="es"/gi, '<html lang="en"').replace(/<html lang='es'/gi, "<html lang='en'")
  // Raw HTML diagram without fence (diagram-design outputs whole HTML file) — render as preview
  if (!raw.includes('```') && raw.includes('<svg') && raw.includes('</svg>')) {
    const htmlBlock = raw.includes('<!DOCTYPE') ? raw.slice(raw.indexOf('<!DOCTYPE')) : raw.slice(raw.indexOf('<svg'))
    const before = raw.includes('<!DOCTYPE') ? raw.slice(0, raw.indexOf('<!DOCTYPE')).trim() : ''
    const parts: ParsedPart[] = []
    if (before) parts.push({ type: 'text', text: before })
    parts.push({ type: 'code', language: 'html', code: normalizeCode(htmlBlock.trim()), title: 'diagram.html' })
    const afterIdx = raw.lastIndexOf('</html>')
    if (afterIdx !== -1 && afterIdx + 7 < raw.length) {
      const after = raw.slice(afterIdx + 7).trim()
      if (after) parts.push({ type: 'text', text: after })
    }
    return parts
  }
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
    let lang = match[1]?.trim() || 'code'
    let code = normalizeCode(match[2]?.trimEnd() ?? '')
    // If fence has no language but content is a diagram HTML, treat as html for preview
    if ((!lang || lang === 'code') && code.includes('<svg') && code.includes('</svg>')) {
      lang = 'html'
    }
    const title = code.includes('diagram-design') || code.includes('<svg')
      ? 'diagram.html'
      : lang.toLowerCase().includes('tsx')
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
  // Streaming partial fence: show live preview even before closing ```
  if (streaming && lastIndex < raw.length) {
    const tail = raw.slice(lastIndex)
    const openIdx = tail.indexOf('```')
    if (openIdx !== -1) {
      const header = tail.slice(openIdx + 3).trimStart()
      const nl = header.indexOf('\n')
      if (nl !== -1) {
        const lang = header.slice(0, nl).trim() || 'code'
        const code = normalizeCode(header.slice(nl + 1))
        const title = lang.toLowerCase().includes('html') ? 'index.html' : `${lang}-output`
        if (tail.slice(0, openIdx).trim()) parts.push({ type: 'text', text: tail.slice(0, openIdx) })
        parts.push({ type: 'code', language: lang || 'html', code, title })
        return parts
      }
    }
    if (tail.trim()) parts.push({ type: 'text', text: tail.slice(lastIndex - Math.min(lastIndex, raw.length)) })
    // if remaining tail after last closed fence is start of open fence, handled above
    if (parts.length === 0) return [{ type: 'text', text: raw }]
    return parts
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
    return parseMessageContent(content, streaming)
  }, [content, isUser, streaming])

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
      <div key={id} data-testid="assistant-thinking" data-role="assistant" className="sv-message sv-message--assistant" aria-live="polite" aria-label="Assistant is thinking" style={{ alignItems: 'flex-start' } as React.CSSProperties}>
        <div className="bot-type-box" style={{ flex: 1, maxWidth: 420, border: '1px solid #E8E4DE', borderRadius: 16, background: '#fff', padding: '14px 16px', boxShadow: '0 2px 12px rgba(60,50,40,.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: '#C65D3B', display: 'grid', placeItems: 'center', color: '#fff', flex: 'none' }}><Sparkles size={14} /></span>
            <span style={{ font: '600 13px/1 Manrope', color: '#1A1614' }}>Sovara</span>
            <span style={{ font: '500 10px/1 Manrope', color: '#22c55e', background: '#f0fdf4', padding: '2px 6px', borderRadius: 999, border: '1px solid #dcfce7' }}>● Connecting</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1 Manrope', color: '#8A8279' }}>
            <span>Thinking</span>
            <span className="sv-thinking-dots" aria-hidden style={{ display: 'inline-flex', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C65D3B', animation: 'pulse 1s infinite' } as React.CSSProperties} />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C65D3B', opacity: .6, animation: 'pulse 1s infinite .2s' } as React.CSSProperties} />
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C65D3B', opacity: .3, animation: 'pulse 1s infinite .4s' } as React.CSSProperties} />
            </span>
          </div>
        </div>
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 6, font: '500 10px/1 Manrope', color: '#8A8279' }}>
          <span style={{ padding: '6px 8px', borderRadius: 999, background: '#fff', border: '1px solid #E8E4DE', whiteSpace: 'nowrap' }}>LOCAL MODEL — {modelBadge ?? 'spark x2.5 4b'} • Streaming…</span>
          <span style={{ padding: '4px 8px', borderRadius: 999, background: '#f0fdf4', border: '1px solid #dcfce7', color: '#16a34a', fontSize: 10 }}>● Ready</span>
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
