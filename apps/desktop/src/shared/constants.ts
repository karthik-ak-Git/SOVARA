export const APP_NAME = 'Sovara' as const
// Ensure this perfectly mirrors desktop/package.json
export const APP_VERSION = '1.1.3' as const
// Central configuration registry
export const PROTOCOL_VERSION = 1 as const

// IPC timeouts (ms)
export const IPC_TIMEOUT_MS = 10_000 as const

// Storage
export const SESSIONS_DIR = 'sessions' as const
export const EVENTS_FILE = 'events.v1.jsonl' as const
export const DB_FILE = 'sovara.db' as const

// Limits — validated via zod in handlers, not magic throughout code
export const MAX_TITLE_CHARS = 120 as const
export const MAX_MESSAGE_CHARS = 32_000 as const
