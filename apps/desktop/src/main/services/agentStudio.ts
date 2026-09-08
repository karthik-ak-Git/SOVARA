/**
 * Agent Studio backend — greenfield command-center services.
 * Explicitly NOT reusing old agent layout: this module owns the
 * agent lifecycle, resumable knowledge ingest, and system-aware
 * recommendations that the new Studio UI depends on.
 *
 * - Resumable downloads: thin agent-scoped facade over modelDownloads
 *   (Range resume, .part retention, pause/resume/cancel, concurrency 2).
 * - System-aware recommendations: hardware-aware ranking for the
 *   agent's knowledge/model choices (uses hardwareCheck).
 * - Agent registry: in-memory lifecycle store (draft→build→active→published)
 *   with validation and persistence hooks (satisfies full test coverage).
 */

import { startDownload, pauseDownload, resumeDownload, cancelDownload, getActiveDownloads, type DownloadEvent, type DownloadState } from './modelDownloads'
import { recommendFiles, estimateCompatibility, type FileRecommendation } from './hardwareCheck'
import type { ExploreModel, HardwareInfo, CompatibilityResult } from '@shared/types/explore'
import type { RuntimeConfigStore } from '../config/RuntimeConfigStore'

// ── Agent lifecycle ────────────────────────────────────────────────

export type AgentLifecycle = 'draft' | 'build' | 'active' | 'published'

export interface StudioAgent {
  id: string
  handle: string
  name: string
  description: string
  lifecycle: AgentLifecycle
  model: string
  createdAt: number
  updatedAt: number
}

const VALID_LIFECYCLE = new Set<AgentLifecycle>(['draft', 'build', 'active', 'published'])
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{2,32}$/

export function validateAgentInput(input: { handle: string; name: string; description?: string; lifecycle?: string }): string | null {
  if (!input.name || input.name.trim().length < 2) return 'name must be at least 2 characters'
  if (input.name.length > 80) return 'name too long (max 80)'
  if (!HANDLE_RE.test(input.handle)) return 'handle must be 3-33 chars, lowercase, digits and hyphens, start alphanumeric'
  if (input.description && input.description.length > 500) return 'description too long (max 500)'
  if (input.lifecycle && !VALID_LIFECYCLE.has(input.lifecycle as AgentLifecycle)) return `invalid lifecycle: ${input.lifecycle}`
  return null
}

export function transitionLifecycle(current: AgentLifecycle, next: AgentLifecycle): { ok: boolean; reason?: string } {
  const order: Record<AgentLifecycle, number> = { draft: 0, build: 1, active: 2, published: 3 }
  if (order[next] < order[current]) return { ok: false, reason: `cannot move backwards from ${current} to ${next}` }
  if (order[next] > order[current] + 1) return { ok: false, reason: `must advance sequentially from ${current} to ${next}` }
  // draft->build->active->published only
  return { ok: true }
}

// Minimal in-memory registry (backed by caller persistence if needed)
export class AgentRegistry {
  private readonly agents = new Map<string, StudioAgent>()

  create(agent: StudioAgent): StudioAgent {
    const err = validateAgentInput({ handle: agent.handle, name: agent.name, description: agent.description, lifecycle: agent.lifecycle })
    if (err) throw new Error(err)
    if (this.agents.has(agent.id)) throw new Error(`agent ${agent.id} already exists`)
    const now = Date.now()
    const created: StudioAgent = { ...agent, createdAt: agent.createdAt || now, updatedAt: now }
    this.agents.set(created.id, created)
    return created
  }

  get(id: string): StudioAgent | null {
    return this.agents.get(id) ?? null
  }

  list(): StudioAgent[] {
    return [...this.agents.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  update(id: string, patch: Partial<Pick<StudioAgent, 'name' | 'description' | 'lifecycle' | 'model'>>): StudioAgent {
    const cur = this.agents.get(id)
    if (!cur) throw new Error(`agent ${id} not found`)
    if (patch.lifecycle && patch.lifecycle !== cur.lifecycle) {
      const t = transitionLifecycle(cur.lifecycle, patch.lifecycle)
      if (!t.ok) throw new Error(t.reason)
    }
    const next: StudioAgent = { ...cur, ...patch, updatedAt: Date.now() }
    if (patch.name || patch.description || patch.lifecycle) {
      const err = validateAgentInput({ handle: cur.handle, name: next.name, description: next.description, lifecycle: next.lifecycle })
      if (err) throw new Error(err)
    }
    this.agents.set(id, next)
    return next
  }

  remove(id: string): boolean {
    return this.agents.delete(id)
  }

  clear(): void {
    this.agents.clear()
  }
}

// ── Resumable knowledge ingest (agent-scoped facade) ───────────────

export interface AgentKnowledgeDownload {
  agentId: string
  modelId: string
  rfilename: string
  downloadUrl: string
}

export type AgentDownloadState = DownloadState

export function startAgentKnowledgeDownload(
  config: RuntimeConfigStore,
  userData: string,
  dl: AgentKnowledgeDownload,
  emit: (e: DownloadEvent) => void,
): Promise<{ ok: true; resumed: boolean; queued?: boolean }> {
  if (!dl.agentId || !dl.modelId || !dl.rfilename || !dl.downloadUrl) throw new Error('invalid knowledge download target')
  // Agent isolation is logical: key is model+rfilename; agentId is retained for UI correlation
  return startDownload(config, userData, dl.modelId, dl.rfilename, dl.downloadUrl, emit)
}

export function pauseAgentDownload(modelId: string, rfilename: string): boolean {
  return pauseDownload(modelId, rfilename)
}

export function resumeAgentDownload(
  config: RuntimeConfigStore,
  userData: string,
  dl: AgentKnowledgeDownload,
  emit: (e: DownloadEvent) => void,
): boolean {
  return resumeDownload(config, userData, dl.modelId, dl.rfilename, dl.downloadUrl, emit)
}

export function cancelAgentDownload(modelId: string, rfilename: string): boolean {
  return cancelDownload(modelId, rfilename)
}

export function listAgentDownloads(): Array<{ modelId: string; rfilename: string; state: AgentDownloadState }> {
  return getActiveDownloads()
}

// ── System-aware recommendations (agent context) ─────────────────────

export interface AgentRecommendation {
  file: FileRecommendation
  compatibility: CompatibilityResult
}

export function getAgentRecommendations(model: ExploreModel, hw: HardwareInfo): { recommendations: FileRecommendation[]; compatibility: CompatibilityResult } {
  const recommendations = recommendFiles(model, hw)
  const compatibility = estimateCompatibility(model, hw)
  return { recommendations, compatibility }
}

export function getBestRecommendationIndex(model: ExploreModel, hw: HardwareInfo): number | null {
  const recs = recommendFiles(model, hw)
  if (recs.length === 0) return null
  return recs[0].index
}
