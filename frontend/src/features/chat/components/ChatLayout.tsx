import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import type { ModelItem, SelectionMode } from "../../../api/types";
import { useChat } from "../hooks/useChat";
import {
  createConversation,
  deleteConversation,
  listConversations,
  loadSelectedModelId,
  loadSelectionMode,
  retitleFromFirstUserMessage,
  saveConversation,
  saveSelectedModelId,
  saveSelectionMode,
} from "../lib/store";
import type { Conversation, UiMessage } from "../types";
import { Composer } from "./Composer";
import { GenerationControls } from "./GenerationControls";
import { MessageList } from "./MessageList";
import { ModelSelector } from "./ModelSelector";
import { Sidebar } from "./Sidebar";

interface ChatLayoutProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
}

/**
 * Chat screen composition. Owns conversation state (localStorage-backed),
 * the routing mode (auto = SOVARA Auto, manual = explicit pick), and the
 * manual selectedModelId; generation state lives in useChat. Model
 * metadata comes from GET /models. Manual selection bypasses routing.
 */
export function ChatLayout({ theme, onToggleTheme }: ChatLayoutProps): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>(() =>
    listConversations(),
  );
  const [activeId, setActiveId] = useState<string | null>(
    () => listConversations()[0]?.id ?? null,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    loadSelectedModelId(),
  );
  // Routing mode is explicit state, never inferred from selectedId:
  // manual = user's choice, auto = router's choice (default, persisted).
  const [mode, setMode] = useState<SelectionMode>(() => loadSelectionMode());
  const [localOnly, setLocalOnly] = useState(true);

  const loadModels = useCallback(() => {
    setModelsLoading(true);
    setModelsError(false);
    api
      .models()
      .then((m) => {
        setModels(m.items);
        setSelectedId((prev) => {
          if (prev !== null && m.items.some((i) => i.id === prev)) return prev;
          const fallback = m.meta.default_model_id || m.items[0]?.id || null;
          if (fallback !== null) saveSelectedModelId(fallback);
          return fallback;
        });
        setModelsLoading(false);
      })
      .catch(() => {
        setModelsError(true);
        setModelsLoading(false);
      });
    api
      .status()
      .then((s) => setLocalOnly(s.network.local_only))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const selected: ModelItem | null =
    models.find((m) => m.id === selectedId) ?? null;

  // Ref mirror: setActiveId is async, but persist() may run in the same
  // tick (new chat -> immediate send). The ref is always current.
  const activeIdRef = useRef<string | null>(listConversations()[0]?.id ?? null);
  const setActive = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  }, []);

  const active: Conversation | undefined = conversations.find((c) => c.id === activeId);
  const messages: UiMessage[] = active?.messages ?? [];

  const persist = useCallback(
    (next: UiMessage[]) => {
      const id = activeIdRef.current;
      setConversations((prev) => {
        const current = prev.find((c) => c.id === id);
        if (current === undefined) return prev;
        let updated: Conversation = { ...current, messages: next };
        if (current.title === "New chat") updated = retitleFromFirstUserMessage(updated);
        saveConversation(updated);
        return prev.map((c) => (c.id === updated.id ? updated : c));
      });
    },
    [activeId],
  );

  const chat = useChat(persist, {
    modelId: mode === "manual" ? (selectedId ?? undefined) : undefined,
    selectionMode: mode,
  });

  const handleSelectModel = useCallback((id: string) => {
    setMode("manual");
    saveSelectionMode("manual");
    setSelectedId(id);
    saveSelectedModelId(id);
  }, []);

  const handleSelectAuto = useCallback(() => {
    setMode("auto");
    saveSelectionMode("auto");
  }, []);

  const handleNewChat = useCallback(() => {
    const convo = createConversation();
    setConversations(listConversations());
    setActive(convo.id);
  }, [setActive]);

  const handleSelect = useCallback(
    (id: string) => {
      if (chat.status === "streaming") chat.stop();
      setActive(id);
      // Adopt the conversation's last-used model only in manual mode;
      // auto mode keeps routing every turn.
      if (mode !== "manual") return;
      const convo = listConversations().find((c) => c.id === id);
      if (convo?.modelId !== undefined) {
        setSelectedId((prev) => {
          if (models.some((m) => m.id === convo.modelId)) {
            saveSelectedModelId(convo.modelId as string);
            return convo.modelId as string;
          }
          return prev;
        });
      }
    },
    [chat, models, mode],
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
      const current = conversations.find((c) => c.id === id);
      // Stamp the turn's model for per-conversation memory: the explicit
      // pick in manual mode, the routed id in auto mode (when known).
      const stampId =
        mode === "manual" ? selectedId : (chat.routing?.selected_model_id ?? null);
      if (stampId !== null) {
        const stamped: Conversation = {
          ...(current as Conversation),
          modelId: stampId,
        };
        saveConversation(stamped);
        setConversations((prev) => prev.map((c) => (c.id === id ? stamped : c)));
      }
      chat.send(current?.messages ?? [], content);
    },
    [conversations, chat, selectedId, mode, setActive],
  );

  const autoResolved: ModelItem | null =
    mode === "auto" && chat.routing?.selected_model_id !== undefined
      ? (models.find((m) => m.id === chat.routing?.selected_model_id) ?? null)
      : null;

  const composerDisabled =
    models.length === 0 ||
    (mode === "manual"
      ? selected?.availability === "unavailable"
      : !models.some((m) => m.availability === "available"));

  const sidebarName =
    mode === "auto"
      ? (autoResolved !== null
          ? autoResolved.display_name || autoResolved.id
          : "SOVARA Auto")
      : (selected !== null ? selected.display_name || selected.id : null);
  const sidebarAvailability =
    mode === "auto"
      ? (autoResolved?.availability ?? "unknown")
      : (selected?.availability ?? "unknown");

  return (
    <div className="sv-app">
      <Sidebar
        collapsed={collapsed}
        conversations={conversations}
        activeId={activeId}
        modelDisplayName={sidebarName}
        modelAvailability={sidebarAvailability}
        localOnly={localOnly}
        onToggle={() => setCollapsed((c) => !c)}
        onNewChat={handleNewChat}
        onSelect={handleSelect}
        onDelete={handleDelete}
      />
      <main className="sv-main">
        <header className="sv-header">
          <span className="sv-header-title">{active?.title ?? "New chat"}</span>
          <ModelSelector
            models={models}
            selectedId={selectedId}
            loading={modelsLoading}
            loadError={modelsError}
            onSelect={handleSelectModel}
            onRetryLoad={loadModels}
            mode={mode}
            autoInfo={
              mode === "auto"
                ? {
                    resolvedId: chat.routing?.selected_model_id ?? null,
                    taskType: chat.routing?.task_type ?? null,
                    reasonCodes: chat.routing?.reason_codes ?? [],
                  }
                : null
            }
            onSelectAuto={handleSelectAuto}
          />
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
