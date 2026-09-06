import type { LlmChunk, LlmPort } from '@shared/types/ports'

/**
 * Commit 5 — deterministic Phase 1 mock assistant.
 * - Local only, zero network, zero model runtime.
 * - Deterministic: pure function of the prompt (length + first 120 chars).
 * - Clearly labelled as a stub; never pretends to be a real model.
 */
export function buildMockAssistantText(prompt: string): string {
  const clean = (prompt ?? '').slice(0, 32_000)
  const snippet = clean.slice(0, 120)
  return `[Phase 1 mock assistant — no model wired] You sent ${clean.length} chars: "${snippet}"`
}

export class LlmStubAdapter implements LlmPort {
  async *stream(prompt: string): AsyncIterable<LlmChunk> {
    yield { type: 'text-delta', text: buildMockAssistantText(prompt ?? '') }
    yield { type: 'done' }
  }
}
