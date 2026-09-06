# API Overview (v1, Phase 0)

Base path: `/api/v1` (configurable via `SOVARA_API_PREFIX`).
Envelope for every error: `{"error": {"code", "message", "details?", "request_id?"}}`.
Correlation: send `X-Request-ID` (optional); responses always return one.

| Method | Path | Purpose | Phase 0 behavior |
|---|---|---|---|
| GET | `/health` (root + `/api/v1/health`) | Liveness | Real: status/app/version/env |
| GET | `/api/v1/status` | System posture | Real composition (config + registries + network) |
| GET | `/api/v1/models` | Catalog | Empty list; `routing: deferred` |
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

### POST /api/v1/chat (Slice 1)

Request `{model_id?: string, messages: [{role, content}]}` (1–64 messages,
content ≤ 12000 chars). Stateless: the client sends full history each turn.

- Success: `200 text/event-stream`, events `data: {"type":"token","delta"}…`,
  then `data: {"type":"done","model_id","finish_reason":"stop"}`.
- Unknown model: JSON `502 model_error` envelope (resolved before first byte).
- Mid-stream failure: `data: {"type":"error","code","message"}`, stream closes.
- Validation failure: JSON `422 validation_error` envelope.
- Timeout (`SOVARA_CHAT_TIMEOUT_S`): `error` event `"Generation timed out"`.
- Client disconnect aborts iteration server-side (real cancellation).

Full machine-readable contract: `GET /openapi.json` (or `/docs` UI) with the
backend running.
