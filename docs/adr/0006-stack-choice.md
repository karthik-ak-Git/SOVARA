# ADR-0006: Python FastAPI backend + React/Vite frontend

## Status

Accepted

## Context

Greenfield repo, no stack to preserve. The backend's future is Python-shaped
(RAG, OCR, document/office-file generation, model orchestration), while the
UI needs a typed component boundary. Options were a TS full-stack (single
language) vs Python API + TS UI.

## Decision

Python 3.12+ FastAPI modular monolith for the backend (async, Pydantic v2,
OpenAPI as the contract), Vite + React + strict TypeScript for the frontend
(status display only in Phase 0). Backend managed with `uv` (no pip);
frontend with npm. OpenAPI JSON is the shared contract — no shared-code
package in Phase 0.

## Consequences

Good: each side uses its strongest ecosystem; contract via HTTP stays clean.
Bad: two toolchains (uv + npm) for contributors.
Mitigation: DEVELOPMENT.md documents both; Compose hides them for runners.
Full design-system decisions (MUI/TanStack) are deferred to the UI phase.
