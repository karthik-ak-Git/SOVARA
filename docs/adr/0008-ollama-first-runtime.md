# ADR-0008: Ollama first, echo harness for model-less environments

## Status

Accepted

## Context

Slice 1 needs exactly one primary local model path, but developer machines
may not have a runtime installed (this was true on the build machine). The
slice must still be verifiable end-to-end (UI → API → gateway → provider →
streaming → UI) without weakening the local-only security posture.

## Decision

- Primary path: `OllamaProvider` behind the `ModelProvider` ABC, default
  loopback base URL; non-loopback URLs must pass the `NetworkPolicy` egress
  gate at construction (denied under `local_only` unless allowlisted).
- Companion: `EchoProvider`, a deterministic in-process streaming stub that
  never echoes user content, selected via `SOVARA_MODEL_PROVIDER=echo` and
  hard-refused in production. It is a harness, not a model path: no routing,
  no capabilities beyond streaming text.
- The factory (`infrastructure/models/factory.py`) is the sole construction
  site; it registers the model record with a live availability probe so
  `GET /models` and the UI show real status.

## Consequences

Good: full vertical slice testable anywhere; production cannot serve echo;
adding llama.cpp/vLLM later means one new adapter + factory branch.
Bad: two providers exist in-tree (mitigated: echo is fenced by env + docs).
