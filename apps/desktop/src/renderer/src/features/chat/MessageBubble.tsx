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
  execPhase?: string
  execLabel?: string | null
  execDetail?: string | null
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

interface StructuredResponseItem {
  type: 'structured'
  summary?: string
  files?: Array<{ path: string; action?: string; description?: string }>
  port?: number
  url?: string
  details?: string
  rawJson: string
}

type ParsedPart = CodeBlockItem | TextItem | StructuredResponseItem

function parseMessageContent(raw: string, streaming = false): ParsedPart[] {
  // Hide raw tool/thinking leaks: <thinking>...</thinking> should be ReasoningBlock, not bubble text (your 10:49 PM screenshot).
  // Also <atem:invoke> leaked as "— used tool —" must be card. Strip both so bubble shows only the final answer.
  const stripToolTags = (s: string): string => {
    // 1) Remove <thinking>...</thinking> and <think>...</think> entirely (including content) — that is reasoning, not answer
    let out = s.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    out = out.replace(/<think>[\s\S]*?<\/think>/gi, '')
    // 2) Remove XML tags from prompt/tool injection leaks (<system_message>, <context_summary>, <user_request>, <implementation_plan>, <walkthrough>)
    out = out.replace(/<system_message>[\s\S]*?<\/system_message>/gi, '')
    out = out.replace(/<context_summary>[\s\S]*?<\/context_summary>/gi, '')
    out = out.replace(/<user_request>[\s\S]*?<\/user_request>/gi, '')
    out = out.replace(/<\/?system_message>/gi, '')
    out = out.replace(/<\/?context_summary>/gi, '')
    out = out.replace(/<\/?user_request>/gi, '')
    out = out.replace(/<\/?implementation_plan>/gi, '')
    out = out.replace(/<\/?walkthrough>/gi, '')
    out = out.replace(/<\/?artifact[^>]*>/gi, '')
    // 3) Remove any stray opening/closing thinking tags that were split across chunks
    out = out.replace(/<\/?thinking>/gi, '').replace(/<\/?think>/gi, '')
    // 4) Remove full <atem:invoke>...</atem:invoke> blocks and bare <atem:...> fragments that leaked
    out = out.replace(/<atem:invoke[^>]*>[\s\S]*?<\/atem:invoke>/gi, ' ')
    out = out.replace(/<\/?atem:[^>]*>/gi, '')
    // 5) Remove <tool_call>...</tool_call>, <function>...</function>, <invoke>...</invoke>,
    //    <parameter>...</parameter> tags that Nemotron and similar models emit as raw tool syntax.
    out = out.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    out = out.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/gi, '')
    out = out.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')
    // Stray closing tags from split/partial blocks
    out = out.replace(/<\/parameter>/gi, '').replace(/<\/function>/gi, '').replace(/<\/tool_call>/gi, '').replace(/<\/invoke>/gi, '')
    out = out.replace(/<parameter\s[^>]*>/gi, '').replace(/<function\s[^>]*>/gi, '').replace(/<tool_call>/gi, '')
    // 6) Collapse "— used tool —" chip duplication and repeated text
    out = out.replace(/—\s*used tool\s*—/gi, ' ')
    out = out.replace(/(I'll read the workspace root to list all files and folders in the codebase\.)\s*\1/gi, '$1')
    out = out.replace(/(Let me explore the workspace to understand the codebase structure and list all the files\.)\s*\1/gi, '$1')
    out = out.replace(/\n{3,}/g, '\n\n')
    return out.trim()
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
  const fenceRegex = /```([a-zA-Z0-9_:-]*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: raw.slice(lastIndex, match.index) })
    }
    let lang = match[1]?.trim() || 'code'
    let code = normalizeCode(match[2]?.trimEnd() ?? '')

    // Structured JSON response check (json:response or json with summary/files)
    if (lang === 'json:response' || (lang.startsWith('json') && code.includes('"summary"'))) {
      try {
        const parsed = JSON.parse(code)
        if (parsed && typeof parsed === 'object') {
          const summary = typeof parsed.summary === 'string' ? parsed.summary : undefined
          const details = typeof parsed.details === 'string' ? parsed.details : typeof parsed.text === 'string' ? parsed.text : undefined
          const files = Array.isArray(parsed.files)
            ? (parsed.files as Array<Record<string, unknown>>)
                .filter((f) => f && typeof f['path'] === 'string')
                .map((f) => ({
                  path: String(f['path']),
                  action: typeof f['action'] === 'string' ? f['action'] : undefined,
                  description: typeof f['description'] === 'string' ? f['description'] : undefined,
                }))
            : undefined
          const port = typeof parsed.port === 'number' ? parsed.port : undefined
          const url = typeof parsed.url === 'string' ? parsed.url : undefined
          if (summary || files || details || port || url) {
            parts.push({
              type: 'structured',
              summary,
              files,
              port,
              url,
              details,
              rawJson: code,
            })
            lastIndex = match.index + match[0].length
            continue
          }
        }
      } catch {
        // Incomplete/streaming JSON — fall through to code block display
      }
    }

    // If fence has no language but content is a diagram HTML, treat as html for preview
    if ((!lang || lang === 'code') && code.includes('<svg') && code.includes('</svg>')) {
      lang = 'html'
    }
    const title = code.includes('diagram-design') || code.includes('<svg')
      ? 'diagram.html'
      : lang.toLowerCase() === 'url' || lang.toLowerCase() === 'server' || /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+/i.test(code.trim())
      ? `Live Server (${code.trim().match(/:\d+/)?.[0]?.slice(1) || 'App'})`
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
    // Skip empty fences (Qwen at 7/32 emits ```json``` with no body → empty data.json card duplication)
    if (!code.trim()) {
      lastIndex = match.index + match[0].length
      continue
    }
    parts.push({ type: 'code', language: lang, code, title })
    lastIndex = match.index + match[0].length
  }
  // Dedupe identical adjacent parts (your 11:05 PM screenshot: same data.json card + same text twice)
  const deduped: ParsedPart[] = []
  for (const p of parts) {
    const prev = deduped[deduped.length - 1]
    if (prev && prev.type === p.type) {
      const a = prev.type === 'code' ? (prev as { code: string }).code.trim() : (prev as { text: string }).text.trim()
      const b = p.type === 'code' ? (p as { code: string }).code.trim() : (p as { text: string }).text.trim()
      if (a === b && a.length > 0) continue
      if (prev.type === 'text' && p.type === 'text' && a.length > 40 && b.startsWith(a.slice(0, 40))) continue
    }
    deduped.push(p)
  }
  parts.length = 0
  parts.push(...deduped)
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
  execPhase,
  execLabel,
  execDetail,
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
        <div className="sv-message-avatar sv-message-avatar--assistant is-live" aria-hidden>
          <Sparkles size={16} className="bot-live-sparkle" />
        </div>
        <div className="sv-thinking-dots" aria-hidden>
          <span /> <span /> <span />
        </div>
      </div>
    )
  }

  if (thinking) {
    const phaseKey = execPhase ?? 'thinking'
    const phaseLabel =
      phaseKey === 'loading'
        ? 'Loading'
        : phaseKey === 'reading'
        ? 'Reading'
        : phaseKey === 'planning'
        ? 'Planning'
        : phaseKey === 'prompting'
        ? 'Prompting'
        : phaseKey === 'selecting'
        ? 'Routing'
        : phaseKey === 'tool'
        ? 'Running Tool'
        : phaseKey === 'artifact'
        ? 'Writing File'
        : 'Thinking'


    // Build activity steps based on current phase
    const phaseSteps: Array<{ label: string; done: boolean; active: boolean }> = []

    if (phaseKey === 'reading') {
      phaseSteps.push({ label: execDetail ?? 'Reading workspace context…', done: false, active: true })
    } else if (phaseKey === 'planning') {
      phaseSteps.push({ label: 'Reading workspace context', done: true, active: false })
      phaseSteps.push({ label: execDetail ?? 'Analyzing task intent…', done: false, active: true })
    } else if (phaseKey === 'prompting') {
      phaseSteps.push({ label: 'Reading workspace context', done: true, active: false })
      phaseSteps.push({ label: 'Analyzing task intent', done: true, active: false })
      phaseSteps.push({ label: 'Assembling prompt…', done: false, active: true })
    } else if (phaseKey === 'selecting') {
      phaseSteps.push({ label: 'Assembled prompt', done: true, active: false })
      phaseSteps.push({ label: `Routing to best model${execDetail ? ` — ${execDetail}` : ''}…`, done: false, active: true })
    } else if (phaseKey === 'loading') {
      phaseSteps.push({ label: 'Routing complete', done: true, active: false })
      phaseSteps.push({ label: execLabel ?? `Loading ${modelBadge ?? 'model weights'}…`, done: false, active: true })
    } else if (phaseKey === 'thinking') {
      phaseSteps.push({ label: `Loaded ${modelBadge ?? 'model'}`, done: true, active: false })
      phaseSteps.push({ label: execDetail ?? 'Reasoning through the task…', done: false, active: true })
    } else {
      phaseSteps.push({ label: execLabel ?? 'Working…', done: false, active: true })
    }

    return (
      <div key={id} data-testid="assistant-thinking" data-role="assistant" className="sv-message sv-message--assistant" aria-live="polite" aria-label="Assistant is thinking" style={{ alignItems: 'flex-start' } as React.CSSProperties}>
        <div className="sv-thinking-activity" role="status" aria-label="Sovara working">
          <div className="sv-thinking-activity-header">
            <Sparkles size={13} className="sv-thinking-sparkle" />
            <span className="sv-thinking-activity-title">{phaseLabel}</span>
            <span className="sv-thinking-activity-chevron">›</span>
          </div>
          <div className="sv-thinking-activity-steps">
            {phaseSteps.map((step, idx) => (
              <div key={idx} className={`sv-thinking-step ${step.done ? 'is-done' : ''} ${step.active ? 'is-active' : ''}`}>
                {step.done ? (
                  <span className="sv-thinking-step-verb">Completed</span>
                ) : (
                  <span className="sv-thinking-step-verb">Working</span>
                )}
                <span className="sv-thinking-step-label">{step.label}</span>
                {step.active && (
                  <span className="sv-thinking-step-dot" aria-hidden />
                )}
              </div>
            ))}
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
      <div className={`sv-message-avatar sv-message-avatar--assistant ${streaming ? 'is-live' : ''}`} aria-hidden>
        <Sparkles size={16} className={streaming ? 'bot-live-sparkle' : ''} />
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

          if (part.type === 'structured') {
            return (
              <div
                key={`${id}-struct-${index}`}
                className="sv-structured-card"
                style={{
                  margin: '10px 0',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                {part.summary ? (
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: part.files?.length || part.details ? '8px' : 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Sparkles size={14} style={{ color: '#E06C47' }} />
                    <span>{part.summary}</span>
                  </div>
                ) : null}
                {(part.url || part.port) ? (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    margin: '8px 0',
                    background: 'rgba(56, 189, 248, 0.1)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    borderRadius: '6px',
                    fontSize: '0.85rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px #38bdf8', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600, color: '#38bdf8' }}>App running on:</span>
                      <code style={{ color: '#fff', fontWeight: 600 }}>{part.url || `http://localhost:${part.port}`}</code>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="sv-btn"
                        style={{ padding: '3px 8px', fontSize: '11px', background: '#0284c7', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        onClick={() => {
                          const u = part.url || `http://localhost:${part.port}`
                          if (onOpenArtifact) {
                            onOpenArtifact({ title: `Live Server (${part.port || u})`, language: 'url', code: u })
                          }
                        }}
                      >
                        Preview in Artifact
                      </button>
                      <button
                        type="button"
                        className="sv-btn"
                        style={{ padding: '3px 8px', fontSize: '11px', background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '4px', cursor: 'pointer' }}
                        onClick={() => {
                          const u = part.url || `http://localhost:${part.port}`
                          window.open(u, '_blank')
                        }}
                      >
                        Open Browser ↗
                      </button>
                    </div>
                  </div>
                ) : null}
                {part.files && part.files.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', margin: '8px 0' }}>
                    {part.files.map((f, fi) => (
                      <div
                        key={fi}
                        role="button"
                        tabIndex={0}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          fontSize: '0.85rem',
                          padding: '6px 10px',
                          background: 'rgba(0, 0, 0, 0.15)',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          userSelect: 'none',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                        }}
                        onClick={async () => {
                          if (!f.path) return
                          try {
                            const { openArtifact } = await import('../../lib/client/api')
                            void openArtifact(f.path)
                          } catch {}
                          if (onOpenArtifact) {
                            try {
                              const { dispatchTool } = await import('../../lib/client/api')
                              const raw = await dispatchTool('fs_read', { path: f.path }).catch(() => '')
                              const code = typeof raw === 'string' ? raw : (raw as { output?: string })?.output ?? ''
                              const ext = f.path.split('.').pop()?.toLowerCase() ?? 'text'
                              const lang = ext === 'html' ? 'html' : ext === 'css' ? 'css' : ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx' ? 'javascript' : ext
                              onOpenArtifact({ title: f.path, language: lang, code: code || `File: ${f.path}` })
                            } catch {
                              onOpenArtifact({ title: f.path, language: 'code', code: `File: ${f.path}` })
                            }
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            const target = e.currentTarget
                            target.click()
                          }
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.72rem',
                            textTransform: 'uppercase',
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: f.action === 'created' ? 'rgba(74, 222, 128, 0.18)' : f.action === 'modified' ? 'rgba(96, 165, 250, 0.18)' : 'rgba(255, 255, 255, 0.1)',
                            color: f.action === 'created' ? '#4ade80' : f.action === 'modified' ? '#60a5fa' : '#94a3b8',
                          }}
                        >
                          {f.action || 'file'}
                        </span>
                        <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.84rem', fontWeight: 600, color: '#fff', textDecoration: 'underline' }}>{f.path}</code>
                        {f.description ? <span style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>— {f.description}</span> : null}
                        <button
                          type="button"
                          style={{
                            marginLeft: 'auto',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid rgba(96, 165, 250, 0.4)',
                            background: 'rgba(96, 165, 250, 0.15)',
                            color: '#60a5fa',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Open ↗
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {part.details ? (
                  <div style={{ marginTop: '8px', fontSize: '0.9rem', lineHeight: 1.5 }}>
                    {renderMarkdown(part.details)}
                  </div>
                ) : null}
              </div>
            )
          }

          if (!part.text.trim()) return null
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
