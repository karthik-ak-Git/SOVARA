/**
 * Model capability registry — the ONLY source of model capabilities.
 * Never infer capabilities from modelId strings. Every capability must be
 * declared here or come from persisted adapter metadata (contextLength,
 * explicit capabilities array). This file is the canonical registry.
 *
 * Each entry maps a canonical family token → capabilities + defaults.
 * Adapter-discovered capabilities (from `capabilities` array) are merged,
 * never invented.
 */

export type ModelCapability =
  | 'chat'
  | 'reasoning'
  | 'coding'
  | 'analysis'
  | 'summarization'
  | 'tool-use'
  | 'vision'
  | 'long-context'

export interface CapabilityProfile {
  family: string
  capabilities: ModelCapability[]
  /** Preferred ctx len when not reported by runtime */
  defaultContextLength: number
  /** Relative strength (higher = more capable, slower) */
  strength: number
  /** Approx params bucket (for size-based routing) */
  paramsBucket: 'small' | 'medium' | 'large' | 'xlarge'
}

export const MODEL_CAPABILITY_REGISTRY: CapabilityProfile[] = [
  { family: 'phi', capabilities: ['chat', 'reasoning', 'coding'], defaultContextLength: 4096, strength: 2, paramsBucket: 'small' },
  { family: 'gemma', capabilities: ['chat', 'reasoning'], defaultContextLength: 8192, strength: 2, paramsBucket: 'small' },
  { family: 'qwen', capabilities: ['chat', 'coding', 'reasoning', 'tool-use', 'analysis'], defaultContextLength: 8192, strength: 3, paramsBucket: 'medium' },
  { family: 'mistral', capabilities: ['chat', 'coding', 'analysis'], defaultContextLength: 8192, strength: 3, paramsBucket: 'medium' },
  { family: 'llama', capabilities: ['chat', 'reasoning', 'analysis', 'summarization'], defaultContextLength: 8192, strength: 3, paramsBucket: 'large' },
  { family: 'deepseek', capabilities: ['reasoning', 'coding', 'analysis'], defaultContextLength: 16384, strength: 4, paramsBucket: 'large' },
  { family: 'codellama', capabilities: ['coding'], defaultContextLength: 4096, strength: 3, paramsBucket: 'medium' },
  { family: 'starcoder', capabilities: ['coding'], defaultContextLength: 8192, strength: 3, paramsBucket: 'medium' },
  { family: 'yi', capabilities: ['chat', 'analysis'], defaultContextLength: 4096, strength: 2, paramsBucket: 'medium' },
  { family: 'mixtral', capabilities: ['chat', 'coding', 'analysis', 'tool-use'], defaultContextLength: 32768, strength: 4, paramsBucket: 'xlarge' },
]

/**
 * Resolve capabilities for a modelId using ONLY the registry or explicit
 * adapter-provided capabilities. Never fallback to string heuristics beyond
 * the registry families. If unknown, return minimal chat-only.
 */
export function resolveCapabilities(
  modelId: string,
  explicitCapabilities?: string[],
  contextLength?: number
): { capabilities: ModelCapability[]; profile: CapabilityProfile | null; contextLength: number } {
  if (explicitCapabilities && explicitCapabilities.length > 0) {
    const caps = explicitCapabilities.filter((c): c is ModelCapability =>
      ['chat', 'reasoning', 'coding', 'analysis', 'summarization', 'tool-use', 'vision', 'long-context'].includes(c)
    )
    if (caps.length > 0) {
      return { capabilities: caps, profile: null, contextLength: contextLength ?? 4096 }
    }
  }
  const lower = modelId.toLowerCase()
  for (const p of MODEL_CAPABILITY_REGISTRY) {
    if (lower.includes(p.family)) {
      const caps = [...p.capabilities] as ModelCapability[]
      if ((contextLength ?? p.defaultContextLength) >= 16384 && !caps.includes('long-context')) caps.push('long-context')
      return { capabilities: caps, profile: p, contextLength: contextLength ?? p.defaultContextLength }
    }
  }
  // Unknown family → minimal, honest
  return { capabilities: ['chat'], profile: null, contextLength: contextLength ?? 4096 }
}

export function capabilitiesForTask(kind: import('./task').TaskKind): ModelCapability[] {
  switch (kind) {
    case 'coding': return ['coding']
    case 'reasoning': return ['reasoning']
    case 'analysis': return ['analysis']
    case 'summarization': return ['summarization']
    case 'tool-use': return ['tool-use']
    case 'agent': return ['tool-use', 'reasoning']
    case 'chat':
    default: return ['chat']
  }
}
