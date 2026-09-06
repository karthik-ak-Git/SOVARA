# ADR-0010: Multi-runtime connections + deterministic smart routing

## Status

Accepted (Phase 1 / Slice 3)

## Context

Slice 2 normalized the model catalog and shipped manual selection against
a single configured runtime. The SIH requirement expects SOVARA to support
multiple open-weight models, pick an appropriate model per task type, and
accept new models later without redesign. Slices 1–2 also left two gaps:

1. The backend was built around one provider instance (`build_provider`,
   single-provider `ModelCatalog`); LM Studio and Ollama could not coexist.
2. Provider state and model state were conflated (one health probe decided
   the whole registry's availability).

## Decision

### 1. Connection layer (Part A)

- **`ProviderRegistry`** (application): kind → adapter map
  (`lmstudio | ollama | echo | future`). No I/O, no discovery.
- **`RuntimeConnectionManager`** (application): provider-independent
  `check_connections()` → `ProviderStatus[]` and `discover_models()`
  per adapter. Zero provider-specific HTTP; every adapter isolated with
  try/except so one down runtime never breaks the others.
- **`ModelCatalog`** is now multi-runtime: per-provider probe +
  discovery, normalize with the *discovering kind* stamped as
  `record.provider` (so `provider_map()` always resolves), one
  configured fallback record per silent/down runtime. Explicit refresh
  lifecycle unchanged (startup + `POST /models/refresh`), never per-chat.
- **Factory** builds every enabled runtime (`SOVARA_ENABLED_PROVIDERS`,
  default `lmstudio,ollama`; echo joins when `MODEL_PROVIDER=echo` outside
  production). A `NetworkPolicy`-denied runtime is skipped with a warning,
  never connected. `build_provider()` stays for backward compatibility.
- **API**: `GET /providers` reports connection state separately from
  `/models` availability; `meta.routing` is `"auto"` when
  `SOVARA_ROUTING_ENABLED` (default true).

### 2. Deterministic routing (Part B)

- **`TaskProfile`** (domain): `task_type` (7 values: general, reasoning,
  coding, document, analysis, vision, data), modalities, required tasks,
  context size, tool flag, profile source. Small and extensible by design.
- **Classifier** (application): explicit UI hint > image modality >
  lexical rules > general. No LLM, no learning — fast and testable.
- **Router** (application): available-only → hard constraints (modality,
  context fit; explicit capability mismatch excluded) → additive
  transparent scoring → deterministic tie-break (score, configured
  default, model id). Unknown capabilities are eligible fallbacks that
  never outrank a claiming model. No candidate → `ModelError`
  ("No suitable local model available"), never a silent misroute.
- **Gateway stays the execution boundary**: the router never calls a
  runtime; `ChatService.decide()` routes, then re-validates through
  `gateway.resolve()`.
- **Modes**: `selection_mode: auto | manual`. Explicit `model_id` implies
  manual and bypasses the router entirely; omitted/`"auto"` (or explicit
  auto) routes. `POST /routing/decide` previews decisions; the chat `done`
  event carries concise `routing` metadata (reasons only, no CoT).
- **Echo harness** claims no task capabilities (honest unknown for a
  pipeline verifier), so it routes as a fallback everywhere.

## Consequences

Good: runtimes coexist; provider vs model health is separable and
observable; routing is explainable (`reason_codes`), reproducible, and
cheap (no LLM call to pick a model); manual override can never be
silently overridden; new open-weight models appear via discovery with
zero redesign (future: per-id configured capability overrides).

Bad / accepted: capability metadata for discovered models is usually
unknown (e.g. LM Studio lists no task claims), so early routing relies on
fallback + tie-break until configured overrides exist; availability is
still probe-cached between refreshes; embedding/latent-specialist models
are indistinguishable from chat models until then.

## Verification (2026-09-06, live LM Studio)

Discovered 4 models (`qwen/qwen3.5-9b`, `nvidia/nemotron-3-nano-4b`,
`zai-org/glm-4.6v-flash`, `text-embedding-nomic-embed-text-v1.5`);
`GET /providers` showed `lmstudio connected=True (4)`,
`ollama connected=False (1 fallback)`. Manual turns to two distinct
models returned matching `done.model_id`s with request logs proving
`requested == resolved == runtime_model_id`; an auto coding turn routed
to `nemotron-3-nano-4b` (reasons: available, unknown caps, text) and
streamed 176 tokens with routing metadata in the `done` event. Ollama
was down — `Unavailable` recorded as a valid result per plan.
