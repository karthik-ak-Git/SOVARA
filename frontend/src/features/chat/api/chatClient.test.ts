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

  it("sends the selected model id in the request body", async () => {
    const body =
      sseEvent({ type: "token", delta: "hi" }) +
      sseEvent({ type: "done", model_id: "model-b", finish_reason: "stop" });
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(body));
    vi.stubGlobal("fetch", fetchMock);
    const result = await streamChat(
      [{ role: "user", content: "hi" }],
      { signal: new AbortController().signal, onToken: () => undefined },
      "model-b",
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(init?.body as string)).toMatchObject({ model_id: "model-b" });
    expect(result).toEqual({ modelId: "model-b", finishReason: "stop" });
  });

  it("omits model_id when no model is selected (server default applies)", async () => {
    const body = sseEvent({ type: "done", model_id: "model-a", finish_reason: "stop" });
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(body));
    vi.stubGlobal("fetch", fetchMock);
    await streamChat([{ role: "user", content: "hi" }], {
      signal: new AbortController().signal,
      onToken: () => undefined,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(init?.body as string)).not.toHaveProperty("model_id");
  });

  it("sends selection_mode auto and returns routing metadata", async () => {
    const routing = {
      auto: true,
      task_type: "coding",
      selected_model_id: "model-b",
      reason_codes: ["coding_capability"],
      decision_source: "deterministic_router",
    };
    const body =
      sseEvent({ type: "token", delta: "hi" }) +
      sseEvent({ type: "done", model_id: "model-b", finish_reason: "stop", routing });
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(body));
    vi.stubGlobal("fetch", fetchMock);
    const result = await streamChat(
      [{ role: "user", content: "hi" }],
      { signal: new AbortController().signal, onToken: () => undefined },
      undefined,
      "auto",
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(init?.body as string)).toMatchObject({ selection_mode: "auto" });
    expect(result.routing).toMatchObject({ auto: true, task_type: "coding" });
  });
});
