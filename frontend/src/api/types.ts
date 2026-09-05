/** API contract types (mirror backend OpenAPI; hand-maintained in Phase 0). */

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

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    request_id?: string;
  };
}
