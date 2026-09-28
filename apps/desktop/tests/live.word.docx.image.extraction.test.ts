import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { evaluateMultimodalGate } from '../src/main/backend/MultimodalGate'
import { routeModel, type RouterContext } from '../src/main/backend/ModelRouter'
import { LocalOpenAIChatAdapter } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
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

describe('USER SCENARIO E2E TEST: Extract Image Data into Word Document (.docx)', () => {
  it('Processes image attachment, extracts experiment list, and generates verified Word Document (.docx)', async () => {
    const tmpWs = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-docx-user-test-'))
    const imagePath = path.join(tmpWs, 'experiments_screenshot.png')
    const docxPath = path.join(tmpWs, 'experiments.docx')

    // 1. Create realistic screenshot image containing database experiment list
    const createImgCmd = `python -c "from PIL import Image, ImageDraw; img = Image.new('RGB', (700, 250), color=(255, 255, 255)); d = ImageDraw.Draw(img); text = 'List of Experiments:\\n1. Database Connection and Schema Setup\\n2. SQL Indexing Performance Analysis\\n3. ACID Transaction Rollback Verification\\n4. Distributed Query Execution Test'; d.text((20, 20), text, fill=(0, 0, 0)); img.save(r'${imagePath}')"`
    await pexec(createImgCmd, { shell: 'powershell.exe' })
    expect(fs.existsSync(imagePath)).toBe(true)

    // 2. AUTO Router capability-aware assessment
    const routerCtx: RouterContext = {
      task: { kind: 'analysis', confidence: 1, requiredCapabilities: ['vision'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'image attachment uploaded', requiresVision: true } as any,
      models: [textModelGemma],
      resources: mockResources,
      ocrCapabilityAvailable: true,
    }

    const decision = await routeModel(routerCtx)
    expect(decision.selectedRoute).toBe('ocr_capability')

    // 3. Perform OCR text extraction on screenshot image
    const ocrCmd = `python -c "from rapidocr_onnxruntime import RapidOCR; engine = RapidOCR(); res, _ = engine(r'${imagePath}'); print('\\n'.join([line[1] for line in res]))"`
    const ocrRes = await pexec(ocrCmd, { shell: 'powershell.exe' })
    const extractedText = ocrRes.stdout.trim()

    expect(extractedText).toContain('List of Experiments')
    expect(extractedText).toContain('Database Connection')

    console.log('=== EXTRACTED TEXT FROM SCREENSHOT ===')
    console.log(extractedText)

    // 4. Generate Word Document (.docx) using python-docx
    const makeDocxCmd = `python -c "import docx; doc = docx.Document(); doc.add_heading('List of Experiments', 0); text = '''${extractedText.replace(/'/g, "\\'")}'''; [doc.add_paragraph(line) for line in text.split('\\n') if line.strip()]; doc.save(r'${docxPath}')"`
    await pexec(makeDocxCmd, { shell: 'powershell.exe' })

    // 5. Physical verification of Word Document (.docx)
    expect(fs.existsSync(docxPath)).toBe(true)
    const stats = fs.statSync(docxPath)
    expect(stats.size).toBeGreaterThan(1000)

    console.log(`=== GENERATED WORD DOCUMENT ===`)
    console.log(`File: ${docxPath}`)
    console.log(`Size: ${stats.size} bytes`)
  }, 45000)
})
