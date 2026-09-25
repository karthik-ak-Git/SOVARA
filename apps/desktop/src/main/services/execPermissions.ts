/**
 * Exec permission gate — enforces the AI command permission level.
 *
 * Levels:
 * - off:    no tool/command dispatch at all.
 * - ask:    every dispatch needs explicit approval (no auto-run).
 * - review: safe read-only tools auto-run; risky ones need approval.
 * - allow:  full access — everything runs without prompting (warn in UI).
 *
 * Mode persists in SovaraDb app_meta (`exec_mode`, default 'review').
 * Approval flow is Phase 2; until then needs-approval surfaces as a
 * structured denial the renderer can turn into a prompt.
 */

import path from 'node:path'

export type ExecMode = 'off' | 'ask' | 'review' | 'allow'

export const EXEC_MODES: ExecMode[] = ['off', 'ask', 'review', 'allow']

export function isExecMode(v: unknown): v is ExecMode {
  return typeof v === 'string' && (EXEC_MODES as string[]).includes(v)
}

/** Read-only tool name prefixes that auto-run under `review`. */
const SAFE_PREFIXES = [
  'read', 'list', 'get', 'describe', 'status', 'probe', 'search',
  'show', 'check', 'fetch', 'inspect', 'scan', 'detect',
]

/** Explicit read-only safe tools that always auto-run under `review` within workspace. */
const SAFE_EXPLICIT_TOOLS = new Set([
  'fs_list', 'fs_read', 'web_search', 'web_fetch'
])

export function isSafeTool(toolName: string): boolean {
  const n = toolName.trim().toLowerCase().replace(/^[^a-z0-9_.-]+/, '')
  if (SAFE_EXPLICIT_TOOLS.has(n)) return true
  // Check if any sub-word separated by _, -, or . is in SAFE_PREFIXES (e.g. fs_list, project_read)
  const parts = n.split(/[_\-.]/)
  if (parts.some((part) => SAFE_PREFIXES.includes(part))) return true
  return SAFE_PREFIXES.some((p) => n === p || n.startsWith(`${p}_`) || n.startsWith(`${p}-`) || n.startsWith(`${p}.`) || n.startsWith(p))
}

export function isExternalPath(filePath?: string, workspaceRoot?: string | null): boolean {
  if (!filePath || typeof filePath !== 'string') return false
  const p = filePath.trim().replace(/^["']|["']$/g, '')
  const isAbs = path.isAbsolute(p) || /^[a-z]:[\\/]/i.test(p)
  if (!isAbs) return false
  if (!workspaceRoot) return true
  try {
    const normPath = path.resolve(p).toLowerCase().replace(/\\/g, '/')
    const normRoot = path.resolve(workspaceRoot).toLowerCase().replace(/\\/g, '/')
    return !normPath.startsWith(normRoot + '/') && normPath !== normRoot
  } catch {
    return true
  }
}

export type PermissionScope = 'once' | 'conversation' | 'project' | 'global'

const allowedByScope = {
  global: new Set<string>(),
  project: new Map<string, Set<string>>(), // projectId -> set of keys
  conversation: new Map<string, Set<string>>(), // sessionId -> set
}

function normalizeKeyPath(p: string): string {
  return p.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/').toLowerCase()
}

function toolKey(toolName: string, args: Record<string, unknown> = {}): string {
  const raw = (args['command'] as string) || (args['CommandLine'] as string) || (args['cmd'] as string) || (args['path'] as string) || (args['file_path'] as string) || ''
  return `${toolName.toLowerCase()}::${normalizeKeyPath(raw.slice(0, 300))}`
}

export function rememberApproval(toolName: string, args: Record<string, unknown>, scope: PermissionScope, sessionId?: string, projectId?: string | null): void {
  const key = toolKey(toolName, args)
  if (scope === 'global') allowedByScope.global.add(key)
  else if (scope === 'project' && projectId) {
    const s = allowedByScope.project.get(projectId) ?? new Set<string>()
    s.add(key)
    allowedByScope.project.set(projectId, s)
  } else if (scope === 'conversation' && sessionId) {
    const s = allowedByScope.conversation.get(sessionId) ?? new Set<string>()
    s.add(key)
    allowedByScope.conversation.set(sessionId, s)
  }
  // 'once' needs no persistence — caller uses _forceApprove for single dispatch
}

export function isScopedAllowed(toolName: string, args: Record<string, unknown>, sessionId?: string, projectId?: string | null): boolean {
  const key = toolKey(toolName, args)
  const rawPath = (args['path'] as string) || (args['file_path'] as string) || ''
  const normPath = rawPath ? normalizeKeyPath(rawPath) : ''

  const checkSet = (set: Set<string> | undefined): boolean => {
    if (!set) return false
    if (set.has(key)) return true
    if (normPath) {
      const prefix = `${toolName.toLowerCase()}::`
      for (const item of set) {
        if (item.startsWith(prefix)) {
          const approvedPath = item.slice(prefix.length)
          if (normPath === approvedPath || normPath.startsWith(approvedPath + '/')) {
            return true
          }
        }
      }
    }
    return false
  }

  if (checkSet(allowedByScope.global)) return true
  if (projectId && checkSet(allowedByScope.project.get(projectId))) return true
  if (sessionId && checkSet(allowedByScope.conversation.get(sessionId))) return true
  return false
}

export type GateVerdict =
  | { allowed: true; autoApproved: boolean }
  | { allowed: false; reason: 'disabled' | 'needs-approval'; message: string }

export function gateDispatch(
  mode: ExecMode,
  toolName: string,
  args?: Record<string, unknown>,
  sessionId?: string,
  projectId?: string | null,
  workspaceRoot?: string | null
): GateVerdict {
  const name = toolName || 'unknown-tool'
  // Scoped allowlist overrides mode (conversation/project/global remember)
  if (args && isScopedAllowed(toolName, args, sessionId, projectId)) {
    return { allowed: true, autoApproved: true }
  }

  const rawPath = (args?.['path'] as string) || (args?.['file_path'] as string)
  const isAccessingExternal = (name === 'fs_read' || name === 'fs_list' || name === 'fs_search') && isExternalPath(rawPath, workspaceRoot)

  switch (mode) {
    case 'off':
      return {
        allowed: false,
        reason: 'disabled',
        message: `Blocked: command execution is Off — "${name}" was not run.`,
      }
    case 'allow':
      return { allowed: true, autoApproved: true }
    case 'review':
      if (isAccessingExternal) {
        const cleanPath = (rawPath || '').trim().replace(/^["']|["']$/g, '')
        return {
          allowed: false,
          reason: 'needs-approval',
          message: `Approval required: "${name}" is requesting access to external file/folder "${cleanPath}" outside workspace.`,
        }
      }
      if (isSafeTool(name)) return { allowed: true, autoApproved: true }
      return {
        allowed: false,
        reason: 'needs-approval',
        message: `Approval required: "${name}" is not a safe read-only command under Auto Review.`,
      }
    case 'ask':
    default:
      return {
        allowed: false,
        reason: 'needs-approval',
        message: `Approval required: "${name}" needs confirmation under Ask every time.`,
      }
  }
}
