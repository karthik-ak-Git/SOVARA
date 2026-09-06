import type { LlmChunk, LlmPort } from '@shared/types/ports'

export class LlmStubAdapter implements LlmPort {
  async *stream(_prompt: string): AsyncIterable<LlmChunk> {
    yield { type: 'text-delta', text: '[Phase 1 stub — no LLM wired]' }
    yield { type: 'done' }
  }
}
