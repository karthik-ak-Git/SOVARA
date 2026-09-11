/**
 * Commit 6 — runtime-agnostic model types.
 *
 * SOVARA's own vocabulary for local runtimes and discovered models.
 * No vendor-specific fields here: Ollama / LM Studio / vLLM / llama.cpp
 * quirks stay inside adapters as optional `metadata`, never in core types.
 * Renderer and shared code must never branch on vendor assumptions —
 * only on `type` (for labels) and on capability strings.
 */

/** Extensible runtime family. First supported: `openai-compatible`. */
export type RuntimeType =
  | 'openai-compatible'
  | 'ollama'
  | 'lmstudio'
  | 'vllm'
  | 'llama.cpp'
  | 'custom'

export interface ModelRuntimeEntry {
  id: string
  displayName: string
  /** Adapter family this entry is served by. */
  type: RuntimeType
  /** Normalized local base URL, e.g. `http://127.0.0.1:1234/v1`. */
  endpoint: string
  enabled: boolean
  timeoutMs: number
}

export interface DiscoveredModel {
  /** Stable within its runtime: `<runtimeId>:<remote id>`. */
  modelId: string
  displayName: string
  runtimeId: string
  /** Discovery tag — mirrors LocalModel.source, never a vendor branch. */
  source: RuntimeType
  capabilities: string[]
  contextLength?: number
  /** Small adapter-supplied extras (e.g. `owned_by`). Bounded at write. */
  metadata?: Record<string, string>
  /** True when present in the runtime's last discovery snapshot. */
  available: boolean
}

export interface RuntimeProbeResult {
  reachable: boolean
  runtimeId: string
  latencyMs: number
  models: DiscoveredModel[]
  /** Normalized, user-safe message. Never a raw exception. */
  error?: string
}

export interface ActiveModelSelection {
  runtimeId: string
  modelId: string
}

export interface ActiveModelState {
  selection: ActiveModelSelection | null
  /** False when the runtime/model vanished — UI shows it, never re-picks. */
  available: boolean
  displayName?: string
  runtimeDisplayName?: string
}
