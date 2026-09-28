import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { routeModel, type RouterContext } from '../src/main/backend/ModelRouter'
import { LocalOpenAIChatAdapter } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import { ToolStubAdapter } from '../src/main/backend/ports/ToolStubAdapter'
import { dispatchFs } from '../src/main/capabilities/fs/index'
import { extractToolFences, extractBareToolCalls } from '../src/main/backend/tools/fenceTools'
import { SOVARA_SYSTEM_PROMPT } from '../src/main/backend/prompts/sovaraSystem'
import type { DiscoveredModel } from '@shared/types/models'
import type { SystemResources } from '@shared/types/ports'
import type { LlmChatMessage } from '@shared/types/ports'

const pexec = promisify(execFile)
const ENDPOINT = 'http://127.0.0.1:60776'
const LOCAL_MODEL_PATH = 'C:\\Users\\Atina\\.lmstudio\\models\\lmstudio-community\\gemma-4-E2B-it-GGUF\\gemma-4-E2B-it-Q4_K_M.gguf'

const mockResources: SystemResources = {
  cpu: { user: 0, system: 0 },
  ram: { totalMB: 32000, freeMB: 16000, usedMB: 16000 },
  vram: { totalMB: 8000, freeMB: 6000, usedMB: 2000 },
}

const textModelGemma: DiscoveredModel = {
  modelId: LOCAL_MODEL_PATH,
  runtimeId: 'local',
  available: true,
  capabilities: ['chat', 'coding'],
  contextLength: 8192,
}

const visionModelQwen: DiscoveredModel = {
  modelId: 'qwen2-vl-7b-instruct',
  runtimeId: 'local',
  available: true,
  capabilities: ['chat', 'coding', 'vision'],
  contextLength: 8192,
}

function parseAnyToolCall(text: string): { toolName: string; args: Record<string, unknown> } | null {
  const fences = extractToolFences(text)
  if (fences.length > 0) return { toolName: fences[0]!.toolName, args: fences[0]!.args }
  const bare = extractBareToolCalls(text)
  if (bare.length > 0) return { toolName: bare[0]!.toolName, args: bare[0]!.args }
  const customMatch = text.match(/<\|?tool_call\|?>[ \t]*(?:tool:)?([a-zA-Z0-9_-]+)\r?\n?(\{[\s\S]*?\})/i)
  if (customMatch) {
    try { return { toolName: customMatch[1]!, args: JSON.parse(customMatch[2]!) } } catch { return { toolName: customMatch[1]!, args: {} } }
  }
  return null
}

function buildCatalogForImage(imagePath: string): string {
  return [
    'TOOLS - call with a fenced block, NOT XML. Format exactly:',
    '```tool:shell_exec',
    `{"command": "python -c \\"from rapidocr_onnxruntime import RapidOCR; engine = RapidOCR(); res, _ = engine(r'${imagePath}'); print('\\\\n'.join([line[1] for line in res]))\\""}`,
    '```',
    'Available tools:',
    '- fs_read: read a file {"path": "..."}',
    '- fs_write: write a file {"path": "...", "content": "..."}',
    '- shell_exec: run a terminal command {"command": "..."}',
    'Execution Workflow:',
    'Step 1: Execute shell_exec to run Python RapidOCR on the image file.',
    'Step 2: Call fs_write {"path": "factorial.py", "content": "..."} to save the extracted Python code.',
    'Step 3: Call fs_read {"path": "factorial.py"} to verify the saved file content.',
    'Emit ONE fenced tool block per turn (markdown ```tool:name), then wait for its observation.',
  ].join('\n')
}

describe('PART 7 — E2E AUTO SMART ROUTER VALIDATION SUITE (Real Image -> Python Artifact)', () => {
  it('TEST A: Vision Model Available -> AUTO Router selects Vision Model Route', async () => {
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-auto-testA-'))
    const imagePath = path.join(tmpWs, 'code_sample.png')

    // Create real image with Python factorial code
    const createImgCmd = `python -c "from PIL import Image, ImageDraw; img = Image.new('RGB', (600, 200), color=(255, 255, 255)); d = ImageDraw.Draw(img); code = 'def calculate_factorial(n):\\n    if n <= 1:\\n        return 1\\n    return n * calculate_factorial(n - 1)\\n\\nprint(calculate_factorial(5))'; d.text((20, 20), code, fill=(0, 0, 0)); img.save(r'${imagePath}')"`
    await pexec(createImgCmd, { shell: 'powershell.exe' })
    expect(fs.existsSync(imagePath)).toBe(true)

    // Router Context: both Vision Model and Text Model available
    const routerCtx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attachment uploaded', requiresVision: true } as any,
      models: [textModelGemma, visionModelQwen],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const decision = await routeModel(routerCtx)

    // Verify AUTO Router Selection
    expect(decision.selectedRoute).toBe('vision_model')
    expect(decision.modelId).toBe('qwen2-vl-7b-instruct')
    expect(decision.routingTrace?.selectedRoute).toBe('vision_model')
    expect(decision.routingTrace?.reason).toContain('Vision-capable model available')

    console.log('=== TEST A ROUTING TRACE ===')
    console.log(JSON.stringify(decision.routingTrace, null, 2))
  })

  it('TEST B: No Vision Model Available, Executable OCR Available -> AUTO Router selects OCR Fallback Route & Generates Verified Artifact', async () => {
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-auto-testB-'))
    const imagePath = path.join(tmpWs, 'code_sample.png')

    // Create real image with Python factorial code
    const createImgCmd = `python -c "from PIL import Image, ImageDraw; img = Image.new('RGB', (600, 200), color=(255, 255, 255)); d = ImageDraw.Draw(img); code = 'def calculate_factorial(n):\\n    if n <= 1:\\n        return 1\\n    return n * calculate_factorial(n - 1)\\n\\nprint(calculate_factorial(5))'; d.text((20, 20), code, fill=(0, 0, 0)); img.save(r'${imagePath}')"`
    await pexec(createImgCmd, { shell: 'powershell.exe' })
    expect(fs.existsSync(imagePath)).toBe(true)

    // Router Context: Text Model only, Executable OCR Capability available
    const routerCtx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attachment uploaded', requiresVision: true } as any,
      models: [textModelGemma], // Vision model unavailable
      resources: mockResources,
      ocrCapabilityAvailable: true, // Executable OCR capability available
    }

    const decision = await routeModel(routerCtx)

    // Verify AUTO Router Selection
    expect(decision.selectedRoute).toBe('ocr_capability')
    expect(decision.modelId).toBe(LOCAL_MODEL_PATH)
    expect(decision.routingTrace?.selectedRoute).toBe('ocr_capability')

    console.log('=== TEST B ROUTING TRACE ===')
    console.log(JSON.stringify(decision.routingTrace, null, 2))

    // Execute agent turn using selected model + OCR fallback route
    const adapter = new LocalOpenAIChatAdapter()

    const systemPrompt = [SOVARA_SYSTEM_PROMPT, buildCatalogForImage(imagePath), `Active Workspace Root: ${tmpWs}`].join('\n\n')
    const history: LlmChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Read the attached image code_sample.png at ${imagePath} and create a Python file factorial.py containing the Python code shown in the image. Read back the file to verify it.` }
    ]

    const toolSequence: Array<{ name: string; args: Record<string, unknown>; output: string }> = []
    let step = 0

    while (step < 6) {
      step++
      let assistantText = ''

      for await (const chunk of adapter.streamChat({
        endpoint: ENDPOINT,
        model: LOCAL_MODEL_PATH,
        messages: history,
        stream: true,
        maxCompletionTokens: 1024,
        timeoutMs: 30000
      })) {
        if (chunk.type === 'text-delta' && chunk.text) assistantText += chunk.text
      }

      const parsed = parseAnyToolCall(assistantText)
      if (parsed) {
        let toolOutput = ''
        if (parsed.toolName === 'shell_exec') {
          const cmd = String(parsed.args.command || `python -c "from rapidocr_onnxruntime import RapidOCR; engine = RapidOCR(); res, _ = engine(r'${imagePath}'); print('\\n'.join([line[1] for line in res]))"`)
          const res = await pexec(cmd, { cwd: tmpWs, shell: 'powershell.exe' }).catch((e) => ({ stdout: '', stderr: String(e) }))
          toolOutput = res.stdout || res.stderr || 'done'
        } else {
          toolOutput = await dispatchFs(parsed.toolName, parsed.args as Record<string, string>, tmpWs)
        }

        toolSequence.push({ name: parsed.toolName, args: parsed.args, output: toolOutput })

        const tcId = `tc_auto_${step}_${Date.now()}`
        history.push({ role: 'assistant', content: assistantText, tool_calls: [{ id: tcId, type: 'function', function: { name: parsed.toolName, arguments: JSON.stringify(parsed.args) } }] })
        history.push({ role: 'tool', tool_call_id: tcId, content: toolOutput })
        continue
      }
      break
    }

    console.log('=== TEST B TOOL EXECUTION SEQUENCE ===')
    console.log(toolSequence.map((t) => `${t.name}(${JSON.stringify(t.args)})`))

    // Verify file factorial.py was physically written & read back
    const createdFile = path.join(tmpWs, 'factorial.py')
    expect(fs.existsSync(createdFile)).toBe(true)
    const fileContent = fs.readFileSync(createdFile, 'utf8')
    expect(fileContent).toContain('def calculate_factorial')
    console.log('=== TEST B GENERATED FACTORIAL.PY CONTENT ===')
    console.log(fileContent)
  }, 60000)

  it('TEST C: Neither Vision Model nor Executable OCR Available -> AUTO Router stops with honest capability-unavailable result', async () => {
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-auto-testC-'))
    const imagePath = path.join(tmpWs, 'code_sample.png')

    // Router Context: Text Model only, NO OCR Capability
    const routerCtx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attachment uploaded', requiresVision: true } as any,
      models: [textModelGemma],
      resources: mockResources,
      ocrCapabilityAvailable: false,
    }

    const decision = await routeModel(routerCtx)

    // Verify AUTO Router Selection
    expect(decision.selectedRoute).toBe('unavailable')
    expect(decision.modelId).toBeNull()
    expect(decision.reason).toContain('image-processing-unavailable')
    expect(decision.routingTrace?.selectedRoute).toBe('unavailable')

    console.log('=== TEST C ROUTING TRACE ===')
    console.log(JSON.stringify(decision.routingTrace, null, 2))

    // Confirm no fake files created in workspace
    const createdFile = path.join(tmpWs, 'factorial.py')
    expect(fs.existsSync(createdFile)).toBe(false)
  })
})
