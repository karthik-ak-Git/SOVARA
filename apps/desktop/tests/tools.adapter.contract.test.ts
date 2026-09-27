/**
 * Adapter-level tool contracts: search_skills, read_skill, todo_write, memory,
 * run_code, MCP routing, the circuit breaker, and the unknown-tool path.
 *
 * These exercise ToolStubAdapter's real dispatch() against a real temp HOME so
 * skill discovery finds real SKILL.md fixtures.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ToolStubAdapter } from '../src/main/backend/ports/ToolStubAdapter'

const j = (s: string) => JSON.parse(s) as Record<string, any>

let ws: string

beforeEach(() => {
  // NOTE: deliberately NOT touching HOME/USERPROFILE. Mutating global env here
  // leaked into other test files in the same worker and broke real-home skill
  // discovery for them. Workspace-local skills are the hermetic seam instead.
  ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sovara-ws-'))
  for (const [dir, name, desc] of [
    ['code', 'code', 'Write production code artifacts'],
    ['pptx', 'pptx', 'Build PowerPoint presentations'],
  ] as const) {
    const d = path.join(ws, 'skills', dir)
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(
      path.join(d, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nFollow this procedure exactly.\n`,
      'utf8',
    )
  }
})
afterEach(() => { fs.rmSync(ws, { recursive: true, force: true }) })

function makeAdapter(): ToolStubAdapter {
  // Constructor signature: (webTools, ?, workspaceProvider)
  return new ToolStubAdapter(
    { enabled: false, search: async () => { throw new Error('disabled') }, crawl: async () => [] } as never,
    () => [],
    () => ws,
  )
}

describe('TOOL search_skills — purpose: find skills by keyword, return name/source/description', () => {
  // Every skill dispatch re-scans the real home skill library (1268 skills on the
  // dev machine), so these are deliberately consolidated: one scan, many
  // assertions, instead of one scan per assertion.
  it('finds by name, by description, hints the next step, and errors honestly', async () => {
    const a = makeAdapter()
    const byName = j(await a.dispatch('search_skills', { query: 'pptx' }))
    expect(byName.error).toBeUndefined()
    expect(byName.totalCount).toBeGreaterThan(0)
    const hit = byName.matches.find((m: any) => m.name === 'pptx')
    expect(hit).toBeTruthy()
    expect(hit).toHaveProperty('source')
    expect(hit).toHaveProperty('description')
    // Tells the model the next step instead of dead-ending.
    expect(byName.hint).toMatch(/read_skill/)

    const byDesc = j(await a.dispatch('search_skills', { query: 'powerpoint' }))
    expect(byDesc.matches.some((m: any) => m.name === 'pptx')).toBe(true)

    const miss = j(await a.dispatch('search_skills', { query: 'zzz_nope' }))
    expect(miss.error).toMatch(/No skills found/i)
    expect(miss.error).toMatch(/different keyword/i)
  })
})

describe('TOOL read_skill — purpose: return the SKILL.md body for an exact name', () => {
  it('reads exactly, is case-insensitive, accepts aliases, and fails honestly', async () => {
    const a = makeAdapter()
    const exact = j(await a.dispatch('read_skill', { skill_name: 'pptx' }))
    expect(exact.error).toBeUndefined()
    expect(exact.name).toBe('pptx')
    expect(exact.content).toContain('Follow this procedure exactly')

    // Small models vary capitalisation and key name.
    const upper = j(await a.dispatch('read_skill', { skill_name: 'PPTX' }))
    expect(upper.error).toBeUndefined()
    const alias = j(await a.dispatch('read_skill', { skillName: 'code' }))
    expect(alias.error).toBeUndefined()

    const noName = j(await a.dispatch('read_skill', {}))
    expect(noName.error).toMatch(/requires.*skill_name/i)

    const unknown = j(await a.dispatch('read_skill', { skill_name: 'ghost' }))
    expect(unknown.error).toMatch(/not found/i)
    expect(unknown.error).toMatch(/search_skills/)
  })

  it('caps the body so a huge skill cannot blow the context window', async () => {
    const d = path.join(ws, 'skills', 'huge')
    fs.mkdirSync(d, { recursive: true })
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: huge\ndescription: big\n---\n${'A'.repeat(50000)}`, 'utf8')
    const r = j(await makeAdapter().dispatch('read_skill', { skill_name: 'huge' }))
    expect(r.content.length).toBeLessThanOrEqual(10000)
  })
})

describe('TOOL todo_write (adapter) — purpose: whole-list replace through the adapter', () => {
  it('accepts the model-favoured shape {todos:[{content,status}]}', async () => {
    const r = j(await makeAdapter().dispatch('todo_write', { todos: [{ content: 'a', status: 'pending' }] }))
    expect(r.error).toBeUndefined()
    expect(r.counts.pending).toBe(1)
  })
  it('returns a readable error for an invalid list', async () => {
    const r = j(await makeAdapter().dispatch('todo_write', { todos: [{ content: '', status: 'pending' }] }))
    expect(r.error).toMatch(/non-empty|string/i)
  })
})

describe('TOOL run_code — purpose: programmatic tool calls, returns output+status', () => {
  it('requires code', async () => {
    const r = j(await makeAdapter().dispatch('run_code', {}))
    expect(r.error).toMatch(/requires \{ code: string \}/)
  })
  it('returns a status field so the orchestrator can verify an effect', async () => {
    const r = j(await makeAdapter().dispatch('run_code', { code: 'return 1 + 1;' }))
    expect(r).toHaveProperty('status')
    expect(['ok', 'error']).toContain(r.status)
  })
})

describe('TOOL dispatch routing + circuit breaker', () => {
  it('returns a structured error for an unregistered tool (never throws)', async () => {
    const r = j(await makeAdapter().dispatch('totally_unknown_tool', {}))
    expect(r.error).toBeTruthy()
  })
  it('lists every tool with a real description the model can be shown', () => {
    const defs = makeAdapter().list()
    expect(defs.length).toBeGreaterThan(5)
    for (const d of defs) {
      expect(d.name, 'named').toBeTruthy()
      expect(d.description, `${d.name} described`).toBeTruthy()
      expect(d.parameters, `${d.name} schema`).toBeTruthy()
    }
    const names = defs.map((d) => d.name)
    for (const must of ['clarify', 'search_skills', 'read_skill']) {
      expect(names, `${must} is offered to the model`).toContain(must)
    }
  })
  it('opens the circuit after repeated failures so a broken tool cannot spin the loop', async () => {
    const a = makeAdapter()
    // Use run_code (a cheap deterministic failure) rather than read_skill:
    // every skills dispatch re-scans the real home skill library, which is slow
    // and would make this test time out for reasons unrelated to the breaker.
    for (let i = 0; i < 4; i++) await a.dispatch('run_code', {})
    const after = j(await a.dispatch('run_code', { code: 'return 1;' }))
    expect(after.error ?? '').toMatch(/circuit|temporarily|unavailable|repeated/i)
  })
})
