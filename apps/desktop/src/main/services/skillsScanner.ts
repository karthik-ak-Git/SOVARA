import { readdir, access, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'

export interface SkillsSource {
  name: string
  path: string
  skillCount: number
  enabled: boolean
}

export interface BionicSkill {
  id: string
  name: string
  description: string
  path: string
}

const SKILL_SOURCES: Array<{ name: string; relPath: string }> = [
  { name: 'Claude Code', relPath: '.claude/skills' },
  { name: 'Other Agents', relPath: '.agents/skills' },
  { name: 'OpenCode', relPath: '.opencode/skills' },
  { name: 'Agency Agents', relPath: '.agency-agents/skills' },
  { name: 'Superpowers', relPath: '.superpowers/skills' },
  { name: 'Hyperframes', relPath: '.hyperframes/skills' },
  { name: 'Antigravity Built-in', relPath: '.gemini/antigravity/builtin/skills' },
  { name: 'Antigravity Config', relPath: '.gemini/config/skills' },
  { name: 'Gemini Skills', relPath: '.gemini/skills' },
  { name: 'Cursor Skills', relPath: '.cursor/skills' },
  { name: 'Windsurf Skills', relPath: '.windsurf/skills' },
]

function getEnabledMapRaw(store?: { getAppSetting: (k: string) => string | null }): Record<string, boolean> {
  try {
    const raw = store?.getAppSetting('skills_enabled')
    if (raw) return JSON.parse(raw) as Record<string, boolean>
  } catch {}
  return {}
}

function isSourceEnabled(name: string, store?: { getAppSetting: (k: string) => string | null }): boolean {
  const map = getEnabledMapRaw(store)
  if (name in map) return Boolean(map[name])
  return true
}

export function setSkillsSourceEnabled(store: { setAppSetting: (k: string, v: string) => void; getAppSetting: (k: string) => string | null }, name: string, enabled: boolean): void {
  const map = getEnabledMapRaw(store)
  map[name] = enabled
  store.setAppSetting('skills_enabled', JSON.stringify(map))
}

function getBionicDir(): string {
  try {
    return join(app.getPath('userData'), 'skills')
  } catch {
    return join(homedir(), '.sovara', 'skills')
  }
}

async function countSkills(dirPath: string): Promise<number> {
  let count = 0
  try {
    await access(dirPath)
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        try {
          await access(join(dirPath, entry.name, 'SKILL.md'))
          count++
        } catch {
          // subdirectory has no SKILL.md — skip
        }
      }
    }
  } catch {
    // directory doesn't exist
  }
  return count
}

function parseSkillMd(text: string): { name: string; description: string } {
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (fm) {
    const body = fm[1]
    const name = body.match(/^\s*name\s*:\s*(.+)\s*$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
    const desc = body.match(/^\s*description\s*:\s*(.+)\s*$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
    return { name, description: desc }
  }
  const firstLine = text.trim().split('\n')[0]?.slice(0, 80) ?? ''
  return { name: firstLine, description: '' }
}

export async function scanSkillsSources(store?: { getAppSetting: (k: string) => string | null }): Promise<SkillsSource[]> {
  const home = homedir()
  const results: SkillsSource[] = []
  for (const src of SKILL_SOURCES) {
    const fullPath = join(home, src.relPath)
    const skillCount = await countSkills(fullPath)
    results.push({
      name: src.name,
      path: fullPath,
      skillCount,
      enabled: isSourceEnabled(src.name, store),
    })
  }
  return results
}

export async function listBionicSkills(): Promise<BionicSkill[]> {
  return listSkillsInDir(getBionicDir())
}

export async function listSkillsInDir(dirPath: string): Promise<BionicSkill[]> {
  const out: BionicSkill[] = []
  try {
    await access(dirPath)
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(dirPath, entry.name, 'SKILL.md')
      try {
        await access(skillPath)
        const text = await readFile(skillPath, 'utf8')
        const meta = parseSkillMd(text)
        const stat = await readFile(skillPath, 'utf8').then(() => null).catch(() => null)
        out.push({
          id: entry.name,
          name: meta.name || entry.name,
          description: meta.description || text.slice(0, 120).replace(/\n/g, ' ').trim(),
          path: join(dirPath, entry.name),
        })
      } catch {
        // skip
      }
    }
  } catch {
    // no dir yet
  }
  return out
}

export async function listDetailedSkillsForSources(store?: { getAppSetting: (k: string) => string | null }): Promise<Array<{ name: string; path: string; skills: BionicSkill[] }>> {
  const home = homedir()
  const out: Array<{ name: string; path: string; skills: BionicSkill[] }> = []
  for (const src of SKILL_SOURCES) {
    const fullPath = join(home, src.relPath)
    const skills = await listSkillsInDir(fullPath)
    out.push({ name: src.name, path: fullPath, skills })
  }
  return out
}

export async function importSkillFromUrl(url: string): Promise<BionicSkill> {
  const u = new URL(url)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL must be https://')
  // Fetch remote SKILL.md — allowed for skills import (sovereignty exception: skillsScanner may fetch)
  const res = await fetch(url, { headers: { 'User-Agent': 'SOVARA/1.0' } } as RequestInit)
  if (!res.ok) throw new Error(`fetch failed (${res.status})`)
  const text = await res.text()
  if (!text.trim()) throw new Error('empty SKILL.md')
  // Derive name from URL or frontmatter
  const meta = parseSkillMd(text)
  const fallback = u.pathname.split('/').pop()?.replace(/\.md$/i, '') || `skill-${Date.now()}`
  const name = meta.name || fallback.slice(0, 32)
  // Create via existing helper (uses frontmatter)
  return createBionicSkill({ name, description: meta.description, content: text })
}

export async function importSkillFromContent(content: string, fallbackName?: string): Promise<BionicSkill> {
  const text = content.trim()
  if (!text) throw new Error('empty skill content')
  const meta = parseSkillMd(text)
  const name = meta.name || fallbackName?.replace(/\.md$/i, '').slice(0, 32) || `skill-${Date.now()}`
  return createBionicSkill({ name, description: meta.description, content: text })
}

export async function createBionicSkill(input: { name: string; description?: string; content: string }): Promise<BionicSkill> {
  const dir = getBionicDir()
  const sanitized = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || `skill-${Date.now()}`
  const skillDir = join(dir, sanitized)
  await mkdir(skillDir, { recursive: true })
  const frontmatter = `---\nname: "${input.name.replace(/"/g, '\\"')}"\ndescription: "${(input.description ?? '').replace(/"/g, '\\"')}"\n---\n`
  const body = `${frontmatter}\n${input.content.trim()}\n`
  await writeFile(join(skillDir, 'SKILL.md'), body, 'utf8')
  return {
    id: sanitized,
    name: input.name,
    description: input.description ?? '',
    path: skillDir,
  }
}

export async function deleteBionicSkill(id: string): Promise<boolean> {
  const dir = getBionicDir()
  const sanitized = id.replace(/[^a-z0-9-_]/g, '').slice(0, 64)
  if (!sanitized) return false
  const skillDir = join(dir, sanitized)
  try {
    await rm(skillDir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

// Helper to gather all available skills across Bionic, sources, and workspace
export async function getAllDiscoveredSkills(
  store?: { getAppSetting: (k: string) => string | null },
  workspaceRoot?: string
): Promise<Array<BionicSkill & { source: string }>> {
  const all: Array<BionicSkill & { source: string }> = []
  const seenPaths = new Set<string>()

  // 1. Bionic skills
  if (isSourceEnabled('Bionic', store) !== false) {
    const bionic = await listBionicSkills()
    for (const b of bionic) {
      if (!seenPaths.has(b.path)) {
        seenPaths.add(b.path)
        all.push({ ...b, source: 'Bionic' })
      }
    }
  }

  // 2. Global configured sources
  const sources = await scanSkillsSources(store)
  const enabledSources = sources.filter((s) => s.enabled)
  for (const src of enabledSources) {
    const skills = await listSkillsInDir(src.path)
    for (const s of skills) {
      if (!seenPaths.has(s.path)) {
        seenPaths.add(s.path)
        all.push({ ...s, source: src.name })
      }
    }
  }

  // 3. Workspace-local skills
  if (workspaceRoot) {
    const wsCandidates = ['.skills', 'skills', '.agents/skills', '.gemini/skills', '.opencode/skills']
    for (const rel of wsCandidates) {
      const p = join(workspaceRoot, rel)
      const skills = await listSkillsInDir(p)
      for (const s of skills) {
        if (!seenPaths.has(s.path)) {
          seenPaths.add(s.path)
          all.push({ ...s, source: `Workspace (${rel})` })
        }
      }
    }
  }

  return all
}

// Load enabled SKILL.md contents for AI injection with keyword relevance matching
export async function loadEnabledSkillsContent(
  store?: { getAppSetting: (k: string) => string | null },
  userPrompt?: string,
  workspaceRoot?: string
): Promise<string | null> {
  const allSkills = await getAllDiscoveredSkills(store, workspaceRoot)
  if (allSkills.length === 0) return null

  const parts: string[] = []
  let budget = 10000

  // Scoring function for relevance
  const promptLower = (userPrompt ?? '').toLowerCase()
  const promptWords = promptLower
    .split(/[^a-z0-9_-]+/)
    .filter((w) => w.length >= 3)

  const isUiRequest = /\b(react|tailwind|css|frontend|ui|ux|dashboard|timer|game|cyber|dark-mode|component|landing|web|widget|artifact|button|chart|visual)\b/i.test(promptLower)
  const isDiagramRequest = /\b(mermaid|flowchart|sequence|diagram|architecture|login|oauth|process|flow)\b/i.test(promptLower)

  const scoredSkills = allSkills.map((skill) => {
    let score = 0
    const nameLower = skill.name.toLowerCase()
    const descLower = (skill.description || '').toLowerCase()

    if (userPrompt && userPrompt.trim()) {
      // Direct prompt token matches
      for (const word of promptWords) {
        if (nameLower.includes(word)) score += 15
        if (descLower.includes(word)) score += 5
      }

      // Domain thematic boosts
      if (isUiRequest) {
        if (nameLower === 'frontend-design' || nameLower.includes('frontend-design')) score += 60
        if (nameLower === 'tailwind-patterns' || nameLower.includes('tailwind')) score += 55
        if (nameLower === 'generative_ui' || nameLower.includes('generative_ui')) score += 50
        if (nameLower === 'react-patterns' || nameLower.includes('react')) score += 45
        if (nameLower.includes('ui-ux') || nameLower.includes('ui-design') || nameLower.includes('minimalist-ui')) score += 40
        if (nameLower.includes('dashboard') && promptLower.includes('dashboard')) score += 40
      }

      if (isDiagramRequest) {
        if (nameLower.includes('mermaid') || nameLower.includes('diagram')) score += 60
        if (nameLower === 'generative_ui' || nameLower.includes('generative_ui')) score += 40
        if (nameLower.includes('architecture') || nameLower.includes('flowchart')) score += 35
      }
    }

    return { skill, score }
  })

  // Sort descending by score
  scoredSkills.sort((a, b) => b.score - a.score)

  // If we have relevant matches (score > 0), select top matching skills
  const topMatches = scoredSkills.filter((s) => s.score > 0)
  const selected: Array<BionicSkill & { source: string }> = []

  if (topMatches.length > 0) {
    for (const match of topMatches.slice(0, 5)) {
      selected.push(match.skill)
    }
  } else {
    // Fallback: take Bionic skills and a few general skills
    for (const s of allSkills.filter((x) => x.source === 'Bionic').slice(0, 3)) {
      selected.push(s)
    }
    for (const s of allSkills.filter((x) => x.source !== 'Bionic').slice(0, 3)) {
      if (!selected.some((sel) => sel.path === s.path)) {
        selected.push(s)
      }
    }
  }

  // Load content of selected skills within budget
  for (const skill of selected) {
    if (budget <= 0) break
    try {
      const text = await readFile(join(skill.path, 'SKILL.md'), 'utf8')
      const sliceSize = Math.min(3000, budget)
      const block = `## Skill: ${skill.name} (${skill.source})\n${text.slice(0, sliceSize)}`
      parts.push(block)
      budget -= block.length
    } catch {}
  }

  if (parts.length === 0) return null
  return `<skills_context>\nEnterprise Skills Available (Consult these instructions closely):\n\n${parts.join('\n\n---\n\n')}\n</skills_context>`
}
