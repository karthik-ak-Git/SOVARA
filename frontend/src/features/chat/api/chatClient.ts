/**
 * SSE chat streaming client. Owns every byte of the /chat HTTP exchange:
 * request marshalling, SSE parsing, error-kind mapping, abort propagation.
 * UI code (hooks/components) never touches fetch or Response bodies.
 */

import { apiBase, CHAT_PATH } from "../../../api/client";
import type { ChatEvent, ChatMessageIn } from "../../../api/types";
import type { ChatErrorKind } from "../types";

export class ChatStreamError extends Error {
  readonly kind: ChatErrorKind;
  readonly status?: number;

  constructor(kind: ChatErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ChatStreamError";
    this.kind = kind;
    this.status = status;
  }
}

export interface StreamCallbacks {
  signal: AbortSignal;
  onToken: (delta: string) => void;
}

export interface StreamResult {
  modelId: string;
  finishReason: string;
}

function parseEvent(line: string): ChatEvent | null {
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice("data: ".length)) as ChatEvent;
  } catch {
    return null; // robust stream: skip malformed lines, like the backend does
  }
}

function envelopeMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error: { message?: unknown } }).error;
    if (typeof err.message === "string" && err.message.length > 0) return err.message;
  }
  return fallback;
}

function envelopeCode(body: unknown): string | null {
  if (typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error: { code?: unknown } }).error;
    if (typeof err.code === "string") return err.code;
  }
  return null;
}

/**
 * POST the turn, stream SSE tokens via onToken, resolve on `done`.
 * Rejects with ChatStreamError; AbortError from `signal` maps to `cancelled`.
 */
export async function streamChat(
  messages: ChatMessageIn[],
  callbacks: StreamCallbacks,
  modelId?: string,
): Promise<StreamResult> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${CHAT_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(
        modelId === undefined ? { messages } : { model_id: modelId, messages },
      ),
      signal: callbacks.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ChatStreamError("cancelled", "Generation stopped");
    }
    throw new ChatStreamError("connection", "Cannot reach the SOVARA backend");
  }

  if (!res.ok || res.body === null) {
    const body = (await res.json().catch(() => null)) as unknown;
    if (res.status === 422) {
      throw new ChatStreamError(
        "validation",
        envelopeMessage(body, "Request validation failed"),
        res.status,
      );
    }
    if (res.status === 502 && envelopeCode(body) === "model_error") {
      throw new ChatStreamError(
        "model_unavailable",
        envelopeMessage(body, "Local model is unavailable"),
        res.status,
      );
    }
    throw new ChatStreamError(
      "generation",
      envelopeMessage(body, `Chat request failed (${res.status})`),
      res.status,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        for (const line of block.split("\n")) {
          const event = parseEvent(line.trim());
          if (event === null) continue;
          if (event.type === "token") callbacks.onToken(event.delta);
          else if (event.type === "done") {
            return { modelId: event.model_id, finishReason: event.finish_reason };
          } else {
            throw new ChatStreamError("generation", event.message);
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ChatStreamError("cancelled", "Generation stopped");
    }
    if (err instanceof ChatStreamError) throw err;
    throw new ChatStreamError("connection", "Stream interrupted");
  } finally {
    reader.releaseLock();
  }
  throw new ChatStreamError("generation", "Stream ended without completion");
}
