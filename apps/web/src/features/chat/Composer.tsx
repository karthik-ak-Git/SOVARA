'use client'

import { useEffect, useRef, useState, useCallback, type KeyboardEvent, type ReactElement } from 'react'
import {
  Plus,
  Globe,
  Mic,
  ArrowUp,
  Square,
  Paperclip,
  X,
  Loader2,
  FileText,
  Folder,
  Sparkles,
  Shield,
} from 'lucide-react'
import { ModelSelector } from './ModelSelector'
import { PermissionControl, type ExecMode } from '../../components/ui/PermissionControl'
import { TokenMeter } from '../../components/ui/TokenMeter'
import { transcribeAudio } from '@/lib/client/api'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'
import type { ChatPhase } from './useChatSession'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: (content: string, attachments?: FileAttachment[], opts?: { webSearch?: boolean; reasoning?: boolean }) => void
  onCancel?: () => void
  disabled?: boolean
  busy?: boolean
  phase?: ChatPhase
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
  onSelectModel?: (runtimeId: string, modelId: string) => void
  onOpenSettings?: () => void
}

export interface FileAttachment {
  name: string
  type: string
  size: number
  data: string
}

const MAX_LENGTH = 32_000
const MAX_HEIGHT_PX = 180

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}

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
  reasoningEnabled = false,
  onReasoningToggle,
  onSelectModel,
  onOpenSettings,
}: ComposerProps): ReactElement {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [webSearch, setWebSearch] = useState(false)
  const [micActive, setMicActive] = useState(false)
  const [micLoading, setMicLoading] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const attachWrapRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const pcmChunksRef = useRef<Float32Array[]>([])
  const canSend = value.trim().length > 0 && !disabled
  const streaming = busy && phase !== 'idle'
  const [dragActive, setDragActive] = useState(false)
  const showStop = streaming && onCancel

  const estimatedTokens = value.trim() ? Math.round(value.trim().length / 4) : 0
  const contextMaxTokens = 8192

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

  useEffect(() => {
    if (!attachMenuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (attachWrapRef.current && !attachWrapRef.current.contains(e.target as Node)) setAttachMenuOpen(false)
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setAttachMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [attachMenuOpen])

  useEffect(() => {
    return () => {
      processorRef.current?.disconnect()
      if (audioCtxRef.current?.state !== 'closed') void audioCtxRef.current?.close()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const handleMicClick = useCallback(async () => {
    if (micLoading) return

    if (micActive) {
      setMicActive(false)
      setMicLoading(true)

      const chunks = pcmChunksRef.current
      pcmChunksRef.current = []
      processorRef.current?.disconnect()
      processorRef.current = null
      const ctx = audioCtxRef.current
      const stream = streamRef.current
      if (ctx) {
        try { await ctx.close() } catch { /* ignore */ }
        audioCtxRef.current = null
      }
      stream?.getTracks().forEach((t) => t.stop())
      streamRef.current = null

      const totalLen = chunks.reduce((s, c) => s + c.length, 0)
      if (totalLen < 800) { setMicLoading(false); return }

      const nativePcm = new Float32Array(totalLen)
      let off = 0
      for (const c of chunks) { nativePcm.set(c, off); off += c.length }

      const inRate = ctx?.sampleRate ?? 48000
      let pcm16k: Float32Array
      if (inRate === 16000) {
        pcm16k = nativePcm
      } else {
        const targetLen = Math.round((nativePcm.length * 16000) / inRate)
        pcm16k = new Float32Array(targetLen)
        for (let i = 0; i < targetLen; i++) {
          const srcIdx = (i * (nativePcm.length - 1)) / (targetLen - 1)
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      pcmChunksRef.current = []

      const audioCtx = new AudioContext()
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
    if (showStop) { onCancel?.(); return }
    const content = value.trim()
    if (content.length === 0 || disabled) return
    const atts = attachments.length > 0 ? attachments : undefined
    const hasOpts = webSearch || reasoningEnabled
    if (hasOpts) {
      const opts: { webSearch?: boolean; reasoning?: boolean } = {}
      if (webSearch) opts.webSearch = true
      if (reasoningEnabled) opts.reasoning = true
      onSend(content, atts, opts)
    } else {
      onSend(content, atts)
    }
    setAttachments([])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Enter') return
    if (showStop && !e.shiftKey) { e.preventDefault(); onCancel?.(); return }
    if (e.shiftKey) {
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      const next = `${value.slice(0, start)}\n${value.slice(end)}`
      onChange(next.slice(0, MAX_LENGTH))
      requestAnimationFrame(() => { el.selectionStart = start + 1; el.selectionEnd = start + 1 })
      return
    }
    e.preventDefault()
    submit()
  }

  const ingestFiles = useCallback((files: FileList | File[]): void => {
    const maxSize = 10 * 1024 * 1024
    const allowed = [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]
    for (const file of Array.from(files).slice(0, 5)) {
      if (file.size > maxSize || file.size === 0) continue
      const lower = file.name.toLowerCase()
      const extOk =
        allowed.includes(file.type) ||
        lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.csv') ||
        lower.endsWith('.json') || lower.endsWith('.pdf') || lower.endsWith('.docx') ||
        lower.endsWith('.xlsx') || lower.endsWith('.png') || lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp')
      if (!extOk) continue
      const reader = new FileReader()
      reader.onload = (): void => {
        const data = reader.result as string
        setAttachments((prev) =>
          prev.length >= 5 ? prev : [...prev, { name: file.name, type: file.type || 'text/plain', size: file.size, data }]
        )
      }
      reader.readAsDataURL(file)
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (files) ingestFiles(files)
    e.target.value = ''
  }, [ingestFiles])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setDragActive(false)
    if (disabled || busy) return
    const files = e.dataTransfer?.files
    if (files && files.length > 0) ingestFiles(files)
  }, [ingestFiles, disabled, busy])

  const removeAttachment = useCallback((idx: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  return (
    <div className="sv-composer" aria-label="Message composer">
      <div
        className={`sv-composer-card${dragActive ? ' composer-drop-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled && !busy) setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {dragActive ? (
          <div className="composer-drop-hint" aria-hidden>
            Drop files to attach (pdf, images, office, text)
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 0 6px' }}>
            {attachments.map((a, i) => (
              <div key={`${a.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 8, background: 'var(--stitch-parchment, #F7F5F2)', fontSize: 12, color: 'var(--stitch-ink, #2C2825)' }}>
                <FileText size={13} aria-hidden />
                <span>{a.name}</span>
                <span style={{ opacity: 0.5 }}>{formatFileSize(a.size)}</span>
                <button type="button" onClick={() => removeAttachment(i)} aria-label={`Remove ${a.name}`} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', display: 'flex' }}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <textarea
          ref={areaRef}
          className="sv-composer-input"
          placeholder={
            streaming ? 'Sovora is thinking… (Esc to stop)' :
            disabled ? 'Waiting…' :
            'Message Sovora…'
          }
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={handleKeyDown}
          maxLength={MAX_LENGTH}
          disabled={disabled}
          aria-label="Message input"
          rows={2}
          data-testid="composer-input"
        />

        <div className="sv-composer-bottom">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div ref={attachWrapRef} style={{ position: 'relative' }}>
              <button
                type="button"
                className="sv-composer-icon-btn"
                aria-label="Attach"
                aria-expanded={attachMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAttachMenuOpen((v) => !v)}
              >
                <Plus size={16} aria-hidden />
              </button>
              {attachMenuOpen ? (
                <div className="sv-dropdown" style={{ bottom: '100%', left: 0, marginBottom: 6, minWidth: 160 }} role="menu" aria-label="Attachment options">
                  <button type="button" role="menuitem" className="sv-dropdown-item" onClick={() => { setAttachMenuOpen(false); fileInputRef.current?.click() }}>
                    <Paperclip size={14} aria-hidden /> Attach files…
                  </button>
                  <button type="button" role="menuitem" className="sv-dropdown-item" onClick={() => { setAttachMenuOpen(false); folderInputRef.current?.click() }}>
                    <Folder size={14} aria-hidden /> Attach folder…
                  </button>
                  <button type="button" role="menuitem" className="sv-dropdown-item" onClick={() => { setAttachMenuOpen(false); onOpenSettings?.() }}>
                    <Sparkles size={14} aria-hidden /> Use skill
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="sv-composer-icon-btn"
              aria-label="Execution permissions"
              title="Execution permissions"
              onClick={() => onExecModeChange(execMode === 'off' ? 'ask' : 'off')}
              style={{ color: execMode === 'off' ? undefined : '#D97757' }}
            >
              <Shield size={15} aria-hidden />
            </button>
            <button
              type="button"
              className={`sv-composer-icon-btn${webSearch ? ' sv-btn-active' : ''}`}
              aria-label={webSearch ? 'Web search on' : 'Web search off'}
              title={webSearch ? 'Web search enabled' : 'Toggle web search'}
              onClick={() => setWebSearch((v) => !v)}
              style={webSearch ? { color: '#D97757' } : undefined}
            >
              <Globe size={14} aria-hidden />
            </button>
            <input ref={fileInputRef} type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.json,.csv" multiple onChange={handleFileSelect} aria-label="Select files to attach" />
            <input ref={folderInputRef} type="file" className="sr-only" {...{ webkitdirectory: '' } as unknown as Record<string, string>} multiple onChange={handleFileSelect} aria-label="Select folder to attach" />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <TokenMeter used={estimatedTokens} max={contextMaxTokens} />
            <ModelSelector
              active={active}
              models={models}
              runtimes={runtimes}
              onSelect={(rid, mid) => onSelectModel?.(rid, mid)}
              reasoningEnabled={reasoningEnabled}
              onReasoningToggle={onReasoningToggle}
              onOpenSettings={onOpenSettings}
            />
            <button
              type="button"
              className="sv-composer-icon-btn"
              aria-label={micLoading ? 'Transcribing...' : micActive ? 'Stop recording' : 'Start recording'}
              title={micLoading ? 'Transcribing audio...' : micActive ? 'Click to stop recording' : 'Voice input'}
              onClick={handleMicClick}
              disabled={micLoading}
            >
              {micLoading ? <Loader2 size={16} aria-hidden className="spin" /> : <Mic size={16} aria-hidden />}
            </button>
            {showStop ? (
              <button type="button" className="sv-send-btn" style={{ background: '#8A8279' }} onClick={() => onCancel?.()} aria-label="Stop generating" title="Stop generating (Esc)" data-testid="stop-button">
                <Square size={14} aria-hidden />
              </button>
            ) : (
              <button type="button" className="sv-send-btn" style={{ opacity: canSend ? 1 : 0.4 }} onClick={submit} disabled={!canSend} aria-label="Send message" title="Send prompt (Enter)" data-testid="send-button">
                <ArrowUp size={16} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0 0' }}>
        <PermissionControl mode={execMode} onChange={onExecModeChange} />
        <span style={{ fontSize: 11, color: '#8A8279' }}>
          Sovora runs sovereign &amp; local • {execMode === 'allow' ? 'Full access' : execMode === 'ask' ? 'Ask before running' : 'Read-only'}
        </span>
      </div>
    </div>
  )
}
