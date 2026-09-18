// @sovara/capability-todo — model-facing whole-list replacement, like harness tool-todo/src/index.ts
// Each call appends a `todo/write` snapshot; replay is last-write-wins. UI derives from session events.

import type { TodoItem } from './types.ts'

export const name = 'capability-todo'
export const inject = ['tools', 'sessionProjections'] as const

export interface Config {
  allowParallelInProgress: boolean
}

export const Config = {
  allowParallelInProgress: true,
}

const STATUSES = ['pending', 'in_progress', 'completed'] as const

const DESCRIPTION_HEAD =
  'Record and update a structured task list for the current work. Send the ENTIRE ' +
  'list every call — it REPLACES the previous list (there are no partial updates, ' +
  'no per-item edits). Use it to plan multi-step work and show progress: add one ' +
  'todo per concrete step before you start. '

const DESCRIPTION_PARALLEL =
  'Mark every todo being actively worked ' +
  'on `in_progress` — several at once when work genuinely runs in parallel (e.g. ' +
  'concurrent subagents or background commands), one for sequential work; while ' +
  'work remains, at least one task should be `in_progress`. '

const DESCRIPTION_SINGLE =
  'Keep AT MOST ONE todo `in_progress` at a ' +
  'time; while work remains, exactly one active task should be `in_progress`. '

const DESCRIPTION_TAIL =
  'Mark a todo ' +
  '`completed` the moment it is done (do not batch completions), and allow no ' +
  '`in_progress` item only once all work is complete. Skip the list for trivial ' +
  'single-step tasks. Statuses: `pending` (not started), `in_progress` (being ' +
  'worked on now), `completed` (finished).'

function describe(allowParallel: boolean): string {
  return DESCRIPTION_HEAD + (allowParallel ? DESCRIPTION_PARALLEL : DESCRIPTION_SINGLE) + DESCRIPTION_TAIL
}

function toTodoList(raw: { content: string; status: string }[], allowParallel: boolean): TodoItem[] {
  const todos: TodoItem[] = []
  const seen = new Set<string>()
  let active = 0
  for (const item of raw) {
    const content = item.content.trim()
    if (content.length === 0) throw new Error('invalid todo: `content` must be a non-empty string')
    if (seen.has(content)) throw new Error(`invalid todos: duplicate content ${JSON.stringify(content)}`)
    seen.add(content)
    if (item.status === 'in_progress') active++
    if (!STATUSES.includes(item.status as typeof STATUSES[number])) throw new Error(`invalid status ${item.status}`)
    todos.push({ content, status: item.status as TodoItem['status'] })
  }
  if (!allowParallel && active > 1) throw new Error(`invalid todos: at most one task may be in_progress (got ${active})`)
  return todos
}

export function getTodoToolDefinition(allowParallel = true) {
  return {
    name: 'todo_write',
    toolset: 'todo' as const,
    description: describe(allowParallel),
    parameters: {
      type: 'object' as const,
      properties: {
        todos: {
          type: 'array' as const,
          description: 'The COMPLETE task list, replacing any previous list.',
          items: {
            type: 'object' as const,
            additionalProperties: false,
            properties: {
              content: { type: 'string' as const, description: 'What the task is — a short imperative line.' },
              status: { type: 'string' as const, enum: [...STATUSES], description: 'pending (not started) | in_progress (now) | completed (done).' },
            },
            required: ['content', 'status'] as const,
          },
        },
      },
      required: ['todos'] as const,
    },
  }
}

export function executeTodoWrite(
  args: { todos: { content: string; status: string }[] },
  ctx: { append: (type: 'todo/write', data: { todos: TodoItem[] }) => void; allowParallel?: boolean }
): { todos: TodoItem[]; counts: { pending: number; inProgress: number; completed: number } } {
  const todos = toTodoList(args.todos, ctx.allowParallel ?? true)
  ctx.append('todo/write', { todos })
  const count = (s: TodoItem['status']) => todos.filter(t => t.status === s).length
  return {
    todos,
    counts: { pending: count('pending'), inProgress: count('in_progress'), completed: count('completed') },
  }
}
