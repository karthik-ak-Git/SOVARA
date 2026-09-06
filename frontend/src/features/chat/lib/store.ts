/**
 * Conversation persistence (localStorage). Server-side memory is deferred,
 * so the client owns conversation history; each turn sends full history.
 */

import type { Conversation, UiMessage } from "../types";

const KEY = "sovara.conversations.v1";
const MAX_STORED = 50;

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

function read(): Conversation[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as Conversation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(convos: Conversation[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(convos.slice(0, MAX_STORED)));
  } catch {
    // storage full or unavailable: chat still works in-memory
  }
}

export function listConversations(): Conversation[] {
  return read().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createConversation(firstMessage?: string): Conversation {
  const now = Date.now();
  const convo: Conversation = {
    id: uid(),
    title:
      firstMessage === undefined || firstMessage.trim() === ""
        ? "New chat"
        : firstMessage.trim().slice(0, 48),
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  write([convo, ...read()]);
  return convo;
}

export function saveConversation(convo: Conversation): void {
  const rest = read().filter((c) => c.id !== convo.id);
  write([{ ...convo, updatedAt: Date.now() }, ...rest]);
}

export function deleteConversation(id: string): void {
  write(read().filter((c) => c.id !== id));
}

const SELECTED_KEY = "sovara.selectedModel.v1";

export function loadSelectedModelId(): string | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    return raw === null || raw === "" ? null : raw;
  } catch {
    return null;
  }
}

export function saveSelectedModelId(id: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // storage unavailable: selection still works in-memory
  }
}

const MODE_KEY = "sovara.selectionMode.v1";

/** Routing mode: auto (router decides) is the default; manual is explicit. */
export function loadSelectionMode(): "auto" | "manual" {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    return raw === "manual" ? "manual" : "auto";
  } catch {
    return "auto";
  }
}

export function saveSelectionMode(mode: "auto" | "manual"): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // storage unavailable: mode still works in-memory
  }
}

export function retitleFromFirstUserMessage(convo: Conversation): Conversation {
  const first = convo.messages.find((m: UiMessage) => m.role === "user");
  if (first === undefined) return convo;
  return { ...convo, title: first.content.trim().slice(0, 48) || "New chat" };
}

export { uid };
