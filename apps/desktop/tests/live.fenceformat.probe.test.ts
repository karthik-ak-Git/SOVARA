/**
 * A/B probe: does the size of SOVARA's system prompt change whether the model
 * emits a parseable tool fence?
 *
 * Live finding from the first run of the live E2E test: with the real prompt
 * the model emitted
 *     <tool_call>search_skills<arg_key>query</arg_key><arg_value>pdf</arg_value></tool_call>
 * and extractToolFences returned 0. With a short prompt the same model emitted
 * a correct ```tool:search_skills fence for the same request.
 *
 * This isolates the cause instead of guessing at it.
 */
import { describe, it, expect } from 'vitest'
import { SOVARA_SYSTEM_PROMPT } from '../src/main/backend/prompts/sovaraSystem'
import { extractToolFences } from '../src/main/backend/tools/fenceTools'

const PORT = process.env.LIVE_PORT || '52028'
const ENDPOINT = `http://127.0.0.1:${PORT}/v1/chat/completions`
const MODEL = 'Spark-X2.5-4B-Q4_K_M'

const CATALOG = `TOOLS - call with a fenced block, NOT XML. Format exactly:
\`\`\`tool:fs_list
{"path": "."}
\`\`\`
Available tools:
- search_skills: find an installed skill by keyword
- read_skill: read a skill {"skill_name": "..."}
- shell_exec: run a terminal command {"command": "..."}
Rules: 0) ACTION-FIRST: your next non-reasoning output MUST be a tool fence.`

async function ask(system: string, user: string): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 400, temperature: 0.2, stream: false,
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const j = await res.json() as { choices: Array<{ message: { content: string } }> }
  return j.choices?.[0]?.message?.content ?? ''
}

const looksXml = (s: string) => /<\s*\/?\s*(tool_call|tool|arg_key|arg_value|function)/i.test(s)

const LIVE = Boolean(process.env.LIVE_PORT)
describe.skipIf(!LIVE)('prompt size vs tool-fence compliance (live)', () => {
  it('short prompt yields a parseable fence', async () => {
    const short = `You are SOVARA, a local AI agent running fully offline.\n\n${CATALOG}`
    const out = await ask(short, 'Create a quarterly revenue report as report.pdf')
    console.log(`SHORT  ~${Math.round(short.length / 4)} tok  fences=${extractToolFences(out).length}  xml=${looksXml(out)}`)
    console.log(`       ${JSON.stringify(out).slice(0, 220)}`)
    expect(extractToolFences(out).length).toBeGreaterThan(0)
  }, 300000)

  it('the real full prompt is measured and reported', async () => {
    const full = `${SOVARA_SYSTEM_PROMPT}\n\n${CATALOG}`
    const out = await ask(full, 'Create a quarterly revenue report as report.pdf')
    const fences = extractToolFences(out)
    console.log(`FULL   ~${Math.round(full.length / 4)} tok  fences=${fences.length}  xml=${looksXml(out)}`)
    console.log(`       ${JSON.stringify(out).slice(0, 400)}`)
    // Reported, not asserted: the point is the measurement.
    expect(typeof fences.length).toBe('number')
  }, 300000)

  it('quantifies the parser gap: XML-style output the app cannot read', async () => {
    const full = `${SOVARA_SYSTEM_PROMPT}\n\n${CATALOG}`
    const samples: string[] = []
    for (let i = 0; i < 3; i++) samples.push(await ask(full, 'Create a quarterly revenue report as report.pdf'))
    const parsed = samples.map(s => extractToolFences(s).length)
    const xmls = samples.map(looksXml)
    console.log(`repeat runs -> fences: ${parsed.join(',')}   xml: ${xmls.join(',')}`)
    for (const s of samples) if (looksXml(s)) console.log(`  XML SAMPLE: ${JSON.stringify(s).slice(0, 260)}`)
    expect(true).toBe(true)
  }, 600000)
})
