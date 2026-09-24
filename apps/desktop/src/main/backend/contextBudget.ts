/**
 * SOVARA Context Budget — adapted from llm_wiki's context-budget.ts
 * Original: test/llm_wiki/src/lib/context-budget.ts (MIT)
 * 
 * Pure budget allocator for chat context assembly.
 * Given an LLM's maxContextSize (in tokens), compute per-section budgets.
 * 
 * llm_wiki shape (chars):
 *   maxCtx 100% → idx 5% | pages 50% | history+sys ~30% | resp 15%
 * SOVARA adaptation (tokens):
 *   maxCtx 100% → system 10% | index/workspace 5% | pages/files 50% | history 20% | response 15%
 * 
 * Why separate module:
 * - Math has corner cases (tiny 4K, huge 1M, legacy caps)
 * - Testable in isolation, not inlined in AgentOrchestrator
 */

export interface ContextBudget {
  /** Full context window in tokens */
  maxCtx: number
  /** Tokens reserved for LLM response */
  responseReserve: number
  /** System prompt budget (SOVARA prompt + workspace context) */
  systemBudget: number
  /** Workspace/index summary budget (~5%) */
  indexBudget: number
  /** Total tokens for retrieved workspace files / wiki pages */
  pageBudget: number
  /** Chat history budget (~20%) */
  historyBudget: number
  /** Per-file truncation cap */
  maxPageSize: number
  /** Per-file cap in chars (for file content) */
  maxPageSizeChars: number
}

const DEFAULT_MAX_CTX = 12288
const RESPONSE_RESERVE_FRAC = 0.15
const SYSTEM_BUDGET_FRAC = 0.10
const INDEX_BUDGET_FRAC = 0.05
const PAGE_BUDGET_FRAC = 0.50
const HISTORY_BUDGET_FRAC = 0.20
const PER_PAGE_FRAC = 0.30
const PER_PAGE_FLOOR_TOKENS = 1200 // ~5K chars

/**
 * Compute token budgets from max context window.
 * Falsy maxContextSize falls back to DEFAULT_MAX_CTX (12288) so existing configs don't break.
 * Supports 4K → 1M range as in llm_wiki.
 */
export function computeContextBudget(maxContextSize?: number): ContextBudget {
  const maxCtx =
    typeof maxContextSize === 'number' && maxContextSize > 0 && Number.isFinite(maxContextSize)
      ? Math.floor(maxContextSize)
      : DEFAULT_MAX_CTX

  const responseReserve = Math.floor(maxCtx * RESPONSE_RESERVE_FRAC)
  const systemBudget = Math.floor(maxCtx * SYSTEM_BUDGET_FRAC)
  const indexBudget = Math.floor(maxCtx * INDEX_BUDGET_FRAC)
  const pageBudget = Math.floor(maxCtx * PAGE_BUDGET_FRAC)
  const historyBudget = Math.floor(maxCtx * HISTORY_BUDGET_FRAC)

  const maxPageSize = Math.min(
    pageBudget,
    Math.max(PER_PAGE_FLOOR_TOKENS, Math.floor(pageBudget * PER_PAGE_FRAC)),
  )

  return {
    maxCtx,
    responseReserve,
    systemBudget,
    indexBudget,
    pageBudget,
    historyBudget,
    maxPageSize,
    maxPageSizeChars: maxPageSize * 4, // heuristic 1 token ≈ 4 chars
  }
}

/**
 * Budget-aware history truncation — keeps recent turns verbatim, summarizes older.
 * Mirrors llm_wiki's proportional allocation but for chat history.
 */
export function budgetHistory(
  messages: Array<{ role: string; content: string }>,
  historyBudgetTokens: number,
): Array<{ role: string; content: string }> {
  const historyBudgetChars = historyBudgetTokens * 4
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0)
  if (totalChars <= historyBudgetChars) return messages

  // Keep most recent messages that fit, summarize the rest
  const recent: typeof messages = []
  let chars = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (chars + msg.content.length > historyBudgetChars && recent.length > 0) break
    recent.unshift(msg)
    chars += msg.content.length
  }

  const olderCount = messages.length - recent.length
  if (olderCount <= 0) return recent

  const summary = `[Earlier conversation: ${olderCount} messages summarized, ${messages.length} total → ${recent.length} recent kept verbatim]`
  return [{ role: 'user', content: summary }, ...recent]
}

/**
 * Per-file budget check — single file won't exceed maxPageSize
 */
export function truncateFileToBudget(content: string, maxPageSizeChars: number): string {
  if (content.length <= maxPageSizeChars) return content
  return content.slice(0, maxPageSizeChars - 100) + '\n\n[...truncated for budget: file exceeds per-page cap]'
}
