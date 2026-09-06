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

export type ModelAvailability = "available" | "unavailable" | "unknown";

export type SelectionMode = "auto" | "manual";

export interface ProviderStatus {
  provider: string;
  runtime: string;
  base_url: string;
  connected: boolean;
  detail: string;
  model_count: number;
}

export interface ProvidersResponse {
  items: ProviderStatus[];
  meta: {
    source: string;
  };
}

/** Concise auto-routing metadata (reasons only, never chain-of-thought). */
export interface RoutingInfo {
  auto: boolean;
  task_type?: string;
  selected_model_id?: string;
  reason_codes?: string[];
  decision_source?: string;
}

export interface ModelItem {
  id: string;
  display_name: string;
  provider: string;
  runtime: string;
  version: string;
  role?: string;
  capabilities: ModelCapabilities;
  capability_source: string;
  context_window: number | null;
  parameter_size_b: number | null;
  availability: ModelAvailability;
  metadata: Record<string, string>;
}

export interface ModelList {
  items: ModelItem[];
  meta: {
    routing: string;
    source: string;
    default_model_id: string;
  };
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
  | {
      type: "done";
      model_id: string;
      finish_reason: string;
      routing?: RoutingInfo;
    }
  | { type: "error"; code: string; message: string };

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}
