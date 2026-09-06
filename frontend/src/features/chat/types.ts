/** Chat feature UI types. Plain data — no behavior, no imports. */

import type { ChatRole } from "../../api/types";

export type AssistantRole = Extract<ChatRole, "user" | "assistant">;

export interface UiMessage {
  id: string;
  role: AssistantRole;
  content: string;
}

export type ChatStatus =
  | "idle"
  | "streaming"
  | "error";

export type ChatErrorKind =
  | "model_unavailable"
  | "validation"
  | "generation"
  | "connection"
  | "cancelled";

export interface ChatError {
  kind: ChatErrorKind;
  message: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: UiMessage[];
  createdAt: number;
  updatedAt: number;
}
