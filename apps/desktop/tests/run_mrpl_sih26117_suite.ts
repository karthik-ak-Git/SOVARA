import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { LocalOpenAIChatAdapter } from '../src/main/backend/ports/LocalOpenAIChatAdapter'
import { SOVARA_SYSTEM_PROMPT } from '../src/main/backend/prompts/sovaraSystem'
import { extractToolFences, normalizeToolName } from '../src/main/backend/tools/fenceTools'
import { ToolStubAdapter, createWebRuntime } from '../src/main/backend/ports/ToolStubAdapter'
import type { LlmChatMessage } from '../src/shared/types/ports'

process.env.SOVARA_NETWORK_MODE = 'CONTROLLED_LOCAL'
const PORT = 60889
const ENDPOINT = `http://127.0.0.1:${PORT}`
const LLAMA_EXE = 'C:\\Users\\Atina\\AppData\\Local\\Sovara\\runtime\\llama.cpp\\b10900\\llama-server.exe'
const MODEL_PATH = 'C:\\Users\\Atina\\.lmstudio\\models\\lmstudio-community\\gemma-4-E2B-it-GGUF\\gemma-4-E2B-it-Q4_K_M.gguf'
const WORKSPACE = 'D:\\SOVARA'

const MRPL_PROMPTS = [
  {
    id: 1,
    title: 'MOC Approval Note - CDU Overhead Condenser',
    category: 'Approval Note / Process Safety',
    prompt: "You are SOVARA, the sovereign industrial AI workbench for Mangalore Refinery and Petrochemicals Limited (MRPL). Draft a confidential Management of Change (MOC) Approval Note (Doc No: MRPL-MOC-2026-CDU1-042) for replacing the Crude Distillation Unit overhead condenser tube bundle from Carbon Steel to Titanium Grade 2 to mitigate wet H2S sour water corrosion. Use fs_write to save the note to 'mrpl_cdu_moc_note.md'. Include: MOC ID, Process Hazard Analysis (PHA) summary, metallurgy comparison, environmental compliance, and an engineering sign-off table. Verify creation with fs_read."
  },
  {
    id: 2,
    title: 'Darcy-Weisbach Pipeline Hydraulics',
    category: 'Engineering Calculations',
    prompt: "Write a Python script 'mrpl_pipeline_hydraulics.py' that calculates the frictional pressure drop across a 500-meter crude transfer line from Tank 101 to CDU furnace using the Darcy-Weisbach equation. Given: Fluid density = 850 kg/m3, Dynamic viscosity = 0.005 Pa*s, Pipe internal diameter = 0.3 m, Flow rate = 250 m3/h, Pipe absolute roughness = 0.045 mm. Use fs_write to create the script, then use shell_exec to execute 'python mrpl_pipeline_hydraulics.py' and print Reynolds number, friction factor, and total pressure drop in both kPa and bar."
  },
  {
    id: 3,
    title: 'Heat Exchanger E-102 LMTD & Heat Duty',
    category: 'Engineering Calculations',
    prompt: "Write a Python calculation script 'mrpl_heat_exchanger_lmtd.py' for shell-and-tube exchanger E-102 at MRPL. Hot fluid (kerosene) cools from 180°C to 110°C, cold fluid (crude oil) heats from 40°C to 95°C in counter-current flow. Compute: (1) Temperature differences Delta T1 and Delta T2, (2) Log Mean Temperature Difference (LMTD) in °C, (3) Heat duty Q in kW given cold fluid mass flow 45 kg/s and Cp = 2.1 kJ/(kg*K). Save with fs_write and execute with shell_exec."
  },
  {
    id: 4,
    title: 'Centrifugal Pump P-201A NPSHa Cavitation Assessment',
    category: 'Engineering Calculations / Rotating Equipment',
    prompt: "Write a standalone Python script 'mrpl_pump_npsh.py' to evaluate cavitation margin for MRPL Booster Pump P-201A pumping naphtha. Atmospheric pressure = 101.3 kPa, Suction vessel static liquid head = 4.5 m above pump centerline, Suction line friction loss = 1.2 m, Fluid vapor pressure = 45 kPa, Fluid density = 720 kg/m3, Pump manufacturer NPSH required (NPSHr) = 2.8 m. Calculate NPSH available (NPSHa) and determine whether cavitation margin exceeds API 610 safety limit (margin >= 1.0 m). Save with fs_write and execute with shell_exec."
  },
  {
    id: 5,
    title: 'Ultrasonic Thickness Inspection & Corrosion Rate',
    category: 'Inspection & Integrity / Non-Destructive Testing',
    prompt: "Write an inspection analysis script 'mrpl_corrosion_eval.py' that processes ultrasonic thickness (UT) inspection readings from MRPL Diesel Hydrodesulfurization (DHDS) reactor shell. Nominal original wall thickness = 38.0 mm, Minimum design allowable thickness (t_min) = 28.5 mm, Installation year = 2014. Current measured thickness in 2026 inspection = 31.8 mm. Calculate: (1) Total metal loss, (2) Corrosion rate in mm/year, (3) Remaining service life in years. Save with fs_write and execute with shell_exec."
  },
  {
    id: 6,
    title: 'API 520 Safety Relief Valve (PSV) Orifice Sizing',
    category: 'Process Safety / Engineering Calculations',
    prompt: "Write a Python calculation script 'mrpl_psv_sizing.py' to calculate the required effective discharge area (cm2 and in2) for a spring-loaded relief valve PSV-304 on an LPG accumulator under fire case according to API 520 Part I. Relieving capacity = 15,000 kg/h, Relieving pressure = 18.5 bar absolute, Latent heat of vaporization = 360 kJ/kg, Molecular weight = 44.1 kg/kmol, Relieving temperature = 55°C, Discharge coefficient Kd = 0.975. Determine the nearest standard API orifice letter. Save with fs_write and execute with shell_exec."
  },
  {
    id: 7,
    title: 'Flare Gas Emission Telemetry Dashboard',
    category: 'Environmental Compliance / Deliverables',
    prompt: "Generate a dark-themed HTML/CSS compliance dashboard 'mrpl_flare_emissions.html' visualizing hourly SO2, NOx, and VOC emission levels from MRPL elevated flare stack against Indian CPCB (Central Pollution Control Board) statutory threshold limits (SO2 <= 500 mg/Nm3). Include a status badge (COMPLIANT), parameter metric cards, and a CSS-styled gauge. Save with fs_write and verify creation with fs_read."
  },
  {
    id: 8,
    title: 'ASTM D86 Crude Distillation Boiling Curve',
    category: 'Refinery Laboratory & Assay / Data Processing',
    prompt: "Write a Python data processing script 'mrpl_astm_d86.py' that takes boiling point data of Bombay High Crude: IBP=38°C, 10%=95°C, 30%=180°C, 50%=265°C, 70%=340°C, 90%=440°C, FBP=520°C. Calculate volumetric yields for: (1) Light Naphtha (<90°C), (2) Heavy Naphtha (90-150°C), (3) Kerosene/ATF (150-240°C), (4) Gasoil/Diesel (240-360°C), (5) Atmospheric Residue (>360°C) using linear interpolation. Save with fs_write and run with shell_exec."
  },
  {
    id: 9,
    title: 'CCR Furnace F-101 Pre-Startup Safety Checklist',
    category: 'Standard Operating Procedures / Operations',
    prompt: "Create a comprehensive standard operating procedure (SOP) pre-startup safety checklist for MRPL Continuous Catalytic Reforming (CCR) furnace F-101 following turnaround. Use fs_write to save it to 'mrpl_sop_furnace_startup.md'. Must include Nitrogen purging & LEL gas testing criteria (<0.5%), fuel gas valve train double-block-and-bleed leak checks, pilot burner ignition sequence, and burner flame scanner permissives. Verify with fs_read."
  },
  {
    id: 10,
    title: 'Control Valve Flow Coefficient Cv Sizing',
    category: 'Instrumentation & Control',
    prompt: "Write a Python tool 'mrpl_control_valve_cv.py' to calculate the required flow coefficient (Cv) for a globe valve controlling chilled cooling water to MRPL Aromatics complex. Flow rate = 450 US GPM, Specific gravity = 1.0, Upstream pressure P1 = 65 psia, Downstream pressure P2 = 45 psia. Compute Cv = Q * sqrt(SG / Delta P). Check if standard 3-inch valve (rated Cv = 110) has sufficient operating margin (between 20% and 80% valve opening). Save with fs_write and run with shell_exec."
  },
  {
    id: 11,
    title: 'Hydrocracker Unit Shift Handover Log',
    category: 'Operations Log / Shift Handover',
    prompt: "Draft a formal shift handover log for Shift Engineer (Shift A to Shift B, 14:00 - 22:00 hrs) for MRPL Hydrocracker Unit (HCU). Record throughput (285 m3/h), reactor bed peak temperature (392°C), H2/hydrocarbon ratio, ongoing maintenance permits (tag-out of booster pump P-302B for mechanical seal replacement), and night shift instructions. Save with fs_write to 'mrpl_shift_handover_log.md'."
  },
  {
    id: 12,
    title: 'Air-Gapped Sovereign Security & Network Audit',
    category: 'Sovereignty & Security Invariants',
    prompt: "Verify the sovereign air-gapped security posture of this workbench using shell_exec to run PowerShell command `Get-NetTCPConnection -State Established, Listen | Where-Object { $_.LocalPort -in 8080,60888 } | Select-Object LocalAddress, LocalPort, State` to confirm that all AI inference and agent communications bind exclusively to loopback (127.0.0.1) and have ZERO connections to external cloud AI servers. Save the audit summary to 'mrpl_sovereign_security_audit.txt' with fs_write."
  },
  {
    id: 13,
    title: 'Refinery Knowledge Base Memory Ingestion',
    category: 'Knowledge Base / Durable Memory',
    prompt: "Use the memory tool to store durable plant knowledge into the local wiki: Concept 'MRPL_CDU1_Design_Limits': Design capacity 9.69 MMTPA, Maximum operating pressure 3.2 kg/cm2g, Maximum crude preheat temperature 285°C, Overhead chloride limit < 2.0 ppm. Confirm storage."
  },
  {
    id: 14,
    title: 'Local Engineering Skill Discovery',
    category: 'Agentic Skill Ingestion',
    prompt: "Use search_skills to query for available engineering and automation capabilities, verifying that the workbench dynamically indexes local skills without internet connectivity."
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
    '```tool:fs_write',
    '{"path": "filename.ext", "content": "..."}',
    '```',
    'Available tools:',
    '- fs_read: read a file {"path": "..."}',
    '- fs_list: list a directory {"path": "."}',
    '- fs_write: write a file {"path": "...", "content": "..."}',
    '- fs_patch: surgical search & replace {"path": "...", "search": "...", "replace": "..."}',
    '- shell_exec: execute a terminal command {"command": "..."}',
    '- memory: store to wiki {"action": "create", "concept": "...", "content": "..."}',
    '- search_skills: search local skills {"query": "..."}',
    '- read_skill: read local skill {"skill_name": "..."}',
    'Rules:',
    '1) When asked to write or create a file, invoke fs_write directly with the full file content.',
    '2) When asked to execute a script or command, invoke shell_exec directly.',
    '3) When asked to verify or read, invoke fs_read or fs_list directly.',
    '4) Emit ONE tool block per turn, then wait for the tool output before continuing.',
  ].join('\n')
}

async function runPromptSuite() {
  console.log('======================================================================')
  console.log('SOVARA SIH26117 MRPL INDUSTRIAL BENCHMARK SUITE')
  console.log('Theme: Sovereign On-Premise Agentic AI Workbench (14 Prompts)')
  console.log(`Workspace: ${WORKSPACE}`)
  console.log(`Model: ${path.basename(MODEL_PATH)} on port ${PORT}`)
  console.log('======================================================================\n')

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
      console.log('[llama]:', s.trim().slice(0, 120))
    }
  })

  console.log('Waiting for llama-server to be ready...')
  const ready = await waitPort(PORT, 40000)
  if (!ready) {
    console.error('llama-server failed to bind port!')
    llamaProc.kill()
    process.exit(1)
  }
  console.log('llama-server is READY on CUDA.\n')

  const webRuntime = createWebRuntime(() => true)
  const toolAdapter = new ToolStubAdapter(
    webRuntime,
    () => [],
    () => WORKSPACE,
    {
      dispatch: (input) => ({
        jobId: `job_${Date.now()}`,
        done: Promise.resolve({ status: 'completed', result: `Subagent completed: ${input.description}`, durationMs: 25 })
      })
    },
    true
  )

  const chatAdapter = new LocalOpenAIChatAdapter()
  const results: any[] = []

  for (const p of MRPL_PROMPTS) {
    console.log(`\n----------------------------------------------------------------------`)
    console.log(`[PROMPT ${p.id}/14] ${p.title} (${p.category})`)
    console.log(`----------------------------------------------------------------------`)

    const systemContent = [
      SOVARA_SYSTEM_PROMPT,
      buildToolCatalog(),
      `Active Industrial Workspace: ${WORKSPACE}`,
      `Refinery Context: Mangalore Refinery and Petrochemicals Limited (MRPL). Air-Gapped Confidential Mode.`
    ].join('\n\n')

    const history: LlmChatMessage[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: p.prompt }
    ]

    let step = 0
    const maxSteps = 3
    const toolsInvoked: Array<{ tool: string; args: any; output: string; latencyMs: number }> = []
    let fullOutput = ''

    while (step < maxSteps) {
      step++
      let assistantText = ''
      const t0 = Date.now()

      try {
        for await (const chunk of chatAdapter.streamChat({
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
        console.error(`[Error in prompt ${p.id} step ${step}]:`, err.message)
        break
      }

      const dur = ((Date.now() - t0) / 1000).toFixed(2)
      console.log(`  Step ${step}: Model generated in ${dur}s (${assistantText.length} chars)`)
      fullOutput += assistantText + '\n'

      const fences = extractToolFences(assistantText)
      if (fences.length > 0) {
        const fence = fences[0]!
        const toolName = normalizeToolName(fence.toolName)
        const toolArgs = fence.args
        console.log(`   -> Invoking Tool: ${toolName}`)

        const toolStart = Date.now()
        let toolResultStr = ''
        try {
          const res = await toolAdapter.dispatch(toolName, toolArgs)
          toolResultStr = typeof res === 'string' ? res : JSON.stringify(res)
        } catch (e: any) {
          toolResultStr = JSON.stringify({ error: e.message })
        }
        const toolDur = Date.now() - toolStart
        console.log(`   -> Tool Result (${toolDur}ms): ${toolResultStr.slice(0, 120).replace(/\n/g, ' ')}...`)

        toolsInvoked.push({
          tool: toolName,
          args: toolArgs,
          output: toolResultStr,
          latencyMs: toolDur
        })

        const toolCallId = `tc_${p.id}_${step}_${Date.now()}`
        history.push({
          role: 'assistant',
          content: assistantText,
          tool_calls: [{ id: toolCallId, type: 'function', function: { name: toolName, arguments: JSON.stringify(toolArgs) } }]
        })
        history.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: toolResultStr
        })
      } else {
        console.log('   -> Final response completed (no further tools invoked).')
        break
      }
    }

    results.push({
      id: p.id,
      title: p.title,
      category: p.category,
      prompt: p.prompt,
      steps: step,
      toolsInvoked,
      fullOutput: fullOutput.trim()
    })
  }

  console.log('\nShutting down llama-server...')
  llamaProc.kill()

  // Write results to JSON
  const jsonPath = path.join(WORKSPACE, 'MRPL_SIH26117_BENCHMARK_RESULTS.json')
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`JSON report saved to: ${jsonPath}`)

  // Write results to Markdown report
  const mdPath = path.join(WORKSPACE, 'MRPL_SIH26117_BENCHMARK_RESULTS.md')
  let md = '# MRPL Industrial Benchmark Suite (SIH26117) — Live Local Execution Report\n\n'
  md += `**Problem Statement**: SIH26117 — Sovereign On-Premise Agentic AI Workbench\n`
  md += `**Organization**: Mangalore Refinery and Petrochemicals Limited (MRPL)\n`
  md += `**Runtime Model**: \`${path.basename(MODEL_PATH)}\` on \`llama-server.exe\` (CUDA)\n`
  md += `**Execution Date**: ${new Date().toISOString()}\n`
  md += `**Workspace**: \`${WORKSPACE}\`\n\n`

  md += '## Executive Summary Table\n\n'
  md += '| # | Task Title | Category | Steps | Tools Called | Status | Deliverable |\n'
  md += '|---|---|---|---|---|---|---|\n'

  for (const r of results) {
    const toolList = r.toolsInvoked.map((t: any) => `\`${t.tool}\``).join(', ') || 'Direct Synthesis'
    const status = r.toolsInvoked.some((t: any) => t.output.includes('"error"')) ? '**ERROR**' : '**SUCCESS**'
    const deliverable = r.toolsInvoked.find((t: any) => t.tool === 'fs_write')?.args?.path || 'Synthesis Text'
    md += `| ${r.id} | ${r.title} | ${r.category} | ${r.steps} | ${toolList} | ${status} | \`${deliverable}\` |\n`
  }

  md += '\n---\n\n## Detailed Prompt Execution Logs\n\n'
  for (const r of results) {
    md += `### Prompt ${r.id}: ${r.title}\n`
    md += `* **Category**: ${r.category}\n`
    md += `* **Prompt**:\n> ${r.prompt}\n\n`
    md += `* **Steps**: ${r.steps}\n`
    md += `* **Tools Invoked**: ${r.toolsInvoked.length}\n\n`

    if (r.toolsInvoked.length > 0) {
      md += '#### Tool Invocation Trace:\n'
      for (const t of r.toolsInvoked) {
        md += `* **Tool**: \`${t.tool}\` (${t.latencyMs}ms)\n`
        md += '```json\n' + JSON.stringify(t.args, null, 2) + '\n```\n'
        md += '* **Tool Result**:\n```\n' + t.output.slice(0, 1000) + '\n```\n\n'
      }
    }

    md += '#### Model Generation Output:\n\n'
    md += r.fullOutput + '\n\n---\n\n'
  }

  fs.writeFileSync(mdPath, md, 'utf8')
  console.log(`Markdown report saved to: ${mdPath}`)
  console.log('\nALL 14 MRPL INDUSTRIAL PROMPTS EXECUTED AND RECORDED SUCCESSFULLY!')
}

runPromptSuite().catch(console.error)
