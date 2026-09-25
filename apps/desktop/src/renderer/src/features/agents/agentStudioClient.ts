/**
 * Agent Studio client bridge.
 *
 * Talks to the future agents:* IPC contract via window.sovara.invoke
 * directly (preload currently blocks unknown channels, so every call
 * falls back gracefully). Until the orchestrator wires the contract,
 * entities persist in localStorage — real local persistence, never
 * invented numbers. Every collection starts EMPTY; rows only appear
 * after a real user action.
 */

import {
  listSessions,
  getSessionEvents,
  listTools,
  listDetailedSkills,
  getActiveDownloads,
  getAppSettings,
  type SessionEventView,
} from '@/lib/client/api'

export type AgentLifecycle = 'draft' | 'build' | 'active' | 'published'

export interface StudioAgent {
  id: string
  handle: string
  name: string
  description: string
  initials: string
  lifecycle: AgentLifecycle
  model: string
  instructions: string
  updatedAt: number
  fav?: boolean
  team?: boolean
  accent: string
  archived?: boolean
}

export interface KnowledgeFile {
  id: string
  agentId: string
  name: string
  sizeBytes: number
  mime: string | null
  status: 'registered'
  createdAt: number
}

export interface MemoryEntry {
  id: string
  agentId: string
  content: string
  source: 'user' | 'inferred' | 'tool'
  createdAt: number
}

export type WorkflowTrigger = 'manual' | 'schedule' | 'webhook'

export interface Workflow {
  id: string
  agentId: string
  name: string
  trigger: WorkflowTrigger
  steps: string[]
  status: 'active' | 'paused'
  createdAt: number
}

export interface EvalRun {
  id: string
  agentId: string
  prompt: string
  status: string
  latencyMs: number | null
  createdAt: number
}

export interface VersionEntry {
  id: string
  agentId: string
  version: string
  note: string
  snapshot: { name: string; description: string; lifecycle: AgentLifecycle; model: string; instructions: string }
  createdAt: number
}

export interface AgentPermissions {
  agentId: string
  knowledgeRead: boolean
  knowledgeWrite: boolean
  toolsCall: boolean
  mcpSpawn: boolean
  teamVisible: boolean
  allowPublish: boolean
}

export const DEFAULT_PERMISSIONS: Omit<AgentPermissions, 'agentId'> = {
  knowledgeRead: true,
  knowledgeWrite: false,
  toolsCall: true,
  mcpSpawn: true,
  teamVisible: false,
  allowPublish: true,
}

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{2,32}$/
const ACCENTS = ['#4a90d9', '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#14b8a6']

export function validateAgentForm(input: { handle: string; name: string; description?: string }): string | null {
  if (!input.name || input.name.trim().length < 2) return 'Name must be at least 2 characters.'
  if (input.name.length > 80) return 'Name too long (max 80).'
  if (!HANDLE_RE.test(input.handle)) return 'Handle must be 3-33 chars, lowercase letters, digits and hyphens.'
  if (input.description && input.description.length > 500) return 'Description too long (max 500).'
  return null
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'AG'
  if (parts.length === 1) return (parts[0] ?? 'AG').slice(0, 2).toUpperCase()
  return `${(parts[0] ?? 'A')[0] ?? 'A'}${(parts[parts.length - 1] ?? 'G')[0] ?? 'G'}`.toUpperCase()
}

export function accentFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return ACCENTS[h % ACCENTS.length] ?? '#4a90d9'
}

export function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (!Number.isFinite(diff) || diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// ── Future IPC attempt (blocked by preload until wired → null) ─────────

async function tryInvoke<T>(channel: string, payload?: unknown): Promise<T | null> {
  try {
    const w = window as unknown as { sovara?: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }
    if (!w.sovara?.invoke) return null
    const res = await w.sovara.invoke(channel, ...(payload === undefined ? [] : [payload]))
    return res as T
  } catch {
    return null
  }
}

// ── Local fallback persistence (real, per-browser profile) ─────────────

function readLocal<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota/privacy — keep in-memory behavior for the session
  }
}

const K = {
  agents: 'sovara.studio.agents.v1',
  knowledge: 'sovara.studio.knowledge.v1',
  memories: 'sovara.studio.memories.v1',
  workflows: 'sovara.studio.workflows.v1',
  evals: 'sovara.studio.evals.v1',
  versions: 'sovara.studio.versions.v1',
  permissions: 'sovara.studio.permissions.v1',
  skills: 'sovara.studio.skillToggles.v1',
} as const

function snapshotOf(a: StudioAgent): VersionEntry['snapshot'] {
  return { name: a.name, description: a.description, lifecycle: a.lifecycle, model: a.model, instructions: a.instructions }
}

function appendLocalVersion(agent: StudioAgent, note: string): void {
  const all = readLocal<VersionEntry[]>(K.versions, [])
  const count = all.filter((v) => v.agentId === agent.id).length
  all.unshift({
    id: makeId('ver'),
    agentId: agent.id,
    version: `v${count + 1}`,
    note,
    snapshot: snapshotOf(agent),
    createdAt: Date.now(),
  })
  writeLocal(K.versions, all.slice(0, 500))
}

// ── Agents ─────────────────────────────────────────────────────────────

export async function fetchAgents(): Promise<StudioAgent[]> {
  const remote = await tryInvoke<StudioAgent[]>('agents:list')
  if (Array.isArray(remote)) return remote
  const local = readLocal<StudioAgent[]>(K.agents, [])
  return Array.isArray(local) ? local.filter((a) => a && typeof a.id === 'string') : []
}

export async function createAgent(input: { name: string; handle: string; description?: string; model?: string }): Promise<StudioAgent> {
  const err = validateAgentForm(input)
  if (err) throw new Error(err)
  const remote = await tryInvoke<StudioAgent>('agents:create', input)
  if (remote && typeof remote.id === 'string') return remote
  const existing = readLocal<StudioAgent[]>(K.agents, [])
  if (existing.some((a) => a.handle === input.handle.trim())) throw new Error(`Handle already in use: ${input.handle.trim()}`)
  const now = Date.now()
  const agent: StudioAgent = {
    id: makeId('ag'),
    handle: input.handle.trim(),
    name: input.name.trim(),
    description: (input.description ?? '').slice(0, 500),
    initials: initialsFor(input.name),
    lifecycle: 'draft',
    model: (input.model ?? '').slice(0, 256),
    instructions: '',
    updatedAt: now,
    fav: false,
    team: false,
    accent: accentFor(`${input.handle}${now}`),
    archived: false,
  }
  writeLocal(K.agents, [agent, ...existing])
  appendLocalVersion(agent, 'Agent created')
  return agent
}

export async function updateAgent(id: string, patch: Partial<Pick<StudioAgent, 'name' | 'description' | 'lifecycle' | 'model' | 'instructions' | 'fav' | 'team' | 'accent'>>): Promise<StudioAgent> {
  const remote = await tryInvoke<StudioAgent>('agents:update', { id, ...patch })
  if (remote && typeof remote.id === 'string') return remote
  const all = readLocal<StudioAgent[]>(K.agents, [])
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) throw new Error('Agent not found.')
  const cur = all[idx] as StudioAgent
  if (patch.name !== undefined && patch.name.trim().length < 2) throw new Error('Name must be at least 2 characters.')
  const order: Record<AgentLifecycle, number> = { draft: 0, build: 1, active: 2, published: 3 }
  if (patch.lifecycle !== undefined && patch.lifecycle !== cur.lifecycle) {
    if (order[patch.lifecycle] < order[cur.lifecycle]) throw new Error(`Cannot move backwards from ${cur.lifecycle} to ${patch.lifecycle}.`)
    if (order[patch.lifecycle] > order[cur.lifecycle] + 1) throw new Error(`Must advance sequentially from ${cur.lifecycle}.`)
  }
  const next: StudioAgent = {
    ...cur,
    ...patch,
    name: (patch.name ?? cur.name).trim(),
    description: (patch.description ?? cur.description).slice(0, 500),
    initials: initialsFor(patch.name ?? cur.name),
    updatedAt: Date.now(),
  }
  all[idx] = next
  writeLocal(K.agents, all)
  appendLocalVersion(next, 'Agent updated')
  return next
}

export async function duplicateAgent(id: string): Promise<StudioAgent> {
  const remote = await tryInvoke<StudioAgent>('agents:duplicate', { id })
  if (remote && typeof remote.id === 'string') return remote
  const all = readLocal<StudioAgent[]>(K.agents, [])
  const cur = all.find((a) => a.id === id)
  if (!cur) throw new Error('Agent not found.')
  const handles = new Set(all.map((a) => a.handle))
  let handle = `${cur.handle}-copy`.slice(0, 30)
  let n = 2
  while (handles.has(handle)) handle = `${cur.handle}-copy-${n++}`.slice(0, 33)
  const now = Date.now()
  const dup: StudioAgent = {
    ...cur,
    id: makeId('ag'),
    handle,
    name: `${cur.name} (copy)`.slice(0, 80),
    initials: initialsFor(`${cur.name} copy`),
    lifecycle: 'draft',
    updatedAt: now,
    archived: false,
  }
  writeLocal(K.agents, [dup, ...all])
  appendLocalVersion(dup, `Duplicated from ${cur.handle}`)
  return dup
}

export async function removeAgent(id: string): Promise<void> {
  const remote = await tryInvoke<{ ok: boolean }>('agents:remove', { id })
  if (remote && remote.ok === true) return
  const drop = <T extends { id?: string; agentId?: string }>(list: T[]): T[] => list.filter((e) => e.id !== id && e.agentId !== id)
  writeLocal(K.agents, drop(readLocal<StudioAgent[]>(K.agents, [])))
  writeLocal(K.knowledge, drop(readLocal<KnowledgeFile[]>(K.knowledge, [])))
  writeLocal(K.memories, drop(readLocal<MemoryEntry[]>(K.memories, [])))
  writeLocal(K.workflows, drop(readLocal<Workflow[]>(K.workflows, [])))
  writeLocal(K.evals, drop(readLocal<EvalRun[]>(K.evals, [])))
  writeLocal(K.versions, drop(readLocal<VersionEntry[]>(K.versions, [])))
}

export async function setArchived(id: string, archived: boolean): Promise<StudioAgent> {
  const remote = await tryInvoke<StudioAgent>('agents:archive', { id, archived })
  if (remote && typeof remote.id === 'string') return remote
  const all = readLocal<StudioAgent[]>(K.agents, [])
  const idx = all.findIndex((a) => a.id === id)
  if (idx === -1) throw new Error('Agent not found.')
  const next = { ...(all[idx] as StudioAgent), archived, updatedAt: Date.now() }
  all[idx] = next
  writeLocal(K.agents, all)
  appendLocalVersion(next, archived ? 'Agent archived' : 'Agent unarchived')
  return next
}

// ── Knowledge ──────────────────────────────────────────────────────────

export async function fetchKnowledge(agentId: string): Promise<KnowledgeFile[]> {
  const remote = await tryInvoke<KnowledgeFile[]>('agents:knowledge:list', { agentId })
  if (Array.isArray(remote)) return remote
  return readLocal<KnowledgeFile[]>(K.knowledge, []).filter((f) => f.agentId === agentId)
}

export async function addKnowledge(agentId: string, file: { name: string; sizeBytes: number; mime?: string }): Promise<KnowledgeFile> {
  const remote = await tryInvoke<KnowledgeFile>('agents:knowledge:add', { agentId, ...file })
  if (remote && typeof remote.id === 'string') return remote
  const entry: KnowledgeFile = {
    id: makeId('kn'),
    agentId,
    name: file.name.slice(0, 256),
    sizeBytes: Math.max(0, Math.floor(file.sizeBytes || 0)),
    mime: file.mime ?? null,
    status: 'registered',
    createdAt: Date.now(),
  }
  const all = readLocal<KnowledgeFile[]>(K.knowledge, [])
  writeLocal(K.knowledge, [entry, ...all].slice(0, 500))
  return entry
}

export async function removeKnowledge(id: string): Promise<void> {
  const remote = await tryInvoke<{ ok: boolean }>('agents:knowledge:remove', { id })
  if (remote && remote.ok === true) return
  writeLocal(K.knowledge, readLocal<KnowledgeFile[]>(K.knowledge, []).filter((f) => f.id !== id))
}

// ── Memory ─────────────────────────────────────────────────────────────

export async function fetchMemories(agentId: string): Promise<MemoryEntry[]> {
  const remote = await tryInvoke<MemoryEntry[]>('agents:memory:list', { agentId })
  if (Array.isArray(remote)) return remote
  return readLocal<MemoryEntry[]>(K.memories, []).filter((m) => m.agentId === agentId)
}

export async function addMemory(agentId: string, content: string): Promise<MemoryEntry> {
  const clean = content.trim()
  if (!clean) throw new Error('Memory must not be empty.')
  if (clean.length > 4000) throw new Error('Memory too long (max 4000).')
  const remote = await tryInvoke<MemoryEntry>('agents:memory:add', { agentId, content: clean })
  if (remote && typeof remote.id === 'string') return remote
  const entry: MemoryEntry = { id: makeId('mem'), agentId, content: clean, source: 'user', createdAt: Date.now() }
  const all = readLocal<MemoryEntry[]>(K.memories, [])
  writeLocal(K.memories, [entry, ...all].slice(0, 500))
  return entry
}

export async function removeMemory(id: string): Promise<void> {
  const remote = await tryInvoke<{ ok: boolean }>('agents:memory:remove', { id })
  if (remote && remote.ok === true) return
  writeLocal(K.memories, readLocal<MemoryEntry[]>(K.memories, []).filter((m) => m.id !== id))
}

// ── Workflows ──────────────────────────────────────────────────────────

export async function fetchWorkflows(agentId: string): Promise<Workflow[]> {
  const remote = await tryInvoke<Workflow[]>('agents:workflows:list', { agentId })
  if (Array.isArray(remote)) return remote
  return readLocal<Workflow[]>(K.workflows, []).filter((w) => w.agentId === agentId)
}

export async function createWorkflow(agentId: string): Promise<Workflow> {
  const remote = await tryInvoke<Workflow>('agents:workflows:create', { agentId })
  if (remote && typeof remote.id === 'string') return remote
  const existing = readLocal<Workflow[]>(K.workflows, []).filter((w) => w.agentId === agentId)
  const wf: Workflow = {
    id: makeId('wf'),
    agentId,
    name: `Untitled Workflow ${existing.length + 1}`,
    trigger: 'manual',
    steps: [],
    status: 'active',
    createdAt: Date.now(),
  }
  const all = readLocal<Workflow[]>(K.workflows, [])
  writeLocal(K.workflows, [wf, ...all].slice(0, 200))
  return wf
}

export async function updateWorkflow(id: string, patch: Partial<Pick<Workflow, 'name' | 'trigger' | 'steps' | 'status'>>): Promise<Workflow> {
  const remote = await tryInvoke<Workflow>('agents:workflows:update', { id, ...patch })
  if (remote && typeof remote.id === 'string') return remote
  const all = readLocal<Workflow[]>(K.workflows, [])
  const idx = all.findIndex((w) => w.id === id)
  if (idx === -1) throw new Error('Workflow not found.')
  const next = { ...(all[idx] as Workflow), ...patch }
  all[idx] = next
  writeLocal(K.workflows, all)
  return next
}

export async function removeWorkflow(id: string): Promise<void> {
  const remote = await tryInvoke<{ ok: boolean }>('agents:workflows:remove', { id })
  if (remote && remote.ok === true) return
  writeLocal(K.workflows, readLocal<Workflow[]>(K.workflows, []).filter((w) => w.id !== id))
}

// ── Evals (recorded runs only) ─────────────────────────────────────────

export async function fetchEvals(agentId: string): Promise<EvalRun[]> {
  const remote = await tryInvoke<EvalRun[]>('agents:evals:list', { agentId })
  if (Array.isArray(remote)) return remote
  return readLocal<EvalRun[]>(K.evals, []).filter((e) => e.agentId === agentId)
}

export async function recordEval(agentId: string, prompt: string): Promise<EvalRun> {
  const clean = prompt.trim()
  if (!clean) throw new Error('Prompt must not be empty.')
  const remote = await tryInvoke<EvalRun>('agents:evals:record', { agentId, prompt: clean })
  if (remote && typeof remote.id === 'string') return remote
  const entry: EvalRun = { id: makeId('ev'), agentId, prompt: clean.slice(0, 8000), status: 'recorded', latencyMs: null, createdAt: Date.now() }
  const all = readLocal<EvalRun[]>(K.evals, [])
  writeLocal(K.evals, [entry, ...all].slice(0, 200))
  return entry
}

// ── Versions ───────────────────────────────────────────────────────────

export async function fetchVersions(agentId: string): Promise<VersionEntry[]> {
  const remote = await tryInvoke<VersionEntry[]>('agents:versions:list', { agentId })
  if (Array.isArray(remote)) return remote
  return readLocal<VersionEntry[]>(K.versions, []).filter((v) => v.agentId === agentId)
}

// ── Permissions ────────────────────────────────────────────────────────

export async function fetchPermissions(agentId: string): Promise<AgentPermissions> {
  const remote = await tryInvoke<AgentPermissions>('agents:permissions:get', { agentId })
  if (remote && remote.agentId === agentId) return remote
  const all = readLocal<AgentPermissions[]>(K.permissions, [])
  return all.find((p) => p.agentId === agentId) ?? { agentId, ...DEFAULT_PERMISSIONS }
}

export async function savePermissions(agentId: string, patch: Partial<Omit<AgentPermissions, 'agentId'>>): Promise<AgentPermissions> {
  const remote = await tryInvoke<AgentPermissions>('agents:permissions:set', { agentId, ...patch })
  if (remote && remote.agentId === agentId) return remote
  const all = readLocal<AgentPermissions[]>(K.permissions, [])
  const idx = all.findIndex((p) => p.agentId === agentId)
  const next: AgentPermissions = { agentId, ...DEFAULT_PERMISSIONS, ...(idx >= 0 ? all[idx] : {}), ...patch }
  if (idx >= 0) all[idx] = next
  else all.push(next)
  writeLocal(K.permissions, all)
  return next
}

// ── Skill toggles (per agent, persisted) ───────────────────────────────

export async function fetchSkillToggles(agentId: string): Promise<Record<string, boolean>> {
  const all = readLocal<Array<{ agentId: string; name: string; on: boolean }>>(K.skills, [])
  const out: Record<string, boolean> = {}
  for (const t of all) if (t.agentId === agentId) out[t.name] = t.on
  return out
}

export async function setSkillToggle(agentId: string, name: string, on: boolean): Promise<void> {
  const all = readLocal<Array<{ agentId: string; name: string; on: boolean }>>(K.skills, [])
  const idx = all.findIndex((t) => t.agentId === agentId && t.name === name)
  if (idx >= 0) all[idx] = { agentId, name, on }
  else all.push({ agentId, name, on })
  writeLocal(K.skills, all)
}

// ── Real derivation from persisted session events ──────────────────────

export interface ToolCallCount {
  name: string
  total: number
  last7d: number
}

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
  const raw = a['skill_name'] ?? a['skillName'] ?? a['skill']
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim().slice(0, 128) : null
}

async function loadRecentEvents(maxSessions = 25): Promise<SessionEventView[]> {
  try {
    const sessions = await listSessions()
    const recent = sessions.slice(0, maxSessions)
    const lists = await Promise.all(recent.map((s) => getSessionEvents(s.id).catch(() => [] as SessionEventView[])))
    return lists.flat()
  } catch {
    return []
  }
}

export async function fetchToolCallCounts(): Promise<{ byTool: ToolCallCount[]; total: number }> {
  const events = await loadRecentEvents()
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
  const byTool = [...acc.entries()]
    .map(([name, c]) => ({ name, total: c.total, last7d: c.last7d }))
    .sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1))
  return { byTool, total: byTool.reduce((n, t) => n + t.total, 0) }
}

export async function fetchSkillRunCounts(): Promise<Array<{ skillName: string; runs: number }>> {
  const events = await loadRecentEvents()
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

export interface ActivityRow {
  time: number
  text: string
  ok: boolean
}

export async function fetchRecentActivity(limit = 6): Promise<ActivityRow[]> {
  try {
    const sessions = await listSessions()
    const recent = sessions.slice(0, 10)
    const lists = await Promise.all(recent.map((s) => getSessionEvents(s.id).catch(() => [] as SessionEventView[])))
    const rows: ActivityRow[] = []
    for (const events of lists) {
      for (const e of events) {
        if (e.type === 'user/message') rows.push({ time: e.time, text: 'Message sent', ok: true })
        else if (e.type === 'assistant/message') rows.push({ time: e.time, text: 'Reply received', ok: true })
        else if (e.type === 'tool/call') {
          const name = toolNameOf(e.data)
          rows.push({ time: e.time, text: name ? `Tool run · ${name}` : 'Tool run', ok: true })
        } else if (e.type === 'task:error' || e.type === 'error') rows.push({ time: e.time, text: 'Run error recorded', ok: false })
        else if (e.type === 'attachment/added') rows.push({ time: e.time, text: 'Files attached', ok: true })
      }
    }
    return rows.sort((a, b) => b.time - a.time).slice(0, limit)
  } catch {
    return []
  }
}

export interface RealTool {
  name: string
  toolset: string
  description: string
}

export async function fetchRealTools(): Promise<RealTool[]> {
  try {
    const tools = await listTools()
    return tools.map((t) => ({ name: t.name, toolset: t.toolset, description: t.description }))
  } catch {
    return []
  }
}

export interface RealSkill {
  name: string
  source: string
  description: string
}

export async function fetchRealSkills(): Promise<RealSkill[]> {
  try {
    const groups = await listDetailedSkills()
    const out: RealSkill[] = []
    for (const g of groups) {
      for (const s of g.skills ?? []) {
        out.push({ name: s.name, source: g.name || 'local', description: s.description || '' })
      }
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : 1))
  } catch {
    return []
  }
}

export interface RealDownload {
  modelId: string
  rfilename: string
  state: string
  receivedBytes?: number
  totalBytes?: number | null
}

export async function fetchRealDownloads(): Promise<RealDownload[]> {
  try {
    return await getActiveDownloads()
  } catch {
    return []
  }
}

export async function fetchWebSearchEnabled(): Promise<boolean | null> {
  try {
    const s = await getAppSettings()
    return s.webSearch
  } catch {
    return null
  }
}
