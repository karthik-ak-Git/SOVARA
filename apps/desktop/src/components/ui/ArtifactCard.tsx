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
  const [tab, setTab] = useState<'code' | 'preview'>('code')
  const [copied, setCopied] = useState(false)
  const lang = language.toLowerCase()
  const isHtml = lang === 'html' || lang === 'svg'

  const handleCopy = (): void => {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
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
                onClick={() => setTab('preview')}
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
      {tab === 'preview' && isHtml ? (
        <div className="stitch-artifact-preview">
          <iframe
            srcDoc={code}
            title={title}
            sandbox="allow-scripts"
            style={{ width: '100%', height: '220px', border: 'none', background: '#ffffff', borderRadius: '4px' }}
          />
        </div>
      ) : (
        <pre className="stitch-artifact-code">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
