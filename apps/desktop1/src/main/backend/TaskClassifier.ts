/**
 * TaskClassifier — deterministic, replaceable heuristic for task kind.
 * No LLM call. Input is the raw user prompt + explicit toggles.
 * Mirrors spec §7: every request enters task classification before routing.
 */

import type { TaskClassification, TaskKind } from '@shared/types/task'

const CODING_PATTERNS = [
  /```/, /function\s+\w+\s*\(/, /class\s+\w+/, /import\s+.*from/, /const\s+\w+\s*=/, /def\s+\w+\s*\(/, /SELECT\s+.*FROM/i, /\b(bug|refactor|implement|code|typescript|python|rust|function|API)\b/i
]
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
const REASONING_PATTERNS = [
  /\b(think|reason|step by step|chain of thought|solve|puzzle|math|prove|derive)\b/i,
]

function needsReasoning(text: string, explicit?: boolean): boolean {
  if (explicit) return true
  if (REASONING_PATTERNS.some((re) => re.test(text))) return true
  if (text.length > 800) return true // long prompts benefit from reasoning
  return false
}

function estimateContextNeeded(text: string): number {
  // chars → tokens ~4 chars/token, plus history budget
  const tokens = Math.ceil(text.length / 4) + 2048 // history + system
  return Math.max(2048, Math.min(131072, tokens))
}

export function classifyTask(content: string, hints?: { reasoning?: boolean; webSearch?: boolean }): TaskClassification {
  const text = (content ?? '').trim()
  const len = text.length

  if (len === 0) {
    return { kind: 'chat', confidence: 1, requiredCapabilities: ['chat'], contextLengthNeeded: 2048, reasoningRequired: false, reason: 'empty→chat fallback' }
  }

  // Explicit toggles dominate
  if (hints?.reasoning) {
    const kind: TaskKind = CODING_PATTERNS.some((re) => re.test(text)) ? 'coding' : 'reasoning'
    return {
      kind,
      confidence: 0.85,
      requiredCapabilities: kind === 'coding' ? ['coding', 'reasoning'] : ['reasoning'],
      contextLengthNeeded: estimateContextNeeded(text),
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
      contextLengthNeeded: estimateContextNeeded(text),
      reasoningRequired: needsReasoning(text, hints?.reasoning),
      reason: 'webSearch hint / tool pattern',
    }
  }

  if (SUMMARIZATION_PATTERNS.some((re) => re.test(text)) && len < 4000) {
    return {
      kind: 'summarization',
      confidence: 0.75,
      requiredCapabilities: ['summarization'],
      contextLengthNeeded: estimateContextNeeded(text),
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
      contextLengthNeeded: estimateContextNeeded(text),
      reasoningRequired: true,
      reason: 'analysis keywords',
    }
  }

  // Coding
  if (CODING_PATTERNS.some((re) => re.test(text)) && (text.includes('```') || len > 100)) {
    // Single large code block → coding
    const confidence = text.includes('```') ? 0.82 : 0.65
    return {
      kind: 'coding',
      confidence,
      requiredCapabilities: ['coding'],
      contextLengthNeeded: estimateContextNeeded(text),
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
      contextLengthNeeded: estimateContextNeeded(text),
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
      contextLengthNeeded: estimateContextNeeded(text),
      reasoningRequired: true,
      reason: 'reasoning keywords',
    }
  }

  // Default chat
  return {
    kind: 'chat',
    confidence: 0.9,
    requiredCapabilities: ['chat'],
    contextLengthNeeded: estimateContextNeeded(text),
    reasoningRequired: needsReasoning(text),
    reason: 'default chat',
  }
}
