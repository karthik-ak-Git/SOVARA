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
  const dir = getBionicDir()
  const out: BionicSkill[] = []
  try {
    await access(dir)
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(dir, entry.name, 'SKILL.md')
      try {
        await access(skillPath)
        const text = await readFile(skillPath, 'utf8')
        const meta = parseSkillMd(text)
        out.push({
          id: entry.name,
          name: meta.name || entry.name,
          description: meta.description || text.slice(0, 120).replace(/\n/g, ' ').trim(),
          path: join(dir, entry.name),
        })
      } catch {
        // skip
      }
    }
  } catch {
    // no bionic dir yet
  }
  return out
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

// Load enabled SKILL.md contents for AI injection — budget 6000 chars, max 8 skills
export async function loadEnabledSkillsContent(store?: { getAppSetting: (k: string) => string | null }): Promise<string | null> {
  const sources = await scanSkillsSources(store)
  const enabledNames = new Set(sources.filter((s) => s.enabled).map((s) => s.name))
  const parts: string[] = []
  let budget = 6000

  // Bionic first (always considered enabled unless explicitly disabled via map)
  if (isSourceEnabled('Bionic', store) !== false) {
    const bionic = await listBionicSkills()
    for (const skill of bionic.slice(0, 4)) {
      if (budget <= 0) break
      try {
        const text = await readFile(join(skill.path, 'SKILL.md'), 'utf8')
        const block = `## Skill: ${skill.name}\n${text.slice(0, 1500)}`
        parts.push(block.slice(0, budget))
        budget -= block.length
      } catch {}
    }
  }

  // Other app skills — sample 2 per source to avoid blowing context
  for (const src of sources) {
    if (!enabledNames.has(src.name)) continue
    if (budget <= 0) break
    try {
      const entries = await readdir(src.path, { withFileTypes: true })
      let sampled = 0
      for (const entry of entries) {
        if (sampled >= 2 || budget <= 0) break
        if (!entry.isDirectory()) continue
        try {
          const text = await readFile(join(src.path, entry.name, 'SKILL.md'), 'utf8')
          const block = `## Skill: ${entry.name} (${src.name})\n${text.slice(0, 1200)}`
          parts.push(block.slice(0, budget))
          budget -= block.length
          sampled++
        } catch {}
      }
    } catch {}
  }

  if (parts.length === 0) return null
  return `Skills available (follow their instructions when relevant):\n${parts.join('\n\n---\n\n')}`
}
