/**
 * useChat — the single owner of chat runtime state.
 *
 * Separates generation state (status, abort, streaming buffer) from stored
 * conversation state (messages list, owned by the caller via onMessages).
 * The streamer is injectable so tests drive the hook without HTTP.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat } from "../api/chatClient";
import type { ChatMessageIn } from "../../../api/types";
import type { AssistantRole, ChatError, ChatStatus, UiMessage } from "../types";
import { uid } from "../lib/store";

export type StreamFn = (
  messages: ChatMessageIn[],
  callbacks: { signal: AbortSignal; onToken: (delta: string) => void },
  modelId?: string,
) => Promise<{ modelId: string; finishReason: string }>;

interface UseChatOptions {
  stream?: StreamFn;
  modelId?: string;
}

interface UseChatResult {
  status: ChatStatus;
  error: ChatError | null;
  streamingId: string | null;
  send: (messages: UiMessage[], content: string) => void;
  stop: () => void;
  retry: (messages: UiMessage[]) => void;
  regenerate: (messages: UiMessage[]) => void;
}

function toApiMessages(messages: UiMessage[]): ChatMessageIn[] {
  return messages.map((m) => ({ role: m.role as ChatMessageIn["role"], content: m.content }));
}

/** Drop a trailing empty assistant message (left by stop/error) before resend. */
function prunable(messages: UiMessage[]): UiMessage[] {
  const last = messages[messages.length - 1];
  if (last !== undefined && last.role === "assistant" && last.content === "") {
    return messages.slice(0, -1);
  }
  return messages;
}

export function useChat(
  onMessages: (messages: UiMessage[]) => void,
  options: UseChatOptions = {},
): UseChatResult {
  const { stream = streamChat, modelId } = options;
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [error, setError] = useState<ChatError | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onMessagesRef = useRef(onMessages);
  onMessagesRef.current = onMessages;

  useEffect(() => {
    return () => {
      abortRef.current?.abort(); // never leak a stream on unmount
    };
  }, []);

  const run = useCallback(
    (base: UiMessage[], historyForApi: ChatMessageIn[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const assistantId = uid();
      setStreamingId(assistantId);
      setStatus("streaming");
      setError(null);
      let buffer = "";
      const withPlaceholder: UiMessage[] = [
        ...base,
        { id: assistantId, role: "assistant" as AssistantRole, content: "" },
      ];
      onMessagesRef.current(withPlaceholder);

      void stream(historyForApi, {
        signal: controller.signal,
        onToken: (delta: string) => {
          buffer += delta;
          const snapshot = buffer;
          onMessagesRef.current(
            withPlaceholder.map((m) =>
              m.id === assistantId ? { ...m, content: snapshot } : m,
            ),
          );
        },
      }, modelId).then(
        () => {
          setStatus("idle");
          setStreamingId(null);
          abortRef.current = null;
        },
        (err: unknown) => {
          const kind =
            err !== null && typeof err === "object" && "kind" in err
              ? (err as { kind: ChatError["kind"] }).kind
              : "generation";
          const message =
            err instanceof Error ? err.message : "Generation failed";
          if (kind === "cancelled") {
            setStatus("idle"); // keep partial content, no error banner
          } else {
            setStatus("error");
            setError({ kind, message });
          }
          setStreamingId(null);
          abortRef.current = null;
        },
      );
    },
    [stream, modelId],
  );

  const send = useCallback(
    (messages: UiMessage[], content: string) => {
      const trimmed = content.trim();
      if (trimmed === "" || status === "streaming") return;
      const next: UiMessage[] = [
        ...prunable(messages),
        { id: uid(), role: "user" as AssistantRole, content: trimmed },
      ];
      run(next, toApiMessages(next));
    },
    [run, status],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const retry = useCallback(
    (messages: UiMessage[]) => {
      if (status === "streaming") return;
      const base = prunable(messages);
      if (base.length === 0) return;
      run(base, toApiMessages(base));
    },
    [run, status],
  );

  const regenerate = useCallback(
    (messages: UiMessage[]) => {
      if (status === "streaming") return;
      // Drop the last assistant answer, keep the user turn, generate again.
      const base = prunable(messages);
      const last = base[base.length - 1];
      const trimmed =
        last !== undefined && last.role === "assistant" ? base.slice(0, -1) : base;
      if (trimmed.length === 0) return;
      run(trimmed, toApiMessages(trimmed));
    },
    [run, status],
  );

  return { status, error, streamingId, send, stop, retry, regenerate };
}
