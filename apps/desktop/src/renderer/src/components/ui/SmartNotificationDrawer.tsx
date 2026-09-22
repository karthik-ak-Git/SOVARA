import { useState, useEffect, useRef, type CSSProperties } from 'react'
import { Bell, Bot, Cpu, Download, Activity, Sparkles, X, Zap, HardDrive, ArrowRight } from 'lucide-react'
import { detectExternalRuntimes, getActiveDownloads, onDownloadEvents, getHardwareProfile, type DownloadEventView } from '@/lib/client/api'
import type { HardwareInfo } from '@shared/types/explore'

interface SmartNotificationDrawerProps {
  variant?: 'icon' | 'sidebar-item'
  placement?: 'bottom-right' | 'right-start' | 'bottom-left'
  onOpenExplorer?: () => void
  onOpenSettings?: (section?: string) => void
}

export function SmartNotificationDrawer({
  variant = 'icon',
  placement = 'bottom-right',
  onOpenExplorer,
  onOpenSettings,
}: SmartNotificationDrawerProps) {
  const [open, setOpen] = useState(false)
  const [downloads, setDownloads] = useState<Record<string, DownloadEventView>>({})
  const [runtimeSummary, setRuntimeSummary] = useState<any>(null)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void detectExternalRuntimes().then(setRuntimeSummary).catch(() => {})
    void getHardwareProfile().then(setHw).catch(() => {})

    const timer = setInterval(() => {
      void detectExternalRuntimes().then(setRuntimeSummary).catch(() => {})
    }, 15_000)

    const dispose = onDownloadEvents((ev) => {
      setDownloads((prev) => {
        const next = { ...prev }
        const key = `${ev.modelId}\n${ev.rfilename}`
        if (ev.state === 'done' || ev.state === 'cancelled') {
          delete next[key]
        } else {
          next[key] = ev
        }
        return next
      })
    })

    void getActiveDownloads().catch(() => {})
    return () => {
      clearInterval(timer)
      dispose()
    }
  }, [])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const activeDlCount = Object.keys(downloads).length
  const ollamaOnline = runtimeSummary?.ollama?.online ?? false
  const lmOnline = runtimeSummary?.lmstudio?.online ?? false
  const totalLocal = runtimeSummary?.totalLocalModels ?? 0

  // Hardware profile recommendation
  const ramGB = hw ? Math.round(hw.totalRamMB / 1024) : 16
  const freeRamGB = hw ? (hw.freeRamMB / 1024).toFixed(1) : '8.0'
  const vramGB = hw?.totalVramMB ? (hw.totalVramMB / 1024).toFixed(1) : undefined
  const storageFree = hw?.storageFreeGB !== undefined ? `${hw.storageFreeGB} GB` : undefined

  const recommendation = (() => {
    if (!hw) return { tier: 'Detecting Hardware…', desc: 'Analyzing system capabilities…', badgeClass: 'sv-hw-badge--neutral' }
    if (hw.gpuAvailable && (hw.totalVramMB ?? 0) >= 7500) {
      return {
        tier: 'High Performance GPU',
        desc: 'Up to 8B–14B models (Llama 3.1 8B, Qwen 2.5 7B) fit in VRAM with full GPU offload.',
        badgeClass: 'sv-hw-badge--success',
      }
    }
    if (hw.gpuAvailable && (hw.totalVramMB ?? 0) >= 3000) {
      return {
        tier: 'Dedicated GPU Accelerated',
        desc: 'Compact 1B–4B models (Llama 3.2 3B, Qwen 2.5 3B, SmolLM2) offload with high tokens/sec.',
        badgeClass: 'sv-hw-badge--accent',
      }
    }
    return {
      tier: 'System RAM / CPU Mode',
      desc: 'Lightweight models (SmolLM2 135M/360M, Llama 3.2 1B, Qwen 0.5B/1.5B) run smoothly in system memory.',
      badgeClass: 'sv-hw-badge--neutral',
    }
  })()

  const popoverStyle: CSSProperties = placement === 'right-start'
    ? {
        position: 'absolute',
        top: 0,
        left: 'calc(100% + 8px)',
        width: 380,
        maxHeight: 520,
        background: '#FFFFFF',
        border: '1px solid #E8E4DE',
        borderRadius: 12,
        boxShadow: '0 12px 36px rgba(0,0,0,0.14)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : placement === 'bottom-left'
    ? {
        position: 'absolute',
        top: 36,
        left: 0,
        width: 380,
        maxHeight: 520,
        background: '#FFFFFF',
        border: '1px solid #E8E4DE',
        borderRadius: 12,
        boxShadow: '0 12px 36px rgba(0,0,0,0.14)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }
    : {
        position: 'absolute',
        top: 36,
        right: 0,
        width: 380,
        maxHeight: 520,
        background: '#FFFFFF',
        border: '1px solid #E8E4DE',
        borderRadius: 12,
        boxShadow: '0 12px 36px rgba(0,0,0,0.14)',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }

  const handleClick = () => {
    if (onOpenSettings) {
      onOpenSettings('notifications')
    } else {
      setOpen((p) => !p)
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: variant === 'sidebar-item' ? 'block' : 'inline-block', width: variant === 'sidebar-item' ? '100%' : 'auto' }}>
      {variant === 'sidebar-item' ? (
        <button
          type="button"
          className={`nav-item ${open ? 'selected' : ''}`}
          onClick={handleClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '7px 8px',
            borderRadius: 6,
            border: 'none',
            background: open ? '#f1f5f9' : 'transparent',
            color: open ? '#0f172a' : '#475569',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'background 120ms ease, color 120ms ease',
          }}
          aria-label="Smart Notifications"
          title="Hardware profile & local notifications"
        >
          <Bell size={16} aria-hidden style={{ color: '#64748b', flexShrink: 0 }} />
          <span style={{ flex: 1, textAlign: 'left' }}>Notifications</span>
          {activeDlCount > 0 ? (
            <span style={{ background: 'var(--accent, #D97757)', color: '#FFF', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
              {activeDlCount}
            </span>
          ) : hw ? (
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} title="Hardware detected & ready" />
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          className="sv-btn sv-btn-ghost"
          onClick={handleClick}
          style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px' }}
          aria-label="Smart notification center"
          title="Hardware Profile & Local Notifications"
        >
          <Bell size={15} />
          {activeDlCount > 0 ? (
            <span style={{ background: 'var(--accent, #D97757)', color: '#FFF', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
              {activeDlCount}
            </span>
          ) : hw ? (
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
          ) : null}
        </button>
      )}

      {open ? (
        <div style={popoverStyle}>
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border, #E8E4DE)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'var(--bg-2, #F7F5F2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13, color: '#1A1614' }}>
              <Sparkles size={16} color="var(--accent, #C65D3B)" />
              Smart Notifications & Hardware
            </div>
            <button
              type="button"
              className="sv-btn sv-btn-ghost"
              style={{ padding: 2 }}
              onClick={() => setOpen(false)}
              aria-label="Close notifications"
            >
              <X size={14} />
            </button>
          </div>

          <div style={{ padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* 1. Hardware Detection Profile & Model Suggestions */}
            {hw ? (
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #FFFFFF 0%, #FAF8F5 100%)',
                  border: '1px solid #E8E2D9',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 12, color: '#1A1614' }}>
                    <Zap size={14} color="#C65D3B" />
                    <span>PC Hardware Detected</span>
                  </div>
                  <span className={`sv-hw-badge ${recommendation.badgeClass}`} style={{ fontSize: 9, padding: '2px 6px' }}>
                    {recommendation.tier}
                  </span>
                </div>

                <div style={{ font: '500 11px/1.4 "DM Mono", monospace', color: '#6B635B', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ color: '#1A1614', fontWeight: 600 }}>{hw.gpuAvailable && hw.gpuName ? hw.gpuName : 'CPU Inference'}</span>
                  {vramGB ? <span>({vramGB} GB VRAM)</span> : null}
                  <span>•</span>
                  <span>{ramGB} GB RAM ({freeRamGB} GB free)</span>
                  {storageFree ? (
                    <>
                      <span>•</span>
                      <span><HardDrive size={10} style={{ display: 'inline', verticalAlign: -1, marginRight: 2 }} />{storageFree} free</span>
                    </>
                  ) : null}
                </div>

                <p style={{ margin: 0, fontSize: 11, lineHeight: 1.4, color: '#554F48' }}>
                  {recommendation.desc}
                </p>

                {onOpenExplorer ? (
                  <button
                    type="button"
                    className="sv-btn sv-btn-primary sv-hw-btn"
                    onClick={() => {
                      setOpen(false)
                      onOpenExplorer()
                    }}
                    style={{
                      marginTop: 2,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '5px 10px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                      borderRadius: 6,
                      background: '#C65D3B',
                      color: '#FFF',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <span>Explore Compatible Models</span>
                    <ArrowRight size={12} />
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* 2. Active Downloads Section */}
            {activeDlCount > 0 ? (
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2, #F7F5F2)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Download size={14} color="var(--accent, #C65D3B)" />
                  Active Model Downloads ({activeDlCount})
                </div>
                {Object.values(downloads).map((ev) => {
                  const pct = ev.totalBytes ? Math.min(100, Math.round((ev.receivedBytes / ev.totalBytes) * 100)) : 0
                  const speedMBps = ev.speedBps ? (ev.speedBps / (1024 * 1024)).toFixed(1) : null
                  return (
                    <div key={`${ev.modelId}-${ev.rfilename}`} style={{ marginBottom: 8, fontSize: 11 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                          {ev.rfilename}
                        </span>
                        <span>{pct}%</span>
                      </div>
                      <div style={{ height: 4, width: '100%', background: '#E8E4DE', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent, #C65D3B)', transition: 'width 0.2s' }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, color: 'var(--muted-2)', fontSize: 10 }}>
                        <span>{speedMBps ? `${speedMBps} MB/s` : 'Downloading…'}</span>
                        <span>{ev.etaSeconds ? `${Math.ceil(ev.etaSeconds)}s left` : ''}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {/* 3. Runtime Analyzer Status */}
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2, #F7F5F2)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={14} color="#2B8A3E" />
                Detected Runtimes & Local Models
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Bot size={14} /> Ollama (:11434)
                  </span>
                  <span style={{ fontWeight: 600, color: ollamaOnline ? '#2B8A3E' : 'var(--muted-2)' }}>
                    {ollamaOnline ? `Online (${runtimeSummary?.ollama?.manifestCount ?? 0} models)` : 'Not running'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Cpu size={14} /> LM Studio (:1234)
                  </span>
                  <span style={{ fontWeight: 600, color: lmOnline ? '#2B8A3E' : 'var(--muted-2)' }}>
                    {lmOnline ? `Online (${runtimeSummary?.lmstudio?.manifestCount ?? 0} models)` : 'Not running'}
                  </span>
                </div>
              </div>
            </div>

            {/* Total Models Summary */}
            <div style={{ fontSize: 11, color: 'var(--muted-2)', textAlign: 'center', padding: 4 }}>
              Total local models indexed: <strong>{totalLocal}</strong>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
