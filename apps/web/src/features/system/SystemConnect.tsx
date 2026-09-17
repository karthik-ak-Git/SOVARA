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
      // ERR_CONNECTION_REFUSED / Failed to fetch → companion not running — surface friendly guidance instead of raw net error
      const friendly = /Failed to fetch|ERR_CONNECTION_REFUSED|NetworkError|Load failed/i.test(raw)
        ? `Desktop companion not reachable at ${localUrl}. Start it with: pnpm --filter @sovara/desktop dev  (serves http://localhost:51841/__sovara/ping). Also check firewall/antivirus isn't blocking 51841.`
        : raw
      setStatus('failed'); setMsg(friendly)
      await fetch('/api/system/connect', { method:'DELETE' }).catch(()=>{})
      try { localStorage.removeItem('sovara:connected') } catch {}
      // Avoid noisy unhandled rejection console spam for expected offline case
      console.warn('[SystemConnect] probe failed:', raw)
    }
  }, [localUrl, probeLocal])

  const disconnect = useCallback(async () => {
    await fetch('/api/system/connect', { method:'DELETE' })
    setStatus('idle'); setMsg('Disconnected')
    try { localStorage.removeItem('sovara:connected') } catch {}
  }, [])

  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:10, padding:12, display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontWeight:600 }}>System Connect (Web → Your Hardware)</div>
      <div style={{ fontSize:12, opacity:0.7 }}>Vercel app uses your network to reach your local Sovara companion. Validates via cookie; if not valid, no connection. {browserHw ? `Detected: ${browserHw.label}${browserHw.vramHint !== 'Unknown GPU' ? ` • ${browserHw.vramHint}` : ''}` : ''}</div>
      <div style={{ display:'flex', gap:6 }}>
        <input value={localUrl} onChange={e=> setLocalUrl(e.target.value)} placeholder="http://localhost:51841" style={{ flex:1, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)' }} />
        {status==='connected' ? <button onClick={disconnect} style={{ padding:'6px 12px', borderRadius:6 }}>Disconnect</button> : <button onClick={connect} disabled={status==='connecting'} style={{ padding:'6px 12px', borderRadius:6, background:'var(--accent)', color:'#fff' }}>{status==='connecting'?'Connecting…':'Connect'}</button>}
      </div>
      {msg ? <div style={{ fontSize:12, color: status==='failed' ? '#c0392b' : status==='connected' ? '#0a0' : '#888' }}>{msg}</div> : null}
      <div style={{ fontSize:11, opacity:0.5 }}>Requires desktop running (`pnpm dev` exposes http://localhost:51841/__sovara/ping). When connected, chat & model run proxy to your hardware.</div>
    </div>
  )
}
