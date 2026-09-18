// @sovara/capability-todo — types only, like harness packages/todo/tool-todo/src/types.ts
// One home for the `todos` projection-key declaration.

export interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
}

// Augment session event map (shared via branded types, no direct import to avoid cycles)
declare global {
  interface SovaraSessionEventMap {
    'todo/write': { todos: TodoItem[] }
  }
  interface SovaraSessionProjectionMap {
    todos: TodoItem[] | null
  }
}
