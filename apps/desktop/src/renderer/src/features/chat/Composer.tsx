import { useEffect, useRef, useState, useCallback, type KeyboardEvent, type ReactElement } from 'react'
import { Plus, Globe, Mic, MicOff, ArrowUp, Paperclip, X, Loader2 } from 'lucide-react'
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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [attachments, setAttachments] = useState<FileAttachment[]>([])
  const [webSearch, setWebSearch] = useState(false)
  const [voiceState, setVoiceState] = useState<VoiceState>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
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
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  const startRecording = useCallback(async (): Promise<void> => {
    setVoiceError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone not available')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder
      const chunks: BlobPart[] = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null

        if (chunks.length === 0) {
          setVoiceState('idle')
          return
        }

        setVoiceState('transcribing')

        try {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const reader = new FileReader()
          reader.onload = async () => {
            const base64 = (reader.result as string).split(',')[1]
            if (window.sovara) {
              try {
                const result = await window.sovara.invoke('voice:transcribe', { audio: base64, format: 'webm' })
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
              }
            } else {
              setVoiceState('idle')
            }
          }
          reader.readAsDataURL(blob)
        } catch {
          setVoiceState('idle')
        }
      }

      mediaRecorder.start(250) // Collect data every 250ms for faster response
      setVoiceState('recording')

      // Auto-stop after 30 seconds
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop()
        }
      }, 30_000)
    } catch (err) {
      setVoiceState('idle')
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setVoiceError('Microphone permission denied')
      } else {
        setVoiceError('Could not access microphone')
      }
    }
  }, [value, onChange])

  const handleVoiceToggle = useCallback((): void => {
    if (voiceState === 'recording' || voiceState === 'transcribing') {
      stopRecording()
      if (voiceState === 'transcribing') {
        setVoiceState('idle')
      }
    } else {
      startRecording()
    }
  }, [voiceState, stopRecording, startRecording])

  const micIcon = (): ReactElement => {
    if (voiceState === 'transcribing') return <Loader2 size={16} className="spin" aria-hidden />
    if (voiceState === 'recording') return <MicOff size={16} aria-hidden />
    return <Mic size={16} aria-hidden />
  }

  const micLabel = voiceState === 'recording'
    ? 'Stop recording'
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
