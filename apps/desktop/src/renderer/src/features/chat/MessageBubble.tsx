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
  // Hide raw tool calls: <atem:invoke name="Read"> etc. should render as card, not leaked XML (your screenshot).
  // Replace with a compact "Used tool: Read" chip and strip the tag from text.
  const stripToolTags = (s: string): string => {
    // Remove full <atem:invoke>...</atem:invoke> blocks and bare <atem:...> fragments that leaked
    let out = s.replace(/<atem:invoke[^>]*>[\s\S]*?<\/atem:invoke>/gi, ' — used tool — ')
    out = out.replace(/<\/?atem:[^>]*>/gi, '')
    // Collapse the "I'll read the workspace root..." duplication that the model repeats inside/outside the tag
    out = out.replace(/(I'll read the workspace root to list all files and folders in the codebase\.)\s*\1/gi, '$1')
    return out
  }
  raw = stripToolTags(raw)
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
        <div className="sovereign-ledger" role="status" aria-label="Sovara loading">
          <div className="ledger-head">
            <span className="ledger-mark" aria-hidden><Sparkles size={14} /></span>
            <span className="ledger-name">Sovara</span>
            <span className="ledger-phase thinking">Thinking</span>
            <span className="ledger-meta">LOCAL MODEL — {modelBadge ?? 'spark x2.5 4b'} • Streaming…</span>
          </div>
          <div className="ledger-track" aria-hidden><div className="ledger-fill" style={{ width: '48%' } as React.CSSProperties} /></div>
          <div className="ledger-why">Analysing your request — why: building local context before generating • English only</div>
          <div className="ledger-foot">
            <span>Thinking</span>
            <span className="ledger-ticker" aria-hidden>[●●○]</span>
            <span style={{ marginLeft: 'auto', font: '400 10px/1 DM Mono', color: '#8A8279' }}>● Ready</span>
          </div>
        </div>
      </div>
    )
  }

  if (isEditing && isUser && onEditAndResend) {
    return (
      <article key={id} data-testid="message-user-editing" data-role={role} className="sv-message sv-message--user" aria-label="Edit your message">
        <div className="sv-message-bubble sv-message-user" style={{ width: '100%', maxWidth: 480 }}>
          <textarea
            className="sv-composer-input"
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value.slice(0, 32_000))}
            rows={3}
            autoFocus
            aria-label="Edit message"
            data-testid="edit-input"
            style={{ minHeight: 60, padding: '10px 12px', border: '1px solid #E8E4DE', borderRadius: 8, background: '#fff', color: '#1A1614', font: '400 13px/1.5 Manrope', width: '100%', resize: 'vertical' } as React.CSSProperties}
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
          if (!part.text.trim()) return null
          // Minimal markdown for assistant text: **bold**, *italic*, `inline`, -/1. lists, > quote
          // Keep it lightweight (no deps) and preserve whitespace for the model's **workspace**/**SOVARA runtime** etc.
          const renderMarkdown = (raw: string) => {
            const lines = raw.split('\n')
            const out: React.ReactNode[] = []
            let listBuf: string[] = []
            let listType: 'ul' | 'ol' | null = null
            const flushList = () => {
              if (listBuf.length === 0) return
              if (listType === 'ul') {
                out.push(
                  <ul key={`ul-${out.length}`} style={{ margin: '8px 0', paddingLeft: 20, listStyle: 'disc' }}>
                    {listBuf.map((li, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: inline(mdEscape(li)) }} />
                    ))}
                  </ul>
                )
              } else {
                out.push(
                  <ol key={`ol-${out.length}`} style={{ margin: '8px 0', paddingLeft: 20 }}>
                    {listBuf.map((li, i) => (
                      <li key={i} dangerouslySetInnerHTML={{ __html: inline(mdEscape(li)) }} />
                    ))}
                  </ol>
                )
              }
              listBuf = []
              listType = null
            }
            const mdEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            const inline = (s: string) =>
              s
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+?)`/g, '<code style="background:#f0ede7;padding:1px 4px;border-radius:4px;font:12px/1.2 ui-monospace">$1</code>')
                .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:#C65D3B;text-decoration:underline">$1</a>')
            for (const line of lines) {
              const t = line.trim()
              if (/^[-*]\s+/.test(t)) {
                if (listType !== 'ul') { flushList(); listType = 'ul' }
                listBuf.push(t.replace(/^[-*]\s+/, ''))
                continue
              }
              if (/^\d+\.\s+/.test(t)) {
                if (listType !== 'ol') { flushList(); listType = 'ol' }
                listBuf.push(t.replace(/^\d+\.\s+/, ''))
                continue
              }
              if (t.startsWith('> ')) {
                flushList()
                out.push(
                  <blockquote key={`bq-${out.length}`} style={{ borderLeft: '2px solid #E8E4DE', margin: '8px 0', paddingLeft: 12, color: '#5a564f' }} dangerouslySetInnerHTML={{ __html: inline(mdEscape(t.slice(2))) }} />
                )
                continue
              }
              if (t.startsWith('### ')) {
                flushList()
                out.push(<h3 key={`h3-${out.length}`} style={{ font: '600 13px/1.4 Manrope', margin: '10px 0 4px' }} dangerouslySetInnerHTML={{ __html: inline(mdEscape(t.slice(4))) }} />)
                continue
              }
              if (t === '') {
                flushList()
                out.push(<div key={`br-${out.length}`} style={{ height: 8 }} />)
                continue
              }
              flushList()
              out.push(<p key={`p-${out.length}`} style={{ margin: '6px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: inline(mdEscape(line)) }} />)
            }
            flushList()
            return out.length ? out : [<p key="p0" style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: inline(mdEscape(raw)) }} />]
          }
          return (
            <div key={`${id}-text-${index}`} style={{ width: '100%' }}>
              {renderMarkdown(part.text)}
              {streaming && index === parsedParts.length - 1 ? <span className="sv-stream-caret" aria-hidden="true" /> : null}
            </div>
          )
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
