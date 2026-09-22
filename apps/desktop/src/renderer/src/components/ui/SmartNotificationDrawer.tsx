import { useState, useEffect } from 'react'
import { Bell, Bot, Cpu, Download, Activity, Sparkles, X } from 'lucide-react'
import { detectExternalRuntimes, getActiveDownloads, onDownloadEvents, type DownloadEventView } from '@/lib/client/api'

export function SmartNotificationDrawer() {
  const [open, setOpen] = useState(false)
  const [downloads, setDownloads] = useState<Record<string, DownloadEventView>>({})
  const [runtimeSummary, setRuntimeSummary] = useState<any>(null)

  useEffect(() => {
    void detectExternalRuntimes().then(setRuntimeSummary).catch(() => {})
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

  const activeDlCount = Object.keys(downloads).length
  const ollamaOnline = runtimeSummary?.ollama?.online ?? false
  const lmOnline = runtimeSummary?.lmstudio?.online ?? false
  const totalLocal = runtimeSummary?.totalLocalModels ?? 0

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="sv-btn sv-btn-ghost"
        onClick={() => setOpen((p) => !p)}
        style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '4px 8px' }}
        aria-label="Smart notification center"
        title="Local Runtime Analyzer & Downloads"
      >
        <Bell size={15} />
        {activeDlCount > 0 ? (
          <span style={{ background: 'var(--accent, #D97757)', color: '#FFF', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>
            {activeDlCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 36,
            right: 0,
            width: 360,
            maxHeight: 480,
            background: 'var(--bg-1, #FFFFFF)',
            border: '1px solid var(--border, #E8E4DE)',
            borderRadius: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 13 }}>
              <Sparkles size={16} color="var(--accent, #D97757)" />
              Smart Notification & Runtime Analyzer
            </div>
            <button
              type="button"
              className="sv-btn sv-btn-ghost"
              style={{ padding: 2 }}
              onClick={() => setOpen(false)}
            >
              <X size={14} />
            </button>
          </div>

          <div style={{ padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Active Downloads Section */}
            {activeDlCount > 0 ? (
              <div style={{ padding: 10, borderRadius: 8, background: 'var(--bg-2, #F7F5F2)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Download size={14} color="var(--accent)" />
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
                        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent, #D97757)', transition: 'width 0.2s' }} />
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

            {/* Runtime Analyzer Status */}
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
