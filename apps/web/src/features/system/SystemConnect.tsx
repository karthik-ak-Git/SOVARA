'use client'
import { useState, useCallback } from 'react'

export function SystemConnect() {
  const [localUrl, setLocalUrl] = useState('http://localhost:51841')
  const [status, setStatus] = useState<'idle'|'connecting'|'connected'|'failed'>('idle')
  const [msg, setMsg] = useState('')

  const connect = useCallback(async () => {
    setStatus('connecting'); setMsg('Probing your hardware…')
    try {
      // Browser (user network) probes local companion — Vercel server never sees localhost
      const ping = await fetch(`${localUrl.replace(/\/$/,'')}/__sovara/ping`, { method:'GET', signal: AbortSignal.timeout(4000) })
      if (!ping.ok) throw new Error(`local ping ${ping.status}`)
      const data = await ping.json().catch(()=> ({})) as { hardwareId?: string }
      const hardwareId = data.hardwareId ?? 'local-consumer'
      const res = await fetch('/api/system/connect', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ localUrl, hardwareId }) })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error ?? 'validation failed')
      setStatus('connected'); setMsg(`Connected to ${localUrl} — models will run on your hardware`)
    } catch (e) {
      setStatus('failed'); setMsg(e instanceof Error ? e.message : String(e))
      await fetch('/api/system/connect', { method:'DELETE' }).catch(()=>{})
    }
  }, [localUrl])

  const disconnect = useCallback(async () => {
    await fetch('/api/system/connect', { method:'DELETE' })
    setStatus('idle'); setMsg('Disconnected')
  }, [])

  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:10, padding:12, display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontWeight:600 }}>System Connect (Web → Your Hardware)</div>
      <div style={{ fontSize:12, opacity:0.7 }}>Vercel app uses your network to reach your local Sovara companion. Validates via cookie; if not valid, no connection.</div>
      <div style={{ display:'flex', gap:6 }}>
        <input value={localUrl} onChange={e=> setLocalUrl(e.target.value)} placeholder="http://localhost:51841" style={{ flex:1, padding:'6px 8px', borderRadius:6, border:'1px solid var(--border)' }} />
        {status==='connected' ? <button onClick={disconnect} style={{ padding:'6px 12px', borderRadius:6 }}>Disconnect</button> : <button onClick={connect} disabled={status==='connecting'} style={{ padding:'6px 12px', borderRadius:6, background:'var(--accent)', color:'#fff' }}>{status==='connecting'?'Connecting…':'Connect'}</button>}
      </div>
      {msg ? <div style={{ fontSize:12, color: status==='failed' ? '#c0392b' : status==='connected' ? '#0a0' : '#888' }}>{msg}</div> : null}
      <div style={{ fontSize:11, opacity:0.5 }}>Requires desktop running (`pnpm dev` exposes http://localhost:51841/__sovara/ping). When connected, chat & model run proxy to your hardware.</div>
    </div>
  )
}
