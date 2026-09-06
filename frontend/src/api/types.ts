/** API contract types (mirror backend OpenAPI; hand-maintained). */

export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  env: string;
}

export interface SystemStatus {
  app: string;
  version: string;
  env: string;
  api_prefix: string;
  models_registered: number;
  tools_registered: number;
  network: {
    local_only: boolean;
    allowed_endpoints: string[];
    audit_log: boolean;
  };
  auth_mode: string;
  capabilities: Record<string, string>;
}

export interface ModelCapabilities {
  modalities: string[];
  tasks: string[];
  supports_streaming: boolean;
  supports_tools: boolean;
}

export interface ModelRecord {
  model_id: string;
  provider: string;
  capabilities: ModelCapabilities;
  resource: Record<string, number | null>;
  available: boolean;
}

export interface ModelList {
  items: ModelRecord[];
  meta: Record<string, string>;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessageIn {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  model_id?: string;
  messages: ChatMessageIn[];
}

export type ChatEvent =
  | { type: "token"; delta: string }
  | { type: "done"; model_id: string; finish_reason: string }
  | { type: "error"; code: string; message: string };

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}
