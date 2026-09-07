import { useEffect, useRef, useState, useCallback, type KeyboardEvent, type ReactElement } from 'react'
import { Plus, Globe, Mic, ArrowUp, Paperclip, X, Loader2 } from 'lucide-react'
import { ModelSelector } from './ModelSelector'
import { PermissionControl, type ExecMode } from '../../components/ui/PermissionControl'
import { transcribeAudio } from '../../lib/ipc'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: (content: string, attachments?: FileAttachment[], opts?: { webSearch: boolean }) => void
  onCancel?: () => void
  disabled?: boolean
  busy?: boolean
  phase?: 'idle' | 'streaming'
  active: ActiveModelState
  runtimes: ModelRuntimeEntry[]
  models: DiscoveredModel[]
  projectCount: number
  onNewProject: () => void
  execMode: ExecMode
  onExecModeChange: (mode: ExecMode) => void
  execAvailable: boolean
  reasoningEnabled?: boolean
  onReasoningToggle?: (enabled: boolean) => void
}

export interface FileAttachment {
  name: string
  type: string
  size: number
  data: string
}

const MAX_LENGTH = 32_000
const MAX_HEIGHT_PX = 160

export function Composer({
  value,
  onChange,
  onSend,
  onCancel,
  disabled = false,
  busy = false,
  phase = 'idle',
  active,
  runtimes,
  models,
  execMode,
  onExecModeChange,
  execAvailable,
  reasoningEnabled = false,
  onReasoningToggle,
}: ComposerProps): ReactElement {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [webSearch, setWebSearch] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const [micLoading, setMicLoading] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const pcmChunksRef = useRef<Float32Array[]>([])
  const canSend = value.trim().length > 0 && !disabled
  const streaming = busy && phase === 'streaming'

  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? 'auto' : 'hidden'
  }, [value])

  const wasDisabled = useRef(disabled)
  useEffect(() => {
    if (wasDisabled.current && !disabled) areaRef.current?.focus()
    wasDisabled.current = disabled
  }, [disabled])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      processorRef.current?.disconnect()
      if (audioCtxRef.current?.state !== 'closed') void audioCtxRef.current?.close()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const handleMicClick = useCallback(async () => {
    if (micLoading) return

    // If currently recording → stop and transcribe
    if (micActive) {
      setMicActive(false)
      setMicLoading(true)

      // Stop capture and collect PCM
      const chunks = pcmChunksRef.current
      pcmChunksRef.current = []
      processorRef.current?.disconnect()
      processorRef.current = null
      const ctx = audioCtxRef.current
      const stream = streamRef.current
      // Close context after grabbing data
      if (ctx) {
        try { await ctx.close() } catch { /* ignore */ }
        audioCtxRef.current = null
      }
      stream?.getTracks().forEach(t => t.stop())
      streamRef.current = null

      // Concatenate float32 chunks (native rate) then resample to 16kHz — Handy FrameResampler
      const totalLen = chunks.reduce((s, c) => s + c.length, 0)
      if (totalLen < 800) {
        setMicLoading(false)
        return
      }
      const nativePcm = new Float32Array(totalLen)
      let off = 0
      for (const c of chunks) { nativePcm.set(c, off); off += c.length }

      const inRate = ctx?.sampleRate ?? 48000
      let pcm16k: Float32Array
      if (inRate === 16000) {
        pcm16k = nativePcm
      } else {
        const targetLen = Math.round(nativePcm.length * 16000 / inRate)
        pcm16k = new Float32Array(targetLen)
        for (let i = 0; i < targetLen; i++) {
          const srcIdx = i * (nativePcm.length - 1) / (targetLen - 1)
          const lo = Math.floor(srcIdx)
          const hi = Math.ceil(srcIdx)
          const frac = srcIdx - lo
          pcm16k[i] = nativePcm[lo] * (1 - frac) + nativePcm[hi] * frac
        }
      }

      try {
        const int16 = new Int16Array(pcm16k.length)
        for (let i = 0; i < pcm16k.length; i++) {
          const s = Math.max(-1, Math.min(1, pcm16k[i]))
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
        }
        const bytes = new Uint8Array(int16.buffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)
        const result = await transcribeAudio(base64, 'recording.pcm')
        if (result.ok && result.text && result.text.trim()) {
          const prefix = value.trim() ? `${value.trim()} ` : ''
          const next = (prefix + result.text.trim()).slice(0, MAX_LENGTH)
          onChange(next)
          requestAnimationFrame(() => areaRef.current?.focus())
        } else if (!result.ok) {
          console.error('[Composer] Transcription error:', result.error)
        }
      } catch (err) {
        console.error('[Composer] Transcription failed:', err)
      } finally {
        setMicLoading(false)
      }
      return
    }

    // Start recording — Handy-style: native rate capture + resample to 16kHz
    // (Handy: cpal default rate + FrameResampler rubato; here Web Audio native + linear)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream
      pcmChunksRef.current = []

      const audioCtx = new AudioContext() // native rate (avoids forcing hardware — Handy get_preferred_config)
      audioCtxRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      processor.onaudioprocess = (e) => {
        pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      const gain = audioCtx.createGain()
      gain.gain.value = 0
      processor.connect(gain)
      gain.connect(audioCtx.destination)

      setMicActive(true)
    } catch (err) {
      console.error('[Composer] Microphone access denied:', err)
      setMicLoading(false)
    }
  }, [micActive, micLoading, value, onChange])

  const submit = (): void => {
    const content = value.trim()
    if (content.length === 0 || disabled) return
    const atts = attachments.length > 0 ? attachments : undefined
    if (webSearch) onSend(content, atts, { webSearch: true })
    else onSend(content, atts)
    setAttachments([])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return
    if (e.shiftKey) {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      const next = `${value.slice(0, start)}\n${value.slice(end)}`
      onChange(next.slice(0, MAX_LENGTH))
      requestAnimationFrame(() => {
        el.selectionStart = start + 1
        el.selectionEnd = start + 1
      })
      return
    }
    e.preventDefault()
    submit()
  }

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (!files) return
    const maxSize = 10 * 1024 * 1024
    const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'text/markdown']
    for (const file of Array.from(files)) {
      if (file.size > maxSize) continue
      if (!allowed.includes(file.type)) continue
      const reader = new FileReader()
      reader.onload = (): void => {
        const data = reader.result as string
        setAttachments((prev) => [...prev, { name: file.name, type: file.type, size: file.size, data }])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }, [])

  const removeAttachment = useCallback((idx: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  return (
    <div className="composer-bionic" aria-label="Composer workspace">
      <div className="composer-bionic-row">
        <div className="composer-bionic-left">
          <button
            type="button"
            className="composer-icon-btn"
            aria-label="Attach file"
            onClick={() => fileInputRef.current?.click()}
          >
            <Plus size={16} aria-hidden />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="sr-only"
            accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md"
            multiple
            onChange={handleFileSelect}
            aria-label="Select files to attach"
          />
          <button
            type="button"
            className={`composer-icon-btn ${webSearch ? 'active' : ''}`}
            aria-label={webSearch ? 'Web search on' : 'Web search off'}
            onClick={() => setWebSearch((v) => !v)}
          >
            <Globe size={16} aria-hidden />
          </button>
        </div>

        <textarea
          ref={areaRef}
          className="composer-bionic-input"
          placeholder={
            streaming
              ? 'Streaming response…'
              : disabled
                ? 'Waiting for model…'
                : 'Ask anything'
          }
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={handleKeyDown}
          maxLength={MAX_LENGTH}
          disabled={disabled}
          aria-label="Message input"
          rows={1}
          data-testid="composer-input"
        />

        <div className="composer-bionic-right">
          <button
            type="button"
            className={`composer-icon-btn mic-btn ${micActive ? 'recording' : ''} ${micLoading ? 'loading' : ''}`}
            aria-label={micLoading ? 'Transcribing...' : micActive ? 'Stop recording' : 'Start recording'}
            onClick={handleMicClick}
            disabled={micLoading}
          >
            {micLoading ? <Loader2 size={16} aria-hidden className="spin" /> : <Mic size={16} aria-hidden />}
          </button>
          <ModelSelector
            active={active}
            models={models}
            runtimes={runtimes}
            onSelect={() => {}}
            reasoningEnabled={reasoningEnabled}
            onReasoningToggle={onReasoningToggle}
          />
          <button
            type="button"
            className={`composer-send-btn ${canSend ? 'active' : ''}`}
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            data-testid="send-button"
          >
            <ArrowUp size={16} aria-hidden />
          </button>
        </div>
      </div>

      {attachments.length > 0 ? (
        <div className="composer-attachments">
          {attachments.map((a, i) => (
            <div key={`${a.name}-${i}`} className="composer-attachment">
              <Paperclip size={12} aria-hidden />
              <span className="composer-attachment-name">{a.name}</span>
              <button type="button" className="composer-attachment-remove" onClick={() => removeAttachment(i)} aria-label={`Remove ${a.name}`}>
                <X size={10} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="composer-bionic-footer">
        <PermissionControl mode={execMode} onChange={onExecModeChange} />
        {execMode === 'off' ? (
          <span className="composer-exec-hint muted small">Commands disabled</span>
        ) : execMode === 'ask' ? (
          <span className="composer-exec-hint muted small">Commands will ask first</span>
        ) : execMode === 'review' ? (
          <span className="composer-exec-hint muted small">Safe commands auto-run</span>
        ) : (
          <span className="composer-exec-hint composer-exec-hint--allow small">Full access — commands run without prompting</span>
        )}
      </div>
    </div>
  )
}
