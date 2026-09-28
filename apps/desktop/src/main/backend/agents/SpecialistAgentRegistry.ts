/**
 * SpecialistAgentRegistry — SOVARA Imported Specialist Agent Registry.
 *
 * Reads specialist agent definitions from the imported `agency-agents` catalog,
 * normalizes them into SOVARA's internal representation, and exposes lookups
 * for AUTO routing and orchestrator role injection.
 *
 * Phase 2 & 3 implementation.
 */

import fs from 'node:fs'
import path from 'node:path'

export interface SpecialistAgentDefinition {
  /** Unique normalized ID (e.g. "engineering-frontend-developer") */
  id: string
  /** Display name from YAML frontmatter (e.g. "Frontend Developer") */
  name: string
  /** Top-level division category (e.g. "engineering", "testing", "specialized") */
  category: string
  /** Role description from frontmatter */
  description: string
  /** Full Markdown system prompt / instructions */
  instructions: string
  /** Logical capabilities (e.g. ["coding", "frontend", "ui", "web"]) */
  capabilities: string[]
  /** Supported/preferred input modalities */
  preferredModalities: Array<'text' | 'image' | 'code' | 'document'>
  /** Required SOVARA tools mapped from role needs */
  requiredTools: string[]
  /** Required SOVARA skills mapped from role needs */
  requiredSkills: string[]
  /** Task patterns / keywords for matching user requests */
  taskPatterns: string[]
  /** Model runtime requirements */
  modelRequirements: {
    minContextLength?: number
    requiresVision?: boolean
    requiresReasoning?: boolean
  }
  /** Source repository tag */
  source: string
  /** Relative file path within source repository */
  sourcePath: string
  /** License tag */
  license: string
  /** Attribution notice */
  attribution: string
  /** Presentation metadata */
  color?: string
  emoji?: string
  vibe?: string
}

export interface SpecialistMatchResult {
  specialist: SpecialistAgentDefinition
  score: number
  matchedReason: string
}

function parseYamlFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const trimmed = content.trim()
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: content }
  }

  const parts = content.split('---', 3)
  if (parts.length < 3) {
    return { frontmatter: {}, body: content }
  }

  const fmText = parts[1]
  const body = parts[2].trim()
  const frontmatter: Record<string, unknown> = {}

  for (const line of fmText.split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#')) continue
    const idx = l.indexOf(':')
    if (idx > 0) {
      const key = l.slice(0, idx).trim()
      let val: unknown = l.slice(idx + 1).trim()
      if (typeof val === 'string') {
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
      }
      frontmatter[key] = val
    }
  }

  return { frontmatter, body }
}

function deriveCapabilities(category: string, name: string, description: string, body: string): string[] {
  const caps = new Set<string>()
  const text = `${category} ${name} ${description} ${body}`.toLowerCase()

  caps.add(category.toLowerCase())

  if (/\b(code|coding|developer|engineer|script|refactor|bug|fix|build|typescript|python|javascript|react|vue|node)\b/i.test(text)) {
    caps.add('coding')
  }
  if (/\b(test|testing|qa|unit test|e2e|coverage|benchmark|audit)\b/i.test(text)) {
    caps.add('testing')
  }
  if (/\b(plan|architect|design|strategy|workflow|pm|roadmap|discovery)\b/i.test(text)) {
    caps.add('planning')
  }
  if (/\b(research|search|investigate|query|academic|study|literature|evidence)\b/i.test(text)) {
    caps.add('research')
  }
  if (/\b(vision|image|ocr|scan|photo|screenshot|graphic|ui|visual|spatial)\b/i.test(text)) {
    caps.add('vision')
  }
  if (/\b(security|vulnerability|audit|compliance|fedramp|threat|penetration)\b/i.test(text)) {
    caps.add('security')
  }
  if (/\b(review|diff|inspection|critique|evaluator)\b/i.test(text)) {
    caps.add('review')
  }
  if (/\b(document|pdf|docx|spreadsheet|excel|csv|extract)\b/i.test(text)) {
    caps.add('document-analysis')
  }

  return Array.from(caps)
}

function deriveRequiredTools(category: string, capabilities: string[]): string[] {
  const tools = new Set<string>(['fs_read', 'fs_list'])

  if (capabilities.includes('coding') || capabilities.includes('testing') || capabilities.includes('security')) {
    tools.add('fs_write')
    tools.add('fs_patch')
    tools.add('shell_exec')
    tools.add('run_code')
  }

  if (capabilities.includes('planning')) {
    tools.add('todo_write')
    tools.add('search_skills')
    tools.add('read_skill')
  }

  if (capabilities.includes('research')) {
    tools.add('web_search')
    tools.add('fs_search')
  }

  if (capabilities.includes('vision') || capabilities.includes('document-analysis')) {
    tools.add('fs_read')
    tools.add('read_skill')
  }

  return Array.from(tools)
}

function deriveRequiredSkills(capabilities: string[], text: string): string[] {
  const skills = new Set<string>()

  if (/\bpptx|presentation|slide\b/i.test(text)) skills.add('pptx')
  if (/\bdocx|word|document\b/i.test(text)) skills.add('docx')
  if (/\bxlsx|excel|spreadsheet\b/i.test(text)) skills.add('xlsx')
  if (/\bpdf\b/i.test(text)) skills.add('pdf')
  if (/\bocr|image text|scan\b/i.test(text)) skills.add('ocr')
  if (/\bdiagram|mermaid|flowchart\b/i.test(text)) skills.add('diagram')
  if (capabilities.includes('coding')) skills.add('code')

  return Array.from(skills)
}

function deriveTaskPatterns(name: string, description: string, category: string): string[] {
  const patterns: string[] = [name.toLowerCase(), category.toLowerCase()]
  const words = `${name} ${description}`.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []
  for (const w of words) {
    if (!['with', 'that', 'from', 'this', 'your', 'have', 'more', 'about', 'using', 'build', 'create'].includes(w)) {
      if (!patterns.includes(w)) patterns.push(w)
    }
  }
  return patterns.slice(0, 10)
}

export class SpecialistAgentRegistry {
  private readonly specialists = new Map<string, SpecialistAgentDefinition>()
  private loadedPath: string | null = null

  constructor(repoDir?: string) {
    if (repoDir) {
      this.loadFromDirectory(repoDir)
    }
  }

  public loadFromDirectory(repoDir: string): number {
    if (!fs.existsSync(repoDir)) {
      console.warn(`[SOVARA][REGISTRY] Directory does not exist: ${repoDir}`)
      return 0
    }

    this.specialists.clear()
    this.loadedPath = repoDir

    const scanDirectory = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!['.git', '.github', 'examples', 'scripts', 'integrations', 'strategy', 'node_modules'].includes(entry.name)) {
            scanDirectory(fullPath)
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          this.parseAndRegisterFile(fullPath, repoDir)
        }
      }
    }

    scanDirectory(repoDir)
    console.log(`[SOVARA][REGISTRY] Loaded ${this.specialists.size} imported specialist agents from ${repoDir}`)
    return this.specialists.size
  }

  private parseAndRegisterFile(filePath: string, repoDir: string): boolean {
    try {
      const relativePath = path.relative(repoDir, filePath).replace(/\\/g, '/')
      const pathParts = relativePath.split('/')
      if (pathParts.length < 2) return false

      const category = pathParts[0]
      const fileStem = path.basename(filePath, '.md')

      const content = fs.readFileSync(filePath, 'utf-8')
      const { frontmatter, body } = parseYamlFrontmatter(content)

      const name = typeof frontmatter['name'] === 'string' ? frontmatter['name'] : fileStem
      const description = typeof frontmatter['description'] === 'string' ? frontmatter['description'] : ''

      if (!frontmatter['name'] && !body.includes('# ')) {
        return false // Skip non-agent markdown files without name or title
      }

      const id = `${category}-${fileStem}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      const capabilities = deriveCapabilities(category, name, description, body)
      const requiredTools = deriveRequiredTools(category, capabilities)
      const requiredSkills = deriveRequiredSkills(capabilities, `${name} ${description} ${body}`)
      const taskPatterns = deriveTaskPatterns(name, description, category)

      const hasVision = capabilities.includes('vision') || /\b(image|vision|ocr|scan)\b/i.test(`${name} ${description}`)
      const hasReasoning = capabilities.includes('planning') || capabilities.includes('security') || capabilities.includes('review')

      const preferredModalities: Array<'text' | 'image' | 'code' | 'document'> = ['text']
      if (capabilities.includes('coding')) preferredModalities.push('code')
      if (hasVision) preferredModalities.push('image')
      if (capabilities.includes('document-analysis')) preferredModalities.push('document')

      const definition: SpecialistAgentDefinition = {
        id,
        name,
        category,
        description,
        instructions: body,
        capabilities,
        preferredModalities,
        requiredTools,
        requiredSkills,
        taskPatterns,
        modelRequirements: {
          minContextLength: body.length > 10000 ? 8192 : 4096,
          requiresVision: hasVision,
          requiresReasoning: hasReasoning,
        },
        source: 'msitarzewski/agency-agents',
        sourcePath: relativePath,
        license: 'MIT',
        attribution: 'Copyright (c) 2025 AgentLand Contributors',
        color: typeof frontmatter['color'] === 'string' ? frontmatter['color'] : undefined,
        emoji: typeof frontmatter['emoji'] === 'string' ? frontmatter['emoji'] : undefined,
        vibe: typeof frontmatter['vibe'] === 'string' ? frontmatter['vibe'] : undefined,
      }

      this.specialists.set(id, definition)
      return true
    } catch (e) {
      console.warn(`[SOVARA][REGISTRY] Failed to parse agent file ${filePath}:`, e)
      return false
    }
  }

  public getSpecialist(id: string): SpecialistAgentDefinition | undefined {
    return this.specialists.get(id.toLowerCase())
  }

  public getAllSpecialists(): SpecialistAgentDefinition[] {
    return Array.from(this.specialists.values())
  }

  public count(): number {
    return this.specialists.size
  }

  /**
   * Find matching specialist agent for a given task query.
   */
  public findBestMatch(
    query: string,
    opts?: { categoryHint?: string; requiresVision?: boolean }
  ): SpecialistMatchResult | null {
    if (this.specialists.size === 0) return null

    const text = query.toLowerCase()
    let bestMatch: SpecialistMatchResult | null = null

    for (const spec of this.specialists.values()) {
      let score = 0
      const matchedReasons: string[] = []

      // Category match
      if (opts?.categoryHint && spec.category.toLowerCase() === opts.categoryHint.toLowerCase()) {
        score += 30
        matchedReasons.push(`category:${spec.category}`)
      }

      // Vision requirement matching
      if (opts?.requiresVision) {
        if (spec.capabilities.includes('vision') || spec.modelRequirements.requiresVision) {
          score += 40
          matchedReasons.push('vision-capability')
        } else {
          score -= 20
        }
      }

      // Pattern keyword matching
      for (const pattern of spec.taskPatterns) {
        if (pattern.length > 2 && text.includes(pattern)) {
          score += 15
          matchedReasons.push(`keyword:${pattern}`)
        }
      }

      // Specific domain keywords
      if (/\b(python|code|function|class|bug|fix|refactor|script|program)\b/i.test(query) && spec.capabilities.includes('coding')) {
        score += 25
        matchedReasons.push('coding-domain')
      }
      if (/\b(test|unit test|jest|vitest|api test|automation)\b/i.test(query) && spec.capabilities.includes('testing')) {
        score += 25
        matchedReasons.push('testing-domain')
      }
      if (/\b(plan|steps|architecture|design|roadmap|structure)\b/i.test(query) && spec.capabilities.includes('planning')) {
        score += 25
        matchedReasons.push('planning-domain')
      }
      if (/\b(image|ocr|extract code from image|photo|scan|read image)\b/i.test(query) && spec.capabilities.includes('vision')) {
        score += 35
        matchedReasons.push('image-extraction-domain')
      }
      if (/\b(debug|diagnose|error|issue|stack trace|crash)\b/i.test(query) && (spec.id.includes('debug') || spec.capabilities.includes('review'))) {
        score += 25
        matchedReasons.push('debugging-domain')
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          specialist: spec,
          score,
          matchedReason: matchedReasons.join(', ') || 'default match',
        }
      }
    }

    return bestMatch && bestMatch.score > 0 ? bestMatch : null
  }
}

// Global default singleton registry instance
let globalRegistry: SpecialistAgentRegistry | null = null

export function getGlobalSpecialistRegistry(repoDir?: string): SpecialistAgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new SpecialistAgentRegistry()
    const candidates = [
      path.resolve(process.cwd(), 'test/agency-agents'),
      path.resolve(process.cwd(), '../../test/agency-agents'),
      'D:/SOVARA/test/agency-agents',
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        globalRegistry.loadFromDirectory(c)
        break
      }
    }
  }
  if (repoDir && globalRegistry.count() === 0) {
    globalRegistry.loadFromDirectory(repoDir)
  }
  return globalRegistry
}
