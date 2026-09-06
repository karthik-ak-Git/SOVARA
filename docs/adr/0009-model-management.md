# ADR-0009: Provider-independent model management (no routing)

## Status

Accepted

## Context

Slice 1 registered exactly one configured model. With real runtimes (LM
Studio lists 4 models), SOVARA needs discovery, normalized metadata, honest
availability, and manual selection — without building a router.

## Decision

1. **Canonical record** (`ModelRecord`): id (native runtime id, used verbatim
   in inference calls), display_name, provider, runtime, version,
   capabilities (`ModelCapabilities`: modalities/tasks lists + streaming /
   tool flags), capability_source (provider/configured/inferred),
   context_window, parameter_size_b, availability
   (available/unavailable/unknown), metadata. Unknown values stay null —
   adapters never invent metadata.
2. **Capabilities as claimed-task lists**, not boolean scorecards. Presence
   in `tasks` means "claimed by the source", nothing more. `TaskCapability`
   covers reasoning/coding/vision/embedding/ocr/document/tool_use/
   long_context. No benchmarking, no inference (INFERRED reserved).
3. **Discovery**: `ModelProvider.list_models()` returns normalized
   `ModelInfo`s, `[]` on failure. Adapters parse native listings (LM Studio
   `/v1/models`, Ollama `/api/tags`) and use `request.model_id` in payloads
   so any registered id dispatches to the right runtime model.
4. **Catalog lifecycle**: `ModelCatalog.refresh()` (startup + explicit
   `POST /models/refresh`) replaces registry contents; empty discovery
   falls back to one configured record (known-but-unavailable beats empty).
   Chat turns never pay discovery cost. Default: explicit override >
   configured native id > first available > first registered.
5. **Gateway stays the execution boundary**: resolve() fails unknown vs.
   unavailable distinctly (both 502 `model_error`). No scoring, no auto.
6. **API**: existing `/models` boundary, `items` envelope kept; item shape
   is the normalized record; `meta.default_model_id` added.

## Consequences

Good: UI lists real models with honest unknowns; selection flows
UI → API → gateway → provider; refresh without restart.
Bad: availability is probe-cached (stale between refreshes) — accepted,
 surfaced honestly via the UNKNOWN state and refresh endpoint.
