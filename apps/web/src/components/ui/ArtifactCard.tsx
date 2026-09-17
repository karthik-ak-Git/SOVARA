'use client'

import { useState, type ReactElement } from 'react'
import { Code2, Copy, Check, ExternalLink } from 'lucide-react'

interface Props {
  title: string
  language: string
  code: string
  onOpenSplit?: () => void
}

/**
 * ArtifactCard — Stitch inline rich artifact card (generic only).
 * Header: icon + title + lang badge | Code/Preview tabs (HTML/SVG only) + Copy + Split View.
 * Preview for HTML/SVG uses sandboxed iframe; other languages show code only.
 * No visualizer demo, no new execution wiring.
 */
export function ArtifactCard({ title, language, code, onOpenSplit }: Props): ReactElement {
  const [copied, setCopied] = useState(false)
  const lang = language.toLowerCase()
  const isDiagram = code.includes('<svg') && code.includes('</svg>')
  const isHtml = lang === 'html' || lang === 'svg' || isDiagram
  const defaultTab: 'code' | 'preview' = isDiagram || lang === 'html' || lang === 'svg' ? 'preview' : 'code'
  const [tab, setTab] = useState<'code' | 'preview'>(defaultTab)

  const handleCopy = (): void => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(code).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => {})
    }
  }

  return (
    <div className="stitch-artifact-card" role="region" aria-label={`Artifact ${title}`}>
      <div className="stitch-artifact-header">
        <div className="stitch-artifact-info">
          <Code2 size={16} aria-hidden />
          <span className="stitch-artifact-title">{title}</span>
          <span className="stitch-artifact-badge">{language}</span>
        </div>
        <div className="stitch-artifact-actions">
          {isHtml ? (
            <div className="stitch-artifact-tabs" role="tablist" aria-label="Artifact view">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'code'}
                className={`stitch-artifact-tab${tab === 'code' ? ' active' : ''}`}
                onClick={() => setTab('code')}
              >
                Code
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'preview'}
                className={`stitch-artifact-tab${tab === 'preview' ? ' active' : ''}`}
                onClick={() => { if (onOpenSplit) { onOpenSplit(); } else { setTab('preview') } }}
                title={onOpenSplit ? 'Open preview in right artifact viewer' : 'Preview'}
              >
                Preview
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className="stitch-artifact-btn"
            onClick={handleCopy}
            title={copied ? 'Copied to clipboard' : 'Copy code'}
            aria-label="Copy code"
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          </button>
          {onOpenSplit ? (
            <button
              type="button"
              className="stitch-artifact-btn stitch-artifact-split"
              onClick={onOpenSplit}
              title="Open in Split View"
              aria-label="Open in Split View"
            >
              <ExternalLink size={14} aria-hidden />
              <span className="hidden-sm">Split View</span>
            </button>
          ) : null}
        </div>
      </div>
      {tab === 'preview' && isHtml && !onOpenSplit ? (
        <div className="stitch-artifact-preview" style={{ background: '#fffefa', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E8E4DE' }}>
          <iframe
            srcDoc={code}
            title={title}
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            style={{ width: '100%', height: isDiagram ? '520px' : '420px', border: 'none', display: 'block', background: '#fffefa' }}
          />
        </div>
      ) : tab === 'preview' && isHtml && onOpenSplit ? (
        <div style={{ padding: '14px 16px', background: '#fffefa', borderTop: '1px solid #E8E4DE', font: '400 12px/1.5 Manrope', color: '#8A8279', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Preview opened in right artifact viewer →</span>
          <button type="button" onClick={onOpenSplit} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #E8E4DE', background: '#fff', color: '#C65D3B', font: '600 11px/1 Manrope', cursor: 'pointer' }}>Open</button>
        </div>
      ) : (
        <pre className="stitch-artifact-code">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
