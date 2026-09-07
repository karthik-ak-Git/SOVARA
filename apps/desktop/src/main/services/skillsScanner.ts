import { readdir, stat, access } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface SkillsSource {
  name: string
  path: string
  skillCount: number
  enabled: boolean
}

const SKILL_SOURCES: Array<{ name: string; relPath: string }> = [
  { name: 'Claude Code', relPath: '.claude/skills' },
  { name: 'Other Agents', relPath: '.agents/skills' },
]

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

export async function scanSkillsSources(): Promise<SkillsSource[]> {
  const home = homedir()
  const results: SkillsSource[] = []
  for (const src of SKILL_SOURCES) {
    const fullPath = join(home, src.relPath)
    const skillCount = await countSkills(fullPath)
    results.push({
      name: src.name,
      path: fullPath,
      skillCount,
      enabled: true,
    })
  }
  return results
}
