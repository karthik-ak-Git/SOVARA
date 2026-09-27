/**
 * SKILL GATE - the loop death and the invented content.
 *
 * Two real defects lived here:
 *
 * 1. The gate filtered `skillsNeeded` through a hardcoded allowlist
 *    (['pptx','docx','xlsx','pdf','diagram','code']). Any skill outside those six
 *    buckets skipped the gate entirely, so the router could only ever see them.
 *
 * 2. `hasSearch` counted the ATTEMPT to search, not a successful read. A search
 *    that returned zero matches satisfied the attempt check, the gate failed
 *    again on the next step, and the turn burned all 32 steps with no inference
 *    and no artifact - which is also why the 2D memory .md was never written.
 *
 * The gate is now format-agnostic and releases after N honest misses so the
 * model degrades to the fallback instead of spinning.
 */
import { describe, it, expect } from 'vitest'
import { checkSkillReadGate, MAX_SKILL_SEARCH_ATTEMPTS } from '../src/main/backend/AgentOrchestrator'
import { markdownToSlides } from '../src/main/backend/artifacts'

const hist = (...entries: Array<[string, Record<string, unknown>]>) =>
  entries.map(([name, args]) => ({ name, args }))

describe('skill gate · is format-agnostic', () => {
  it('gates a skill outside the old six-bucket allowlist', () => {
    // Before the fix, 'epub' and 'latex' were filtered out and the gate passed.
    for (const skill of ['epub', 'latex', 'svg', 'mermaid', 'd3', 'blender', 'ffmpeg', 'terraform']) {
      const g = checkSkillReadGate({ skillsNeeded: [skill] } as never, [], new Set())
      expect(g.passed, `"${skill}" bypassed the gate - still hardcoded to six formats`).toBe(false)
      expect(g.missing).toContain(skill)
    }
  })

  it('passes when nothing needs a skill', () => {
    expect(checkSkillReadGate({ skillsNeeded: [] } as never, [], new Set()).passed).toBe(true)
    expect(checkSkillReadGate({} as never, [], new Set()).passed).toBe(true)
  })
})

describe('skill gate · a failed search is not compliance', () => {
  it('still blocks after one fruitless search', () => {
    const g = checkSkillReadGate(
      { skillsNeeded: ['pptx'] } as never,
      hist(['search_skills', { query: 'pptx presentation' }]),
      new Set(),
    )
    expect(g.passed).toBe(false)
  })

  it('passes once the skill is actually read', () => {
    const read = new Set(['pptx-official'])
    const g = checkSkillReadGate(
      { skillsNeeded: ['pptx'] } as never,
      hist(['search_skills', { query: 'pptx' }], ['read_skill', { skill_name: 'pptx-official' }]),
      read,
    )
    expect(g.passed).toBe(true)
  })

  it('does not accept a read when NOTHING was read', () => {
    const g = checkSkillReadGate(
      { skillsNeeded: ['pptx'] } as never,
      hist(['read_skill', { skill_name: '' }]),
      new Set(),
    )
    expect(g.passed).toBe(false)
  })

  it('is satisfied by a real skill name that differs from the format bucket', () => {
    // THE bug: the classifier emits the bucket 'pptx', the installed skill is
    // 'pptx-official'. Comparing the two could never succeed.
    for (const [bucket, skill] of [
      ['pptx', 'pptx-official'], ['xlsx', 'xlsx-official'],
      ['docx', 'docx-official'], ['pdf', 'pdf-official'],
    ] as const) {
      const g = checkSkillReadGate(
        { skillsNeeded: [bucket] } as never,
        hist(['read_skill', { skill_name: skill }]),
        new Set(),
      )
      expect(g.passed, `reading ${skill} did not satisfy the ${bucket} gate`).toBe(true)
    }
  })
})

describe('skill gate · cannot deadlock', () => {
  it('releases after N honest misses instead of spinning to step 32', () => {
    const searches = hist(
      ...Array.from({ length: MAX_SKILL_SEARCH_ATTEMPTS }, () => ['search_skills', { query: 'nope' }] as [string, Record<string, unknown>]),
    )
    const g = checkSkillReadGate({ skillsNeeded: ['pptx'] } as never, searches, new Set())
    expect(g.passed, 'gate deadlocked instead of degrading').toBe(true)
    expect(g.message).toMatch(/SKILL UNAVAILABLE/i)
  })

  it('the release message forbids claiming a skill was read', () => {
    const searches = hist(
      ...Array.from({ length: MAX_SKILL_SEARCH_ATTEMPTS }, () => ['search_skills', { query: 'nope' }] as [string, Record<string, unknown>]),
    )
    const g = checkSkillReadGate({ skillsNeeded: ['pptx'] } as never, searches, new Set())
    expect(g.message).toMatch(/Never claim a skill was read/i)
  })

  it('blocks exactly MAX-1 times, then releases', () => {
    for (let n = 0; n < MAX_SKILL_SEARCH_ATTEMPTS; n++) {
      const g = checkSkillReadGate({ skillsNeeded: ['x'] } as never, hist(...Array.from({ length: n }, () => ['search_skills', {}] as [string, Record<string, unknown>])), new Set())
      if (n < MAX_SKILL_SEARCH_ATTEMPTS - 1) expect(g.passed, `released early at ${n}`).toBe(false)
    }
  })
})

describe('artifacts · never invents content', () => {
  it('does not fabricate a "Key point overview" bullet', () => {
    const slides = markdownToSlides('# Title Only\n\nJust a heading, no bullets.')
    expect(slides.length).toBeGreaterThan(0)
    for (const s of slides) {
      expect(s.bullets, 'a bullet was invented for an empty slide').not.toContain('Key point overview')
    }
  })

  it('leaves a heading-only section with no invented bullet', () => {
    // A section heading followed immediately by another heading has no content.
    const slides = markdownToSlides('# Deck\n\n## Q1\n\n## Q2\n- Real bullet')
    const q1 = slides.find(s => s.title === 'Q1')
    expect(q1, 'the empty Q1 section should still exist as a slide').toBeTruthy()
    expect(q1!.bullets, 'an empty section must not gain invented bullets').toEqual([])
  })

  it('still keeps real bullets intact', () => {
    const slides = markdownToSlides('# Deck\n\n## Q1\n- Ship CLI\n- Fix updater')
    const q1 = slides.find(s => s.title === 'Q1')
    expect(q1!.bullets).toContain('Ship CLI')
    expect(q1!.bullets).toContain('Fix updater')
  })
})
