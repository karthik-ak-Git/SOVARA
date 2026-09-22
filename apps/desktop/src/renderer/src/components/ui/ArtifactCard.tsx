'use client'

import { useState, useEffect, type ReactElement } from 'react'
import { Code2, Copy, Check, ExternalLink } from 'lucide-react'
import { preparePreviewHtml, isVisualArtifact } from '../../utils/previewBundler'

interface Props {
  title: string
  language: string
  code: string
  onOpenSplit?: () => void
}

/**
 * ArtifactCard — Rich artifact card for desktop chat.
 * Header: icon + title + lang badge | Code/Preview tabs (HTML/SVG/React/Mermaid) + Copy + Split View.
 * Preview uses sandboxed iframe supporting live React apps and Mermaid diagrams.
 */
export function ArtifactCard({ title, language, code, onOpenSplit }: Props): ReactElement {
  const [copied, setCopied] = useState(false)
  const [bundledHtml, setBundledHtml] = useState<string>('')
  const lang = language.toLowerCase()
  const canPreview = isVisualArtifact(code, lang)
  const defaultTab: 'code' | 'preview' = canPreview ? 'preview' : 'code'
  const [tab, setTab] = useState<'code' | 'preview'>(defaultTab)

  useEffect(() => {
    if (canPreview) {
      let isCancelled = false
      preparePreviewHtml(code, undefined, undefined, lang).then((res) => {
        if (!isCancelled) setBundledHtml(res)
      })
      return () => {
        isCancelled = true
      }
    } else {
      setBundledHtml('')
    }
  }, [code, canPreview, lang])

  const handleCopy = (): void => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(code).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => {})
    }
  }

  const isTall = lang === 'mermaid' || code.includes('<svg') || lang === 'tsx' || lang === 'jsx' || lang === 'react'

  return (
    <div className="stitch-artifact-card" role="region" aria-label={`Artifact ${title}`}>
      <div className="stitch-artifact-header">
        <div className="stitch-artifact-info">
          <Code2 size={16} aria-hidden />
          <span className="stitch-artifact-title">{title}</span>
          <span className="stitch-artifact-badge">{language}</span>
        </div>
        <div className="stitch-artifact-actions">
          {canPreview ? (
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
      {tab === 'preview' && canPreview && !onOpenSplit ? (
        <div className="stitch-artifact-preview" style={{ background: '#090d16', borderRadius: '8px', overflow: 'hidden', border: '1px solid #1e293b' }}>
          {bundledHtml ? (
            <iframe
              srcDoc={bundledHtml}
              title={title}
              sandbox="allow-scripts allow-modals"
              loading="lazy"
              style={{ width: '100%', height: isTall ? '500px' : '420px', border: 'none', display: 'block', background: '#090d16' }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: isTall ? '500px' : '420px', gap: 12, color: '#475569', fontSize: 13 }}>
              <div style={{ width: 28, height: 28, border: '2px solid #334155', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              <span>Preparing preview…</span>
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
        </div>
      ) : tab === 'preview' && canPreview && onOpenSplit ? (
        <div style={{ padding: '14px 16px', background: '#090d16', borderTop: '1px solid #1e293b', font: '400 12px/1.5 Manrope', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>Preview opened in right artifact viewer →</span>
          <button type="button" onClick={onOpenSplit} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #334155', background: '#1e293b', color: '#38bdf8', font: '600 11px/1 Manrope', cursor: 'pointer' }}>Open</button>
        </div>
      ) : (
        <pre className="stitch-artifact-code">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
