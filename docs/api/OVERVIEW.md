# API Overview (v1, Phase 0)

Base path: `/api/v1` (configurable via `SOVARA_API_PREFIX`).
Envelope for every error: `{"error": {"code", "message", "details?", "request_id?"}}`.
Correlation: send `X-Request-ID` (optional); responses always return one.

| Method | Path | Purpose | Phase 0 behavior |
|---|---|---|---|
| GET | `/health` (root + `/api/v1/health`) | Liveness | Real: status/app/version/env |
| GET | `/api/v1/status` | System posture | Real composition (config + registries + network) |
| GET | `/api/v1/models` | Catalog | Empty list; `routing: deferred` |
| GET | `/api/v1/providers` | Runtime connections | **Live (Slice 3)** |
| POST | `/api/v1/routing/decide` | Routing preview | **Live (Slice 3)** |
| GET | `/api/v1/models/{id}` | Record | Record or `404 not_found` |
| GET | `/api/v1/conversations` | List | Empty; persistence deferred |
| POST | `/api/v1/conversations` | Create | Validated echo (`201`), no persistence |
| GET | `/api/v1/tasks` | List | Empty; agent loop deferred |
| POST | `/api/v1/tasks` | Create | Validated echo (`201`), no execution |
| GET | `/api/v1/tools` | Catalog | Empty list; execution deferred |
| GET | `/api/v1/tools/{name}` | Manifest | Manifest or `404 not_found` |
| POST | `/api/v1/knowledge/search` | Search | Empty; retrieval deferred |
| GET | `/api/v1/knowledge/documents` | List | Empty; ingestion deferred |
| GET | `/api/v1/artifacts` | List | Empty; generation deferred |
| GET | `/api/v1/audit/events` | List | Empty; event store deferred |
| POST | `/api/v1/chat` | Streaming chat turn | **Live (Slice 1): SSE stream** |

### GET /api/v1/models (Slice 2: normalized)

`{items: [{id, display_name, provider, runtime, version, capabilities,
capability_source, context_window, parameter_size_b, availability,
metadata}], meta: {routing: "deferred", source: "registry",
default_model_id}}`. Unknown values are null — never invented.

### GET /api/v1/models/{id} (Slice 2)

Single normalized record, or `404 not_found`.

### POST /api/v1/models/refresh (Slice 2, multi-runtime in Slice 3)

Re-runs provider discovery + health probes, replaces registry contents,
rebinds the gateway, returns the same shape as `GET /models`. Explicit
lifecycle — chat turns never pay discovery cost.

### GET /api/v1/models (Slice 3: routing flag)

Same normalized shape; `meta.routing` is `"auto"` when deterministic
smart routing is enabled (`SOVARA_ROUTING_ENABLED`, default true).

### GET /api/v1/providers (Slice 3)

Connection state per local runtime, separate from model availability:
`{items: [{provider, runtime, base_url, connected, detail, model_count}],
meta: {source: "connection-manager"}}`. A down runtime reports
`connected: false` without affecting other runtimes' models.

### POST /api/v1/routing/decide (Slice 3)

Routing preview without generation. Request `{text?, task_type?}` →
`{selected_model_id, task_profile, reason_codes, candidates,
decision_source: "deterministic_router"}`. No suitable model → JSON
`502 model_error` (`"No suitable local model available"`).

### POST /api/v1/chat (Slice 1, routing in Slice 3)

Request `{model_id?: string, messages: [{role, content}],
selection_mode?: "auto" | "manual", task_type?: string}` (1–64 messages,
content ≤ 12000 chars). Stateless: the client sends full history each turn.

- **Auto** (omitted/`"auto"` model_id, or `selection_mode: "auto"`):
  the turn is classified, the deterministic router picks the best
  available local model, availability is re-validated through the
  gateway, then generation streams.
- **Manual** (explicit `model_id`, or `selection_mode: "manual"`):
  the router is bypassed entirely and never overrides the pick.

### POST /api/v1/chat (Slice 1)

Request `{model_id?: string, messages: [{role, content}]}` (1–64 messages,
content ≤ 12000 chars). Stateless: the client sends full history each turn.

- Success: `200 text/event-stream`, events `data: {"type":"token","delta"}…`,
  then `data: {"type":"done","model_id","finish_reason":"stop","routing"}`,
  where `routing` is `{auto, task_type?, selected_model_id?, reason_codes?,
  decision_source?}` (concise reasons, never chain-of-thought).
- Unknown model / no suitable model: JSON `502 model_error` envelope
  (resolved before first byte).
- Mid-stream failure: `data: {"type":"error","code","message"}`, stream closes.
- Validation failure: JSON `422 validation_error` envelope.
- Timeout (`SOVARA_CHAT_TIMEOUT_S`): `error` event `"Generation timed out"`.
- Client disconnect aborts iteration server-side (real cancellation).

Full machine-readable contract: `GET /openapi.json` (or `/docs` UI) with the
backend running.
