'use client'
import { useState, useCallback, useEffect } from 'react'

function detectBrowserHardware(): { label: string; vramHint: string } {
  const cores = (navigator as { hardwareConcurrency?: number }).hardwareConcurrency ?? 4
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 8
  let gpu = 'Unknown GPU'
  // WebGPU probing is async; we do sync fallback here
  return { label: `Browser: ${cores} cores • ~${mem}GB RAM`, vramHint: gpu }
}

export function SystemConnect() {
  const [localUrl, setLocalUrl] = useState('http://localhost:51841')
  const [status, setStatus] = useState<'idle'|'connecting'|'connected'|'failed'>('idle')
  const [msg, setMsg] = useState('')
  const [browserHw, setBrowserHw] = useState<{ label: string; vramHint: string } | null>(null)

  useEffect(() => {
    try { setBrowserHw(detectBrowserHardware()) } catch {}
    // auto-probe saved companion on mount
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('sovara:localUrl') : null
    if (saved) setLocalUrl(saved)
    // try auto-connect silently if previous session was connected
    const wasConnected = typeof localStorage !== 'undefined' ? localStorage.getItem('sovara:connected') : null
    if (wasConnected === '1' && saved) {
      void (async () => {
        try {
          const ping = await fetch(`${saved.replace(/\/$/,'')}/__sovara/ping`, { method:'GET', signal: AbortSignal.timeout(2000) })
          if (ping.ok) {
            const data = await ping.json().catch(()=> ({})) as { hardwareId?: string }
            await fetch('/api/system/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ localUrl: saved, hardwareId: data.hardwareId ?? 'local-consumer' }) })
            setStatus('connected'); setMsg(`Auto-connected to ${saved} — models run on your hardware`)
          }
        } catch {}
      })()
    }
    // WebGPU async probe for better label
    if ((navigator as unknown as { gpu?: { requestAdapter: () => Promise<never> } }).gpu) {
      void (navigator as unknown as { gpu: { requestAdapter: () => Promise<{ info?: { description?: string } }> } }).gpu.requestAdapter().then(a => {
        const desc = (a as unknown as { info?: { description?: string } })?.info?.description
        if (desc) setBrowserHw(prev => prev ? { ...prev, vramHint: desc } : { label: 'Browser hardware', vramHint: desc })
      }).catch(()=>{})
    }
  }, [])

  const probeLocal = useCallback(async (base: string) => {
    // Try base with explicit CORS + private-network handling; ERR_CONNECTION_REFUSED is expected when desktop is off
    const url = `${base.replace(/\/$/,'')}/__sovara/ping`
    const res = await fetch(url, { method:'GET', mode:'cors', signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`local ping ${res.status} at ${url}`)
    return res.json().catch(()=> ({})) as Promise<{ hardwareId?: string; gpu?: string; vramMB?: number }>
  }, [])

  const connect = useCallback(async () => {
    setStatus('connecting'); setMsg('Probing your hardware…')
    try {
      // Browser (user network) probes local companion — Vercel server never sees localhost
      let data: { hardwareId?: string; gpu?: string; vramMB?: number } | null = null
      let lastErr: unknown = null
      // Try user-provided URL then fallback to 127.0.0.1 variant for mixed-content / localhost resolution quirks
      const candidates = [localUrl, localUrl.replace('localhost','127.0.0.1'), 'http://127.0.0.1:51841', 'http://localhost:51841']
      const tried = new Set<string>()
      for (const c of candidates) {
        if (!c || tried.has(c)) continue
        tried.add(c)
        try { data = await probeLocal(c); if (data) { if (c !== localUrl) setLocalUrl(c); break } } catch (e) { lastErr = e }
      }
      if (!data) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'desktop companion not reachable'))
      const hardwareId = data.hardwareId ?? 'local-consumer'
      const effectiveUrl = [...tried][0] // probeLocal succeeded on last iteration; use localUrl state
      const res = await fetch('/api/system/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ localUrl, hardwareId }) })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error ?? 'validation failed')
      setStatus('connected'); setMsg(`Connected to ${localUrl} — models will run on your hardware${data.gpu ? ` (${data.gpu})` : ''}`)
      try { localStorage.setItem('sovara:localUrl', localUrl); localStorage.setItem('sovara:connected','1') } catch {}
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      const friendly = /Failed to fetch|ERR_CONNECTION_REFUSED|NetworkError|Load failed/i.test(raw)
        ? `Desktop app not reachable. 1) Ensure Sovara.exe is running in the background. 2) Because this is a secure web app (HTTPS) trying to talk to your local computer (HTTP), your browser might block it. Click the 🔒 icon in your URL bar, go to Site Settings, and set "Insecure content" to Allow.`
        : raw
      setStatus('failed'); setMsg(friendly)
      await fetch('/api/system/connect', { method:'DELETE' }).catch(()=>{})
      try { localStorage.removeItem('sovara:connected') } catch {}
      console.warn('[SystemConnect] probe failed:', raw)
    }
  }, [localUrl, probeLocal])

  const disconnect = useCallback(async () => {
    await fetch('/api/system/connect', { method:'DELETE' })
    setStatus('idle'); setMsg('Disconnected')
    try { localStorage.removeItem('sovara:connected') } catch {}
  }, [])

  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:10, padding:12, display:'flex', flexDirection:'column', gap:8, background: 'var(--bg-secondary)' }}>
      <div style={{ fontWeight:600, display: 'flex', alignItems: 'center', gap: 6 }}>
        🔌 System Connect (Web ⟷ Your Hardware)
      </div>
      <div style={{ fontSize:13, opacity:0.8 }}>
        This Vercel demo can securely bridge to your local system hardware to run AI models offline, just like native companion apps from laptop manufacturers.
        <br/><br/>
        <strong>Requirement:</strong> The Sovara Desktop App (`.exe`) must be running in the background.
      </div>
      <div style={{ display:'flex', gap:6, marginTop: 4 }}>
        <input value={localUrl} onChange={e=> setLocalUrl(e.target.value)} placeholder="http://127.0.0.1:51841" style={{ flex:1, padding:'8px', borderRadius:6, border:'1px solid var(--border)' }} />
        {status==='connected' ? 
          <button onClick={disconnect} style={{ padding:'8px 16px', borderRadius:6, background:'#333', color:'#fff' }}>Disconnect</button> : 
          <button onClick={connect} disabled={status==='connecting'} style={{ padding:'8px 16px', borderRadius:6, background:'var(--accent)', color:'#fff', fontWeight:600 }}>{status==='connecting'?'Probing...':'Connect Hardware'}</button>
        }
      </div>
      {msg ? <div style={{ fontSize:12, padding: '8px', borderRadius: '6px', background: status==='failed' ? '#ffebee' : status==='connected' ? '#e8f5e9' : 'transparent', color: status==='failed' ? '#c0392b' : status==='connected' ? '#2e7d32' : '#888' }}>{msg}</div> : null}
      {status === 'failed' && (
        <div style={{ fontSize:12, marginTop: 4, color: '#d35400' }}>
          <strong>Browser Blocked?</strong> Browsers block HTTPS sites from talking to your local HTTP hardware. To fix this: Click the padlock (🔒) next to the Vercel URL at the top of your browser ➞ <strong>Site settings</strong> ➞ Find <strong>Insecure content</strong> ➞ Change it to <strong>Allow</strong>, then reload the page!
        </div>
      )}
    </div>
  )
}
