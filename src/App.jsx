import { useState, useEffect, useRef } from 'react'
export default function App(){
  const [isProcessing,setProcessing]=useState(false)
  const [loadedContextSize,setLoaded]=useState(0)
  const [generatedResponse,setResponse]=useState('')
  const [tokenSpeed,setSpeed]=useState(0)
  const [hardwareAllocations,setAlloc]=useState({diskRead:'0 MB/s',ram:'0 MB',layers:'0'})
  const ref=useRef(null)
  useEffect(()=>{ if(ref.current) ref.current.scrollTop=ref.current.scrollHeight },[generatedResponse])
  const loadModel=async(f)=>{
    setProcessing(true)
    const hw=await window.electron.invoke('hardware-status-fetch',{modelSizeMb:2706})
    setAlloc({diskRead:'0 MB/s',ram:hw.profile.freeRam+' MB',layers:String(hw.profile.gpuLayers)})
    setLoaded(hw.profile.contextSize)
    const eng=await window.electron.invoke('engine-init',{modelPath:f})
    setProcessing(false)
  }
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-bold">Sovara Disk KV — App Location Cache</h1>
        <div className="text-xs opacity-60">Ctx {loadedContextSize} • {tokenSpeed} tok/s • VRAM {hardwareAllocations.ram} • Disk {hardwareAllocations.diskRead}</div>
        <div ref={ref} className="mt-4 h-96 overflow-auto bg-black p-3 rounded text-sm whitespace-pre-wrap">{generatedResponse || 'Ready — load a model. Cache at %APPDATA%/Sovara/disk_kv' }</div>
        <input className="w-full mt-3 bg-zinc-900 p-2 rounded" placeholder="Prompt huge database..." onKeyDown={async e=>{if(e.key==='Enter'){setProcessing(true);const r=await window.electron.invoke('prompt-submit',{prompt:e.target.value});setResponse(r.response||'');setProcessing(false);}}} />
        {isProcessing && <div className="text-xs mt-2">Processing layer-ahead prefetch...</div>}
      </div>
    </div>
  )
}
