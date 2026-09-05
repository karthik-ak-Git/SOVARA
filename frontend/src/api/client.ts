/**
 * Typed API client — the ONLY place that talks HTTP.
 * Feature components call these functions; no fetch() in components.
 */

import type { HealthResponse, SystemStatus } from "./types";

const BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  "http://127.0.0.1:8000";

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
};
