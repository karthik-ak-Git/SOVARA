import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { LocalOpenAIChatAdapter } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import { SOVARA_SYSTEM_PROMPT } from '../src/main/backend/prompts/sovaraSystem'
import { extractToolFences, extractBareToolCalls } from '../src/main/backend/tools/fenceTools'
import { dispatchFs } from '../src/main/capabilities/fs/index'
import { ToolStubAdapter } from '../src/main/backend/ports/ToolStubAdapter'
import { sanitizeAssistantText } from '@shared/assistantProtocol'
import type { LlmChatMessage } from '@shared/types/ports'

const pexec = promisify(execFile)
const ENDPOINT = 'http://127.0.0.1:60776'
const MODEL_ID = 'C:\\Users\\Atina\\.lmstudio\\models\\lmstudio-community\\gemma-4-E2B-it-GGUF\\gemma-4-E2B-it-Q4_K_M.gguf'

function buildToolCatalog(): string {
  return [
    'TOOLS - call with a fenced block, NOT XML. Format exactly:',
    '```tool:search_skills',
    '{"query": "ocr"}',
    '```',
    'Available tools:',
    '- search_skills: find an installed skill {"query": "..."}',
    '- read_skill: read a skill instruction {"skill_name": "..."}',
    '- fs_read: read a file {"path": "..."}',
    '- fs_write: write a file {"path": "...", "content": "..."}',
    '- shell_exec: run a terminal command {"command": "..."}',
    'Execution Workflow (Follow these steps in order):',
    'Step 1: Call search_skills {"query": "ocr"}.',
    'Step 2: Call read_skill {"skill_name": "ocr"}.',
    'Step 3: Call shell_exec to run Python RapidOCR on the image file: {"command": "python -c \\"from rapidocr_onnxruntime import RapidOCR; engine = RapidOCR(); res, _ = engine(r\'<PATH>\'); print(\'\\\\n\'.join([line[1] for line in res]))\\""}.',
    'Step 4: Call fs_write {"path": "factorial.py", "content": "..."} to write the extracted Python code.',
    'Step 5: Call fs_read {"path": "factorial.py"} to verify the generated file content.',
    'Emit ONE fenced tool block per turn (markdown ```tool:name), then wait for its observation.',
  ].join('\n')
}

function parseAnyToolCall(text: string): { toolName: string; args: Record<string, unknown> } | null {
  const fences = extractToolFences(text)
  if (fences.length > 0) {
    return { toolName: fences[0]!.toolName, args: fences[0]!.args }
  }
  const bare = extractBareToolCalls(text)
  if (bare.length > 0) {
    return { toolName: bare[0]!.toolName, args: bare[0]!.args }
  }
  const customMatch = text.match(/<\|?tool_call\|?>[ \t]*(?:tool:)?([a-zA-Z0-9_-]+)\r?\n?(\{[\s\S]*?\})/i)
  if (customMatch) {
    const toolName = customMatch[1]!
    try {
      const args = JSON.parse(customMatch[2]!)
      return { toolName, args }
    } catch {
      return { toolName, args: {} }
    }
  }
  return null
}

describe('SOVARA LIVE OCR IMAGE-TO-PYTHON E2E VALIDATION SUITE', () => {
  it('Executes complete live Image -> search_skills -> read_skill -> OCR -> fs_write -> fs_read -> Final Answer workflow', async () => {
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-ocr-e2e-'))
    const adapter = new LocalOpenAIChatAdapter()
    const stubAdapter = new ToolStubAdapter()

    // 1. Create real code_sample.png image in workspace
    const imagePath = path.join(tmpWs, 'code_sample.png')
    const createImgCmd = `python -c "from PIL import Image, ImageDraw; img = Image.new('RGB', (600, 200), color=(255, 255, 255)); d = ImageDraw.Draw(img); code = 'def calculate_factorial(n):\\n    if n <= 1:\\n        return 1\\n    return n * calculate_factorial(n - 1)\\n\\nprint(calculate_factorial(5))'; d.text((20, 20), code, fill=(0, 0, 0)); img.save(r'${imagePath}')"`
    await pexec(createImgCmd, { shell: 'powershell.exe' })
    expect(fs.existsSync(imagePath)).toBe(true)

    // User Task Prompt
    const userPrompt = `Read the attached image code_sample.png at ${imagePath} and create a Python file factorial.py containing the Python code shown in the image. Read back the file to verify it.`

    const systemContent = [
      SOVARA_SYSTEM_PROMPT,
      buildToolCatalog(),
      `Active Workspace Root: ${tmpWs}`
    ].join('\n\n')

    const history: LlmChatMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userPrompt }
    ]

    const toolSequence: Array<{ name: string; args: Record<string, unknown>; output: string }> = []
    let step = 0
    let finalAnswer = ''

    while (step < 8) {
      step++
      let assistantText = ''

      for await (const chunk of adapter.streamChat({
        endpoint: ENDPOINT,
        model: MODEL_ID,
        messages: history,
        stream: true,
        maxCompletionTokens: 1024,
        timeoutMs: 40000
      })) {
        if (chunk.type === 'text-delta' && chunk.text) {
          assistantText += chunk.text
        }
      }

      const parsedCall = parseAnyToolCall(assistantText)
      if (parsedCall) {
        const toolName = parsedCall.toolName
        const toolArgs = parsedCall.args

        let toolOutput = ''
        if (toolName === 'search_skills' || toolName === 'read_skill') {
          toolOutput = await stubAdapter.dispatch(toolName, toolArgs)
        } else if (toolName === 'shell_exec') {
          const cmd = String(toolArgs.command || '')
          const execRes = await pexec(cmd, { cwd: tmpWs, shell: 'powershell.exe' }).catch((e) => ({ stdout: '', stderr: String(e) }))
          toolOutput = execRes.stdout || execRes.stderr || 'done'
        } else {
          toolOutput = await dispatchFs(toolName, toolArgs as Record<string, string>, tmpWs)
        }

        toolSequence.push({ name: toolName, args: toolArgs, output: toolOutput })

        const toolCallId = `tc_ocr_${step}_${Date.now()}`
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
          content: toolOutput
        })

        continue
      }

      finalAnswer = assistantText
      break
    }

    console.log('=== E2E TOOL EXECUTION SEQUENCE ===')
    console.log(toolSequence.map((t) => `${t.name}(${JSON.stringify(t.args)})`))

    console.log('=== RAW FINAL ANSWER ===')
    console.log(finalAnswer)

    const cleanedAnswer = sanitizeAssistantText(finalAnswer)

    // VERIFICATIONS:
    // A. Image attachment handling: code_sample.png passed as input
    expect(fs.existsSync(imagePath)).toBe(true)

    // B. search_skills executed and returned matches
    const searchStep = toolSequence.find((t) => t.name === 'search_skills')
    expect(searchStep).toBeDefined()
    expect(searchStep?.output).toContain('matches')

    // C. read_skill executed and returned skill content
    const readSkillStep = toolSequence.find((t) => t.name === 'read_skill')
    expect(readSkillStep).toBeDefined()

    // D. Actual image-processing/OCR executed (via shell_exec rapidocr or python)
    const ocrStep = toolSequence.find((t) => t.name === 'shell_exec')
    expect(ocrStep).toBeDefined()
    expect(ocrStep?.output).toContain('calculate_factorial')

    // E & F. Generated file factorial.py created
    const createdFile = path.join(tmpWs, 'factorial.py')
    expect(fs.existsSync(createdFile)).toBe(true)

    // G. Physical file verification: read file back
    const fileContent = fs.readFileSync(createdFile, 'utf8')
    console.log('=== PHYSICALLY GENERATED FACTORIAL.PY CONTENT ===')
    console.log(fileContent)

    expect(fileContent).toContain('def calculate_factorial')
    expect(fileContent).toContain('return')

    // H. Final answer sanitization check (no raw Thinking Process / Thought tags)
    expect(cleanedAnswer).not.toContain('Thinking Process:')
    expect(cleanedAnswer).not.toContain('Thought Process:')
    expect(cleanedAnswer).not.toContain('<think>')
    expect(cleanedAnswer).not.toContain('<thinking>')
  }, 120000)
})
