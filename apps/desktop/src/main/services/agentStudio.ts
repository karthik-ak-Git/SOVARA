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
import { z } from 'zod'
import { SovaraDb } from '../storage/db'
import type { SessionEventView } from '@shared/types/ports'

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

// ── Persistent Studio store (SQLite-backed extension of the registry) ───
// The in-memory AgentRegistry above stays exactly as pinned by
// tests/agents.studio.test.ts. StudioStore persists the same validated
// shapes in the shared SovaraDb file with idempotent CREATE TABLE IF NOT
// EXISTS statements (RuntimeConfigStore pattern — no schema-version bump).
// No seeds anywhere: every row comes from a real user action, and every
// agent create/update appends a real version snapshot.

export interface StudioAgentView {
  id: string
  handle: string
  name: string
  description: string
  lifecycle: AgentLifecycle
  model: string
  instructions: string
  fav: boolean
  team: boolean
  accent: string
  archived: boolean
  createdAt: number
  updatedAt: number
}

export interface StudioKnowledgeFile {
  id: string
  agentId: string
  name: string
  sizeBytes: number
  mime: string | null
  /** Honest registry state — files are registered, not yet RAG-indexed. */
  status: 'registered'
  createdAt: number
  updatedAt: number
}

export type StudioMemorySource = 'user' | 'inferred' | 'tool'

export interface StudioMemoryEntry {
  id: string
  agentId: string
  content: string
  source: StudioMemorySource
  createdAt: number
  updatedAt: number
}

export type StudioWorkflowTrigger = 'manual' | 'schedule' | 'webhook'
export type StudioWorkflowStatus = 'active' | 'paused'

export interface StudioWorkflow {
  id: string
  agentId: string
  name: string
  trigger: StudioWorkflowTrigger
  /** User-defined step labels — no fabricated runs or success rates. */
  steps: string[]
  status: StudioWorkflowStatus
  createdAt: number
  updatedAt: number
}

export interface StudioEvalRun {
  id: string
  agentId: string
  prompt: string
  status: string
  latencyMs: number | null
  createdAt: number
}

export interface StudioVersionEntry {
  id: string
  agentId: string
  version: string
  note: string
  snapshot: { name: string; description: string; lifecycle: AgentLifecycle; model: string; instructions: string }
  createdAt: number
}

export interface StudioPermissions {
  agentId: string
  knowledgeRead: boolean
  knowledgeWrite: boolean
  toolsCall: boolean
  mcpSpawn: boolean
  teamVisible: boolean
  allowPublish: boolean
  updatedAt: number
}

export const DEFAULT_PERMISSIONS: Omit<StudioPermissions, 'agentId' | 'updatedAt'> = {
  knowledgeRead: true,
  knowledgeWrite: false,
  toolsCall: true,
  mcpSpawn: true,
  teamVisible: false,
  allowPublish: true,
}

const HANDLE_RE_STUDIO = /^[a-z0-9][a-z0-9-]{2,32}$/
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/

function studioId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function uniqueHandle(base: string, taken: (h: string) => boolean): string {
  let h = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'agent'
  if (!taken(h)) return h
  let n = 2
  while (taken(`${h}-${n}`)) n++
  return `${h}-${n}`
}

// ── Zod payload shapes for the future agents:* IPC contract ─────────────
// (Kept here so the orchestrator can import them without touching
// src/shared/ipc/schemas.ts in this pass.)

export const zStudioAgentCreate = z.object({
  handle: z.string().min(3).max(33).regex(HANDLE_RE_STUDIO, 'handle must be 3-33 chars, lowercase, digits and hyphens, start alphanumeric'),
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional().default(''),
  lifecycle: z.enum(['draft', 'build', 'active', 'published']).optional().default('draft'),
  model: z.string().max(256).optional().default(''),
  instructions: z.string().max(20000).optional().default(''),
  fav: z.boolean().optional().default(false),
  team: z.boolean().optional().default(false),
  accent: z.string().regex(ACCENT_RE, 'accent must be #rrggbb').optional().default('#4a90d9'),
}).strict()

export const zStudioAgentUpdate = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional(),
  lifecycle: z.enum(['draft', 'build', 'active', 'published']).optional(),
  model: z.string().max(256).optional(),
  instructions: z.string().max(20000).optional(),
  fav: z.boolean().optional(),
  team: z.boolean().optional(),
  accent: z.string().regex(ACCENT_RE, 'accent must be #rrggbb').optional(),
}).strict()

export const zStudioId = z.object({ id: z.string().min(1).max(128) }).strict()

export const zStudioKnowledgeAdd = z.object({
  agentId: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  sizeBytes: z.number().int().min(0).max(1024 * 1024 * 1024).optional().default(0),
  mime: z.string().max(128).optional(),
}).strict()

export const zStudioMemoryAdd = z.object({
  agentId: z.string().min(1).max(128),
  content: z.string().min(1).max(4000),
  source: z.enum(['user', 'inferred', 'tool']).optional().default('user'),
}).strict()

export const zStudioWorkflowCreate = z.object({
  agentId: z.string().min(1).max(128),
  name: z.string().min(1).max(120).optional().default('Untitled Workflow'),
  trigger: z.enum(['manual', 'schedule', 'webhook']).optional().default('manual'),
  steps: z.array(z.string().min(1).max(200)).max(50).optional().default([]),
}).strict()

export const zStudioWorkflowUpdate = z.object({
  name: z.string().min(1).max(120).optional(),
  trigger: z.enum(['manual', 'schedule', 'webhook']).optional(),
  steps: z.array(z.string().min(1).max(200)).max(50).optional(),
  status: z.enum(['active', 'paused']).optional(),
}).strict()

export const zStudioEvalRecord = z.object({
  agentId: z.string().min(1).max(128),
  prompt: z.string().min(1).max(8000),
  status: z.string().min(1).max(64).optional().default('recorded'),
  latencyMs: z.number().int().min(0).max(3600000).nullable().optional().default(null),
}).strict()

export const zStudioPermissionsSet = z.object({
  knowledgeRead: z.boolean().optional(),
  knowledgeWrite: z.boolean().optional(),
  toolsCall: z.boolean().optional(),
  mcpSpawn: z.boolean().optional(),
  teamVisible: z.boolean().optional(),
  allowPublish: z.boolean().optional(),
}).strict()

export const zStudioVersionSave = z.object({
  agentId: z.string().min(1).max(128),
  note: z.string().max(500).optional().default(''),
}).strict()

export class StudioStore {
  private readonly db: SovaraDb

  constructor(baseDir?: string) {
    this.db = new SovaraDb(baseDir)
    this.ensureTables()
  }

  private ensureTables(): void {
    this.db.raw.exec(`
      CREATE TABLE IF NOT EXISTS studio_agents (
        id TEXT PRIMARY KEY,
        handle TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        lifecycle TEXT NOT NULL DEFAULT 'draft',
        model TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        fav INTEGER NOT NULL DEFAULT 0,
        team INTEGER NOT NULL DEFAULT 0,
        accent TEXT NOT NULL DEFAULT '#4a90d9',
        archived INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_knowledge (
        id TEXT PRIMARY KEY,
        agentId TEXT NOT NULL,
        name TEXT NOT NULL,
        sizeBytes INTEGER NOT NULL DEFAULT 0,
        mime TEXT,
        status TEXT NOT NULL DEFAULT 'registered',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_memory (
        id TEXT PRIMARY KEY,
        agentId TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_workflows (
        id TEXT PRIMARY KEY,
        agentId TEXT NOT NULL,
        name TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT 'manual',
        steps TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_evals (
        id TEXT PRIMARY KEY,
        agentId TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'recorded',
        latencyMs INTEGER,
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_versions (
        id TEXT PRIMARY KEY,
        agentId TEXT NOT NULL,
        version TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        snapshot TEXT NOT NULL DEFAULT '{}',
        createdAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS studio_permissions (
        agentId TEXT PRIMARY KEY,
        knowledgeRead INTEGER NOT NULL DEFAULT 1,
        knowledgeWrite INTEGER NOT NULL DEFAULT 0,
        toolsCall INTEGER NOT NULL DEFAULT 1,
        mcpSpawn INTEGER NOT NULL DEFAULT 1,
        teamVisible INTEGER NOT NULL DEFAULT 0,
        allowPublish INTEGER NOT NULL DEFAULT 1,
        updatedAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_studio_knowledge_agent ON studio_knowledge(agentId);
      CREATE INDEX IF NOT EXISTS idx_studio_memory_agent ON studio_memory(agentId);
      CREATE INDEX IF NOT EXISTS idx_studio_workflows_agent ON studio_workflows(agentId);
      CREATE INDEX IF NOT EXISTS idx_studio_evals_agent ON studio_evals(agentId);
      CREATE INDEX IF NOT EXISTS idx_studio_versions_agent ON studio_versions(agentId);
    `)
  }

  close(): void {
    this.db.close()
  }

  // ── Agents ─────────────────────────────────────────────────────────

  listAgents(opts?: { includeArchived?: boolean }): StudioAgentView[] {
    const rows = (opts?.includeArchived
      ? this.db.raw.prepare('SELECT * FROM studio_agents ORDER BY updatedAt DESC, id DESC').all()
      : this.db.raw.prepare('SELECT * FROM studio_agents WHERE archived IS NULL OR archived = 0 ORDER BY updatedAt DESC, id DESC').all()) as Array<Record<string, unknown>>
    return rows.map((r) => this.mapAgent(r))
  }

  listArchivedAgents(): StudioAgentView[] {
    const rows = this.db.raw.prepare('SELECT * FROM studio_agents WHERE archived IS NOT NULL AND archived != 0 ORDER BY updatedAt DESC, id DESC').all() as Array<Record<string, unknown>>
    return rows.map((r) => this.mapAgent(r))
  }

  getAgent(id: string): StudioAgentView | null {
    const r = this.db.raw.prepare('SELECT * FROM studio_agents WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return r ? this.mapAgent(r) : null
  }

  createAgent(input: z.infer<typeof zStudioAgentCreate>): StudioAgentView {
    const parsed = zStudioAgentCreate.safeParse(input)
    if (!parsed.success) throw new Error(`invalid agent: ${parsed.error.message}`)
    const err = validateAgentInput({ handle: parsed.data.handle, name: parsed.data.name, description: parsed.data.description, lifecycle: parsed.data.lifecycle })
    if (err) throw new Error(err)
    const now = Date.now()
    const id = studioId('ag')
    try {
      this.db.raw.prepare(
        'INSERT INTO studio_agents (id, handle, name, description, lifecycle, model, instructions, fav, team, accent, archived, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)'
      ).run(id, parsed.data.handle, parsed.data.name.trim(), parsed.data.description ?? '', parsed.data.lifecycle ?? 'draft', parsed.data.model ?? '', parsed.data.instructions ?? '', parsed.data.fav ? 1 : 0, parsed.data.team ? 1 : 0, parsed.data.accent ?? '#4a90d9', now, now)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/UNIQUE constraint failed: studio_agents.handle/i.test(msg)) throw new Error(`handle already in use: ${parsed.data.handle}`)
      throw new Error(msg)
    }
    const created = this.getAgent(id)
    if (!created) throw new Error('agent create failed')
    this.appendVersion(id, 'Agent created', created)
    this.ensurePermissionsRow(id)
    return created
  }

  updateAgent(id: string, patch: z.infer<typeof zStudioAgentUpdate>, versionNote?: string): StudioAgentView {
    const parsed = zStudioAgentUpdate.safeParse(patch)
    if (!parsed.success) throw new Error(`invalid agent update: ${parsed.error.message}`)
    const cur = this.getAgent(id)
    if (!cur) throw new Error(`agent ${id} not found`)
    const p = parsed.data
    if (p.lifecycle && p.lifecycle !== cur.lifecycle) {
      const t = transitionLifecycle(cur.lifecycle, p.lifecycle)
      if (!t.ok) throw new Error(t.reason ?? `invalid lifecycle transition`)
    }
    const next = {
      name: p.name?.trim() ?? cur.name,
      description: p.description ?? cur.description,
      lifecycle: p.lifecycle ?? cur.lifecycle,
      model: p.model ?? cur.model,
      instructions: p.instructions ?? cur.instructions,
      fav: p.fav ?? cur.fav,
      team: p.team ?? cur.team,
      accent: p.accent ?? cur.accent,
    }
    const err = validateAgentInput({ handle: cur.handle, name: next.name, description: next.description, lifecycle: next.lifecycle })
    if (err) throw new Error(err)
    const now = Date.now()
    this.db.raw.prepare(
      'UPDATE studio_agents SET name = ?, description = ?, lifecycle = ?, model = ?, instructions = ?, fav = ?, team = ?, accent = ?, updatedAt = ? WHERE id = ?'
    ).run(next.name, next.description, next.lifecycle, next.model, next.instructions, next.fav ? 1 : 0, next.team ? 1 : 0, next.accent, now, id)
    const updated = this.getAgent(id)
    if (!updated) throw new Error('agent update failed')
    this.appendVersion(id, versionNote ?? 'Agent updated', updated)
    return updated
  }

  archiveAgent(id: string, archived: boolean): StudioAgentView {
    const cur = this.getAgent(id)
    if (!cur) throw new Error(`agent ${id} not found`)
    this.db.raw.prepare('UPDATE studio_agents SET archived = ?, updatedAt = ? WHERE id = ?').run(archived ? Date.now() : null, Date.now(), id)
    const updated = this.getAgent(id)
    if (!updated) throw new Error('agent archive failed')
    this.appendVersion(id, archived ? 'Agent archived' : 'Agent unarchived', updated)
    return updated
  }

  removeAgent(id: string): boolean {
    const cur = this.getAgent(id)
    if (!cur) return false
    for (const t of ['studio_knowledge', 'studio_memory', 'studio_workflows', 'studio_evals', 'studio_versions']) {
      this.db.raw.prepare(`DELETE FROM ${t} WHERE agentId = ?`).run(id)
    }
    this.db.raw.prepare('DELETE FROM studio_permissions WHERE agentId = ?').run(id)
    const r = this.db.raw.prepare('DELETE FROM studio_agents WHERE id = ?').run(id) as unknown as { changes: number }
    return (r.changes ?? 0) > 0
  }

  duplicateAgent(id: string): StudioAgentView {
    const cur = this.getAgent(id)
    if (!cur) throw new Error(`agent ${id} not found`)
    const handles = new Set(this.listAgents({ includeArchived: true }).map((a) => a.handle))
    const handle = uniqueHandle(`${cur.handle}-copy`, (h) => handles.has(h))
    const now = Date.now()
    const dupId = studioId('ag')
    this.db.raw.prepare(
      'INSERT INTO studio_agents (id, handle, name, description, lifecycle, model, instructions, fav, team, accent, archived, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)'
    ).run(dupId, handle, `${cur.name} (copy)`.slice(0, 80), cur.description, 'draft', cur.model, cur.instructions, cur.fav ? 1 : 0, cur.team ? 1 : 0, cur.accent, now, now)
    // Copy memories + workflows so the duplicate is genuinely useful; runs and
    // versions start fresh (no fabricated history).
    for (const m of this.listMemories(id)) {
      this.addMemory(dupId, { content: m.content, source: m.source })
    }
    for (const w of this.listWorkflows(id)) {
      this.createWorkflow(dupId, { name: w.name, trigger: w.trigger, steps: w.steps })
    }
    const dup = this.getAgent(dupId)
    if (!dup) throw new Error('agent duplicate failed')
    this.appendVersion(dupId, `Duplicated from ${cur.handle}`, dup)
    this.ensurePermissionsRow(dupId)
    return dup
  }

  // ── Knowledge registry ─────────────────────────────────────────────

  listKnowledge(agentId: string): StudioKnowledgeFile[] {
    this.requireAgent(agentId)
    const rows = this.db.raw.prepare('SELECT * FROM studio_knowledge WHERE agentId = ? ORDER BY createdAt DESC, id DESC').all(agentId) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: String(r['id'] ?? ''),
      agentId: String(r['agentId'] ?? agentId),
      name: String(r['name'] ?? ''),
      sizeBytes: typeof r['sizeBytes'] === 'number' ? r['sizeBytes'] : 0,
      mime: typeof r['mime'] === 'string' ? (r['mime'] as string) : null,
      status: 'registered' as const,
      createdAt: typeof r['createdAt'] === 'number' ? (r['createdAt'] as number) : Date.now(),
      updatedAt: typeof r['updatedAt'] === 'number' ? (r['updatedAt'] as number) : Date.now(),
    }))
  }

  addKnowledge(agentId: string, input: { name: string; sizeBytes?: number; mime?: string }): StudioKnowledgeFile {
    const parsed = zStudioKnowledgeAdd.safeParse({ agentId, ...input })
    if (!parsed.success) throw new Error(`invalid knowledge file: ${parsed.error.message}`)
    this.requireAgent(agentId)
    const now = Date.now()
    const id = studioId('kn')
    this.db.raw.prepare(
      'INSERT INTO studio_knowledge (id, agentId, name, sizeBytes, mime, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, agentId, parsed.data.name.trim().slice(0, 256), parsed.data.sizeBytes ?? 0, parsed.data.mime ?? null, 'registered', now, now)
    const rows = this.listKnowledge(agentId)
    const created = rows.find((f) => f.id === id)
    if (!created) throw new Error('knowledge add failed')
    return created
  }

  removeKnowledge(id: string): boolean {
    const r = this.db.raw.prepare('DELETE FROM studio_knowledge WHERE id = ?').run(id) as unknown as { changes: number }
    return (r.changes ?? 0) > 0
  }

  // ── Memory ─────────────────────────────────────────────────────────

  listMemories(agentId: string): StudioMemoryEntry[] {
    this.requireAgent(agentId)
    const rows = this.db.raw.prepare('SELECT * FROM studio_memory WHERE agentId = ? ORDER BY createdAt DESC, id DESC').all(agentId) as Array<Record<string, unknown>>
    return rows.map((r) => {
      const src = String(r['source'] ?? 'user')
      return {
        id: String(r['id'] ?? ''),
        agentId: String(r['agentId'] ?? agentId),
        content: String(r['content'] ?? ''),
        source: (src === 'inferred' || src === 'tool' ? src : 'user') as StudioMemorySource,
        createdAt: typeof r['createdAt'] === 'number' ? (r['createdAt'] as number) : Date.now(),
        updatedAt: typeof r['updatedAt'] === 'number' ? (r['updatedAt'] as number) : Date.now(),
      }
    })
  }

  addMemory(agentId: string, input: { content: string; source?: StudioMemorySource }): StudioMemoryEntry {
    const parsed = zStudioMemoryAdd.safeParse({ agentId, ...input })
    if (!parsed.success) throw new Error(`invalid memory: ${parsed.error.message}`)
    this.requireAgent(agentId)
    const now = Date.now()
    const id = studioId('mem')
    this.db.raw.prepare('INSERT INTO studio_memory (id, agentId, content, source, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run(id, agentId, parsed.data.content.trim(), parsed.data.source ?? 'user', now, now)
    const created = this.listMemories(agentId).find((m) => m.id === id)
    if (!created) throw new Error('memory add failed')
    return created
  }

  removeMemory(id: string): boolean {
    const r = this.db.raw.prepare('DELETE FROM studio_memory WHERE id = ?').run(id) as unknown as { changes: number }
    return (r.changes ?? 0) > 0
  }

  // ── Workflows ──────────────────────────────────────────────────────

  listWorkflows(agentId: string): StudioWorkflow[] {
    this.requireAgent(agentId)
    const rows = this.db.raw.prepare('SELECT * FROM studio_workflows WHERE agentId = ? ORDER BY createdAt DESC, id DESC').all(agentId) as Array<Record<string, unknown>>
    return rows.map((r) => this.mapWorkflow(r, agentId))
  }

  createWorkflow(agentId: string, input: { name?: string; trigger?: StudioWorkflowTrigger; steps?: string[] }): StudioWorkflow {
    const parsed = zStudioWorkflowCreate.safeParse({ agentId, ...input })
    if (!parsed.success) throw new Error(`invalid workflow: ${parsed.error.message}`)
    this.requireAgent(agentId)
    const now = Date.now()
    const id = studioId('wf')
    const name = (parsed.data.name ?? 'Untitled Workflow').trim().slice(0, 120) || 'Untitled Workflow'
    this.db.raw.prepare('INSERT INTO studio_workflows (id, agentId, name, trigger, steps, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, agentId, name, parsed.data.trigger ?? 'manual', JSON.stringify(parsed.data.steps ?? []), 'active', now, now
    )
    const created = this.listWorkflows(agentId).find((w) => w.id === id)
    if (!created) throw new Error('workflow create failed')
    return created
  }

  updateWorkflow(id: string, patch: z.infer<typeof zStudioWorkflowUpdate>): StudioWorkflow {
    const parsed = zStudioWorkflowUpdate.safeParse(patch)
    if (!parsed.success) throw new Error(`invalid workflow update: ${parsed.error.message}`)
    const row = this.db.raw.prepare('SELECT * FROM studio_workflows WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`workflow ${id} not found`)
    const agentId = String(row['agentId'] ?? '')
    const cur = this.mapWorkflow(row, agentId)
    const next = {
      name: (parsed.data.name?.trim() || cur.name).slice(0, 120),
      trigger: parsed.data.trigger ?? cur.trigger,
      steps: parsed.data.steps ?? cur.steps,
      status: parsed.data.status ?? cur.status,
    }
    this.db.raw.prepare('UPDATE studio_workflows SET name = ?, trigger = ?, steps = ?, status = ?, updatedAt = ? WHERE id = ?').run(next.name, next.trigger, JSON.stringify(next.steps), next.status, Date.now(), id)
    const updated = this.listWorkflows(agentId).find((w) => w.id === id)
    if (!updated) throw new Error('workflow update failed')
    return updated
  }

  removeWorkflow(id: string): boolean {
    const r = this.db.raw.prepare('DELETE FROM studio_workflows WHERE id = ?').run(id) as unknown as { changes: number }
    return (r.changes ?? 0) > 0
  }

  // ── Eval history (real runs only — never seeded) ───────────────────

  listEvals(agentId: string, limit = 50): StudioEvalRun[] {
    this.requireAgent(agentId)
    const rows = this.db.raw.prepare('SELECT * FROM studio_evals WHERE agentId = ? ORDER BY createdAt DESC, id DESC LIMIT ?').all(agentId, Math.max(1, Math.min(200, limit))) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: String(r['id'] ?? ''),
      agentId: String(r['agentId'] ?? agentId),
      prompt: String(r['prompt'] ?? ''),
      status: String(r['status'] ?? 'recorded'),
      latencyMs: typeof r['latencyMs'] === 'number' ? (r['latencyMs'] as number) : null,
      createdAt: typeof r['createdAt'] === 'number' ? (r['createdAt'] as number) : Date.now(),
    }))
  }

  recordEval(agentId: string, input: { prompt: string; status?: string; latencyMs?: number | null }): StudioEvalRun {
    const parsed = zStudioEvalRecord.safeParse({ agentId, ...input })
    if (!parsed.success) throw new Error(`invalid eval: ${parsed.error.message}`)
    this.requireAgent(agentId)
    const now = Date.now()
    const id = studioId('ev')
    this.db.raw.prepare('INSERT INTO studio_evals (id, agentId, prompt, status, latencyMs, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, agentId, parsed.data.prompt.trim(), parsed.data.status ?? 'recorded', parsed.data.latencyMs ?? null, now
    )
    const created = this.listEvals(agentId).find((e) => e.id === id)
    if (!created) throw new Error('eval record failed')
    return created
  }

  // ── Versions (every save is a real snapshot) ───────────────────────

  listVersions(agentId: string): StudioVersionEntry[] {
    this.requireAgent(agentId)
    const rows = this.db.raw.prepare('SELECT * FROM studio_versions WHERE agentId = ? ORDER BY createdAt DESC, id DESC').all(agentId) as Array<Record<string, unknown>>
    return rows.map((r) => ({
      id: String(r['id'] ?? ''),
      agentId: String(r['agentId'] ?? agentId),
      version: String(r['version'] ?? ''),
      note: String(r['note'] ?? ''),
      snapshot: this.parseSnapshot(r['snapshot']),
      createdAt: typeof r['createdAt'] === 'number' ? (r['createdAt'] as number) : Date.now(),
    }))
  }

  saveVersion(agentId: string, note = ''): StudioVersionEntry {
    const agent = this.requireAgent(agentId)
    return this.appendVersion(agentId, note.slice(0, 500), agent)
  }

  // ── Permissions (persisted per agent, private by default) ──────────

  getPermissions(agentId: string): StudioPermissions {
    this.requireAgent(agentId)
    const r = this.db.raw.prepare('SELECT * FROM studio_permissions WHERE agentId = ?').get(agentId) as Record<string, unknown> | undefined
    if (!r) return { agentId, ...DEFAULT_PERMISSIONS, updatedAt: Date.now() }
    return {
      agentId,
      knowledgeRead: (r['knowledgeRead'] as number) === 1,
      knowledgeWrite: (r['knowledgeWrite'] as number) === 1,
      toolsCall: (r['toolsCall'] as number) === 1,
      mcpSpawn: (r['mcpSpawn'] as number) === 1,
      teamVisible: (r['teamVisible'] as number) === 1,
      allowPublish: (r['allowPublish'] as number) === 1,
      updatedAt: typeof r['updatedAt'] === 'number' ? (r['updatedAt'] as number) : Date.now(),
    }
  }

  setPermissions(agentId: string, patch: z.infer<typeof zStudioPermissionsSet>): StudioPermissions {
    const parsed = zStudioPermissionsSet.safeParse(patch)
    if (!parsed.success) throw new Error(`invalid permissions: ${parsed.error.message}`)
    const cur = this.getPermissions(agentId)
    const next = { ...cur, ...parsed.data, agentId, updatedAt: Date.now() }
    this.db.raw.prepare(
      'INSERT INTO studio_permissions (agentId, knowledgeRead, knowledgeWrite, toolsCall, mcpSpawn, teamVisible, allowPublish, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(agentId) DO UPDATE SET knowledgeRead = excluded.knowledgeRead, knowledgeWrite = excluded.knowledgeWrite, toolsCall = excluded.toolsCall, mcpSpawn = excluded.mcpSpawn, teamVisible = excluded.teamVisible, allowPublish = excluded.allowPublish, updatedAt = excluded.updatedAt'
    ).run(next.agentId, next.knowledgeRead ? 1 : 0, next.knowledgeWrite ? 1 : 0, next.toolsCall ? 1 : 0, next.mcpSpawn ? 1 : 0, next.teamVisible ? 1 : 0, next.allowPublish ? 1 : 0, next.updatedAt)
    return next
  }

  // ── Internals ──────────────────────────────────────────────────────

  private requireAgent(agentId: string): StudioAgentView {
    const a = this.getAgent(agentId)
    if (!a) throw new Error(`agent ${agentId} not found`)
    return a
  }

  private ensurePermissionsRow(agentId: string): void {
    const existing = this.db.raw.prepare('SELECT agentId FROM studio_permissions WHERE agentId = ?').get(agentId) as unknown | undefined
    if (existing) return
    this.db.raw.prepare('INSERT INTO studio_permissions (agentId, knowledgeRead, knowledgeWrite, toolsCall, mcpSpawn, teamVisible, allowPublish, updatedAt) VALUES (?, 1, 0, 1, 1, 0, 1, ?)').run(agentId, Date.now())
  }

  private appendVersion(agentId: string, note: string, agent: StudioAgentView): StudioVersionEntry {
    const count = (this.db.raw.prepare('SELECT count(*) as c FROM studio_versions WHERE agentId = ?').get(agentId) as { c?: number })?.c ?? 0
    const version = `v${count + 1}`
    const id = studioId('ver')
    const snapshot = { name: agent.name, description: agent.description, lifecycle: agent.lifecycle, model: agent.model, instructions: agent.instructions }
    this.db.raw.prepare('INSERT INTO studio_versions (id, agentId, version, note, snapshot, createdAt) VALUES (?, ?, ?, ?, ?, ?)').run(id, agentId, version, note.slice(0, 500), JSON.stringify(snapshot), Date.now())
    const created = this.listVersions(agentId).find((v) => v.id === id)
    if (!created) throw new Error('version save failed')
    return created
  }

  private parseSnapshot(raw: unknown): StudioVersionEntry['snapshot'] {
    const fallback = { name: '', description: '', lifecycle: 'draft' as AgentLifecycle, model: '', instructions: '' }
    if (typeof raw !== 'string') return fallback
    try {
      const v = JSON.parse(raw) as Record<string, unknown>
      const lc = String(v['lifecycle'] ?? 'draft')
      return {
        name: typeof v['name'] === 'string' ? (v['name'] as string) : '',
        description: typeof v['description'] === 'string' ? (v['description'] as string) : '',
        lifecycle: (['draft', 'build', 'active', 'published'] as AgentLifecycle[]).includes(lc as AgentLifecycle) ? (lc as AgentLifecycle) : 'draft',
        model: typeof v['model'] === 'string' ? (v['model'] as string) : '',
        instructions: typeof v['instructions'] === 'string' ? (v['instructions'] as string) : '',
      }
    } catch {
      return fallback
    }
  }

  private mapAgent(r: Record<string, unknown>): StudioAgentView {
    const lc = String(r['lifecycle'] ?? 'draft')
    const accent = typeof r['accent'] === 'string' && ACCENT_RE.test(r['accent'] as string) ? (r['accent'] as string) : '#4a90d9'
    return {
      id: String(r['id'] ?? ''),
      handle: String(r['handle'] ?? ''),
      name: String(r['name'] ?? ''),
      description: String(r['description'] ?? ''),
      lifecycle: (['draft', 'build', 'active', 'published'] as AgentLifecycle[]).includes(lc as AgentLifecycle) ? (lc as AgentLifecycle) : 'draft',
      model: typeof r['model'] === 'string' ? (r['model'] as string) : '',
      instructions: typeof r['instructions'] === 'string' ? (r['instructions'] as string) : '',
      fav: (r['fav'] as number) === 1,
      team: (r['team'] as number) === 1,
      accent,
      archived: (r['archived'] as number | null) != null && (r['archived'] as number) !== 0,
      createdAt: typeof r['createdAt'] === 'number' ? (r['createdAt'] as number) : Date.now(),
      updatedAt: typeof r['updatedAt'] === 'number' ? (r['updatedAt'] as number) : Date.now(),
    }
  }

  private mapWorkflow(r: Record<string, unknown>, agentId: string): StudioWorkflow {
    const trigger = String(r['trigger'] ?? 'manual')
    const status = String(r['status'] ?? 'active')
    let steps: string[] = []
    try {
      const v = JSON.parse(String(r['steps'] ?? '[]')) as unknown
      if (Array.isArray(v)) steps = v.filter((s): s is string => typeof s === 'string').slice(0, 50)
    } catch {
      steps = []
    }
    return {
      id: String(r['id'] ?? ''),
      agentId: String(r['agentId'] ?? agentId),
      name: String(r['name'] ?? 'Untitled Workflow'),
      trigger: (['manual', 'schedule', 'webhook'] as StudioWorkflowTrigger[]).includes(trigger as StudioWorkflowTrigger) ? (trigger as StudioWorkflowTrigger) : 'manual',
      steps,
      status: status === 'paused' ? 'paused' : 'active',
      createdAt: typeof r['createdAt'] === 'number' ? (r['createdAt'] as number) : Date.now(),
      updatedAt: typeof r['updatedAt'] === 'number' ? (r['updatedAt'] as number) : Date.now(),
    }
  }
}

// ── Derivation from real session events (no invented numbers) ──────────
// Skill run counts and tool usage counts are computed live from persisted
// session events (tool/call entries written by tools:dispatch and the
// orchestrator). Empty input yields empty output — never placeholder data.

function toolNameOf(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const n = o['name'] ?? o['toolName']
  return typeof n === 'string' && n.length > 0 ? n : null
}

function skillNameOf(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const args = o['args']
  const a = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : o
  const raw = a['skill_name'] ?? a['skillName'] ?? a['skill'] ?? a['name']
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim().slice(0, 128) : null
}

export interface ToolCallCount {
  name: string
  total: number
  last7d: number
}

export function countToolCalls(events: SessionEventView[]): ToolCallCount[] {
  const now = Date.now()
  const week = 7 * 86_400_000
  const acc = new Map<string, { total: number; last7d: number }>()
  for (const e of events) {
    if (e.type !== 'tool/call') continue
    const name = toolNameOf(e.data)
    if (!name) continue
    const cur = acc.get(name) ?? { total: 0, last7d: 0 }
    cur.total++
    if (now - e.time >= 0 && now - e.time < week) cur.last7d++
    acc.set(name, cur)
  }
  return [...acc.entries()]
    .map(([name, c]) => ({ name, total: c.total, last7d: c.last7d }))
    .sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1))
}

export interface SkillRunCount {
  skillName: string
  runs: number
}

export function countSkillReads(events: SessionEventView[]): SkillRunCount[] {
  const acc = new Map<string, { label: string; runs: number }>()
  for (const e of events) {
    if (e.type !== 'tool/call') continue
    if (toolNameOf(e.data) !== 'read_skill') continue
    const skill = skillNameOf(e.data)
    if (!skill) continue
    const key = skill.toLowerCase()
    const cur = acc.get(key) ?? { label: skill, runs: 0 }
    cur.runs++
    acc.set(key, cur)
  }
  return [...acc.values()]
    .map((v) => ({ skillName: v.label, runs: v.runs }))
    .sort((a, b) => b.runs - a.runs || (a.skillName < b.skillName ? -1 : 1))
}

export interface StudioActivityRow {
  time: number
  text: string
  kind: 'message' | 'reply' | 'tool' | 'error' | 'other'
}

export function buildRecentActivity(events: SessionEventView[], limit = 6): StudioActivityRow[] {
  const rows: StudioActivityRow[] = []
  for (const e of events) {
    if (e.type === 'user/message') rows.push({ time: e.time, text: 'Message sent', kind: 'message' })
    else if (e.type === 'assistant/message') rows.push({ time: e.time, text: 'Reply received', kind: 'reply' })
    else if (e.type === 'tool/call') {
      const name = toolNameOf(e.data)
      rows.push({ time: e.time, text: name ? `Tool run · ${name}` : 'Tool run', kind: 'tool' })
    } else if (e.type === 'task:error' || e.type === 'error') rows.push({ time: e.time, text: 'Run error recorded', kind: 'error' })
    else if (e.type === 'attachment/added') rows.push({ time: e.time, text: 'Files attached', kind: 'other' })
    else if (e.type === 'system/compact') rows.push({ time: e.time, text: 'Context compacted', kind: 'other' })
  }
  return rows.sort((a, b) => b.time - a.time).slice(0, Math.max(1, Math.min(20, limit)))
}
