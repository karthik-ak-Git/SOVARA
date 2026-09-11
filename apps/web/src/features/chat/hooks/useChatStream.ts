/**
 * useChatStream — streaming helper. Currently the stream is owned by
 * useChatSession / chatStore via `events:session` pushes. This hook
 * exists as a seam for future ToolCallChunk rendering (§17).
 */
import { useEffect } from 'react'
import type { ChatStreamEvent } from '@shared/types/chat'

export function useChatStream(
  onEvent: (ev: ChatStreamEvent) => void
): void {
  // Placeholder: real subscription lives in chatStore / useChatSession
  // This hook keeps the file-structure from spec without duplicating logic.
  useEffect(() => {
    void onEvent
  }, [onEvent])
}
