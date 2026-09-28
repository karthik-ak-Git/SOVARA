import { describe, expect, it, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { LocalOpenAIChatAdapter, sanitizeToolCallMessages } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import { SOVARA_SYSTEM_PROMPT } from '../src/main/backend/prompts/sovaraSystem'
import { extractToolFences, looksLikeToolFence } from '../src/main/backend/tools/fenceTools'
import { dispatchFs } from '../src/main/capabilities/fs/index'
import type { LlmChatMessage } from '@shared/types/ports'

const ENDPOINT = 'http://127.0.0.1:60776'
const MODEL_ID = 'C:\\Users\\Atina\\.lmstudio\\models\\lmstudio-community\\gemma-4-E2B-it-GGUF\\gemma-4-E2B-it-Q4_K_M.gguf'

function buildToolCatalog(): string {
  return [
    'TOOLS - call with a fenced block, NOT XML. Format exactly:',
    '```tool:fs_list',
    '{"path": "."}',
    '```',
    'Available tools:',
    '- fs_read: read a file {"path": "..."}',
    '- fs_list: list a directory {"path": "."}',
    '- fs_write: write a file {"path": "...", "content": "..."}',
    'Rules:',
    '1) For exploration or inspections, call fs_list or fs_read directly using the fenced block.',
    '2) Emit ONE fenced tool block per step, then wait for its result before the next step.',
    '3) If fs_read returns "is a directory, use fs_list", call fs_list with that path on your next action.',
    '4) If fs_read returns "file not found", check the hint and call fs_read with the existing filename on your next action.',
  ].join('\n')
}

/**
 * Executes a live SOVARA multi-step agent loop through LocalOpenAIChatAdapter and dispatchFs.
 */
async function executeSovaraAgentLoop(
  userPrompt: string,
  workspaceRoot: string,
  maxSteps = 6
): Promise<{ history: LlmChatMessage[]; toolSequence: string[]; finalAnswer: string; rawResponses: string[] }> {
  const adapter = new LocalOpenAIChatAdapter()

  const systemContent = [
    SOVARA_SYSTEM_PROMPT,
    buildToolCatalog(),
    `Active Workspace Root: ${workspaceRoot}`
  ].join('\n\n')

  const history: LlmChatMessage[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userPrompt }
  ]

  const toolSequence: string[] = []
  const rawResponses: string[] = []
  let step = 0
  let finalAnswer = ''

  while (step < maxSteps) {
    step++
    let assistantText = ''

    // Invoke LocalOpenAIChatAdapter streamChat
    for await (const chunk of adapter.streamChat({
      endpoint: ENDPOINT,
      model: MODEL_ID,
      messages: history,
      stream: true,
      maxCompletionTokens: 1024,
      timeoutMs: 30000
    })) {
      if (chunk.type === 'text-delta' && chunk.text) {
        assistantText += chunk.text
      }
    }

    rawResponses.push(assistantText)

    // Check if the model emitted a tool fence
    if (looksLikeToolFence(assistantText)) {
      const fences = extractToolFences(assistantText)
      if (fences.length > 0) {
        const fence = fences[0]!
        const toolName = fence.toolName
        const toolArgs = fence.args
        const callSig = `${toolName}(${JSON.stringify(toolArgs)})`
        toolSequence.push(callSig)

        // Execute physical filesystem tool
        const toolOutputStr = await dispatchFs(toolName, toolArgs as Record<string, string>, workspaceRoot)

        // Append assistant turn (with tool_calls structure) and tool result turn
        const toolCallId = `tc_${step}_${Date.now()}`
        history.push({
          role: 'assistant',
          content: assistantText,
          tool_calls: [
            {
              id: toolCallId,
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(toolArgs) }
            }
          ]
        })

        history.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: toolOutputStr
        })

        continue
      }
    }

    // No tool fence emitted -> final answer reached
    finalAnswer = assistantText
    break
  }

  return { history, toolSequence, finalAnswer, rawResponses }
}

describe('SOVARA LIVE END-TO-END VALIDATION SUITE', () => {
  let tmpWs: string

  beforeEach(() => {
    tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-e2e-val-'))
  })

  it('A. Global-workspace test: Inspect wiki directory and recover from is_a_directory error', async () => {
    const canonicalWs = path.resolve('d:/SOVARA')

    // Create wiki directory with a sample node so it exists on disk
    const wikiDir = path.join(canonicalWs, 'wiki', 'concepts')
    fs.mkdirSync(wikiDir, { recursive: true })
    fs.writeFileSync(path.join(wikiDir, 'sovara-concept.md'), '# SOVARA Concept\n- Architecture: Decoupled ports')

    const { toolSequence, finalAnswer, rawResponses } = await executeSovaraAgentLoop(
      'Read wiki/ directory in the active global workspace and tell me what knowledge exists.',
      canonicalWs,
      6
    )

    console.log('=== GLOBAL WORKSPACE TEST TOOL SEQUENCE ===')
    console.log(toolSequence)
    console.log('=== FINAL ANSWER ===')
    console.log(finalAnswer)

    const fullRawText = rawResponses.join('\n')

    // CRITICAL VALIDATIONS:
    // 1. Tool execution sequence started with fs_read or fs_list and recovered with fs_list
    expect(toolSequence.length).toBeGreaterThanOrEqual(2)
    expect(toolSequence.some((t) => t.includes('fs_list'))).toBe(true)

    // 2. Model did NOT output "I am waiting for the result..."
    expect(fullRawText).not.toContain('I am waiting for the result')

    // 3. Model did NOT emit native <|tool_call> syntax
    expect(fullRawText).not.toContain('<|tool_call>')

    // 4. Model produced non-empty final answer summarizing knowledge
    expect(finalAnswer.length).toBeGreaterThan(20)
  }, 60000)

  it('B. Filename-recovery test: production_notes.txt -> production_notes.txt.txt recovery', async () => {
    // Setup file with duplicate extension in temp workspace
    const dupFile = path.join(tmpWs, 'production_notes.txt.txt')
    fs.writeFileSync(dupFile, 'Machine A: 120 u/h, Downtime: 2h\nMachine B: 150 u/h, Downtime: 1h\nMachine C: 90 u/h, Downtime: 4h')

    const { toolSequence, finalAnswer, rawResponses } = await executeSovaraAgentLoop(
      'Read production_notes.txt and tell me the highest production rate.',
      tmpWs,
      6
    )

    console.log('=== FILENAME RECOVERY TEST TOOL SEQUENCE ===')
    console.log(toolSequence)
    console.log('=== FINAL ANSWER ===')
    console.log(finalAnswer)

    const fullRawText = rawResponses.join('\n')

    // CRITICAL VALIDATIONS:
    // 1. First tool call requested production_notes.txt
    expect(toolSequence[0]).toContain('production_notes.txt')

    // 2. Second tool call recovered with production_notes.txt.txt
    expect(toolSequence[1]).toContain('production_notes.txt.txt')

    // 3. Model did NOT output "I am waiting for the result..."
    expect(fullRawText).not.toContain('I am waiting for the result')

    // 4. Model did NOT emit native <|tool_call> syntax
    expect(fullRawText).not.toContain('<|tool_call>')

    // 5. Final answer identifies highest production rate (Machine B: 150 u/h)
    expect(finalAnswer).toMatch(/Machine B|150/i)
  }, 60000)
})
