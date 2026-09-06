/** chatClient tests: SSE parsing + error-kind mapping (mocked fetch). */

import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatStreamError, streamChat } from "./chatClient";

function sseResponse(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function sseEvent(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamChat", () => {
  it("streams tokens and resolves on done", async () => {
    const body =
      sseEvent({ type: "token", delta: "Hello " }) +
      "not-an-event\n\n" +
      sseEvent({ type: "token", delta: "world" }) +
      sseEvent({ type: "done", model_id: "m", finish_reason: "stop" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(body)));
    const seen: string[] = [];
    const result = await streamChat(
      [{ role: "user", content: "hi" }],
      { signal: new AbortController().signal, onToken: (d) => seen.push(d) },
    );
    expect(seen).toEqual(["Hello ", "world"]);
    expect(result).toEqual({ modelId: "m", finishReason: "stop" });
  });

  it("maps 502 model_error to model_unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: { code: "model_error", message: "down" } }),
          { status: 502 },
        ),
      ),
    );
    await expect(
      streamChat([{ role: "user", content: "hi" }], {
        signal: new AbortController().signal,
        onToken: () => undefined,
      }),
    ).rejects.toMatchObject({ kind: "model_unavailable" });
  });

  it("maps 422 to validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 422 })),
    );
    await expect(
      streamChat([{ role: "user", content: "hi" }], {
        signal: new AbortController().signal,
        onToken: () => undefined,
      }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("maps mid-stream error events to generation", async () => {
    const body =
      sseEvent({ type: "token", delta: "partial " }) +
      sseEvent({ type: "error", code: "model_error", message: "boom" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(body)));
    const seen: string[] = [];
    await expect(
      streamChat([{ role: "user", content: "hi" }], {
        signal: new AbortController().signal,
        onToken: (d) => seen.push(d),
      }),
    ).rejects.toMatchObject({ kind: "generation", message: "boom" });
    expect(seen).toEqual(["partial "]); // partial output preserved
  });

  it("maps abort to cancelled", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener("abort", () => {
          throw new DOMException("aborted", "AbortError");
        });
        return new Promise((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(new DOMException("aborted", "AbortError")),
          );
        });
      }),
    );
    const pending = streamChat([{ role: "user", content: "hi" }], {
      signal: controller.signal,
      onToken: () => undefined,
    });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(ChatStreamError);
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("rejects when the stream ends without done", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse("")));
    await expect(
      streamChat([{ role: "user", content: "hi" }], {
        signal: new AbortController().signal,
        onToken: () => undefined,
      }),
    ).rejects.toMatchObject({ kind: "generation" });
  });
});
