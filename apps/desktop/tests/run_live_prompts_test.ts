import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { LocalOpenAIChatAdapter } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import { SOVARA_SYSTEM_PROMPT } from '../src/main/backend/prompts/sovaraSystem'
import { extractToolFences, looksLikeToolFence, normalizeToolName } from '../src/main/backend/tools/fenceTools'
import { dispatchFs } from '../src/main/capabilities/fs/index'
import type { LlmChatMessage } from '../src/shared/types/ports'

const PORT = 60776
const ENDPOINT = `http://127.0.0.1:${PORT}`
const LLAMA_EXE = 'C:\\Users\\Atina\\AppData\\Local\\Sovara\\runtime\\llama.cpp\\b10900\\llama-server.exe'
const MODEL_PATH = 'C:\\Users\\Atina\\.lmstudio\\models\\lmstudio-community\\gemma-4-E2B-it-GGUF\\gemma-4-E2B-it-Q4_K_M.gguf'
const WORKSPACE = 'D:\\SOVARA'

const PROMPTS = [
  {
    id: 1,
    title: 'Dashboard HTML & CSS',
    prompt: "Create a standalone HTML and CSS file called 'dashboard.html' in the workspace that showcases a dark-mode hardware monitoring dashboard with mock animated CPU, GPU, and RAM dials. Verify the file exists and give me a summary of what you created."
  },
  {
    id: 2,
    title: 'Fibonacci Benchmark',
    prompt: "Write a Python script called 'fibonacci_bench.py' that computes the first 35 Fibonacci numbers both iteratively and recursively, measures the execution time for both approaches, and prints a formatted comparison table. Run the script and show me the output."
  },
  {
    id: 3,
    title: 'Hardware Inspection',
    prompt: "Inspect the host system hardware specifications (CPU cores, available RAM, and GPU/VRAM) and recommend the best local GGUF quantization level (e.g. Q4_K_M vs Q8_0) for running models on this machine."
  },
  {
    id: 4,
    title: 'Workspace Scan & Architecture',
    prompt: "Scan the current workspace structure, identify the key entry points and main architectural components, and summarize how the agent orchestrator communicates with local tools."
  },
  {
    id: 5,
    title: 'Math Utils Bug & Fix',
    prompt: "Create a test file 'math_utils.js' with a deliberate division-by-zero bug in an average() function. Run a test against it, detect the failure, edit the file to fix the bug, and verify that the tests pass."
  }
]

function waitPort(port: number, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now()
  return new Promise((resolve) => {
    const probe = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true)
        } else {
          retry()
        }
      })
      req.on('error', () => retry())
      req.setTimeout(1000, () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false)
      } else {
        setTimeout(probe, 1000)
      }
    }
    probe()
  })
}

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
    '- shell_exec: execute a terminal command {"command": "..."}',
    'Rules:',
    '1) If you need to write or create a file, invoke fs_write directly.',
    '2) If you need to read or verify a file, invoke fs_read or fs_list directly.',
    '3) If you need to run a script or test, invoke shell_exec directly.',
    '4) Emit ONE tool block per turn, wait for the result.',
  ].join('\n')
}

async function runSinglePrompt(adapter: LocalOpenAIChatAdapter, promptObj: typeof PROMPTS[0]) {
  console.log(`\n======================================================================`)
  console.log(`TESTING PROMPT ${promptObj.id}: ${promptObj.title}`)
  console.log(`Prompt text: "${promptObj.prompt}"`)
  console.log(`======================================================================`)

  const systemContent = [
    SOVARA_SYSTEM_PROMPT,
    buildToolCatalog(),
    `Active Workspace Root: ${WORKSPACE}`
  ].join('\n\n')

  const history: LlmChatMessage[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: promptObj.prompt }
  ]

  let step = 0
  const maxSteps = 4
  const toolsInvoked: string[] = []
  let fullOutput = ''

  while (step < maxSteps) {
    step++
    let assistantText = ''
    const t0 = Date.now()

    try {
      for await (const chunk of adapter.streamChat({
        endpoint: ENDPOINT,
        model: MODEL_PATH,
        messages: history,
        stream: true,
        maxCompletionTokens: 4096,
        timeoutMs: 60000
      })) {
        if (chunk.type === 'text-delta' && chunk.text) {
          assistantText += chunk.text
        }
      }
    } catch (err: any) {
      console.error(`[Error in step ${step}]:`, err.message)
      break
    }

    const duration = ((Date.now() - t0) / 1000).toFixed(2)
    console.log(`[Step ${step}] Model responded in ${duration}s (${assistantText.length} chars)`)
    fullOutput += assistantText + '\n'

    // Check tool invocation
    const fences = extractToolFences(assistantText)
    if (fences.length > 0) {
      const fence = fences[0]!
      const toolName = normalizeToolName(fence.toolName)
      const toolArgs = fence.args
      const callSig = `${toolName}(${JSON.stringify(toolArgs).slice(0, 80)}...)`
      toolsInvoked.push(callSig)
      console.log(` -> Tool invoked: ${callSig}`)

      let toolOutput = ''
      if (toolName === 'fs_write' || toolName === 'fs_read' || toolName === 'fs_list') {
        try {
          toolOutput = await dispatchFs(toolName, toolArgs as Record<string, string>, WORKSPACE)
        } catch (e: any) {
          toolOutput = `Tool error: ${e.message}`
        }
      } else if (toolName === 'shell_exec') {
        toolOutput = `[Simulated shell_exec]: command accepted`
      } else {
        toolOutput = `[Tool ${toolName} executed]`
      }

      console.log(` -> Tool result: ${toolOutput.slice(0, 100).replace(/\n/g, ' ')}...`)

      const toolCallId = `tc_${step}_${Date.now()}`
      history.push({
        role: 'assistant',
        content: assistantText,
        tool_calls: [{ id: toolCallId, type: 'function', function: { name: toolName, arguments: JSON.stringify(toolArgs) } }]
      })
      history.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: toolOutput
      })
      continue
    } else {
      console.log(` -> No tool called (Direct text response)`)
      break
    }
  }

  return {
    id: promptObj.id,
    title: promptObj.title,
    steps: step,
    toolsInvoked,
    fullOutput: fullOutput.trim(),
    preview: fullOutput.trim().slice(0, 300) + (fullOutput.trim().length > 300 ? '...' : '')
  }
}

async function main() {
  console.log(`Starting llama-server with model: ${path.basename(MODEL_PATH)} on port ${PORT}...`)
  
  const llamaProc: ChildProcess = spawn(
    LLAMA_EXE,
    [
      '--model', MODEL_PATH,
      '--port', String(PORT),
      '--ctx-size', '8192',
      '--n-gpu-layers', '999',
      '--threads', '6'
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  )

  llamaProc.stderr?.on('data', (d) => {
    const s = d.toString()
    if (s.includes('error') || s.includes('CUDA') || s.includes('main: server is listening')) {
      // console.log('[llama stderr]:', s.trim())
    }
  })

  const ready = await waitPort(PORT, 40000)
  if (!ready) {
    console.error('Failed to start llama-server within timeout.')
    try { llamaProc.kill() } catch {}
    process.exit(1)
  }

  console.log(`llama-server is healthy and ready on port ${PORT}!`)

  const adapter = new LocalOpenAIChatAdapter()
  const results = []

  for (const p of PROMPTS) {
    try {
      const res = await runSinglePrompt(adapter, p)
      results.push(res)
    } catch (e: any) {
      console.error(`Prompt ${p.id} threw error:`, e.message)
      results.push({ id: p.id, title: p.title, steps: 0, toolsInvoked: [], fullOutput: `Error: ${e.message}`, preview: `Error: ${e.message}` })
    }
  }

  let mdReport = '# SOVARA Live AI Model Generation Outputs\n\n'
  mdReport += `**Model**: \`${path.basename(MODEL_PATH)}\` via \`llama-server.exe\` (CUDA)\n`
  mdReport += `**Timestamp**: ${new Date().toISOString()}\n\n---\n\n`

  for (const r of results) {
    mdReport += `## Prompt ${r.id}: ${r.title}\n\n`
    mdReport += `**Steps Executed**: ${r.steps}\n\n`
    mdReport += `**Tools Invoked**: ${r.toolsInvoked.length > 0 ? r.toolsInvoked.join(', ') : 'None'}\n\n`
    mdReport += `### Generated Output:\n\n${r.fullOutput}\n\n---\n\n`
  }

  fs.writeFileSync(path.join(WORKSPACE, 'live_model_outputs.md'), mdReport, 'utf8')
  console.log(`Saved full outputs to ${path.join(WORKSPACE, 'live_model_outputs.md')}`)

  console.log('\n======================================================================')
  console.log('SUMMARY OF LIVE LOCAL MODEL TESTS (Gemma-4-E2B-it-Q4_K_M)')
  console.log('======================================================================')
  for (const r of results) {
    console.log(`\nPrompt ${r.id}: ${r.title}`)
    console.log(`- Steps executed: ${r.steps}`)
    console.log(`- Tools called: ${r.toolsInvoked.length > 0 ? r.toolsInvoked.join(', ') : 'None (Generated markdown/text directly)'}`)
  }

  console.log('\nShutting down llama-server...')
  try {
    llamaProc.kill('SIGTERM')
    // Wait for clean exit
    setTimeout(() => {
      try { process.kill(llamaProc.pid!, 'SIGKILL') } catch {}
      process.exit(0)
    }, 2000)
  } catch {
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
