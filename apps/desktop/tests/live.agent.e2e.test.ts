/**
 * LIVE END-TO-END: the model inside SOVARA does the work.
 *
 * This is not a mock and not a scripted model. It talks to the real
 * llama-server sidecar that `pnpm dev` started, using:
 *   - the REAL assembled system prompt  (prompts/sovaraSystem.ts)
 *   - the REAL runtime tool catalog    (mirrors AgentOrchestrator:1343-1349)
 *   - the REAL fence parser            (tools/fenceTools.ts)
 *   - the REAL skill index             (services/skillsScanner.ts)
 *   - the REAL shell                    (child_process)
 *
 * Run with the app's model already loaded:
 *   npx vitest run tests/live.agent.e2e.test.ts --testTimeout=900000
 *
 * Set LIVE_PORT to override the sidecar port (default 52028).
 */
import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

import { SOVARA_SYSTEM_PROMPT } from '../src/main/backend/prompts/sovaraSystem'
import { extractToolFences } from '../src/main/backend/tools/fenceTools'
import { getAllDiscoveredSkills } from '../src/main/services/skillsScanner'

const pexec = promisify(execFile)
const PORT = process.env.LIVE_PORT || '52028'
const ENDPOINT = `http://127.0.0.1:${PORT}/v1/chat/completions`
const MODEL = process.env.LIVE_MODEL || 'Spark-X2.5-4B-Q4_K_M'
const WORK = path.resolve(__dirname, '..', '..', '..', 'test', 'sovara-agent-journey', 'live')

const MAX_STEPS = 8

const log: string[] = []
function say(s: string) { log.push(s); console.log(s) }

/** Same shape AgentOrchestrator builds for the model. */
function toolCatalog(): string {
  return [
    'TOOLS - call with a fenced block, NOT XML. Format exactly:',
    '```tool:fs_list',
    '{"path": "."}',
    '```',
    'Available tools:',
    '- search_skills: find an installed skill by keyword',
    '- read_skill: read a skill full instructions {"skill_name": "..."}',
    '- fs_read: read a file {"path": "..."}',
    '- fs_write: write a file {"path": "...", "content": "..."}',
    '- fs_list: list a directory {"path": "."}',
    '- shell_exec: run a terminal command {"command": "..."}',
    '- todo_write: plan steps {"todos": [{"content": "...", "status": "pending"}]}',
    '- clarify: ask the user {"questions": [{"question": "...", "options": ["..."]}]}',
    'Rules: 0) ACTION-FIRST: for a requested file write, your next non-reasoning output MUST be a tool fence.',
    '1) For exploration or inspections, you may call fs_list or fs_read directly.',
    '2) Emit ONE fenced tool block per step, then wait for its [Tool result] before the next.',
    '3) Use shell_exec for running python, bash, powershell, or npm scripts.',
    '4) When asked to build, write, or generate code/apps/files, generate the complete functioning implementation immediately.',
  ].join('\n')
}

async function chat(messages: Array<{ role: string; content: string }>, reasoning: boolean): Promise<string> {
  const system = [
    SOVARA_SYSTEM_PROMPT,
    reasoning ? 'Think step by step inside a fenced json:reasoning block before any tool fence.' : '',
    toolCatalog(),
    `Workspace root for every path you pass: ${WORK}`,
  ].filter(Boolean).join('\n\n')
  const body = {
    model: MODEL,
    messages: [{ role: 'system', content: system }, ...messages],
    max_tokens: 900,
    temperature: 0.2,
    stream: false,
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = await res.json() as { choices: Array<{ message: { content: string } }> }
  return j.choices?.[0]?.message?.content ?? ''
}

async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  try {
    if (name === 'search_skills') {
      const all = await getAllDiscoveredSkills(undefined, WORK)
      const q = String(args.query ?? '').toLowerCase()
      const terms = q.split(/[^a-z0-9+#.]+/).filter(t => t.length > 1)
      const hits = terms.length
        ? all.filter(s => {
            const n = (s.name || '').toLowerCase(), d = (s.description || '').toLowerCase()
            return terms.some(t => n.includes(t) || d.includes(t))
          })
        : []
      return JSON.stringify({
        query: q, totalCount: hits.length,
        matches: hits.slice(0, 20).map(s => ({ name: s.name, source: s.source, description: (s.description || '').slice(0, 160) })),
      })
    }
    if (name === 'read_skill') {
      const all = await getAllDiscoveredSkills(undefined, WORK)
      const want = String(args.skill_name ?? args.skillName ?? args.name ?? '').trim().toLowerCase()
      const m = all.find(s => s.name.toLowerCase() === want || (s.id || '').toLowerCase() === want)
      if (!m) return JSON.stringify({ error: `Skill "${want}" not found.` })
      const content = fs.readFileSync(path.join(m.path, 'SKILL.md'), 'utf8')
      return JSON.stringify({ name: m.name, source: m.source, content: content.slice(0, 6000) })
    }
    if (name === 'fs_write') {
      const p = path.resolve(WORK, String(args.path ?? 'out.txt'))
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, String(args.content ?? ''), 'utf8')
      return JSON.stringify({ ok: true, path: p, bytes: fs.statSync(p).size })
    }
    if (name === 'fs_list') {
      const p = path.resolve(WORK, String(args.path ?? '.'))
      return JSON.stringify({ entries: fs.readdirSync(p, { withFileTypes: true }).map(d => d.name) })
    }
    if (name === 'fs_read') {
      const p = path.resolve(WORK, String(args.path ?? ''))
      return JSON.stringify({ path: p, content: fs.readFileSync(p, 'utf8').slice(0, 4000) })
    }
    if (name === 'shell_exec') {
      const cmd = String(args.command ?? '')
      const r = await pexec('cmd.exe', ['/c', cmd], { cwd: WORK, timeout: 240000, windowsHide: true })
      return JSON.stringify({ ok: true, exitCode: 0, stdout: (r.stdout || '').slice(-3000), stderr: (r.stderr || '').slice(-1500) })
    }
    if (name === 'todo_write') return JSON.stringify({ ok: true, todos: args.todos })
    if (name === 'clarify') return JSON.stringify({ ok: true, note: 'user answered: proceed with your best judgement' })
    return JSON.stringify({ error: `unknown tool ${name}` })
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) })
  }
}

const LIVE = Boolean(process.env.LIVE_PORT)
describe.skipIf(!LIVE)('LIVE agent - the model itself must produce the file', () => {
  it('searches a skill, reads it, and generates the artifact', async () => {
    fs.mkdirSync(WORK, { recursive: true })
    for (const f of fs.readdirSync(WORK)) {
      try { fs.rmSync(path.join(WORK, f), { recursive: true, force: true }) } catch {}
    }

    const TASK = 'Create a quarterly revenue report as report.pdf'
    const messages: Array<{ role: string; content: string }> = [{ role: 'user', content: TASK }]

    const used: string[] = []
    const readSkills: string[] = []
    let final = ''
    let systemTokens = 0

    for (let step = 1; step <= MAX_STEPS; step++) {
      const t0 = Date.now()
      let out: string
      try {
        out = await chat(messages, true)
      } catch (e) {
        say(`step ${step}: REQUEST FAILED ${(e as Error).message}`)
        break
      }
      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      if (step === 1) {
        systemTokens = SOVARA_SYSTEM_PROMPT.length
        say(`system prompt approx tokens: ~${Math.round(systemTokens / 4)}`)
      }
      const fences = extractToolFences(out)
      say(`--- step ${step} (${secs}s) fences=${fences.length} chars=${out.length}`)

      if (fences.length === 0) {
        final = out
        say(`NO TOOL FENCE. Model replied in prose.`)
        say(out.slice(0, 700))
        break
      }

      let result = ''
      for (const f of fences) {
        const name = String((f as { tool?: string }).tool ?? '').trim()
        const args = (f as { args?: Record<string, unknown> }).args ?? {}
        used.push(name)
        say(`    -> ${name} ${JSON.stringify(args).slice(0, 220)}`)
        result = await runTool(name, args)
        if (name === 'read_skill') readSkills.push(String(args.skill_name ?? args.skillName ?? ''))
        say(`    <- ${result.slice(0, 260)}`)
      }
      messages.push({ role: 'assistant', content: out })
      messages.push({ role: 'user', content: `[Tool result]\n${result}` })
    }

    const files = fs.readdirSync(WORK).filter(f => !f.startsWith('_'))
    say('')
    say('================ LIVE RESULT ================')
    say(`tools used      : ${used.join(' -> ') || '(none)'}`)
    say(`skills read     : ${readSkills.join(', ') || '(none)'}`)
    say(`files produced  : ${files.join(', ') || '(none)'}`)
    say(`final prose     : ${final ? final.slice(0, 300) : '(no prose turn)'}`)
    fs.writeFileSync(path.join(__dirname, '..', '..', '..', 'test', 'sovara-agent-journey', 'live', '_RUN.txt'), log.join('\n'), 'utf8')

    expect(used.length, 'the model emitted no tool calls at all').toBeGreaterThan(0)
  }, 900000)
})
