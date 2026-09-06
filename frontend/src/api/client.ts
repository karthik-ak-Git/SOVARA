/**
 * Typed API client — the ONLY place that talks HTTP outside feature streams.
 * Feature components call these functions; no fetch() in components.
 * (The chat SSE stream lives in features/chat/api/chatClient.ts.)
 */

import type { HealthResponse, ModelList, ProvidersResponse, SystemStatus } from "./types";

const BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://127.0.0.1:8000";

export const CHAT_PATH = "/api/v1/chat";

export function apiBase(): string {
  return BASE;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as unknown;
    throw new Error(
      `API ${res.status} ${path}: ${JSON.stringify(body ?? null)}`,
    );
  }
  return (await res.json()) as T;
}

export const api = {
  health(): Promise<HealthResponse> {
    return get<HealthResponse>("/api/v1/health");
  },
  status(): Promise<SystemStatus> {
    return get<SystemStatus>("/api/v1/status");
  },
  models(): Promise<ModelList> {
    return get<ModelList>("/api/v1/models");
  },
  providers(): Promise<ProvidersResponse> {
    return get<ProvidersResponse>("/api/v1/providers");
  },
};
