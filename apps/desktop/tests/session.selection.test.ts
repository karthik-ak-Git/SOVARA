import { describe, expect, it } from 'vitest'
import { isSessionAvailable } from '../src/renderer/src/features/chat/useChatSession'

describe('chat session selection', () => {
  const sessions = [
    { id: 'sess-current', title: 'Current', createdAt: 1, updatedAt: 1 },
    { id: 'sess-other', title: 'Other', createdAt: 1, updatedAt: 1 },
  ]

  it('accepts a session that is present in the current database view', () => {
    expect(isSessionAvailable(sessions, 'sess-current')).toBe(true)
  })

  it('rejects a stale session id so the renderer can create a replacement', () => {
    expect(isSessionAvailable(sessions, 'sess-deleted')).toBe(false)
    expect(isSessionAvailable(sessions, null)).toBe(false)
  })
})
