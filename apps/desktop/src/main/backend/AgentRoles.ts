/**
 * Logical Agent Roles for SOVARA Agentic Harness
 * Single loaded local GGUF model powers all roles.
 * Logical roles are controlled via:
 * - System instructions / role prompt modifier
 * - Task context
 * - Tool permissions
 * - Output schemas
 * - Execution state
 */

import type { TaskKind } from '@shared/types/task'
import { normalizeToolName } from './tools/fenceTools'

export type LogicalRoleName =
  | 'Planner'
  | 'Coder'
  | 'Researcher'
  | 'DocumentAnalyst'
  | 'Reviewer'
  | 'Verifier'
  | 'ToolOperator'
  | 'Chat'

export interface LogicalAgentRole {
  name: LogicalRoleName
  displayName: string
  description: string
  systemInstruction: string
  allowedTools: string[]
  outputDirective: string
}

export const AGENT_ROLES: Record<LogicalRoleName, LogicalAgentRole> = {
  Planner: {
    name: 'Planner',
    displayName: 'Task Planner',
    description: 'Decomposes complex requests into ordered tasks, identifies skills, and structures multi-step execution.',
    systemInstruction: `ROLE: Logical Task Planner. Focus on breaking down the user request into clear, executable steps. Discover required skills using search_skills and construct an explicit plan before writing artifacts.`,
    allowedTools: ['search_skills', 'read_skill', 'fs_read', 'fs_write', 'fs_patch', 'fs_list', 'fs_search', 'shell_exec', 'invoke_subagent', 'memory', 'todo_write', 'clarify'],
    outputDirective: 'State the structured step-by-step plan clearly using todo_write before dispatching file mutations.',
  },
  Coder: {
    name: 'Coder',
    displayName: 'Software Engineer',
    description: 'Scaffolds codebases, modifies files, fixes bugs, writes tests, and runs workspace scripts.',
    systemInstruction: `ROLE: Logical Software Engineer. Write clean, complete, production-grade code. Modify files directly using fs_write/fs_patch and run build commands with shell_exec.`,
    allowedTools: ['fs_read', 'fs_write', 'fs_patch', 'fs_list', 'fs_search', 'shell_exec', 'bash', 'cmd', 'powershell', 'terminal_exec', 'search_skills', 'read_skill', 'todo_write', 'run_code', 'invoke_subagent', 'clarify'],
    outputDirective: 'Provide full executable code blocks without placeholder snippets. Verify compilation and execution.',
  },
  Researcher: {
    name: 'Researcher',
    displayName: 'Knowledge & Web Researcher',
    description: 'Searches codebase, documentation, skills corpus, web, and memory for information and facts.',
    systemInstruction: `ROLE: Logical Researcher. Conduct thorough search across project files, skills documentation, 2D memory, and web context. Synthesize verified evidence.`,
    allowedTools: ['search_skills', 'read_skill', 'fs_read', 'fs_list', 'fs_search', 'web_search', 'web_fetch', 'memory', 'invoke_subagent', 'clarify'],
    outputDirective: 'Synthesize findings with citations and clean markdown tables.',
  },
  DocumentAnalyst: {
    name: 'DocumentAnalyst',
    displayName: 'Document & PDF Analyst',
    description: 'Extracts data from documents, PDFs, spreadsheets, scans, and structures insights.',
    systemInstruction: `ROLE: Logical Document Analyst. Read and parse document contents, extract text/tables, and structure key insights.`,
    allowedTools: ['fs_read', 'fs_list', 'fs_search', 'memory', 'search_skills', 'read_skill', 'invoke_subagent', 'clarify'],
    outputDirective: 'Present extracted document facts in structured Markdown tables with source citations.',
  },
  Reviewer: {
    name: 'Reviewer',
    displayName: 'Code & Quality Reviewer',
    description: 'Inspects code diffs, architecture, security constraints, and quality metrics.',
    systemInstruction: `ROLE: Logical Code Reviewer. Audit implementation changes for security, performance, correctness, and adherence to project conventions.`,
    allowedTools: ['fs_read', 'fs_search', 'fs_list', 'memory', 'invoke_subagent', 'clarify'],
    outputDirective: 'Highlight security issues, performance bottlenecks, and concrete code improvements.',
  },
  Verifier: {
    name: 'Verifier',
    displayName: 'Execution Verifier',
    description: 'Runs test suites, verifies created artifact files, checks exit codes, and confirms task completion.',
    systemInstruction: `ROLE: Logical Execution Verifier. Validate generated files exist, scripts execute cleanly, and all user requirements are satisfied.`,
    allowedTools: ['fs_read', 'fs_list', 'shell_exec', 'run_code', 'memory', 'todo_write', 'invoke_subagent', 'clarify'],
    outputDirective: 'Confirm explicit file presence and test outputs before reporting completion.',
  },
  ToolOperator: {
    name: 'ToolOperator',
    displayName: 'Tool Execution Operator',
    description: 'Executes specific workspace tools according to task instructions.',
    systemInstruction: `ROLE: Logical Tool Operator. Execute required workspace tools accurately and handle tool feedback cleanly.`,
    allowedTools: ['fs_read', 'fs_write', 'fs_patch', 'fs_list', 'fs_search', 'shell_exec', 'todo_write', 'memory', 'search_skills', 'read_skill', 'web_search', 'web_fetch', 'invoke_subagent', 'run_code', 'clarify'],
    outputDirective: 'Execute requested tool commands and report empirical outcome.',
  },
  Chat: {
    name: 'Chat',
    displayName: 'General Assistant',
    description: 'Handles general queries, direct answers, and conversational interaction.',
    systemInstruction: `ROLE: Logical Chat Assistant. Provide helpful, concise, accurate direct responses.`,
    allowedTools: ['fs_read', 'fs_write', 'fs_patch', 'fs_list', 'fs_search', 'shell_exec', 'search_skills', 'read_skill', 'web_search', 'web_fetch', 'invoke_subagent', 'run_code', 'memory', 'clarify'],
    outputDirective: 'Answer user queries clearly and directly.',
  },
}

/**
 * Maps TaskKind to the primary logical agent role.
 */
export function resolveLogicalRole(taskKind: TaskKind, skillsNeeded?: string[]): LogicalAgentRole {
  if (taskKind === 'coding') return AGENT_ROLES.Coder
  if (taskKind === 'agent' || taskKind === 'reasoning') return AGENT_ROLES.Planner
  if (taskKind === 'analysis') {
    if (skillsNeeded?.some((s) => ['pdf', 'docx', 'xlsx', 'ocr'].includes(s))) {
      return AGENT_ROLES.DocumentAnalyst
    }
    return AGENT_ROLES.Reviewer
  }
  if (taskKind === 'summarization') return AGENT_ROLES.Researcher
  if (taskKind === 'tool-use') return AGENT_ROLES.ToolOperator
  return AGENT_ROLES.Chat
}

/**
 * Checks if a tool is permitted for the given logical role.
 */
export function isToolPermittedForRole(role: LogicalAgentRole, toolName: string): boolean {
  const norm = normalizeToolName(toolName)
  if (role.allowedTools.includes(norm) || role.allowedTools.includes('*')) return true
  if (['shell_exec', 'bash', 'cmd', 'powershell', 'terminal_exec'].includes(norm)) {
    return role.allowedTools.some((t) => ['shell_exec', 'bash', 'cmd', 'powershell', 'terminal_exec'].includes(t))
  }
  if (['search_skills', 'read_skill'].includes(norm)) {
    return role.allowedTools.some((t) => ['search_skills', 'read_skill'].includes(t))
  }
  return false
}
