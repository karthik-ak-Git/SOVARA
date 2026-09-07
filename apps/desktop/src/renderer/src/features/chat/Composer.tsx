import { useEffect, useRef, useState, useCallback, type KeyboardEvent, type ReactElement } from 'react'
import { Plus, Globe, Mic, ArrowUp, Paperclip, X, Loader2, MicVocal } from 'lucide-react'
import { ModelSelector } from './ModelSelector'
import { PermissionControl, type ExecMode } from '../../components/ui/PermissionControl'
import type { ActiveModelState, DiscoveredModel, ModelRuntimeEntry } from '@shared/types/models'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSend: (content: string, attachments?: FileAttachment[]) => void
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

type VoiceState = 'idle' | 'recording' | 'transcribing'

/** Animated waveform bars for the dictation panel. */
function WaveformBars(): ReactElement {
  return (
    <div className="dictation-waveform" aria-hidden>
      {Array.from({ length: 32 }, (_, i) => (
        <div
          key={i}
          className="dictation-waveform-bar"
          style={{ animationDelay: `${(i * 0.05) % 1.6}s` }}
        />
      ))}
    </div>
  )
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
}: ComposerProps): ReactElement {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const pcmChunksRef = useRef<Float32Array[]>([])
  const nativeSampleRateRef = useRef<number>(16000)
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [webSearch, setWebSearch] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [showDictation, setShowDictation] = useState(false)
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {})
      }
      if (recordingTimerRef.current) clearTimeout(recordingTimerRef.current)
    }
  }, [])

  const submit = (): void => {
    const content = value.trim()
    if (content.length === 0 || disabled) return
    onSend(content, attachments.length > 0 ? attachments : undefined)
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

  const stopRecording = useCallback((): void => {
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect()
      workletNodeRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
  }, [])

  const startRecording = useCallback(async (): Promise<void> => {
    setVoiceError(null)
    pcmChunksRef.current = []

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone not available')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const ctx = new AudioContext()
      audioContextRef.current = ctx
      nativeSampleRateRef.current = ctx.sampleRate

      await ctx.audioWorklet.addModule(new URL('./pcm-processor.worklet.ts', import.meta.url).href)

      const source = ctx.createMediaStreamSource(stream)
      const workletNode = new AudioWorkletNode(ctx, 'pcm-processor')
      workletNodeRef.current = workletNode

      workletNode.port.onmessage = (e: MessageEvent<{ pcm: Float32Array }>) => {
        if (e.data?.pcm) {
          pcmChunksRef.current.push(e.data.pcm)
        }
      }

      source.connect(workletNode)
      workletNode.connect(ctx.destination)

      setVoiceState('recording')
      setShowDictation(true)

      recordingTimerRef.current = setTimeout(() => {
        stopRecording()
        void transcribeChunks(nativeSampleRateRef.current)
      }, 30_000)
    } catch (err) {
      setVoiceState('idle')
      setShowDictation(false)
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setVoiceError('Microphone permission denied')
      } else {
        setVoiceError('Could not access microphone')
      }
    }
  }, [stopRecording])

  const transcribeChunks = useCallback(async (nativeSampleRate?: number): Promise<void> => {
    const chunks = pcmChunksRef.current
    pcmChunksRef.current = []

    if (chunks.length === 0) {
      setVoiceState('idle')
      return
    }

    setVoiceState('transcribing')

    try {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
      const merged = new Float32Array(totalLength)
      let offset = 0
      for (const chunk of chunks) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      const targetRate = 16000
      let resampled = merged
      const srcRate = nativeSampleRate ?? targetRate
      if (srcRate !== targetRate && srcRate > 0) {
        const ratio = targetRate / srcRate
        const newLength = Math.round(merged.length * ratio)
        resampled = new Float32Array(newLength)
        for (let i = 0; i < newLength; i++) {
          const srcIdx = i / ratio
          const idx = Math.floor(srcIdx)
          const frac = srcIdx - idx
          resampled[i] = idx + 1 < merged.length
            ? merged[idx] * (1 - frac) + merged[idx + 1] * frac
            : merged[idx] ?? 0
        }
      }

      const buffer = resampled.buffer
      const bytes = new Uint8Array(buffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64 = btoa(binary)

      if (window.sovara) {
        try {
          const result = await window.sovara.invoke('voice:transcribe', {
            pcm: base64,
            sampleRate: targetRate,
            language: 'en',
          })
          let transcribed = ''
          if (typeof result === 'string') {
            transcribed = result
          } else if (result && typeof result === 'object' && 'text' in result) {
            transcribed = (result as { text: string }).text ?? ''
          }
          if (transcribed) {
            onChange(value ? `${value}\n${transcribed}` : transcribed)
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Transcription failed'
          setVoiceError(msg)
        } finally {
          setVoiceState('idle')
          setShowDictation(false)
        }
      } else {
        setVoiceState('idle')
        setShowDictation(false)
      }
    } catch {
      setVoiceState('idle')
      setShowDictation(false)
    }
  }, [value, onChange])

  const handleVoiceToggle = useCallback((): void => {
    if (voiceState === 'recording') {
      stopRecording()
      void transcribeChunks(nativeSampleRateRef.current)
    } else if (voiceState === 'transcribing') {
      setVoiceState('idle')
      setShowDictation(false)
      pcmChunksRef.current = []
    } else {
      startRecording()
    }
  }, [voiceState, stopRecording, startRecording, transcribeChunks])

  const closeDictation = useCallback((): void => {
    if (voiceState === 'recording') {
      stopRecording()
      void transcribeChunks(nativeSampleRateRef.current)
    }
    setShowDictation(false)
  }, [voiceState, stopRecording, transcribeChunks])

  const micIcon = (): ReactElement => {
    if (voiceState === 'transcribing') return <Loader2 size={16} className="spin" aria-hidden />
    // Listening state keeps the Mic glyph (never swaps to MicOff) — the red
    // `recording` class + "Listening…" placeholder carry the state instead.
    return <Mic size={16} aria-hidden />
  }

  const micLabel = voiceState === 'recording'
    ? 'Listening — click to stop and transcribe'
    : voiceState === 'transcribing'
      ? 'Transcribing…'
      : 'Voice input'

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
            voiceState === 'transcribing'
              ? 'Transcribing…'
              : voiceState === 'recording'
                ? 'Listening…'
                : streaming
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
            className={`composer-icon-btn mic-btn ${voiceState === 'recording' ? 'recording' : ''} ${voiceState === 'transcribing' ? 'transcribing' : ''}`}
            aria-label={micLabel}
            onClick={handleVoiceToggle}
            disabled={voiceState === 'transcribing'}
          >
            {micIcon()}
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

      {/* Dictation panel — shown when recording or transcribing */}
      {showDictation && voiceState !== 'idle' ? (
        <div className="dictation-panel">
          <div className="dictation-header">
            <div className="dictation-header-left">
              <MicVocal size={14} aria-hidden />
              <span className="dictation-title">Dictation</span>
            </div>
            <button type="button" className="dictation-close" onClick={closeDictation} aria-label="Close dictation">
              <X size={14} aria-hidden />
            </button>
          </div>
          <p className="dictation-subtitle">
            Speak and it becomes text. Adjust{' '}
            <span className="dictation-link">settings</span>{' '}
            or{' '}
            <span className="dictation-link">how it's written</span>{' '}
            any time.
          </p>
          {voiceState === 'recording' ? <WaveformBars /> : null}
          {voiceState === 'transcribing' ? (
            <div className="dictation-transcribing">
              <Loader2 size={14} className="spin" aria-hidden />
              <span>Transcribing…</span>
            </div>
          ) : null}
          <div className="dictation-model">
            <span className="dictation-model-label">Dictate (Speech to Text)</span>
            <span className="dictation-model-desc">
              Types what you say into the input. Transcribes on-device with the <strong>faster-whisper</strong> multilingual model.
            </span>
          </div>
        </div>
      ) : null}

      {voiceError ? (
        <div className="composer-voice-error">
          <span>{voiceError}</span>
          <button type="button" onClick={() => setVoiceError(null)} aria-label="Dismiss">
            <X size={10} aria-hidden />
          </button>
        </div>
      ) : null}

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
        {execAvailable ? (
          <span className="composer-exec-hint muted small">Commands will run locally</span>
        ) : null}
      </div>
    </div>
  )
}
