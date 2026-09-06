/** useChat tests: send/stream/stop/retry/regenerate via injected streamer. */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatStreamError } from "../api/chatClient";
import type { StreamFn } from "./useChat";
import { useChat } from "./useChat";
import type { UiMessage } from "../types";

function msg(role: "user" | "assistant", content: string, id = role): UiMessage {
  return { id: `${id}-${content.length}`, role, content };
}

/** Streamer that emits two tokens, then completes. */
function scriptedStream(deltas: string[] = ["Hello ", "world"]): StreamFn {
  return async (_messages, { onToken }) => {
    for (const d of deltas) onToken(d);
    return { modelId: "m", finishReason: "stop" };
  };
}

/** Streamer that hangs until aborted, then rejects as cancelled. */
function hangingStream(): StreamFn {
  return (_messages, { signal }) =>
    new Promise((_res, rej) => {
      signal.addEventListener("abort", () =>
        rej(new ChatStreamError("cancelled", "stopped")),
      );
    });
}

describe("useChat", () => {
  it("sends a message and streams the assistant reply", async () => {
    const seen: UiMessage[][] = [];
    const { result } = renderHook(() =>
      useChat((m) => seen.push(m), { stream: scriptedStream() }),
    );
    act(() => result.current.send([], "Hi SOVARA"));
    expect(result.current.status).toBe("streaming");
    await waitFor(() => expect(result.current.status).toBe("idle"));
    const last = seen[seen.length - 1];
    expect(last[0]).toMatchObject({ role: "user", content: "Hi SOVARA" });
    expect(last[1]).toMatchObject({ role: "assistant", content: "Hello world" });
    expect(seen.length).toBeGreaterThan(2); // progressive updates, not one blob
  });

  it("ignores empty sends and sends while streaming", () => {
    const onMessages = vi.fn();
    const { result } = renderHook(() =>
      useChat(onMessages, { stream: hangingStream() }),
    );
    act(() => result.current.send([], "   "));
    expect(onMessages).not.toHaveBeenCalled();
    act(() => result.current.send([], "first"));
    expect(result.current.status).toBe("streaming");
    act(() => result.current.send([], "second"));
    expect(onMessages).toHaveBeenCalledTimes(1); // second send ignored
  });

  it("stop aborts and keeps partial content without error", async () => {
    const seen: UiMessage[][] = [];
    const { result } = renderHook(() =>
      useChat((m) => seen.push(m), { stream: hangingStream() }),
    );
    act(() => result.current.send([], "long task"));
    expect(result.current.status).toBe("streaming");
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.error).toBeNull();
    const last = seen[seen.length - 1];
    expect(last).toHaveLength(2); // user + (empty) assistant placeholder kept
    expect(last[1].content).toBe("");
  });

  it("surfaces generation errors, retry then succeeds", async () => {
    let calls = 0;
    const flaky: StreamFn = async (_messages, { onToken }) => {
      calls += 1;
      if (calls === 1) throw new ChatStreamError("generation", "boom");
      onToken("recovered");
      return { modelId: "m", finishReason: "stop" };
    };
    const seen: UiMessage[][] = [];
    const { result } = renderHook(() =>
      useChat((m) => seen.push(m), { stream: flaky }),
    );
    act(() => result.current.send([], "go"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatchObject({ kind: "generation" });
    act(() => result.current.retry(seen[seen.length - 1]));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    const last = seen[seen.length - 1];
    expect(last[0]).toMatchObject({ role: "user", content: "go" });
    expect(last[last.length - 1].content).toBe("recovered");
  });

  it("regenerate drops the last assistant answer", async () => {
    const seen: UiMessage[][] = [];
    const received: string[][] = [];
    const capture: StreamFn = async (messages, { onToken }) => {
      received.push(messages.map((m) => m.content));
      onToken("new");
      return { modelId: "m", finishReason: "stop" };
    };
    const { result } = renderHook(() =>
      useChat((m) => seen.push(m), { stream: capture }),
    );
    const history = [msg("user", "q"), msg("assistant", "old answer")];
    act(() => result.current.regenerate(history));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(received[0]).toEqual(["q"]); // old answer not resent
    const last = seen[seen.length - 1];
    expect(last[last.length - 1].content).toBe("new");
  });
});
