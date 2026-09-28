import { describe, expect, it } from 'vitest'
import { ToolStubAdapter } from '../src/main/backend/ports/ToolStubAdapter'
import { extractToolFences } from '../src/main/backend/tools/fenceTools'

describe('SOVARA Skill Resolution Boundary & Registry Test Suite', () => {
  it('1. search_skills("ocr") returns valid OCR skill entries', async () => {
    const adapter = new ToolStubAdapter()
    const resStr = await adapter.dispatch('search_skills', { query: 'ocr' })
    const res = JSON.parse(resStr)

    expect(res.matches).toBeDefined()
    expect(res.matches.length).toBeGreaterThan(0)
    const hasOcrMatch = res.matches.some((m: { description: string }) => m.description.toLowerCase().includes('ocr'))
    expect(hasOcrMatch).toBe(true)
  })

  it('2. read_skill({ skill_name: "ocr" }) resolves through skill registry rather than fs_read lookup', async () => {
    const adapter = new ToolStubAdapter()
    const resStr = await adapter.dispatch('read_skill', { skill_name: 'ocr' })
    const res = JSON.parse(resStr)

    // Must NOT return filesystem error
    expect(res.error).toBeUndefined()
    expect(res.content).toBeDefined()
    expect(res.name).toBeDefined()
  })

  it('3. read_skill({ path: "ocr" }) normalizes path argument and resolves through skill registry', async () => {
    const adapter = new ToolStubAdapter()
    const resStr = await adapter.dispatch('read_skill', { path: 'ocr' } as any)
    const res = JSON.parse(resStr)

    expect(res.error).toBeUndefined()
    expect(res.content).toBeDefined()
    expect(res.name).toBeDefined()
  })

  it('4. Generic skill resolution works for non-OCR skills (e.g. brag, antigravity-guide)', async () => {
    const adapter = new ToolStubAdapter()
    
    // Non-OCR test 1: brag
    const bragResStr = await adapter.dispatch('read_skill', { skill_name: 'brag' })
    const bragRes = JSON.parse(bragResStr)
    expect(bragRes.error).toBeUndefined()
    expect(bragRes.content).toBeDefined()
    expect(bragRes.name).toBe('brag')

    // Non-OCR test 2: antigravity-guide
    const guideResStr = await adapter.dispatch('read_skill', { skill_name: 'antigravity-guide' })
    const guideRes = JSON.parse(guideResStr)
    expect(guideRes.error).toBeUndefined()
    expect(guideRes.content).toBeDefined()
    expect(guideRes.name).toBe('antigravity-guide')
  })

  it('5. fenceTools normalizes read_skill with path or query argument into skill_name', () => {
    const fenceText = '```tool:read_skill\n{"path":"ocr"}\n```'
    const extracted = extractToolFences(fenceText)

    expect(extracted.length).toBe(1)
    expect(extracted[0].toolName).toBe('read_skill')
    expect(extracted[0].args.skill_name).toBe('ocr')
  })
})
