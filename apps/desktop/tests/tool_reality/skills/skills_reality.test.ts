import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { ToolStubAdapter } from '../../../src/main/backend/ports/ToolStubAdapter'
import { detectSkillNeeds, classifyTaskEnhanced } from '../../../src/main/backend/TaskClassifier'
import { createTestWorkspace, type TestWorkspaceFixture } from '../fixtures/setup'

describe('SOVARA Tool Reality Lab — Skill Discovery & Reading Tools (search_skills, read_skill)', () => {
  let fixture: TestWorkspaceFixture
  let toolAdapter: ToolStubAdapter

  beforeEach(() => {
    fixture = createTestWorkspace()
    toolAdapter = new ToolStubAdapter()
    // Bind workspace to tool adapter
    ;(toolAdapter as unknown as { getWorkspace: () => string }).getWorkspace = () => fixture.workspaceRoot
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('1. search_skills & read_skill: Known skill search returns match and read_skill fetches real SKILL.md content', async () => {
    // 1. search_skills for "pptx"
    const searchRaw = await toolAdapter.dispatch('search_skills', { query: 'pptx' })
    const searchResult = JSON.parse(searchRaw)

    expect(searchResult.error).toBeUndefined()
    expect(searchResult.matches).toBeDefined()
    expect(Array.isArray(searchResult.matches)).toBe(true)
    expect(searchResult.matches.length).toBeGreaterThan(0)

    const skillName = searchResult.matches[0].name

    // 2. read_skill for matching skill
    const readRaw = await toolAdapter.dispatch('read_skill', { skill_name: skillName })
    const readResult = JSON.parse(readRaw)

    expect(readResult.error).toBeUndefined()
    expect(readResult.name).toBe(skillName)
    expect(readResult.content).toBeDefined()
    expect(typeof readResult.content).toBe('string')
    expect(readResult.content.length).toBeGreaterThan(0)
  })

  it('2. search_skills: Unknown skill search returns truthful not-found result without hallucination', async () => {
    const searchRaw = await toolAdapter.dispatch('search_skills', { query: 'xyznonexistent9999' })
    const searchResult = JSON.parse(searchRaw)

    expect(searchResult.matches).toBeUndefined()
    expect(searchResult.error).toContain('No skills found matching')
  })

  it('3. Calculator prompt contract: Pure arithmetic prompt does NOT inject xlsx skill', () => {
    const prompt = 'A production line has 3 machines. Machine A produces 120 units/hour, B produces 150 units/hour, and C produces 90 units/hour. Calculate total production.'

    // 1. detectSkillNeeds must return 0 skills
    const skills = detectSkillNeeds(prompt)
    expect(skills).not.toContain('xlsx')
    expect(skills.length).toBe(0)

    // 2. Task classification must classify as chat/reasoning without artifact requirement
    const classification = classifyTaskEnhanced(prompt)
    expect(classification.requiresArtifact).toBe(false)
    expect(classification.skillsNeeded).not.toContain('xlsx')
  })
})
