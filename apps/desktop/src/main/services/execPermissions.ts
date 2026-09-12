/**
 * Exec permission gate — enforces the AI command permission level.
 *
 * Levels:
 * - off:    no tool/command dispatch at all.
 * - ask:    every dispatch needs explicit approval (no auto-run).
 * - review: safe read-only tools auto-run; risky ones need approval.
 * - allow:  full access — everything runs without prompting (warn in UI).
 *
 * Mode persists in SovaraDb app_meta (`exec_mode`, default 'ask').
 * Approval flow is Phase 2; until then needs-approval surfaces as a
 * structured denial the renderer can turn into a prompt.
 */

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

export function isSafeTool(toolName: string): boolean {
  const n = toolName.trim().toLowerCase().replace(/^[^a-z0-9]+/, '')
  return SAFE_PREFIXES.some((p) => n === p || n.startsWith(`${p}_`) || n.startsWith(`${p}-`) || n.startsWith(`${p}.`) || n.startsWith(p))
}

export type GateVerdict =
  | { allowed: true; autoApproved: boolean }
  | { allowed: false; reason: 'disabled' | 'needs-approval'; message: string }

export function gateDispatch(mode: ExecMode, toolName: string): GateVerdict {
  const name = toolName || 'unknown-tool'
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
