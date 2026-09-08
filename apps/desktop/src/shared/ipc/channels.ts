/**
 * Single source of IPC channels — imported by main, preload, renderer (types only).
 * Enforced by preload whitelist; handlers validate with zod.
 */
export const IPC_CHANNELS = {
  'app:getInfo': { type: 'invoke' as const },
  'app:getSystem': { type: 'invoke' as const },
  'system:getResources': { type: 'invoke' as const },
  'sessions:list': { type: 'invoke' as const },
  'sessions:create': { type: 'invoke' as const },
  'sessions:get': { type: 'invoke' as const },
  'sessions:getEvents': { type: 'invoke' as const },
  'sessions:rename': { type: 'invoke' as const },
  'sessions:delete': { type: 'invoke' as const },
  'projects:list': { type: 'invoke' as const },
  'projects:create': { type: 'invoke' as const },
  'projects:rename': { type: 'invoke' as const },
  'projects:delete': { type: 'invoke' as const },
  'sessions:archive': { type: 'invoke' as const },
  'sessions:unarchive': { type: 'invoke' as const },
  'sessions:listArchived': { type: 'invoke' as const },
  'chat:send': { type: 'invoke' as const },
  'chat:cancel': { type: 'invoke' as const },
  'models:listLocal': { type: 'invoke' as const },
  'models:load': { type: 'invoke' as const },
  'models:probeRuntime': { type: 'invoke' as const },
  // Commit 6 — workbench facet (registry/probe/select; legacy trio above untouched)
  'models:listRuntimes': { type: 'invoke' as const },
  'models:addRuntime': { type: 'invoke' as const },
  'models:removeRuntime': { type: 'invoke' as const },
  'models:testConnection': { type: 'invoke' as const },
  'models:listModels': { type: 'invoke' as const },
  'models:selectModel': { type: 'invoke' as const },
  'models:getActiveModel': { type: 'invoke' as const },
  // Settings (preferences)
  'settings:get': { type: 'invoke' as const },
  'settings:set': { type: 'invoke' as const },
  // App version + update feed (Settings → General)
  'app:getVersion': { type: 'invoke' as const },
  'updates:checkNow': { type: 'invoke' as const },
  // Usage stats
  'usage:getTotal': { type: 'invoke' as const },
  'usage:getByModel': { type: 'invoke' as const },
  // Window controls (frameless window)
  'window:minimize': { type: 'invoke' as const },
  'window:maximize': { type: 'invoke' as const },
  'window:close': { type: 'invoke' as const },
  // Dialog
  'dialog:pickFolder': { type: 'invoke' as const },
  // Skills scanning
  'skills:scan': { type: 'invoke' as const },
  'skills:toggle': { type: 'invoke' as const },
  // Explore (HuggingFace catalog)
  'explore:listModels': { type: 'invoke' as const },
  'explore:getModel': { type: 'invoke' as const },
  'explore:getCompatibility': { type: 'invoke' as const },
  // Library (downloaded models)
  'library:listModels': { type: 'invoke' as const },
  'library:getDirectory': { type: 'invoke' as const },
  'library:setDirectory': { type: 'invoke' as const },
  // First-run setup (Python env for sidecars)
  'setup:getPythonStatus': { type: 'invoke' as const },
  'setup:ensurePython': { type: 'invoke' as const },
  // Exec permissions (AI command levels)
  'exec:getMode': { type: 'invoke' as const },
  'exec:setMode': { type: 'invoke' as const },
  // Tools (gated by exec permission level)
  'tools:list': { type: 'invoke' as const },
  'tools:dispatch': { type: 'invoke' as const },
  // MCP servers (Connected Apps)
  'mcp:list': { type: 'invoke' as const },
  'mcp:add': { type: 'invoke' as const },
  'mcp:remove': { type: 'invoke' as const },
  'mcp:toggle': { type: 'invoke' as const },
  'mcp:probe': { type: 'invoke' as const },
  // Voice transcription (local faster-whisper)
  'voice:transcribe': { type: 'invoke' as const },
  'voice:status': { type: 'invoke' as const },
  'events:session': { type: 'on' as const },
  'events:resources': { type: 'on' as const },
} as const

export type IpcChannel = keyof typeof IPC_CHANNELS
export type IpcInvokeChannel = {
  [K in IpcChannel]: (typeof IPC_CHANNELS)[K]['type'] extends 'invoke' ? K : never
}[IpcChannel]
export type IpcOnChannel = {
  [K in IpcChannel]: (typeof IPC_CHANNELS)[K]['type'] extends 'on' ? K : never
}[IpcChannel]
