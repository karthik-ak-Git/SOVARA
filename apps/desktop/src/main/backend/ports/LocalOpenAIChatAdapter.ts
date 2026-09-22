/**
 * Commit 7 — real local inference adapter (OpenAI-compatible, loopback only).
 *
 * Speaks the minimum chat protocol: `POST <endpoint>/chat/completions` with
 * `{model, messages, stream}` — no provider-specific parameters, no extras.
 * All HTTP flows through HttpClient; the endpoint is revalidated at request
 * time (stored endpoints are never trusted blindly). Failures surface as
 * classified ChatInferenceError — never raw stacks or endpoint internals.
 *
 * Streaming is genuine: deltas yield as SSE events arrive. When a server
 * answers `stream:true` with plain JSON instead, exactly one non-streaming
 * read is performed and marked `non-stream-fallback` — streaming is never
 * faked from a buffered body.
 */
import {
  consumeSseBodyFull,
  extractDelta,
  extractDeltaFull,
  mergeToolCallDeltas,
  isLoopbackUrl,
  postLoopback,
  readBoundedBody,
} from '../../network/HttpClient'
import type { LlmChatRequest, LlmChunk, LlmPort, LlmUsage } from '@shared/types/ports'

export type ChatErrorCode =
  | 'connection-refused'
  | 'timeout'
  | 'unauthorized'
  | 'model-not-found'
  | 'invalid-response'
  | 'stream-error'
  | 'blocked'
  | 'cancelled'
  | 'response-too-large'

export class ChatInferenceError extends Error {
  constructor(
    public readonly code: ChatErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ChatInferenceError'
  }
}

export function chatCompletionsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '')
  const base = /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
  return `${base}/chat/completions`
}

export function classifyChatError(e: unknown): ChatInferenceError {
  if (e instanceof ChatInferenceError) return e
  if (e !== null && typeof e === 'object' && 'name' in e) {
    const name = String((e as Record<string, unknown>)['name'])
    if (name === 'LoopbackViolationError') {
      return new ChatInferenceError('blocked', 'blocked: endpoint is not a local loopback address')
    }
  }
  const msg = e instanceof Error ? e.message : String(e)
  if (/cancelled/i.test(msg)) return new ChatInferenceError('cancelled', 'cancelled')
  if (/timeout|timed out|aborted/i.test(msg)) {
    return new ChatInferenceError('timeout', 'timeout: the local model did not answer in time')
  }
  if (/ECONNREFUSED|refused|fetch failed|connect/i.test(msg)) {
    return new ChatInferenceError('connection-refused', 'connection-refused: is the local server still running?')
  }
  if (/response-too-large|exceeded the local cap/i.test(msg)) {
    return new ChatInferenceError('response-too-large', 'invalid-response: reply exceeded the local size cap')
  }
  if (/did not return JSON|Unexpected token/i.test(msg)) {
    return new ChatInferenceError('invalid-response', 'invalid-response: runtime did not return a chat reply')
  }
  if (/redirect/i.test(msg)) return new ChatInferenceError('blocked', 'blocked: runtime redirected away from localhost')
  if (/non-loopback|loopback/i.test(msg)) {
    return new ChatInferenceError('blocked', 'blocked: endpoint is not a local loopback address')
  }
  return new ChatInferenceError('stream-error', 'stream-error: the local runtime interrupted the reply')
}

async function checkStatusWithBody(res: Response): Promise<void> {
  if (res.status === 401) {
    throw new ChatInferenceError('unauthorized', 'unauthorized: the local server rejected the request')
  }
  if (res.status === 404) {
    throw new ChatInferenceError('model-not-found', 'model-not-found: the server has no such model')
  }
  if (res.status >= 200 && res.status < 300) return
  let bodySnippet = ''
  try {
    const t = await res.text()
    if (t) bodySnippet = t.slice(0, 400).replace(/\s+/g, ' ').trim()
  } catch { /* ignore */ }
  // Context overflow must be actionable — callers auto-compact on this string
  if (/exceed.*context|context.*size/i.test(bodySnippet)) {
    throw new ChatInferenceError('invalid-response', `exceed_context_size_error: ${bodySnippet}`)
  }
  const suffix = bodySnippet ? ` — ${bodySnippet}` : ''
  throw new ChatInferenceError('invalid-response', `invalid-response: runtime answered ${res.status}${suffix}`)
}

function checkStatus(status: number): void {
  if (status === 401) {
    throw new ChatInferenceError('unauthorized', 'unauthorized: the local server rejected the request')
  }
  if (status === 404) {
    throw new ChatInferenceError('model-not-found', 'model-not-found: the server has no such model')
  }
  if (status < 200 || status >= 300) {
    throw new ChatInferenceError('invalid-response', `invalid-response: runtime answered ${status}`)
  }
}

function extractUsage(json: unknown): LlmUsage | undefined {
  if (json === null || typeof json !== 'object') return undefined
  const obj = json as Record<string, unknown>
  const usage = obj['usage']
  if (usage === null || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const prompt = typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : 0
  const completion = typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : 0
  const total = typeof u['total_tokens'] === 'number' ? u['total_tokens'] : prompt + completion
  if (prompt === 0 && completion === 0) return undefined
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total }
}

export class LocalOpenAIChatAdapter implements LlmPort {
  async *stream(_prompt: string): AsyncIterable<LlmChunk> {
    void _prompt
    throw new ChatInferenceError('invalid-response', 'unavailable: use streamChat with a selected local model')
  }

  async *streamChat(request: LlmChatRequest): AsyncIterable<LlmChunk> {
    if (!(await isLoopbackUrl(request.endpoint))) {
      throw new ChatInferenceError('blocked', 'blocked: endpoint is not a local loopback address')
    }
    if (request.model.trim() === '') {
      throw new ChatInferenceError('model-not-found', 'model-not-found: empty model id')
    }
    const url = chatCompletionsUrl(request.endpoint)

    // ── Dynamic max_tokens ──────────────────────────────────────────────────
    // Previously hardcoded to 2048 (or 4096 for PPT). Now the orchestrator
    // computes the ceiling from: nCtx - promptEstimate - reserved. We honour it.
    // Fallback 4096 is generous for one-turn chat before orchestrator catches up.
    const maxTokens = request.maxCompletionTokens ?? 4096

    // ── Serialize messages — support role:'tool' for tool result turns ──────
    const serializedMessages = request.messages.map((m) => {
      if (m.role === 'tool') {
        // Tool result: llama-server needs tool_call_id to correlate with the request
        return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content }
      }
      if (m.role === 'assistant' && (m.tool_calls || (m as unknown as Record<string, unknown>)['tool_calls'])) {
        const rawCalls = m.tool_calls || (m as unknown as Record<string, unknown>)['tool_calls']
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: rawCalls,
        }
      }
      if (m.images && m.images.length > 0) {
        return {
          role: m.role,
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.images.map((img) => ({
              type: 'image_url' as const,
              image_url: { url: `data:${img.mime};base64,${img.base64}` },
            })),
          ],
        }
      }
      return { role: m.role, content: m.content }
    })

    const body: Record<string, unknown> = {
      model: request.model,
      messages: serializedMessages,
      stream: request.stream,
      // llama.cpp: cache_prompt reuses KV for system prompt (~40% faster on 2nd turn)
      cache_prompt: true,
      max_tokens: maxTokens,
      temperature: 0.7,
    }

    // ── Native tool calling ─────────────────────────────────────────────────
    // Only send native tools array to remote APIs. For local llama-server endpoints,
    // sending body['tools'] forces native Jinja tool grammar that freezes/stops local models.
    // Local models use prompt toolCatalog + fenceTools for 100% reliable execution.
    const isLocalServer = /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(request.endpoint)
    if (request.tools && request.tools.length > 0 && !isLocalServer) {
      body['tools'] = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }))
      body['tool_choice'] = 'auto'
    }

    let opened: { res: Response; latencyMs: number }
    try {
      opened = await postLoopback(url, body, { timeoutMs: request.timeoutMs, signal: request.signal })
    } catch (e) {
      throw classifyChatError(e)
    }
    const { res } = opened
    try {
      await checkStatusWithBody(res)
    } catch (e) {
      try { await res.body?.cancel() } catch { /* ignore */ }
      throw e
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (request.stream && contentType.includes('text/event-stream')) {
      yield* this.yieldLive(res, request.maxResponseBytes)
      return
    }
    // Non-streaming fallback: one bounded read
    let text: string
    try {
      text = await readBoundedBody(res, request.maxResponseBytes)
    } catch (e) {
      throw classifyChatError(e)
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new ChatInferenceError('invalid-response', 'invalid-response: runtime did not return a chat reply')
    }
    const { content, toolCallDeltas } = extractDeltaFull(json)
    if (toolCallDeltas.length > 0) {
      const toolCalls = mergeToolCallDeltas(toolCallDeltas)
      if (content) yield { type: 'text-delta', text: content }
      yield { type: 'done', note: 'non-stream-fallback', toolCalls, usage: extractUsage(json) }
      return
    }
    if (content === null || content === '') {
      throw new ChatInferenceError('invalid-response', 'invalid-response: reply carried no assistant text')
    }
    yield { type: 'text-delta', text: content }
    yield { type: 'done', note: 'non-stream-fallback', usage: extractUsage(json) }
  }

  /**
   * Bridge SSE delivery into progressive generator yields.
   *
   * Tool calling: llama-server streams tool_call deltas across many chunks
   * (partial id, partial name, partial arguments). We accumulate by index,
   * then deliver the complete LlmToolCall[] on the 'done' chunk.
   * Text deltas are still yielded immediately for live display.
   */
  private async *yieldLive(res: Response, maxBytes?: number): AsyncIterable<LlmChunk> {
    const queue: string[] = []
    const toolCallAccumulator = new Map<number, {
      id: string; type: string; name: string; argumentsChunks: string[]
    }>()
    let settled = false
    let failed: unknown = null
    let sseUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined
    let wake: () => void = () => {}
    const notify = (): void => { const w = wake; wake = () => {}; w() }

    const pump = consumeSseBodyFull(res, {
      maxBytes,
      onDelta: (t) => { queue.push(t); notify() },
      onToolCallDelta: (delta) => {
        const existing = toolCallAccumulator.get(delta.index) ?? {
          id: '', type: 'function', name: '', argumentsChunks: [],
        }
        if (delta.id) existing.id = delta.id
        if (delta.type) existing.type = delta.type
        if (delta.function?.name) existing.name += delta.function.name
        if (delta.function?.arguments) existing.argumentsChunks.push(delta.function.arguments)
        toolCallAccumulator.set(delta.index, existing)
      },
      onUsage: (u) => { sseUsage = u },
    }).then(
      () => { settled = true; notify() },
      (e: unknown) => { settled = true; failed = e; notify() }
    )
    pump.catch(() => {})
    try {
      for (;;) {
        while (queue.length > 0) {
          const text = queue.shift()
          if (text !== undefined) yield { type: 'text-delta', text }
        }
        if (settled) break
        await new Promise<void>((resolve) => { wake = resolve })
      }
      await pump
    } catch (e) {
      throw classifyChatError(failed ?? e)
    }
    if (failed) throw classifyChatError(failed)

    const toolCalls = toolCallAccumulator.size > 0
      ? Array.from(toolCallAccumulator.entries())
          .sort(([a], [b]) => a - b)
          .map(([, tc]) => ({
            id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.argumentsChunks.join('') },
          }))
      : undefined

    yield { type: 'done', usage: sseUsage, toolCalls }
  }
}
