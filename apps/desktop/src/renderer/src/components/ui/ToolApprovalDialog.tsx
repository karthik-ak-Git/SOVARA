import type { ReactElement } from 'react'
import { Shield, X } from 'lucide-react'

interface Props {
  toolName: string
  message: string
  args?: Record<string, unknown>
  onApprove: () => void
  onDeny: () => void
}

export function ToolApprovalDialog({ toolName, message, args, onApprove, onDeny }: Props): ReactElement {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'grid', placeItems:'center', zIndex:9999 }} role="dialog" aria-modal="true">
      <div style={{ background:'#fff', borderRadius:12, padding:20, maxWidth:480, width:'90%', boxShadow:'0 12px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
          <Shield size={18} style={{ color:'#D97757' }} /><strong>Allow command?</strong>
          <button type="button" onClick={onDeny} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer' }} aria-label="Close"><X size={16} /></button>
        </div>
        <p style={{ fontSize:13, color:'#5C3A21', marginBottom:6 }}>{message}</p>
        <p style={{ fontSize:12, color:'#8A8279' }}>Tool: <code>{toolName}</code></p>
        {args ? <pre style={{ fontSize:11, background:'#F7F5F2', padding:8, borderRadius:6, overflow:'auto', maxHeight:120, marginTop:6 }}>{JSON.stringify(args, null, 2)}</pre> : null}
        <p style={{ fontSize:11, color:'#8A8279', marginTop:6 }}>File not listed? You can still approve — the command will run.</p>
        <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
          <button type="button" className="sv-btn sv-btn-ghost" onClick={onDeny}>Deny</button>
          <button type="button" className="sv-btn sv-btn-primary" onClick={onApprove}>Allow & run</button>
        </div>
      </div>
    </div>
  )
}
