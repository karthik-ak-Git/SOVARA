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

  // Size heuristic: small/fast for chat, stronger for reasoning/coding/analysis — but not at 7/32 hallucinate cost
  if (profile) {
    if (task.kind === 'chat' && profile.paramsBucket === 'small') { score += 12; reasons.push('small for chat') }
    if ((task.kind === 'reasoning' || task.kind === 'analysis' || task.kind === 'agent') && profile.strength >= 3) {
      // Strong bonus reduced when 8192 forces 7/32 partial — small 999/999 is clearer than xlarge 7/32
      const is8192Partial = profile.paramsBucket === 'xlarge' && task.contextLengthNeeded >= 8192
      score += is8192Partial ? 2 : 10; reasons.push(is8192Partial ? 'strong but 7/32 at 8192' : 'strong for reasoning')
    }
    if (task.kind === 'coding' && capabilities.includes('coding')) {
      const isCodSmall = (profile.paramsBucket === 'small' || profile.paramsBucket === 'medium') && capabilities.includes('coding')
      score += isCodSmall ? 14 : 10; reasons.push(isCodSmall ? 'code capable small → fast' : 'code capable')
    }
    if (task.kind === 'summarization' && capabilities.includes('summarization')) { score += 8; reasons.push('summarizer') }
  } else {
    // No profile → neutral, don't punish unknown heavily
    score += 2
  }

  // Long-context bonus when needed
  if (task.contextLengthNeeded > 8192 && capabilities.includes('long-context')) { score += 8; reasons.push('long-context') }

  // Prefer available models (should be filtered already)
  if (m.available) score += 5
  // Diversity: true-small that also handles the task gets edge at 8192 — prevents Qwen-9B always winning
  if (profile?.paramsBucket === 'small' && hasNeed) { score += 8; reasons.push('small+capable for 8192') }

  // Honor explicit user selection — strong bias if active matches (user picked in UI)
  // This prevents auto-switching away from Unlimited-OCR when user explicitly chose it
  // Will still be overruled only if resource-blocked in routeModel loop
  // (applied in routeModel via active param; score bump here if needed)
  // handled in routeModel scoring below

  // 3-5x speed + all-layers: prefer small/fast that fits fully at 8192 over xlarge partial 7/32 (hallucinates)
  // Harness-style: small models (needle3, 0.5B-4B) fit 999 layers at 8192 with 655MB, Qwen 9B needs 7/32 at 8192 → 6.5 t/s vs 30 t/s
  const vramFree = resources.vram.freeMB
  const vramTotal = resources.vram.totalMB
  // Only true-small (needle/phi/gemma ≤4B) fits 8192 fully 999/999. Qwen-9B is 'medium' but 5.3GB file → 7/32 partial at 8192.
  // Detect heavy medium by modelId (9B/12B/14B in name) and penalize instead of bonus.
  const heavyMedium = profile?.paramsBucket === 'medium' && /9b|12b|14b|32b|70b/i.test(m.modelId)
  const isSmallFast = profile?.paramsBucket === 'small' && !heavyMedium
  const isMediumFast = profile?.paramsBucket === 'medium' && !heavyMedium
  const isXlargePartial = profile?.paramsBucket === 'xlarge' && task.contextLengthNeeded >= 8192
  if (isSmallFast && task.contextLengthNeeded >= 8192) { score += 22; reasons.push('small fits 8192 fully 999/999 → 3-5x') }
  else if (isMediumFast && task.contextLengthNeeded >= 8192) { score += 10; reasons.push('medium fits 8192 mostly → fast') }
  if (heavyMedium && task.contextLengthNeeded >= 8192) { score -= 40; reasons.push('9B+ medium partial 7/32 at 8192 → slow/hallucinate, prefer small 999 — consumer 6GB no s') }
  if (isXlargePartial) { score -= 30; reasons.push('xlarge partial 7/32 at 8192 → slow/hallucinate') }
  // VRAM signal: penalize xlarge on low VRAM, and penalize CPU fallback (large RAM models) — prevents 9B CPU timeout invalid-response
  if (vramFree !== undefined && profile?.paramsBucket === 'xlarge' && vramFree < 4000) { score -= 30; reasons.push('vram pressure vs xlarge') }
  if (vramTotal !== undefined && vramTotal < 7000 && profile?.paramsBucket === 'xlarge') { score -= 30; reasons.push('needs large VRAM') }
  if (vramTotal !== undefined && vramTotal < 7000 && heavyMedium) { score -= 40; reasons.push('consumer 6GB heavyMedium blocked') }
  // If task is simple chat/tool pdf, prefer small/medium resident model over xlarge CPU
  if (profile?.paramsBucket === 'xlarge' && (task.kind === 'chat' || task.kind === 'tool-use')) { score -= 8; reasons.push('xlarge overkill') }

  return { model: m, score, reason: reasons.join(', '), capabilities: capabilities as string[], contextLength }
}

export async function routeModel(ctx: RouterContext): Promise<ModelRoutingDecision> {
  const { task, models, active } = ctx

  // SOVEREIGN: only the owned sidecar (runtimeId=local) may run inference.
  // LM Studio / Ollama entries are detect-only (see ModelWorkbench.ensureExternalRuntimes).
  // We keep their files for Library listing, but we NEVER route a prompt to :1234 / :11434.
  const sovereign = models.filter((m) => m.runtimeId === 'local')
  const available = sovereign.filter((m) => m.available)
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

  let scored = available.map((m) => scoreModel(m, task, ctx.resources))
  // Honor explicit selection, but task-aware: if the task needs tool-use/coding/vision
  // and the pinned model lacks it, don't force it — let a capable model win.
  // This fixes "for every task it picking the same model (spark)".
  if (active) {
    const need = capabilitiesForTask(task.kind)
    for (const s of scored) {
      if (s.model.modelId === active.modelId && s.model.runtimeId === active.runtimeId) {
        const caps = s.capabilities
        const hasNeed = need.every((c) => (caps as string[]).includes(c))
        const hasAny = need.some((c) => (caps as string[]).includes(c))
        if (hasNeed) { s.score += 100; s.reason += ', user selected + capability exact' }
        else if (hasAny) { s.score += 40; s.reason += ', user selected + capability partial' }
        else if (task.kind === 'chat') { s.score += 60; s.reason += ', user selected (chat)' }
        else { s.score += 10; s.reason += ', user selected but capability miss — task may reroute' }
      }
    }
  }
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
  // Even in blocked case, never fall back to an external runner — surface the sovereign reason.
  if (top && top.model.runtimeId !== 'local') {
    return {
      modelId: null,
      runtimeId: null,
      reason: `sovereign: no local model fits and external runners are disabled — free VRAM or download a smaller GGUF into the Sovara library | top external was ${top.model.modelId}`,
      task,
      candidatesConsidered: scored.length,
      switched: false,
    }
  }
  return {
    modelId: top ? top.model.modelId : null,
    runtimeId: top ? top.model.runtimeId : null,
    reason: `all candidates blocked by resources — top: ${top?.reason ?? 'none'}`,
    task,
    candidatesConsidered: scored.length,
    switched: false,
  }
}
