/**
 * Chat feature types — single source for Chat workspace.
 * Mirrors spec ChatState but stays compatible with existing SessionEvent model.
 */
import type { SessionEventView, SessionHeaderView } from '@/lib/client/api'
import type { ChatMessage, SessionEventLike } from './conversation'

export type { ChatMessage, SessionEventLike, SessionEventView, SessionHeaderView }

export type ChatStatus = 'idle' | 'sending' | 'streaming' | 'cancelling' | 'error'

export interface ChatError {
  message: string
  code?: string
}

export interface ChatState {
  activeSessionId?: string
  messages: ChatMessage[]
  status: ChatStatus
  streamingMessageId?: string
  error?: ChatError
  selectedModelId?: string
  composerText: string

  setActiveSession: (id: string | null) => void
  setComposerText: (text: string) => void
  sendMessage: (content: string, opts?: { webSearch?: boolean }) => Promise<void>
  cancelGeneration: () => Promise<void>
  regenerate: () => Promise<void>
  editAndResend: (content: string, opts?: { webSearch?: boolean }) => Promise<void>
}
