/**
 * Logical Multi-Role Prompting Engine
 * Maps task requirements to logical agent personas over a SINGLE resident local GGUF model.
 */

export type LogicalRole =
  | 'planner'
  | 'coder'
  | 'researcher'
  | 'document_analyst'
  | 'verifier'
  | 'reviewer'
  | 'tool_operator'

export interface RolePromptDirective {
  role: LogicalRole
  title: string
  directive: string
  suggestedTools: string[]
}

export const LOGICAL_ROLES: Record<LogicalRole, RolePromptDirective> = {
  planner: {
    role: 'planner',
    title: 'Lead Architect & Planner',
    directive: `Role: Planner. Break the task into discrete, actionable steps. Emit a todo list via todo_write. Identify key skill capabilities needed before writing files. Always check workspace context first.`,
    suggestedTools: ['todo_write', 'fs_list', 'search_skills', 'memory'],
  },
  coder: {
    role: 'coder',
    title: 'Senior Systems Coder',
    directive: `Role: Coder. Write clean, complete, bug-free, fully functional code using fs_write or fs_patch. Run verification commands via shell_exec. Never emit pseudo-code or placeholder blocks.`,
    suggestedTools: ['fs_write', 'fs_patch', 'fs_read', 'shell_exec', 'todo_write'],
  },
  researcher: {
    role: 'researcher',
    title: 'Workspace & Web Researcher',
    directive: `Role: Researcher. Search files, read context, fetch documentation, and synthesize facts. Store key entities and concepts using memory tool for the 2D Knowledge Graph.`,
    suggestedTools: ['fs_search', 'fs_read', 'web_search', 'web_fetch', 'memory'],
  },
  document_analyst: {
    role: 'document_analyst',
    title: 'Document & Data Analyst',
    directive: `Role: Document Analyst. Parse data files, structure information into markdown tables, and build generator scripts for PDF, DOCX, XLSX, or PPTX deliverables.`,
    suggestedTools: ['fs_read', 'fs_write', 'search_skills', 'read_skill', 'shell_exec'],
  },
  verifier: {
    role: 'verifier',
    title: 'Automated Test Verifier',
    directive: `Role: Verifier. Run tests, check execution output via shell_exec, inspect files, and confirm clean exit codes without swallowing errors.`,
    suggestedTools: ['shell_exec', 'fs_read', 'fs_search'],
  },
  reviewer: {
    role: 'reviewer',
    title: 'Code & Quality Reviewer',
    directive: `Role: Reviewer. Audit changes against prompt requirements, security guidelines, and formatting standards. Surface clear recap summaries.`,
    suggestedTools: ['fs_read', 'fs_patch', 'memory'],
  },
  tool_operator: {
    role: 'tool_operator',
    title: 'Autonomous Tool Operator',
    directive: `Role: Tool Operator. Execute filesystem and system tools cleanly. Process structured tool inputs and inspect runtime observations.`,
    suggestedTools: ['fs_read', 'fs_write', 'shell_exec', 'todo_write'],
  },
}

export function getRoleDirective(role: LogicalRole): RolePromptDirective {
  return LOGICAL_ROLES[role] ?? LOGICAL_ROLES.tool_operator
}
