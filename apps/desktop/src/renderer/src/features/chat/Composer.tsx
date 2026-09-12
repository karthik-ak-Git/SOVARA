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

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: (content: string, attachments?: FileAttachment[], opts?: { webSearch?: boolean; reasoning?: boolean }) => void
  onCancel?: () => void
  disabled?: boolean
  busy?: boolean
  phase?: 'idle' | 'streaming' | 'planning' | 'loading' | 'tool'
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
  execAvailable,
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
  const streaming = busy && (phase === 'streaming' || phase === 'planning' || phase === 'loading' || phase === 'tool')
  const showStop = streaming && onCancel

  // Rough token estimate (4 chars per token)
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

  // Close attach menu on outside click / Esc
  useEffect(() => {
    if (!attachMenuOpen) return
    const onDoc = (e: MouseEvent): void => {
      if (attachWrapRef.current && !attachWrapRef.current.contains(e.target as Node)) setAttachMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setAttachMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey as unknown as EventListener)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey as unknown as EventListener)
    }
  }, [attachMenuOpen])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      processorRef.current?.disconnect()
      if (audioCtxRef.current?.state !== 'closed') void audioCtxRef.current?.close()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const handleMicClick = useCallback(async () => {
    if (micLoading) return

    // If currently recording → stop and transcribe
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
        try {
          await ctx.close()
        } catch {
          /* ignore */
        }
        audioCtxRef.current = null
      }
      stream?.getTracks().forEach((t) => t.stop())
      streamRef.current = null

      const totalLen = chunks.reduce((s, c) => s + c.length, 0)
      if (totalLen < 800) {
        setMicLoading(false)
        return
      }
      const nativePcm = new Float32Array(totalLen)
      let off = 0
      for (const c of chunks) {
        nativePcm.set(c, off)
        off += c.length
      }

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
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
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
    if (showStop) {
      onCancel?.()
      return
    }
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
    if (showStop && !e.shiftKey) {
      e.preventDefault()
      onCancel?.()
      return
    }
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
    ]
    for (const file of Array.from(files)) {
      if (file.size > maxSize) continue
      if (!allowed.includes(file.type) && !file.name.endsWith('.md') && !file.name.endsWith('.txt')) continue
      const reader = new FileReader()
      reader.onload = (): void => {
        const data = reader.result as string
        setAttachments((prev) => [...prev, { name: file.name, type: file.type || 'text/plain', size: file.size, data }])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }, [])

  const removeAttachment = useCallback((idx: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx))
  }, [])

  return (
    <div className="stitch-composer-dock bionic-composer-dock" aria-label="Composer workspace">
      <div className="stitch-composer-card bionic-composer-card">
        {/* Attached Files Ribbon */}
        {attachments.length > 0 ? (
          <div className="stitch-attach-ribbon">
            {attachments.map((a, i) => (
              <div key={`${a.name}-${i}`} className="stitch-attach-pill">
                <FileText size={15} aria-hidden />
                <span className="stitch-attach-name">{a.name}</span>
                <span className="stitch-attach-size">{formatFileSize(a.size)}</span>
                <button
                  type="button"
                  className="stitch-attach-remove"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Remove ${a.name}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Text Input Area — Bionic aligned */}
        <textarea
          ref={areaRef}
          className="stitch-composer-input bionic-composer-input"
          placeholder={
            streaming
              ? 'Generating local model response… (Esc to stop)'
              : disabled
                ? 'Waiting for local model to become ready…'
                : 'Ask Bionic to do something'
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

        {/* Composer Bottom Toolbar — Bionic: (+ / shield) left, (model / mic / send) right */}
        <div className="stitch-composer-toolbar bionic-composer-toolbar">
          <div className="stitch-composer-left bionic-composer-left">
            <div className="bionic-attach-wrap" ref={attachWrapRef}>
              <button
                type="button"
                className="bionic-plus-btn"
                aria-label="Attach or use skill"
                aria-expanded={attachMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAttachMenuOpen((v) => !v)}
              >
                <Plus size={16} aria-hidden />
              </button>
              {attachMenuOpen ? (
                <div className="bionic-attach-menu" role="menu" aria-label="Attachment options">
                  <button
                    type="button"
                    role="menuitem"
                    className="bionic-attach-menu-item"
                    onClick={() => {
                      setAttachMenuOpen(false)
                      fileInputRef.current?.click()
                    }}
                  >
                    <Paperclip size={14} aria-hidden /> Attach files…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="bionic-attach-menu-item"
                    onClick={() => {
                      setAttachMenuOpen(false)
                      folderInputRef.current?.click()
                    }}
                  >
                    <Folder size={14} aria-hidden /> Attach folder…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="bionic-attach-menu-item bionic-attach-menu-item--accent"
                    onClick={() => {
                      setAttachMenuOpen(false)
                      onOpenSettings?.()
                    }}
                  >
                    <Sparkles size={14} aria-hidden /> Use skill
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="bionic-shield-btn"
              aria-label="Execution permissions"
              title="Execution permissions"
              onClick={() => onExecModeChange(execMode === 'off' ? 'ask' : 'off')}
            >
              <Shield size={15} aria-hidden />
            </button>
            {/* hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              className="sr-only"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.json,.csv"
              multiple
              onChange={handleFileSelect}
              aria-label="Select files to attach"
            />
            <input
              ref={folderInputRef}
              type="file"
              className="sr-only"
              // @ts-expect-error webkitdirectory is non-standard but supported in Electron/Chromium
              webkitdirectory=""
              multiple
              onChange={handleFileSelect}
              aria-label="Select folder to attach"
            />
            <span className="stitch-composer-hidden-model">
              <ModelSelector
                active={active}
                models={models}
                runtimes={runtimes}
                onSelect={(rid, mid) => {
                  onSelectModel?.(rid, mid)
                }}
                reasoningEnabled={reasoningEnabled}
                onReasoningToggle={onReasoningToggle}
                onOpenSettings={onOpenSettings}
              />
            </span>
          </div>

          <div className="stitch-composer-right bionic-composer-right">
            <button
              type="button"
              className="bionic-model-pill"
              onClick={() => onOpenSettings?.()}
              title="Switch model"
              aria-label="Switch model"
            >
              <span aria-hidden>◈</span>
              <span>{active.displayName ?? 'Glm 4.6v Flash'}</span>
            </button>
            <button
              type="button"
              className={`bionic-mic-btn ${micActive ? 'recording' : ''} ${micLoading ? 'loading' : ''}`}
              aria-label={micLoading ? 'Transcribing...' : micActive ? 'Stop recording' : 'Start recording'}
              title={micLoading ? 'Transcribing audio...' : micActive ? 'Click to stop recording' : 'Voice input'}
              onClick={handleMicClick}
              disabled={micLoading}
            >
              {micLoading ? <Loader2 size={16} aria-hidden className="spin" /> : <Mic size={16} aria-hidden />}
            </button>
            {showStop ? (
              <button
                type="button"
                className="bionic-send-btn active"
                onClick={() => onCancel?.()}
                aria-label="Stop generating"
                title="Stop generating (Esc)"
                data-testid="stop-button"
              >
                <Square size={14} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className={`bionic-send-btn ${canSend ? 'active' : ''}`}
                onClick={submit}
                disabled={!canSend}
                aria-label="Send message"
                title="Send prompt (Enter)"
                data-testid="send-button"
              >
                <ArrowUp size={16} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="composer-bionic-footer bionic-exec-row">
        <PermissionControl mode={execMode} onChange={onExecModeChange} />
        <span className="muted small">
          Sovora runs sovereign &amp; local • {execMode === 'allow' ? 'Full access — commands run directly' : execMode === 'ask' ? 'Ask before running' : 'Read-only'}
        </span>
      </div>
    </div>
  )
}
