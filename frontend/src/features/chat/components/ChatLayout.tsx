import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { useChat } from "../hooks/useChat";
import {
  createConversation,
  deleteConversation,
  listConversations,
  retitleFromFirstUserMessage,
  saveConversation,
} from "../lib/store";
import type { Conversation, UiMessage } from "../types";
import { Composer } from "./Composer";
import { GenerationControls } from "./GenerationControls";
import { MessageList } from "./MessageList";
import { Sidebar } from "./Sidebar";

interface ChatLayoutProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

/**
 * Chat screen composition. Owns conversation state (localStorage-backed);
 * generation state lives in useChat. Metadata (model/status) is plain
 * useEffect fetches — no query library for two read-only calls.
 */
export function ChatLayout({ theme, onToggleTheme }: ChatLayoutProps): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    listConversations(),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => listConversations()[0]?.id ?? null,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [modelAvailable, setModelAvailable] = useState(false);
  const [localOnly, setLocalOnly] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .models()
      .then((m) => {
        if (!alive) return;
        const first = m.items[0];
        setModelId(first?.model_id ?? null);
        setModelAvailable(first?.available ?? false);
      })
      .catch(() => {
        if (alive) setModelAvailable(false);
      });
    api
      .status()
      .then((s) => {
        if (alive) setLocalOnly(s.network.local_only);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const activeIdRef = useRef<string | null>(listConversations()[0]?.id ?? null);
  const setActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const active: Conversation | undefined = conversations.find((c) => c.id === activeId);
  const messages: UiMessage[] = active?.messages ?? [];

  const persist = useCallback((next: UiMessage[]) => {
    const id = activeIdRef.current;
    setConversations((prev) => {
      const current = prev.find((c) => c.id === id);
      if (current === undefined) return prev;
      let updated: Conversation = { ...current, messages: next };
      if (current.title === "New chat") updated = retitleFromFirstUserMessage(updated);
      saveConversation(updated);
      return prev.map((c) => (c.id === updated.id ? updated : c));
    });
  }, []);

  const chat = useChat(persist, { modelId: modelId ?? undefined });

  const handleNewChat = useCallback(() => {
    const convo = createConversation();
    setConversations(listConversations());
    setActive(convo.id);
  }, [setActive]);

  const handleSelect = useCallback(
    (id: string) => {
      if (chat.status === "streaming") chat.stop();
      setActive(id);
    },
    [chat, setActive],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (chat.status === "streaming" && id === activeId) chat.stop();
      deleteConversation(id);
      const rest = listConversations();
      setConversations(rest);
      if (id === activeId) setActive(rest[0]?.id ?? null);
    },
    [chat, activeId, setActive],
  );

  const handleSend = useCallback(
    (content: string) => {
      let id = activeIdRef.current;
      if (id === null) {
        const convo = createConversation(content);
        setConversations(listConversations());
        setActive(convo.id);
        id = convo.id;
      }
      const current = conversations.find((c) => c.id === id)?.messages ?? [];
      chat.send(current, content);
    },
    [conversations, chat, setActive],
  );

  const composerDisabled = !modelAvailable;

  return (
    <div className="sv-app">
      <Sidebar
        collapsed={collapsed}
        conversations={conversations}
        activeId={activeId}
        modelId={modelId}
        modelAvailable={modelAvailable}
        localOnly={localOnly}
        onToggle={() => setCollapsed((c) => !c)}
        onNewChat={handleNewChat}
        onSelect={handleSelect}
        onDelete={handleDelete}
      />
      <main className="sv-main">
        <header className="sv-header">
          <span className="sv-header-title">
            {active?.title ?? "New chat"}
          </span>
          <button
            type="button"
            className="sv-icon-btn"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? "☾" : "☀"}
          </button>
        </header>
        <MessageList messages={messages} streamingId={chat.streamingId} />
        <div className="sv-bottom">
          <GenerationControls
            status={chat.status}
            error={chat.error}
            messages={messages}
            onStop={chat.stop}
            onRetry={() => chat.retry(messages)}
            onRegenerate={() => chat.regenerate(messages)}
          />
          <Composer
            status={chat.status}
            disabled={composerDisabled}
            disabledReason={
              composerDisabled
                ? "Model unavailable — start the local runtime, then reload."
                : undefined
            }
            onSend={handleSend}
            onStop={chat.stop}
          />
        </div>
      </main>
    </div>
  );
}
