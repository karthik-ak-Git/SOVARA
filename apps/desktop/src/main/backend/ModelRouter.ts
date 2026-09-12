/**
 * ModelRouter — smart selection layer between task classification and ModelRuntimePort.
 * Consumes only port abstractions + the capability registry. Never invents capabilities.
 * Decision factors (where data is available): task type, required capability,
 * model capability, context length, current model state, VRAM/RAM, running instances,
 * limits, runtime availability.
 */

import type { DiscoveredModel } from '@shared/types/models'
import type { SystemResources } from '@shared/types/ports'
import type { TaskClassification, ModelRoutingDecision } from '@shared/types/task'
import { resolveCapabilities, capabilitiesForTask } from '@shared/types/modelCapabilities'

export interface RouterContext {
  task: TaskClassification
  models: DiscoveredModel[]
  /** Current active selection (if any) */
  active?: { runtimeId: string; modelId: string } | null
  /** System snapshot from SystemResourceManagerPort */
  resources: SystemResources
  /** Pressure for a hypothetical load (caller's checkBeforeLoad for top candidate) */
  checkBeforeLoad?: (modelId: string) => Promise<{ level: 'ok' | 'warn' | 'critical'; blocking?: boolean; reason?: string }>
  /** Preference for reasoning flag etc. (future) */
  preferReasoning?: boolean
}

export interface ScoredModel {
  model: DiscoveredModel
  score: number
  reason: string
  capabilities: string[]
  contextLength: number
}

function scoreModel(
  m: DiscoveredModel,
  task: TaskClassification,
  resources: SystemResources
): ScoredModel {
  const { capabilities, profile, contextLength } = resolveCapabilities(m.modelId, m.capabilities, m.contextLength)
  let score = 0
  const reasons: string[] = []

  // Capability match (strongest signal)
  const need = capabilitiesForTask(task.kind)
  const hasNeed = need.every((c) => capabilities.includes(c as never))
  const hasAny = need.some((c) => capabilities.includes(c as never))
  if (hasNeed) { score += 40; reasons.push('capability exact') }
  else if (hasAny) { score += 20; reasons.push('capability partial') }
  else if (task.kind === 'chat') { score += 10; reasons.push('chat fallback') }
  else { score -= 10; reasons.push('capability miss') }

  // Vision requirement (image attached): vision-capable models win by a wide
  // margin; text-only models are still eligible as a graceful fallback.
  if (task.requiresVision) {
    if (capabilities.includes('vision')) { score += 30; reasons.push('vision match') }
    else { score -= 25; reasons.push('no vision support') }
  }

  // Context length must satisfy need
  if (contextLength >= task.contextLengthNeeded) { score += 15; reasons.push('ctx fits') }
  else { score -= 20; reasons.push(`ctx short ${contextLength}<${task.contextLengthNeeded}`) }

  // Size heuristic: small/fast for chat, stronger for reasoning/coding/analysis
  if (profile) {
    if (task.kind === 'chat' && profile.paramsBucket === 'small') { score += 8; reasons.push('small for chat') }
    if ((task.kind === 'reasoning' || task.kind === 'analysis' || task.kind === 'agent') && profile.strength >= 3) { score += 10; reasons.push('strong for reasoning') }
    if (task.kind === 'coding' && capabilities.includes('coding')) { score += 10; reasons.push('code capable') }
    if (task.kind === 'summarization' && capabilities.includes('summarization')) { score += 8; reasons.push('summarizer') }
  } else {
    // No profile → neutral, don't punish unknown heavily
    score += 2
  }

  // Long-context bonus when needed
  if (task.contextLengthNeeded > 8192 && capabilities.includes('long-context')) { score += 8; reasons.push('long-context') }

  // Prefer available models (should be filtered already)
  if (m.available) score += 5

  // VRAM signal: if resource snapshot says we have pressure, penalize large models
  const vramFree = resources.vram.freeMB
  if (vramFree !== undefined && profile?.paramsBucket === 'xlarge' && vramFree < 4000) { score -= 12; reasons.push('vram pressure vs xlarge') }

  return { model: m, score, reason: reasons.join(', '), capabilities: capabilities as string[], contextLength }
}

export async function routeModel(ctx: RouterContext): Promise<ModelRoutingDecision> {
  const { task, models, active } = ctx

  // Only consider available models
  const available = models.filter((m) => m.available)
  if (available.length === 0) {
    return {
      modelId: null,
      runtimeId: null,
      reason: 'no available models discovered — add a runtime or download a model',
      task,
      candidatesConsidered: 0,
      switched: false,
    }
  }

  const scored = available.map((m) => scoreModel(m, task, ctx.resources))
  // Sort by score desc, then context length desc, then displayName for stability
  scored.sort((a, b) => b.score - a.score || b.contextLength - a.contextLength || a.model.displayName.localeCompare(b.model.displayName))

  // Resource-aware filtering: walk in score order, check blocking pressure
  for (const s of scored) {
    if (ctx.checkBeforeLoad) {
      try {
        const pressure = await ctx.checkBeforeLoad(s.model.modelId)
        if (pressure.blocking) {
          // Skip this candidate, try next
          s.score -= 100
          s.reason += ` | blocked: ${pressure.reason ?? 'resource'}`
          continue
        }
      } catch {
        // Check failed → treat as non-blocking, continue
      }
    }
    const switched = !active || active.modelId !== s.model.modelId || active.runtimeId !== s.model.runtimeId
    return {
      modelId: s.model.modelId,
      runtimeId: s.model.runtimeId,
      reason: `${s.reason} | ${task.reason}`,
      task,
      candidatesConsidered: scored.length,
      switched,
    }
  }

  // All candidates blocked
  const top = scored[0]
  return {
    modelId: top ? top.model.modelId : null,
    runtimeId: top ? top.model.runtimeId : null,
    reason: `all candidates blocked by resources — top: ${top?.reason ?? 'none'}`,
    task,
    candidatesConsidered: scored.length,
    switched: false,
  }
}
