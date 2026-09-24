/**
 * TaskClassifier — deterministic, replaceable heuristic for task kind.
 * No LLM call. Input is the raw user prompt + explicit toggles.
 * Mirrors spec §7: every request enters task classification before routing.
 */

import type { TaskClassification, TaskKind } from '@shared/types/task'

const CODING_PATTERNS = [
  /```/, /function\s+\w+\s*\(/, /class\s+\w+/, /import\s+.*from/, /const\s+\w+\s*=/, /def\s+\w+\s*\(/, /SELECT\s+.*FROM/i, /\b(bug|refactor|implement|code|typescript|python|rust|function|API)\b/i,
]
// Global intent: any workspace artifact creation — not hard-coded per page name
const BUILD_INTENT_RE = /\b(build|create|make|generate|scaffold|write)\b/i
const ANALYSIS_PATTERNS = [
  /\b(analyze|review|audit|explain.*architecture|what.*wrong|problems|issues|diagnos)\b/i,
  /\b(architecture|design|performance|security|refactor)\b.*\b(why|how|what)\b/i,
]
const SUMMARIZATION_PATTERNS = [
  /\b(summarize|summarise|tldr|summary|condense|brief)\b/i,
]
const TOOL_PATTERNS = [
  /\b(search|fetch|browse|download|file|filesystem|read|write|execute|run|tool)\b/i,
]
const PATH_PATTERNS = [
  /^[a-z]:[\\/]/i,
  /^["'][a-z]:[\\/]/i,
  /^\/[a-zA-Z0-9_.-]+/,
  /\b[a-z]:\\[^"'\n\s]+/i,
  /\b[a-z]:\/[^"'\n\s]+/i,
  /\b\w+\.(md|txt|json|ts|tsx|js|jsx|py|java|c|cpp|rs|go|html|css|yaml|yml|toml|xml|csv|log)\b/i,
]
const REASONING_PATTERNS = [
  /\b(think|reason|step by step|chain of thought|solve|puzzle|math|prove|derive)\b/i,
]

const ARTIFACT_BUILD_RE = /\b(ppt|pptx|presentation|pdf|docx|xlsx|slide|slides|report|dashboard|game|canvas|diagram)\b/i

// Enhanced: skill detection per audit
export function detectSkillNeeds(content: string, attachments?: Array<{ mimeType: string }>): string[] {
  const needs = new Set<string>()
  const patterns: Record<string, RegExp> = {
    pptx: /\b(pptx|powerpoint|presentation|slide|deck)\b/gi,
    docx: /\b(docx|word|document|approval.*note|memo|letter)\b/gi,
    xlsx: /\b(xlsx|excel|spreadsheet|calculation|financial|budget)\b/gi,
    pdf: /\b(pdf|convert.*pdf|export.*pdf)\b/gi,
    ocr: /\b(scan|ocr|handwritten|extract.*text|read.*image)\b/gi,
    diagram: /\b(mermaid|flowchart|diagram|architecture|uml)\b/gi,
    code: /\b(function|class|algorithm|script|execute|run.*code)\b/gi,
    rag: /\b(search|knowledge.*base|sop|manual|reference|document.*search)\b/gi,
  }
  for (const [skill, re] of Object.entries(patterns)) {
    re.lastIndex = 0
    if (re.test(content)) needs.add(skill)
  }
  if (attachments) {
    const hasVision = attachments.some((a) => a.mimeType.startsWith('image/') || a.mimeType === 'application/pdf')
    if (hasVision) { needs.add('vision'); needs.add('ocr') }
  }
  return Array.from(needs)
}

export function detectMultimodal(attachments: Array<{ mimeType: string; size?: number; name?: string }>): { needsVision: boolean; types: string[] } {
  const types = new Set<string>()
  let needsVision = false
  for (const att of attachments) {
    if (att.mimeType.startsWith('image/')) { types.add('image'); needsVision = true }
    if (att.mimeType === 'application/pdf') { types.add('pdf'); needsVision = true }
    if (att.mimeType.startsWith('application/vnd.openxmlformats-officedocument')) types.add('document')
  }
  return { needsVision, types: Array.from(types) }
}

function needsReasoning(text: string, explicit?: boolean): boolean {
  if (explicit) return true
  if (REASONING_PATTERNS.some((re) => re.test(text))) return true
  if (ARTIFACT_BUILD_RE.test(text)) return true // document/artifact generation requires deep thinking
  if (text.length > 800) return true // long prompts benefit from reasoning
  return false
}

function estimateContextNeeded(text: string, extraChars = 0): number {
  const contentTokens = Math.ceil((text.length + extraChars) / 4)
  const historyTokens = extraChars > 500 ? Math.ceil(extraChars / 4) : 0
  const needed = contentTokens + historyTokens + 512
  const tiers = [512, 1024, 2048, 4096, 8192, 16384, 32768] as const
  let tier = tiers.find((t) => t >= Math.max(512, needed)) || 32768
  // Artifact builds inject ~6k chars of skill context — ensure at least 8192 so 3307 token prompt doesn't exceed 2048
  if (ARTIFACT_BUILD_RE.test(text) && tier < 8192) tier = 8192
  return tier
}

export function classifyTaskEnhanced(
  content: string,
  attachments?: Array<{ mimeType: string; size: number; name: string }>,
  hints?: { reasoning?: boolean; webSearch?: boolean; hasImage?: boolean; attachmentChars?: number }
): TaskClassification & { skillsNeeded: string[]; needsMultimodal: boolean; requiresArtifact: boolean; artifactType?: TaskClassification['artifactType'] } {
  const base = classifyTask(content, hints)
  const skillsNeeded = detectSkillNeeds(content, attachments)
  const { needsVision, types } = attachments ? detectMultimodal(attachments) : { needsVision: false, types: [] as string[] }
  const requiresArtifact = skillsNeeded.some((s) => ['pptx','docx','xlsx','pdf','code','html'].includes(s))
  let artifactType: TaskClassification['artifactType']
  if (skillsNeeded.includes('pptx')) artifactType='pptx'
  else if (skillsNeeded.includes('docx')) artifactType='docx'
  else if (skillsNeeded.includes('xlsx')) artifactType='xlsx'
  else if (skillsNeeded.includes('pdf')) artifactType='pdf'
  else if (skillsNeeded.includes('code')) artifactType='code'
  return { ...base, skillsNeeded, needsMultimodal: types.length>0, requiresArtifact, artifactType, requiresVision: base.requiresVision || needsVision }
}

function classifyTaskBase(
  content: string,
  hints?: { reasoning?: boolean; webSearch?: boolean; hasImage?: boolean; attachmentChars?: number }
): TaskClassification {
  const text = (content ?? '').trim()
  const len = text.length
  const attachmentChars = Math.max(0, Math.floor(hints?.attachmentChars ?? 0))
  const needsVision = hints?.hasImage === true

  if (len === 0 && !needsVision) {
    return { kind: 'chat', confidence: 1, requiredCapabilities: ['chat'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'empty→chat fallback' }
  }

  // Image attached → vision-capable model required; kind follows the question.
  if (needsVision) {
    const base = classifyTask(text, { reasoning: hints?.reasoning, webSearch: hints?.webSearch })
    const requiredCapabilities = Array.from(new Set([...base.requiredCapabilities, 'vision']))
    return {
      ...base,
      requiredCapabilities,
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      requiresVision: true,
      confidence: Math.min(0.9, base.confidence + 0.05),
      reason: `${base.reason} + image attachment→vision`,
    }
  }

  // Explicit toggles dominate
  if (hints?.reasoning) {
    const kind: TaskKind = CODING_PATTERNS.some((re) => re.test(text)) ? 'coding' : 'reasoning'
    return {
      kind,
      confidence: 0.85,
      requiredCapabilities: kind === 'coding' ? ['coding', 'reasoning'] : ['reasoning'],
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      reasoningRequired: true,
      reason: 'explicit reasoning toggle',
    }
  }

  if (hints?.webSearch || TOOL_PATTERNS.some((re) => re.test(text) && /\b(web|search|fetch)\b/i.test(text))) {
    // webSearch counts as tool-use
    return {
      kind: 'tool-use',
      confidence: 0.8,
      requiredCapabilities: ['tool-use'],
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      reasoningRequired: needsReasoning(text, hints?.reasoning),
      reason: 'webSearch hint / tool pattern',
    }
  }

  // File or directory path in prompt -> tool-use (needs fs_read, fs_list, etc.)
  if (PATH_PATTERNS.some((re) => re.test(text))) {
    return {
      kind: 'tool-use',
      confidence: 0.88,
      requiredCapabilities: ['tool-use'],
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      reasoningRequired: false,
      reason: 'file / path detected in prompt',
    }
  }

  if (SUMMARIZATION_PATTERNS.some((re) => re.test(text)) && len < 4000) {
    return {
      kind: 'summarization',
      confidence: 0.75,
      requiredCapabilities: ['summarization'],
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      reasoningRequired: false,
      reason: 'summarization keywords',
    }
  }

  // Analysis: "Analyze this project...", "Review repository..."
  if (ANALYSIS_PATTERNS.some((re) => re.test(text)) || (len > 200 && /\b(analysis|review)\b/i.test(text))) {
    return {
      kind: 'analysis',
      confidence: 0.78,
      requiredCapabilities: ['analysis'],
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      reasoningRequired: true,
      reason: 'analysis keywords',
    }
  }

  // Coding — global build intent without per-artifact hardcode: "build me X" -> needs workspace tools
  if ((CODING_PATTERNS.some((re) => re.test(text)) && (text.includes('```') || len > 20)) || (BUILD_INTENT_RE.test(text) && len > 8)) {
    // Single large code block → coding
    const confidence = text.includes('```') ? 0.82 : 0.65
    return {
      kind: 'coding',
      confidence,
      requiredCapabilities: ['coding'],
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      reasoningRequired: needsReasoning(text),
      reason: 'code patterns / fences',
    }
  }

  // Multi-step agent signal: "do X, then Y, then ..."
  if (/\b(then|after that|next|steps|plan|workflow)\b/i.test(text) && len > 150) {
    return {
      kind: 'agent',
      confidence: 0.7,
      requiredCapabilities: ['tool-use', 'reasoning'],
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      reasoningRequired: true,
      reason: 'multi-step agent signal',
    }
  }

  // Reasoning
  if (REASONING_PATTERNS.some((re) => re.test(text))) {
    return {
      kind: 'reasoning',
      confidence: 0.68,
      requiredCapabilities: ['reasoning'],
      contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
      reasoningRequired: true,
      reason: 'reasoning keywords',
    }
  }

  // Default chat
  return {
    kind: 'chat',
    confidence: 0.9,
    requiredCapabilities: ['chat'],
    contextLengthNeeded: estimateContextNeeded(text, attachmentChars),
    reasoningRequired: needsReasoning(text),
    reason: 'default chat',
  }
}

export function classifyTask(
  content: string,
  hints?: { reasoning?: boolean; webSearch?: boolean; hasImage?: boolean; attachmentChars?: number }
): TaskClassification {
  const base = classifyTaskBase(content, hints)
  const skillsNeeded = detectSkillNeeds(content, hints?.hasImage ? [{ mimeType: 'image/png' }] : undefined)
  const requiresArtifact = skillsNeeded.some((s) => ['pptx','docx','xlsx','pdf','code','html','diagram'].includes(s))
  let artifactType: TaskClassification['artifactType']
  if (skillsNeeded.includes('pptx')) artifactType='pptx'
  else if (skillsNeeded.includes('docx')) artifactType='docx'
  else if (skillsNeeded.includes('xlsx')) artifactType='xlsx'
  else if (skillsNeeded.includes('pdf')) artifactType='pdf'
  else if (skillsNeeded.includes('diagram')) artifactType='pdf'
  else if (skillsNeeded.includes('code')) artifactType='code'
  return { ...base, skillsNeeded, requiresArtifact, artifactType, needsMultimodal: !!hints?.hasImage }
}
