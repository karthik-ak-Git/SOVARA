/**
 * Tuning — single source of truth for every runtime-tunable constant.
 *
 * Replaces magic numbers that were previously scattered inline
 * (150s stall guard, 120s timeout floor, chunk thresholds, context tiers,
 * VRAM safety margin, tool-loop depth, …). Nothing here is per-user
 * configuration by default; RuntimeConfigStore may override keys via the
 * `tuning` meta key (JSON, partial).
 *
 * Context tiers follow the reference approach in test/main.js:
 * detect real free VRAM/RAM and compute the largest SAFE context window
 * from discrete tiers — never assume a fixed GPU size.
 */

export const CONTEXT_TIERS = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072] as const

export interface TuningConfig {
  /** Abort chat if no token arrives within this window (ms). */
  stallGuardMs: number
  /** Lower bound for per-runtime inference timeout (ms). */
  timeoutFloorMs: number
  /** Prompt length (chars) above which chunked inference kicks in. */
  chunkThresholdChars: number
  /** Chunk size (chars) used by rag/chunker when chunking is active. */
  chunkSizeChars: number
  /** Max chars of request history sent to the model. */
  historyMaxChars: number
  /** Max request messages kept (before budget trimming). */
  historyMaxMessages: number
  /** Max agent tool-loop iterations per user turn. */
  maxToolLoopSteps: number
  /** Discrete context tiers for hardware-aware sizing (tokens). */
  contextTiers: number[]
  /** Fraction of usable VRAM/RAM we plan against (0.85 = 15% headroom). */
  memorySafetyMargin: number
  /** MB of KV cache per 1k tokens at 7B-class models (reference estimate). */
  kvMbPer1kTokens: number
  /** Reserved completion tokens subtracted from the context budget. */
  reservedCompletionTokens: number
  /** Sliding-window turns kept verbatim in budgeted history. */
  slidingWindowTurns: number
  /**
   * Hard ceiling for `max_tokens` sent to the runtime.
   * The orchestrator computes the actual value as:
   *   min(nCtx - promptEstimate - reservedCompletionTokens, maxCompletionTokensCap)
   * On RTX 3050 w/ 4GB VRAM a 7B Q4 model at 8k ctx:
   *   8192 - ~2000 prompt - 1200 reserved = ~5000 max output, capped at 8192.
   * Set lower (e.g. 4096) if long responses cause OOM or slow generation.
   */
  maxCompletionTokensCap: number
}

export const DEFAULT_TUNING: TuningConfig = {
  stallGuardMs: 150_000,
  timeoutFloorMs: 120_000,
  chunkThresholdChars: 9000,
  chunkSizeChars: 6000,
  historyMaxChars: 24_000,
  historyMaxMessages: 50,
  maxToolLoopSteps: 5,
  contextTiers: [...CONTEXT_TIERS],
  memorySafetyMargin: 0.85,
  kvMbPer1kTokens: 8,
  reservedCompletionTokens: 1200,
  slidingWindowTurns: 3,
  maxCompletionTokensCap: 8192,
}

const STORE_KEY = 'tuning'

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN
  if (Number.isNaN(n) || n < min) return fallback
  return Math.min(n, max)
}

/**
 * Load tuning with persisted partial overrides. Never throws — corrupt
 * overrides fall back to defaults per-key. tiers are sanitized to a
 * strictly-increasing integer list.
 */
export function loadTuning(getMeta: (key: string) => string | null): TuningConfig {
  const t: TuningConfig = { ...DEFAULT_TUNING, contextTiers: [...DEFAULT_TUNING.contextTiers] }
  try {
    const raw = getMeta(STORE_KEY)
    if (!raw) return t
    const o = JSON.parse(raw) as Record<string, unknown>
    t.stallGuardMs = clampInt(o['stallGuardMs'], 5_000, 600_000, t.stallGuardMs)
    t.timeoutFloorMs = clampInt(o['timeoutFloorMs'], 5_000, 600_000, t.timeoutFloorMs)
    t.chunkThresholdChars = clampInt(o['chunkThresholdChars'], 1_000, 1_000_000, t.chunkThresholdChars)
    t.chunkSizeChars = clampInt(o['chunkSizeChars'], 500, 200_000, t.chunkSizeChars)
    t.historyMaxChars = clampInt(o['historyMaxChars'], 1_000, 1_000_000, t.historyMaxChars)
    t.historyMaxMessages = clampInt(o['historyMaxMessages'], 2, 500, t.historyMaxMessages)
    t.maxToolLoopSteps = clampInt(o['maxToolLoopSteps'], 1, 40, t.maxToolLoopSteps)
    t.reservedCompletionTokens = clampInt(o['reservedCompletionTokens'], 0, 32_000, t.reservedCompletionTokens)
    t.slidingWindowTurns = clampInt(o['slidingWindowTurns'], 1, 50, t.slidingWindowTurns)
    t.maxCompletionTokensCap = clampInt(o['maxCompletionTokensCap'], 512, 131_072, t.maxCompletionTokensCap)
    if (typeof o['memorySafetyMargin'] === 'number' && o['memorySafetyMargin'] > 0.1 && o['memorySafetyMargin'] <= 1) {
      t.memorySafetyMargin = o['memorySafetyMargin']
    }
    if (typeof o['kvMbPer1kTokens'] === 'number' && o['kvMbPer1kTokens'] > 0 && o['kvMbPer1kTokens'] <= 100) {
      t.kvMbPer1kTokens = o['kvMbPer1kTokens']
    }
    if (Array.isArray(o['contextTiers'])) {
      const tiers = o['contextTiers']
        .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 256)
        .map((x) => Math.floor(x))
        .sort((a, b) => a - b)
      if (tiers.length > 0) t.contextTiers = tiers
    }
  } catch {
    // corrupt overrides → defaults (already applied)
  }
  return t
}

/**
 * Largest discrete context tier that fits `usableMb` at `mbPer1kTokens`
 * (test/main.js pickTierAtOrBelow, generalized to arbitrary tier lists).
 */
export function pickTierAtOrBelow(usableMb: number, mbPer1kTokens: number, tiers: readonly number[] = DEFAULT_TUNING.contextTiers): number {
  if (tiers.length === 0) return 1024
  const maxCtx = Math.floor((usableMb / mbPer1kTokens) * 1000)
  const eligible = tiers.filter((tier) => tier <= maxCtx)
  return eligible.length > 0 ? eligible[eligible.length - 1] : tiers[0]
}
