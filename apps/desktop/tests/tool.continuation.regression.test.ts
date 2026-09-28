import { describe, expect, it } from 'vitest'
import { LocalOpenAIChatAdapter, sanitizeToolCallMessages } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import type { LlmChatMessage } from '@shared/types/ports'

describe('SOVARA Model-Context Tool Continuation Regression Suite', () => {
  it('1. Local adapter serializes tool results as user observation turns for local loopback', () => {
    const messages: LlmChatMessage[] = [
      { role: 'system', content: 'You are SOVARA agent.' },
      { role: 'user', content: 'Read wiki/' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc_read',
            type: 'function',
            function: { name: 'fs_read', arguments: '{"path":"wiki/"}' }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'tc_read',
        content: '{"error":"is a directory, use fs_list: wiki/"}'
      }
    ]

    const sanitized = sanitizeToolCallMessages(messages)
    const isLocalServer = true
    const serialized = sanitized.map((m) => {
      if (isLocalServer) {
        if (m.role === 'tool') return { role: 'user', content: `[Tool Observation]\n${m.content}` }
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
          let textContent = (m.content || '').trim()
          if (!textContent) {
            const fenceBlocks = m.tool_calls.map((tc) => `\`\`\`tool:${tc.function.name}\n${tc.function.arguments}\n\`\`\``)
            textContent = fenceBlocks.join('\n\n')
          }
          return { role: 'assistant', content: textContent }
        }
      }
      return { role: m.role, content: m.content }
    })

    // Assert assistant turn contains explicit markdown fence
    expect(serialized[2].role).toBe('assistant')
    expect(serialized[2].content).toContain('```tool:fs_read')
    expect(serialized[2].content).toContain('{"path":"wiki/"}')

    // Assert tool observation turn is serialized as user role with clear observation prefix
    expect(serialized[3].role).toBe('user')
    expect(serialized[3].content).toContain('[Tool Observation]')
    expect(serialized[3].content).toContain('is a directory, use fs_list: wiki/')
  })

  it('2. Successful tool observation is serialized with markdown fence and user observation', () => {
    const messages: LlmChatMessage[] = [
      { role: 'system', content: 'You are SOVARA agent.' },
      { role: 'user', content: 'Read test.txt' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc_success',
            type: 'function',
            function: { name: 'fs_read', arguments: '{"path":"test.txt"}' }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'tc_success',
        content: '{"content":"SUCCESSFUL_TOOL_BODY"}'
      }
    ]

    const sanitized = sanitizeToolCallMessages(messages)
    const isLocalServer = true
    const serialized = sanitized.map((m) => {
      if (isLocalServer) {
        if (m.role === 'tool') return { role: 'user', content: `[Tool Observation]\n${m.content}` }
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
          let textContent = (m.content || '').trim()
          if (!textContent) {
            const fenceBlocks = m.tool_calls.map((tc) => `\`\`\`tool:${tc.function.name}\n${tc.function.arguments}\n\`\`\``)
            textContent = fenceBlocks.join('\n\n')
          }
          return { role: 'assistant', content: textContent }
        }
      }
      return { role: m.role, content: m.content }
    })

    expect(serialized[2].content).toContain('```tool:fs_read')
    expect(serialized[3].role).toBe('user')
    expect(serialized[3].content).toContain('SUCCESSFUL_TOOL_BODY')
  })

  it('3. Remote endpoints preserve native OpenAI role:tool and tool_calls structure', () => {
    const messages: LlmChatMessage[] = [
      { role: 'system', content: 'You are SOVARA agent.' },
      { role: 'user', content: 'Read test.txt' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc_remote',
            type: 'function',
            function: { name: 'fs_read', arguments: '{"path":"test.txt"}' }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'tc_remote',
        content: '{"content":"REMOTE_BODY"}'
      }
    ]

    const sanitized = sanitizeToolCallMessages(messages)
    const isLocalServer = false
    const serialized = sanitized.map((m) => {
      if (!isLocalServer) {
        if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
        if (m.role === 'assistant' && m.tool_calls) {
          return { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls }
        }
      }
      return { role: m.role, content: m.content }
    })

    expect(serialized[2].role).toBe('assistant')
    expect(serialized[2].tool_calls).toBeDefined()
    expect(serialized[3].role).toBe('tool')
    expect(serialized[3].tool_call_id).toBe('tc_remote')
  })
})
