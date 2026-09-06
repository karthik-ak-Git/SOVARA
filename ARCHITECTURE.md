# SOVARA Architecture (Phase 0)

## 1. System boundaries

| Layer | Location | Phase 0 state |
|---|---|---|
| UI | `frontend/` | Live boundary: status display, typed API client |
| API gateway | `backend/src/sovara/main.py` + `api/v1/` | Live: 9 route groups, one error envelope |
| Application / orchestration | `application/` | Stub: `SystemService.status()` only |
| Agent runtime | `domain/agent.py` | Contract only (no loop) |
| Model gateway | `domain/model_provider.py`, `domain/model_registry.py` | Contract + in-memory registry |
| Knowledge | `domain/knowledge.py` | Contract only |
| Tools | `domain/tool.py`, `domain/tool_registry.py` | Contract + in-memory registry |
| Artifacts | `domain/artifact.py` | Shape only |
| Audit | `domain/audit.py` | Shape only |
| Security / policy | `infrastructure/security/` | Live abstractions: auth seam + `NetworkPolicy` gate |

## 2. Component responsibilities

- **Routes** validate input (Pydantic) and delegate; zero business logic.
- **Application services** compose domain contracts; only `SystemService` exists.
- **Domain** is dependency-free (stdlib + pydantic) and stable across phases.
- **Infrastructure** adapts outward: settings, JSON logging, registries,
  auth providers, network policy. Real DB/vector/object adapters plug in here.
- **Frontend** renders server state; HTTP only via `src/api/client.ts`.

## 3. Dependency direction

```text
api/v1/routes → application → domain ← infrastructure
frontend → (HTTP/OpenAPI) → api
tests → api + domain + infrastructure
```

Nothing imports inward-violating layers: domain never imports API or
infrastructure; the agent (later) resolves tools through `ToolRegistry` by
name, never by direct import.

## 4. Interfaces (all in `backend/src/sovara/domain/`)

- `ModelProvider`: info / health / infer / stream — any local runtime.
- `ModelRegistry` (+ `InMemoryModelRegistry`): register / get / list / remove.
- `Agent`: plan / execute / status with `AgentTask`, `Plan`, `AgentResult`.
- `Tool` + `ToolRegistry`: manifest (name, version, schemas, permissions),
  `execute()`, independent registration.
- `KnowledgeProvider`: ingest / search / fetch with `KnowledgeHit`, `Citation`.
- `Artifact` / `ArtifactRef`: uniform file shape for DOCX/XLSX/PPTX/PDF/code.
- `AuditEvent`: timestamp, actor, task, type, component, action, status, metadata.
- `SovaraError` hierarchy → single `{"error": {...}}` envelope.

## 5. Security boundaries

- **Secrets**: env-only, `SOVARA_` prefix; `.env.example` files contain no
  secrets; `.gitignore` excludes `.env`.
- **Validation**: every POST body is a Pydantic model; failures → `422`
  `validation_error` envelope.
- **Auth**: `AuthProvider` seam; Phase 0 ships `DisabledAuthProvider`
  (local-dev only); production must refuse `disabled` (see `provider_for_mode`).
- **Tools**: `ToolPermission` declared up front; defaults to `network.none`;
  no shell execution primitive exists anywhere in the codebase.
- **Logging**: JSON lines with correlation IDs; confidential content never
  logged (single audited gate `is_confidential_logging_enabled()` → `False`).
- **Errors**: generic `internal_error` for unhandled failures; details to logs.

## 6. Air-gapped design

- `NetworkPolicy` (`infrastructure/security/network_policy.py`) is the single
  egress choke point: `local_only=True` default, empty allowlist, loopback
  always allowed, everything else denied unless allowlisted.
- All future network-touching code (model downloads, tool fetch, crawlers)
  must call `check_egress()`; the policy itself performs no I/O.
- No dependency requires runtime internet: backend needs only
  fastapi/uvicorn/pydantic; frontend runtime is a static bundle + backend API.
- `GET /api/v1/status` exposes the live network posture (`local_only`,
  allowlist) so confinement is visible, not a badge.

## 7. Future extension points (explicitly deferred)

| Capability | Plug-in seam |
|---|---|
| Model runtimes (llama.cpp/vLLM/Ollama) | implement `ModelProvider`, register in `ModelRegistry` |
| Auto-routing | new service over `ModelRegistry.list()` |
| Agent loop | implement `Agent`, resolve tools via `ToolRegistry` |
| Sandboxed execution | `ToolPermission.CODE_EXEC_SANDBOXED` + executor infra |
| RAG / vector store | implement `KnowledgeProvider` + persistence adapter |
| OCR / vision | `TaskCapability.OCR/VISION` providers |
| DOCX/XLSX/PPTX/PDF | generators returning `Artifact` |
| Audit store | consumer of `AuditEvent` |
| Real auth/SSO/RBAC | implement `AuthProvider`, set `SOVARA_AUTH_MODE` |
| Postgres/object storage | infrastructure adapters; compose services on `sovara-net` |

## 8. Phase 1 / Slice 1: local chat harness (live)

```text
Chat UI -> POST /api/v1/chat (SSE) -> ChatService -> ModelGateway
  -> ModelProvider -> Ollama adapter | echo dev harness -> tokens -> UI
```

- **Stateless turns**: the client sends full message history; no server-side
  conversation memory (deferred). The UI persists conversations in
  localStorage; backend persistence stays deferred.
- **Gateway**: `ModelGateway` resolves one registered model (no routing).
  Unknown IDs fail as JSON `502 model_error` before the first SSE byte.
- **Providers** (`infrastructure/models/`, factory is the sole construction
  site): `OllamaProvider` (primary, `/api/chat` NDJSON, loopback default,
  non-loopback URLs pass the `NetworkPolicy` egress gate) and `EchoProvider`
  (deterministic dev harness, refused in production, never echoes content).
- **Streaming**: FastAPI `StreamingResponse` SSE (`token`/`done`/`error`
  events); client disconnect aborts provider iteration; per-request timeout
  via `SOVARA_CHAT_TIMEOUT_S`; malformed lines skipped on both ends.
- **Frontend** (`features/chat/`): HTTP only in `api/chatClient.ts`;
  generation state in `useChat`, conversation state in the layout;
  markdown via react-markdown, no UI framework.
- **Errors**: Phase 0 envelope throughout; the UI maps to five kinds
  (model_unavailable, validation, generation, connection, cancelled).

## 9. What Phase 0 deliberately omits

No persistence (registries are in-memory), no inference, no retrieval, no
execution, no generation, no production auth — per the Phase 0 definition of
done. Placeholders are always marked `phase0-placeholder` in responses.
