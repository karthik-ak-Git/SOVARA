# ADR-0002: Model runtime abstraction (no single-LLM coupling)

## Status

Accepted

## Context

SOVARA must support multiple local open-weight models (reasoning, coding,
vision, embedding) across runtimes (llama.cpp, vLLM, Ollama, future). Coupling
the application to any one SDK would force rewrites per model.

## Decision

All inference flows through the `ModelProvider` ABC
(`info` / `health` / `infer` / `stream`) with capability advertisement
(`ModelCapabilities`, `ModelResource`). Metadata lives in `ModelRegistry`.
Application code never imports a runtime SDK. No routing intelligence in
Phase 0 — the registry only stores records.

## Consequences

Good: runtimes are swappable; router/planner (later) program to one seam.
Bad: lowest-common-denominator interface may hide runtime-specific features.
Mitigation: `metadata`/`resource` fields carry extras without breaking the seam.
