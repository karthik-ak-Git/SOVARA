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
  consumeSseBody,
  extractDelta,
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
    const body = {
      model: request.model,
      // Text-only messages stay plain strings; messages carrying vision parts
      // serialize to OpenAI content blocks. Text-only runtimes never receive
      // images — the orchestrator attaches them only for vision-capable picks.
      messages: request.messages.map((m) =>
        !m.images || m.images.length === 0
          ? { role: m.role, content: m.content }
          : {
            role: m.role,
            content: [
              ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
              ...m.images.map((img) => ({
                type: 'image_url' as const,
                image_url: { url: `data:${img.mime};base64,${img.base64}` },
              })),
            ],
          }
      ),
      stream: request.stream,
    }

    let opened: { res: Response; latencyMs: number }
    try {
      opened = await postLoopback(url, body, { timeoutMs: request.timeoutMs, signal: request.signal })
    } catch (e) {
      throw classifyChatError(e)
    }
    const { res } = opened
    try {
      checkStatus(res.status)
    } catch (e) {
      try {
        await res.body?.cancel()
      } catch {
        // ignore
      }
      throw e
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (request.stream && contentType.includes('text/event-stream')) {
      yield* this.yieldLive(res)
      return
    }
    // Server answered streaming with plain JSON (or caller asked
    // non-streaming): exactly one bounded read, honestly marked.
    let text: string
    try {
      text = await readBoundedBody(res)
    } catch (e) {
      throw classifyChatError(e)
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new ChatInferenceError('invalid-response', 'invalid-response: runtime did not return a chat reply')
    }
    const content = extractDelta(json)
    if (content === null || content === '') {
      throw new ChatInferenceError('invalid-response', 'invalid-response: reply carried no assistant text')
    }
    yield { type: 'text-delta', text: content }
    const usage = extractUsage(json)
    yield { type: 'done', note: 'non-stream-fallback', usage }
  }

  /**
   * Bridge callback-driven SSE delivery into progressive generator yields.
   * A deferred queue carries each delta to the drain loop as it arrives —
   * one POST, no buffering of the whole reply before display.
   */
  private async *yieldLive(res: Response): AsyncIterable<LlmChunk> {
    const queue: string[] = []
    let settled = false
    let failed: unknown = null
    let sseResult: { usage?: { promptTokens: number; completionTokens: number; totalTokens: number } } | undefined
    let wake: () => void = () => {}
    const notify = (): void => {
      const w = wake
      wake = () => {}
      w()
    }
    const pump = consumeSseBody(res, {
      onDelta: (t) => {
        queue.push(t)
        notify()
      },
    }).then(
      (result) => {
        sseResult = result
        settled = true
        notify()
      },
      (e: unknown) => {
        settled = true
        failed = e
        notify()
      }
    )
    // Avoid an unhandled rejection while the drain loop is parked.
    pump.catch(() => {})
    try {
      for (;;) {
        while (queue.length > 0) {
          const text = queue.shift()
          if (text !== undefined) yield { type: 'text-delta', text }
        }
        if (settled) break
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      await pump
    } catch (e) {
      throw classifyChatError(failed ?? e)
    }
    if (failed) throw classifyChatError(failed)
    yield { type: 'done', usage: sseResult?.usage }
  }
}
