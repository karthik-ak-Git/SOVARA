'use client'

import { FileText, X } from 'lucide-react'

interface ContextPanelProps {
  sessionTitle?: string
  projectName?: string | null
  modelName?: string
  modelStatus?: string
  branch?: string
  onClose?: () => void
}

function InfoRow({ label, value, good }: { label: string; value: string; good?: boolean }): React.JSX.Element {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong className={good ? 'good' : ''}>{value}</strong>
    </div>
  )
}

function ContextSection({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="context-section">
      <div className="section-label" style={{ paddingLeft: 0, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  )
}

export function ContextPanel({
  sessionTitle = 'Untitled',
  projectName,
  modelName = 'No Model',
  modelStatus = 'Offline',
  branch = 'main',
  onClose,
}: ContextPanelProps): React.JSX.Element {
  return (
    <aside className="context-panel" aria-label="Session context">
      <div className="context-heading">
        <span>Session context</span>
        <button type="button" className="topbar-icon-btn" onClick={onClose} aria-label="Close context panel" style={{ width: 26, height: 26 } as React.CSSProperties}>
          <X size={15} aria-hidden />
        </button>
      </div>
      <ContextSection title="SESSION">
        <InfoRow label="Name" value={sessionTitle} />
        <InfoRow label="Updated" value="Just now" />
      </ContextSection>
      <ContextSection title="WORKSPACE">
        <InfoRow label="Project" value={projectName ?? '—'} />
        <InfoRow label="Branch" value={branch} />
      </ContextSection>
      <ContextSection title="MODEL">
        <InfoRow label="Model" value={modelName} />
        <InfoRow label="Status" value={modelStatus} good={modelStatus === 'Ready'} />
      </ContextSection>
      <ContextSection title="FILES">
        <div className="context-empty">
          <FileText size={15} aria-hidden />
          No files attached
        </div>
      </ContextSection>
      <ContextSection title="RUNTIME">
        <InfoRow label="GPU" value="Desktop only" />
        <div style={{ fontSize: 10, color: '#9a9288', marginTop: 6, lineHeight: 1.5 }}>Live GPU load, VRAM, tokens/s and context usage appear in the SOVARA desktop app — web is static.</div>
      </ContextSection>
    </aside>
  )
}
